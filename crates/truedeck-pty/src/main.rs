//! TrueDeck PTY sidecar — native ConPTY/Unix PTY over newline-delimited JSON.
//!
//! Protocol (stdin → host, stdout ← host): one JSON object per line.
//!
//! Requests:
//!   { "type":"spawn", "id":"...", "command":"...", "args":[...], "cwd":"...",
//!     "cols":120, "rows":30, "env":{"K":"V"} }
//!   { "type":"write", "id":"...", "data_b64":"..." }
//!   { "type":"resize", "id":"...", "cols":120, "rows":30 }
//!   { "type":"kill", "id":"..." }
//!   { "type":"list" }
//!   { "type":"ping" }
//!   { "type":"shutdown" }
//!
//! Events:
//!   { "type":"ready", "version":"0.1.0" }
//!   { "type":"spawned", "id":"..." }
//!   { "type":"data", "id":"...", "data_b64":"..." }
//!   { "type":"exit", "id":"...", "code":0 }
//!   { "type":"error", "id":null|"...", "message":"..." }
//!   { "type":"pong" }
//!   { "type":"list", "ids":["..."] }

use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Request {
    Spawn {
        id: String,
        command: String,
        #[serde(default)]
        args: Vec<String>,
        cwd: String,
        #[serde(default = "default_cols")]
        cols: u16,
        #[serde(default = "default_rows")]
        rows: u16,
        #[serde(default)]
        env: HashMap<String, String>,
    },
    Write {
        id: String,
        data_b64: String,
    },
    Resize {
        id: String,
        cols: u16,
        rows: u16,
    },
    Kill {
        id: String,
    },
    List,
    Ping,
    Shutdown,
}

fn default_cols() -> u16 {
    120
}
fn default_rows() -> u16 {
    30
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Event {
    Ready {
        version: String,
    },
    Spawned {
        id: String,
    },
    Data {
        id: String,
        data_b64: String,
    },
    Exit {
        id: String,
        code: i32,
    },
    Error {
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        message: String,
    },
    Pong,
    List {
        ids: Vec<String>,
    },
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    /// Kill handle — drop or kill child
    child: Box<dyn portable_pty::Child + Send>,
}

type Sessions = Arc<Mutex<HashMap<String, Session>>>;

fn emit(ev: &Event) {
    let mut out = std::io::stdout().lock();
    if let Ok(line) = serde_json::to_string(ev) {
        let _ = writeln!(out, "{line}");
        let _ = out.flush();
    }
}

fn main() {
    // Line-buffered style for Electron parent
    let _ = std::io::stdout().flush();
    emit(&Event::Ready {
        version: VERSION.to_string(),
    });

    let sessions: Sessions = Arc::new(Mutex::new(HashMap::new()));
    let stdin = std::io::stdin();
    let reader = BufReader::new(stdin.lock());

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                emit(&Event::Error {
                    id: None,
                    message: format!("stdin read: {e}"),
                });
                break;
            }
        };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let req: Request = match serde_json::from_str(line) {
            Ok(r) => r,
            Err(e) => {
                emit(&Event::Error {
                    id: None,
                    message: format!("bad request: {e}"),
                });
                continue;
            }
        };

        match req {
            Request::Ping => emit(&Event::Pong),
            Request::Shutdown => {
                kill_all(&sessions);
                break;
            }
            Request::List => {
                let ids: Vec<String> = sessions.lock().keys().cloned().collect();
                emit(&Event::List { ids });
            }
            Request::Spawn {
                id,
                command,
                args,
                cwd,
                cols,
                rows,
                env,
            } => {
                if let Err(e) = spawn_session(
                    sessions.clone(),
                    id.clone(),
                    command,
                    args,
                    cwd,
                    cols,
                    rows,
                    env,
                ) {
                    emit(&Event::Error {
                        id: Some(id),
                        message: format!("{e:#}"),
                    });
                }
            }
            Request::Write { id, data_b64 } => {
                if let Err(e) = write_session(&sessions, &id, &data_b64) {
                    emit(&Event::Error {
                        id: Some(id),
                        message: format!("{e:#}"),
                    });
                }
            }
            Request::Resize { id, cols, rows } => {
                if let Err(e) = resize_session(&sessions, &id, cols, rows) {
                    emit(&Event::Error {
                        id: Some(id),
                        message: format!("{e:#}"),
                    });
                }
            }
            Request::Kill { id } => {
                kill_session(&sessions, &id);
            }
        }
    }

    kill_all(&sessions);
}

fn spawn_session(
    sessions: Sessions,
    id: String,
    command: String,
    args: Vec<String>,
    cwd: String,
    cols: u16,
    rows: u16,
    env: HashMap<String, String>,
) -> Result<()> {
    if sessions.lock().contains_key(&id) {
        return Err(anyhow!("session already exists: {id}"));
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .context("openpty")?;

    let mut cmd = CommandBuilder::new(&command);
    for a in &args {
        cmd.arg(a);
    }
    cmd.cwd(&cwd);
    // Inherit process env then overlay
    for (k, v) in std::env::vars() {
        // Don't clobber explicit overrides later
        if !env.contains_key(&k) {
            cmd.env(k, v);
        }
    }
    for (k, v) in &env {
        cmd.env(k, v);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .with_context(|| format!("spawn {command}"))?;
    // Drop slave so child is sole owner on Unix
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .context("clone reader")?;
    let writer = pair
        .master
        .take_writer()
        .context("take writer")?;

    {
        let mut map = sessions.lock();
        map.insert(
            id.clone(),
            Session {
                master: pair.master,
                writer,
                child,
            },
        );
    }

    emit(&Event::Spawned { id: id.clone() });

    // Reader thread → data events
    let sessions_r = sessions.clone();
    let id_r = id.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    emit(&Event::Data {
                        id: id_r.clone(),
                        data_b64: B64.encode(&buf[..n]),
                    });
                }
                Err(_) => break,
            }
        }
        // Wait for exit code
        let code = {
            let mut map = sessions_r.lock();
            if let Some(mut sess) = map.remove(&id_r) {
                match sess.child.try_wait() {
                    Ok(Some(status)) => status.exit_code() as i32,
                    _ => {
                        // brief poll
                        thread::sleep(Duration::from_millis(50));
                        match sess.child.try_wait() {
                            Ok(Some(status)) => status.exit_code() as i32,
                            _ => {
                                let _ = sess.child.kill();
                                -1
                            }
                        }
                    }
                }
            } else {
                0
            }
        };
        emit(&Event::Exit {
            id: id_r,
            code,
        });
    });

    Ok(())
}

fn write_session(sessions: &Sessions, id: &str, data_b64: &str) -> Result<()> {
    let bytes = B64
        .decode(data_b64)
        .context("decode data_b64")?;
    let mut map = sessions.lock();
    let sess = map
        .get_mut(id)
        .ok_or_else(|| anyhow!("unknown session {id}"))?;
    sess.writer.write_all(&bytes).context("pty write")?;
    sess.writer.flush().ok();
    Ok(())
}

fn resize_session(sessions: &Sessions, id: &str, cols: u16, rows: u16) -> Result<()> {
    let map = sessions.lock();
    let sess = map
        .get(id)
        .ok_or_else(|| anyhow!("unknown session {id}"))?;
    sess.master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .context("resize")?;
    Ok(())
}

fn kill_session(sessions: &Sessions, id: &str) {
    let mut map = sessions.lock();
    if let Some(mut sess) = map.remove(id) {
        let _ = sess.child.kill();
        emit(&Event::Exit {
            id: id.to_string(),
            code: -1,
        });
    }
}

fn kill_all(sessions: &Sessions) {
    let mut map = sessions.lock();
    for (id, mut sess) in map.drain() {
        let _ = sess.child.kill();
        emit(&Event::Exit { id, code: -1 });
    }
}
