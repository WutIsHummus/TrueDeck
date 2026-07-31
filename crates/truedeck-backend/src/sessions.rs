//! PTY session host (portable-pty / ConPTY).

use crate::protocol::Event;
use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use uuid::Uuid;

/// Parent shells (and agent hosts that launch TrueDeck) often set these to
/// silence ANSI. Agent CLIs honor them and paint monochrome - strip on spawn.
fn should_strip_parent_env(key: &str) -> bool {
    matches!(
        key,
        "NO_COLOR" | "FORCE_COLOR" | "CLICOLOR" | "CLICOLOR_FORCE"
    )
}

fn is_dumb_term(value: &str) -> bool {
    let t = value.trim();
    t.is_empty() || t.eq_ignore_ascii_case("dumb") || t.eq_ignore_ascii_case("unknown")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub agent_id: String,
    pub agent_name: String,
    pub color: String,
    pub project_root: String,
    pub status: String,
    pub created_at: u64,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command_line: Option<String>,
}

struct Live {
    info: SessionInfo,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send>,
}

pub struct SessionManager {
    sessions: Arc<Mutex<HashMap<String, Live>>>,
    emit: Arc<dyn Fn(Event) + Send + Sync>,
}

impl SessionManager {
    pub fn new(emit: Arc<dyn Fn(Event) + Send + Sync>) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            emit,
        }
    }

    pub fn list(&self) -> Vec<SessionInfo> {
        self.sessions
            .lock()
            .values()
            .map(|s| s.info.clone())
            .collect()
    }

    pub fn spawn(
        &self,
        command: &str,
        args: &[String],
        cwd: &str,
        cols: u16,
        rows: u16,
        env: &HashMap<String, String>,
        meta: SessionInfo,
    ) -> Result<SessionInfo> {
        let id = meta.id.clone();
        if self.sessions.lock().contains_key(&id) {
            return Err(anyhow!("session exists: {id}"));
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

        let mut cmd = CommandBuilder::new(command);
        for a in args {
            cmd.arg(a);
        }
        cmd.cwd(cwd);
        // Inherit parent env, but never color-silencing flags.
        // Cursor / Claude Code / Grok Build often set NO_COLOR=1, FORCE_COLOR=0,
        // TERM=dumb on their own process - if we pass those through, every agent
        // TUI in TrueDeck renders monochrome (black & white) instead of brand colors.
        for (k, v) in std::env::vars() {
            if should_strip_parent_env(&k) {
                continue;
            }
            // Never inherit a dumb/broken TERM from the host process
            if k == "TERM" && is_dumb_term(&v) {
                continue;
            }
            if !env.contains_key(&k) {
                cmd.env(&k, v);
            }
        }
        for (k, v) in env {
            if should_strip_parent_env(k) {
                continue;
            }
            cmd.env(k, v);
        }
        // Force modern terminal identity so agent TUIs (Claude/Codex/Grok/etc.)
        // enable full-screen alt buffer, colors, and mouse properly.
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "TrueDeck");
        // chalk / supports-color / rich / many CLIs: 3 = truecolor
        cmd.env("FORCE_COLOR", "3");
        cmd.env("CLICOLOR", "1");
        cmd.env("CLICOLOR_FORCE", "1");

        let child = pair
            .slave
            .spawn_command(cmd)
            .with_context(|| format!("spawn {command}"))?;
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().context("clone reader")?;
        let writer = pair.master.take_writer().context("take writer")?;

        let info = meta;
        {
            let mut map = self.sessions.lock();
            map.insert(
                id.clone(),
                Live {
                    info: info.clone(),
                    master: pair.master,
                    writer,
                    child,
                },
            );
        }

        let sessions = self.sessions.clone();
        let emit = self.emit.clone();
        let id_r = id.clone();
        thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        emit(Event::new(
                            "pty.data",
                            json!({
                                "id": id_r,
                                "data_b64": B64.encode(&buf[..n]),
                            }),
                        ));
                    }
                    Err(_) => break,
                }
            }
            let code = {
                let mut map = sessions.lock();
                if let Some(mut live) = map.remove(&id_r) {
                    match live.child.try_wait() {
                        Ok(Some(st)) => st.exit_code() as i32,
                        _ => {
                            thread::sleep(Duration::from_millis(40));
                            match live.child.try_wait() {
                                Ok(Some(st)) => st.exit_code() as i32,
                                _ => {
                                    let _ = live.child.kill();
                                    -1
                                }
                            }
                        }
                    }
                } else {
                    0
                }
            };
            emit(Event::new(
                "pty.exit",
                json!({ "id": id_r, "exitCode": code }),
            ));
        });

        Ok(info)
    }

    pub fn write(&self, id: &str, data: &str) -> Result<()> {
        let mut map = self.sessions.lock();
        let live = map
            .get_mut(id)
            .ok_or_else(|| anyhow!("unknown session {id}"))?;
        live.writer
            .write_all(data.as_bytes())
            .context("pty write")?;
        let _ = live.writer.flush();
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<()> {
        let map = self.sessions.lock();
        let live = map
            .get(id)
            .ok_or_else(|| anyhow!("unknown session {id}"))?;
        live.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("resize")?;
        Ok(())
    }

    pub fn kill(&self, id: &str) {
        let mut map = self.sessions.lock();
        if let Some(mut live) = map.remove(id) {
            let _ = live.child.kill();
            (self.emit)(Event::new(
                "pty.exit",
                json!({ "id": id, "exitCode": -1 }),
            ));
        }
    }

    pub fn kill_all(&self) {
        let mut map = self.sessions.lock();
        for (id, mut live) in map.drain() {
            let _ = live.child.kill();
            (self.emit)(Event::new(
                "pty.exit",
                json!({ "id": id, "exitCode": -1 }),
            ));
        }
    }
}

pub fn new_session_id() -> String {
    Uuid::new_v4().to_string()
}

pub fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
