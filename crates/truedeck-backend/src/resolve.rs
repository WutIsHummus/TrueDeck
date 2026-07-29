//! Resolve agent commands to real CLI binaries only (never IDE apps).

use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant};

struct CacheEntry {
    command: String,
    args: Vec<String>,
    available: bool,
    at: Instant,
}

static CACHE: Mutex<Option<HashMap<String, CacheEntry>>> = Mutex::new(None);
const TTL: Duration = Duration::from_secs(300);

pub struct ResolveResult {
    pub command: String,
    pub args: Vec<String>,
    pub available: bool,
}

fn which(cmd: &str) -> Option<String> {
    if cfg!(windows) {
        let out = Command::new("where.exe").arg(cmd).output().ok()?;
        if !out.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&out.stdout);
        let lines: Vec<&str> = text
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .collect();
        lines
            .iter()
            .find(|p| {
                let l = p.to_lowercase();
                l.ends_with(".cmd") || l.ends_with(".exe")
            })
            .or(lines.first())
            .map(|s| s.to_string())
    } else {
        let out = Command::new("which").arg(cmd).output().ok()?;
        if !out.status.success() {
            return None;
        }
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    }
}

fn first_existing(paths: &[PathBuf]) -> Option<PathBuf> {
    paths.iter().find(|p| p.exists()).cloned()
}

/// True for Cursor/VS Code GUI binaries. `cursor.cmd` under Program Files launches Cursor.exe.
fn is_ide_binary(path: &str) -> bool {
    let lower = path.to_lowercase().replace('\\', "/");
    let base = lower.rsplit('/').next().unwrap_or(&lower);
    if base == "cursor.exe" || base == "code.exe" || base == "code" {
        return true;
    }
    if lower.contains("/program files/cursor/") && !lower.contains("cursor-agent") {
        return true;
    }
    if lower.contains("/program files (x86)/cursor/") && !lower.contains("cursor-agent") {
        return true;
    }
    if lower.contains("/programs/cursor/") && base.starts_with("cursor") {
        return true;
    }
    if lower.contains("/cursor/resources/app/bin/") && !lower.contains("cursor-agent") {
        return true;
    }
    if lower.ends_with("/cursor.cmd") && !lower.contains("cursor-agent") {
        return true;
    }
    if lower.ends_with("/cursor") && !lower.contains("cursor-agent") {
        return true;
    }
    false
}

/// Returns (command, args) — may be unavailable (caller must check full).
pub fn resolve_agent(agent_id: &str, command: &str, args: &[String]) -> (String, Vec<String>) {
    let r = resolve_agent_full(agent_id, command, args);
    (r.command, r.args)
}

pub fn resolve_agent_full(agent_id: &str, command: &str, args: &[String]) -> ResolveResult {
    let key = format!("{agent_id}\0{command}\0{}", args.join("\0"));
    {
        let mut guard = CACHE.lock();
        if guard.is_none() {
            *guard = Some(HashMap::new());
        }
        if let Some(map) = guard.as_mut() {
            if let Some(e) = map.get(&key) {
                if e.at.elapsed() < TTL {
                    return ResolveResult {
                        command: e.command.clone(),
                        args: e.args.clone(),
                        available: e.available,
                    };
                }
            }
        }
    }

    let resolved = resolve_uncached(agent_id, command, args);

    {
        let mut guard = CACHE.lock();
        if let Some(map) = guard.as_mut() {
            map.insert(
                key,
                CacheEntry {
                    command: resolved.command.clone(),
                    args: resolved.args.clone(),
                    available: resolved.available,
                    at: Instant::now(),
                },
            );
        }
    }
    resolved
}

fn resolve_uncached(agent_id: &str, command: &str, args: &[String]) -> ResolveResult {
    // TrueDeck frame wrapper: trust absolute node + truedeck-frame.mjs args as-is
    let is_frame = args.iter().any(|a| a.contains("truedeck-frame"));
    if is_frame {
        if std::path::Path::new(command).exists() || command.to_ascii_lowercase().contains("node") {
            return ResolveResult {
                command: command.to_string(),
                args: args.to_vec(),
                available: true,
            };
        }
    }

    if agent_id == "cursor" && !is_frame {
        return resolve_cursor_agent();
    }
    if agent_id == "shell" && !is_frame {
        if cfg!(windows) {
            return ResolveResult {
                command: "powershell.exe".into(),
                args: if args.is_empty() {
                    vec!["-NoLogo".into()]
                } else {
                    args.to_vec()
                },
                available: true,
            };
        }
        let sh = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
        return ResolveResult {
            command: sh,
            args: args.to_vec(),
            available: true,
        };
    }

    if is_ide_binary(command) || command.eq_ignore_ascii_case("cursor") {
        return ResolveResult {
            command: command.to_string(),
            args: args.to_vec(),
            available: false,
        };
    }

    let p = PathBuf::from(command);
    if p.exists() && !is_ide_binary(command) {
        return ResolveResult {
            command: command.to_string(),
            args: args.to_vec(),
            available: true,
        };
    }
    if let Some(w) = which(command) {
        if !is_ide_binary(&w) {
            return ResolveResult {
                command: w,
                args: args.to_vec(),
                available: true,
            };
        }
    }
    if cfg!(windows) {
        let home = dirs::home_dir().unwrap_or_default();
        let appdata = std::env::var("APPDATA").unwrap_or_default();
        let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let candidates = [
            PathBuf::from(&appdata).join("npm").join(format!("{command}.cmd")),
            PathBuf::from(&local)
                .join("nvm")
                .join("nodejs")
                .join(format!("{command}.cmd")),
            PathBuf::from(r"C:\nvm4w\nodejs").join(format!("{command}.cmd")),
            home.join(".grok").join("bin").join(format!("{command}.exe")),
            home.join(".local").join("bin").join(command),
        ];
        if let Some(hit) = first_existing(&candidates) {
            let s = hit.to_string_lossy().to_string();
            if !is_ide_binary(&s) {
                return ResolveResult {
                    command: s,
                    args: args.to_vec(),
                    available: true,
                };
            }
        }
    }
    ResolveResult {
        command: command.to_string(),
        args: args.to_vec(),
        available: false,
    }
}

/// Prefer node.exe + index.js under %LOCALAPPDATA%\cursor-agent\versions\*
fn resolve_cursor_agent() -> ResolveResult {
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let base = PathBuf::from(&local).join("cursor-agent");
    let versions = base.join("versions");

    let try_dir = |dir: &PathBuf| -> Option<ResolveResult> {
        let node = dir.join("node.exe");
        let index = dir.join("index.js");
        if node.exists() && index.exists() {
            return Some(ResolveResult {
                command: node.to_string_lossy().to_string(),
                args: vec![index.to_string_lossy().to_string()],
                available: true,
            });
        }
        None
    };

    if versions.is_dir() {
        if let Ok(rd) = std::fs::read_dir(&versions) {
            let mut dirs: Vec<_> = rd.flatten().filter(|e| e.path().is_dir()).collect();
            dirs.sort_by_key(|e| {
                std::cmp::Reverse(
                    e.metadata()
                        .and_then(|m| m.modified())
                        .ok()
                        .unwrap_or(std::time::SystemTime::UNIX_EPOCH),
                )
            });
            for d in dirs {
                if let Some(r) = try_dir(&d.path()) {
                    return r;
                }
            }
        }
    }

    if let Some(r) = try_dir(&base) {
        return r;
    }

    // Never fall back to Cursor IDE (`cursor` / Cursor.exe)
    ResolveResult {
        command: "cursor-agent".into(),
        args: vec![],
        available: false,
    }
}
