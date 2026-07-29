pub mod inject;

use crate::paths::{
    auto_context_path, data_dir, default_palace_path, ensure_dir, global_memory_dir,
    repo_memory_dir, truedeck_dir,
};
use crate::settings::load_settings;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySpaceInfo {
    pub id: String,
    pub label: String,
    pub path: String,
    pub kind: String,
    pub exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

pub fn palace_path() -> PathBuf {
    let s = load_settings();
    if let Some(p) = s.palace_path {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    default_palace_path()
}

pub fn ensure_global_memory() -> PathBuf {
    let d = global_memory_dir();
    ensure_dir(&d);
    ensure_dir(&d.join("context"));
    d
}

pub fn ensure_repo_memory(project_root: &str) -> PathBuf {
    let d = repo_memory_dir(project_root);
    ensure_dir(&d);
    ensure_dir(&d.join("context"));
    ensure_dir(&d.join("decisions"));
    ensure_dir(&d.join("patterns"));
    d
}

pub fn memory_env(project_root: &str) -> std::collections::HashMap<String, String> {
    let _ = ensure_global_memory();
    let _ = ensure_repo_memory(project_root);
    let mut m = std::collections::HashMap::new();
    m.insert("TRUEDECK_MEMORY".into(), "auto".into());
    m.insert("TRUEDECK_PROJECT".into(), project_root.into());
    m.insert(
        "TRUEDECK_REPO_MEMORY".into(),
        repo_memory_dir(project_root).to_string_lossy().into(),
    );
    m.insert(
        "TRUEDECK_GLOBAL_MEMORY".into(),
        global_memory_dir().to_string_lossy().into(),
    );
    m.insert(
        "TRUEDECK_PALACE".into(),
        palace_path().to_string_lossy().into(),
    );
    m.insert(
        "TRUEDECK_AUTO_CONTEXT".into(),
        auto_context_path(project_root).to_string_lossy().into(),
    );
    let wing = Path::new(project_root)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("project")
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect::<String>();
    m.insert("TRUEDECK_MEMORY_WING".into(), wing);
    m
}

/// Fast auto-context write (no MemPalace CLI wait).
pub fn write_auto_context_fast(project_root: &str) -> PathBuf {
    ensure_dir(&truedeck_dir(project_root));
    let global = ensure_global_memory();
    let repo = ensure_repo_memory(project_root);
    let palace = palace_path();
    let wing = Path::new(project_root)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("project");

    let body = format!(
        r#"# TrueDeck auto-context (managed — do not hand-edit)

Memory is **automatic**. You do not need the user to manage notes, MemPalace, or Docker.

## Protocol
- At session start: treat this file as wake-up context.
- Durable facts: write short notes under `.memory/context/` or `.memory/decisions/`.
- Prefer facts over chat logs. Never store secrets.

## Project
- Root: `{project_root}`
- Wing: `{wing}`

## Paths
- Repo memory: `{repo}`
- Global memory: `{global}`
- Palace: `{palace}`
"#,
        project_root = project_root,
        wing = wing,
        repo = repo.display(),
        global = global.display(),
        palace = palace.display(),
    );
    let out = auto_context_path(project_root);
    let _ = fs::write(&out, body);
    ensure_agent_pointer(project_root);
    out
}

fn ensure_agent_pointer(project_root: &str) {
    let block = r#"

<!-- truedeck-memory -->
## TrueDeck memory (automatic)
Session context is auto-generated at `.truedeck/auto-context.md`. Read it at start. Durable facts go in `.memory/`. Do not ask the user to manage memory.
<!-- /truedeck-memory -->
"#;
    for name in ["AGENTS.md", "CLAUDE.md"] {
        let p = Path::new(project_root).join(name);
        if p.exists() {
            if let Ok(cur) = fs::read_to_string(&p) {
                if cur.contains("truedeck-memory") {
                    continue;
                }
                let _ = fs::write(&p, format!("{}\n{}", cur.trim_end(), block));
            }
        } else if name == "AGENTS.md" {
            let _ = fs::write(&p, format!("# Agent instructions\n{block}"));
        }
    }
}

pub fn list_spaces() -> Vec<MemorySpaceInfo> {
    let mut spaces = vec![];
    let default_p = default_palace_path();
    let palace = palace_path();
    spaces.push(MemorySpaceInfo {
        id: "palace-default".into(),
        label: "Default MemPalace".into(),
        path: palace.to_string_lossy().into(),
        kind: "palace".into(),
        exists: palace.exists(),
        detail: Some("Graph/vector memory".into()),
    });

    let mem_root = dirs::home_dir()
        .unwrap_or_default()
        .join(".mempalace");
    if mem_root.exists() {
        if let Ok(rd) = fs::read_dir(&mem_root) {
            for e in rd.flatten() {
                let full = e.path();
                if full.is_dir() && full != palace && full != default_p {
                    let name = e.file_name().to_string_lossy().to_string();
                    spaces.push(MemorySpaceInfo {
                        id: format!("palace-{name}"),
                        label: format!("MemPalace · {name}"),
                        path: full.to_string_lossy().into(),
                        kind: "palace".into(),
                        exists: true,
                        detail: Some("Found under ~/.mempalace".into()),
                    });
                }
            }
        }
    }

    let global = global_memory_dir();
    spaces.push(MemorySpaceInfo {
        id: "global-files".into(),
        label: "TrueDeck global notes".into(),
        path: global.to_string_lossy().into(),
        kind: "global-memory".into(),
        exists: global.exists(),
        detail: Some("Markdown notes (always on)".into()),
    });
    let _ = data_dir();
    spaces
}

pub fn set_palace_path(path: &str) -> Result<(), String> {
    let mut s = load_settings();
    s.palace_path = Some(path.to_string());
    crate::settings::save_settings(&s).map_err(|e| e.to_string())?;
    ensure_dir(Path::new(path));
    Ok(())
}
