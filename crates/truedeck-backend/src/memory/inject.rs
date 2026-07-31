//! Wire memory into agent CLI configs (Cursor/Claude MCP, unified `.agents/`, etc.).
//!
//! Project source of truth is `.agents/AGENTS.md` + `.agents/mcp.json`.
//! Prefer the TypeScript inject path in Electron (full MCP hub); this Rust
//! path is a fallback for backend-only callers.

use crate::memory::palace_path;
use crate::paths::{data_dir, ensure_dir};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InjectResult {
    pub agent_id: String,
    pub ok: bool,
    pub files_written: Vec<String>,
    pub message: String,
}

fn read_json(path: &Path) -> Value {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(json!({}))
}

fn write_json(path: &Path, v: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        ensure_dir(parent);
    }
    fs::write(path, serde_json::to_string_pretty(v).map_err(|e| e.to_string())? + "\n")
        .map_err(|e| e.to_string())
}

fn merge_mcp_servers(path: &Path, servers: &Value) -> Result<String, String> {
    let mut cur = read_json(path);
    let obj = cur.as_object_mut().cloned().unwrap_or_default();
    let mut root = serde_json::Map::from_iter(obj);
    let mut existing = root
        .get("mcpServers")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    if let Some(s) = servers.as_object() {
        for (k, v) in s {
            existing.insert(k.clone(), v.clone());
        }
    }
    root.insert("mcpServers".into(), Value::Object(existing));
    let out = Value::Object(root);
    write_json(path, &out)?;
    Ok(path.to_string_lossy().into())
}

fn mcp_entry(palace: &Path) -> Value {
    let home = dirs::home_dir().unwrap_or_default();
    let mcp = if cfg!(windows) {
        home.join(".local").join("bin").join("mempalace-mcp.exe")
    } else {
        home.join(".local").join("bin").join("mempalace-mcp")
    };
    let command = if mcp.exists() {
        mcp.to_string_lossy().to_string()
    } else if cfg!(windows) {
        "mempalace-mcp.exe".into()
    } else {
        "mempalace-mcp".into()
    };
    json!({
        "command": command,
        "args": ["--palace", palace.to_string_lossy()],
    })
}

pub fn inject_for_agent(
    agent_id: &str,
    project_root: Option<&str>,
    palace_override: Option<&str>,
) -> InjectResult {
    let palace = palace_override
        .map(PathBuf::from)
        .unwrap_or_else(palace_path);
    ensure_dir(&palace);
    let servers = json!({
        "mempalace": mcp_entry(&palace),
        "truedeck": mcp_entry(&palace),
    });

    let mut written: Vec<String> = vec![];
    let home = dirs::home_dir().unwrap_or_default();

    if let Some(root) = project_root {
        crate::memory::ensure_repo_memory(root);
        crate::memory::write_auto_context_fast(root); // also ensures .agents/
        // Project MCP: unified `.agents/mcp.json` + root mirror (no .cursor/)
        let agents_mcp = Path::new(root).join(".agents").join("mcp.json");
        if let Ok(w) = merge_mcp_servers(&agents_mcp, &servers) {
            written.push(w);
        }
        let p = Path::new(root).join(".mcp.json");
        if let Ok(w) = merge_mcp_servers(&p, &servers) {
            written.push(w);
        }
        written.push(Path::new(root).join(".agents").to_string_lossy().into());
    }

    // User-home product MCP (required so each CLI can load servers)
    if agent_id == "cursor" || agent_id == "all" {
        let p = home.join(".cursor").join("mcp.json");
        if let Ok(w) = merge_mcp_servers(&p, &servers) {
            written.push(w);
        }
    }

    if agent_id == "claude" || agent_id == "all" {
        let claude_json = home.join(".claude.json");
        let cur = read_json(&claude_json);
        let mut map = cur.as_object().cloned().unwrap_or_default();
        let mut mcp = map
            .get("mcpServers")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_default();
        mcp.insert("mempalace".into(), mcp_entry(&palace));
        map.insert("mcpServers".into(), Value::Object(mcp));
        if write_json(&claude_json, &Value::Object(map)).is_ok() {
            written.push(claude_json.to_string_lossy().into());
        }
        let p = home.join(".claude").join("mcp.json");
        if let Ok(w) = merge_mcp_servers(&p, &servers) {
            written.push(w);
        }
    }

    // Shared global note under ~/.agents/ (not per-CLI ~/.codex / ~/.grok notes)
    {
        let dir = home.join(".agents");
        ensure_dir(&dir);
        let note = dir.join("truedeck-memory.md");
        let body = format!(
            "# TrueDeck memory (automatic)\n\nRead project `.truedeck/auto-context.md` and `.agents/AGENTS.md` when under TrueDeck.\nPalace: `{}`\n",
            palace.display()
        );
        if fs::write(&note, body).is_ok() {
            written.push(note.to_string_lossy().into());
        }
    }

    if agent_id == "grok" || agent_id == "all" {
        let dir = home.join(".grok");
        ensure_dir(&dir);
        let snippet = dir.join("truedeck-mcp.toml");
        let entry = mcp_entry(&palace);
        let cmd = entry["command"].as_str().unwrap_or("mempalace-mcp");
        let args = entry["args"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str())
                    .map(|s| format!("\"{}\"", s.replace('\\', "\\\\")))
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default();
        let body = format!(
            "# Generated by TrueDeck\n[mcp_servers.mempalace]\ncommand = \"{}\"\nargs = [{}]\nenabled = true\n",
            cmd.replace('\\', "\\\\"),
            args
        );
        if fs::write(&snippet, body).is_ok() {
            written.push(snippet.to_string_lossy().into());
        }
    }

    let rec = data_dir().join("last-memory-inject.json");
    ensure_dir(&data_dir());
    let _ = fs::write(
        &rec,
        serde_json::to_string_pretty(&json_rec(agent_id, &palace, project_root, &written))
            .unwrap_or_default(),
    );
    written.push(rec.to_string_lossy().into());

    let n = written.len();
    InjectResult {
        agent_id: agent_id.into(),
        ok: n > 0,
        message: if n > 0 {
            format!("Memory + `.agents/` wired into {agent_id} ({n} config paths)")
        } else {
            format!("No config files written for {agent_id}")
        },
        files_written: written,
    }
}

fn json_rec(
    agent_id: &str,
    palace: &Path,
    project_root: Option<&str>,
    written: &[String],
) -> Value {
    json!({
        "agentId": agent_id,
        "palacePath": palace.to_string_lossy(),
        "projectRoot": project_root,
        "written": written,
        "at": crate::sessions::now_ms(),
    })
}
