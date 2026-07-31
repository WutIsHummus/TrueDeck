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

/// MemPalace wing unique per project path (not basename alone).
/// Electron uses sha256[:8]; backend uses FNV-1a hex for a short stable suffix.
fn wing_name(project_root: &str) -> String {
    let base = Path::new(project_root)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("project")
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>();
    let base = if base.is_empty() {
        "project".to_string()
    } else {
        base
    };
    let norm = project_root
        .replace('/', "\\")
        .trim_end_matches(['\\', '/'])
        .to_lowercase();
    let mut h: u64 = 0xcbf29ce484222325;
    for b in norm.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    let hex = format!("{h:016x}");
    format!("{base}-{}", &hex[..8])
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
    ensure_agent_pointer(project_root);
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
    // Per-path wing so two folders named SPTS do not share MemPalace memory
    let wing = wing_name(project_root);
    m.insert("TRUEDECK_MEMORY_WING".into(), wing);

    // Unified multi-CLI folder (same contract as TS memoryEnv / agentsEnv)
    let agents = Path::new(project_root).join(".agents");
    m.insert(
        "TRUEDECK_AGENTS_DIR".into(),
        agents.to_string_lossy().into(),
    );
    m.insert(
        "TRUEDECK_AGENTS_MD".into(),
        agents.join("AGENTS.md").to_string_lossy().into(),
    );
    m.insert(
        "TRUEDECK_AGENTS_MCP".into(),
        agents.join("mcp.json").to_string_lossy().into(),
    );
    if let Some(home) = dirs::home_dir() {
        let global_agents = home.join(".agents");
        m.insert(
            "TRUEDECK_GLOBAL_AGENTS".into(),
            global_agents.to_string_lossy().into(),
        );
        m.insert(
            "TRUEDECK_GLOBAL_AGENTS_NOTE".into(),
            global_agents
                .join("truedeck-memory.md")
                .to_string_lossy()
                .into(),
        );
    }
    m
}

/// Fast auto-context write (no MemPalace CLI wait).
pub fn write_auto_context_fast(project_root: &str) -> PathBuf {
    ensure_dir(&truedeck_dir(project_root));
    let global = ensure_global_memory();
    let repo = ensure_repo_memory(project_root);
    let palace = palace_path();
    let wing = wing_name(project_root);

    let agents = Path::new(project_root).join(".agents");
    let body = format!(
        r#"# TrueDeck auto-context (managed — do not hand-edit)

Memory is **automatic**. You do not need the user to manage notes, MemPalace, or Docker.

## Protocol
- At session start: treat this file as wake-up context.
- Read shared agent rules from **`.agents/AGENTS.md`** (unified for all CLIs).
- Durable facts: write short notes under `.memory/context/` or `.memory/decisions/`.
- Prefer facts over chat logs. Never store secrets.

## Project
- Root: `{project_root}`
- Wing: `{wing}`

## Paths
- Unified agents folder: `{agents}`
- Agent instructions: `{agents}/AGENTS.md`
- Project MCP: `{agents}/mcp.json` (mirrored to root `.mcp.json`)
- Repo memory: `{repo}`
- Global memory: `{global}`
- Palace: `{palace}`
"#,
        project_root = project_root,
        wing = wing,
        agents = agents.display(),
        repo = repo.display(),
        global = global.display(),
        palace = palace.display(),
    );
    let out = auto_context_path(project_root);
    let _ = fs::write(&out, body);
    ensure_agent_pointer(project_root);
    out
}

/// Unified `.agents/` folder + thin root bridges (mirrors TS agents-folder.ts).
fn ensure_agent_pointer(project_root: &str) {
    let root = Path::new(project_root);
    let agents_dir = root.join(".agents");
    ensure_dir(&agents_dir);

    let pointer = r#"
<!-- truedeck-memory -->
## TrueDeck memory (automatic)
At session start, read `.truedeck/auto-context.md` for project memory.
Durable facts: `.memory/context/` or `.memory/decisions/`; MemPalace MCP for search/recall.
Project agent rules and MCP live under **`.agents/`** (unified for all CLIs).
Canonical instructions: `.agents/AGENTS.md`. Project MCP: `.agents/mcp.json` (mirrored to root `.mcp.json`).
TrueDeck hub (`truedeck-hub`): `truedeck_show`, `truedeck_launch`, MCP config tools — app must be running.
Do not ask the user to manage memory, Graphify, or MCP wiring.
<!-- /truedeck-memory -->
"#;

    let canonical = agents_dir.join("AGENTS.md");
    if !canonical.exists() {
        let body = format!(
            "# Agent instructions\n\nThis file is the **canonical** multi-agent guide for this repo (TrueDeck `.agents/` folder).\nAll coding CLIs should treat this as the shared source of truth.\n\n{}\n\n## Project MCP\nProject MCP servers: `.agents/mcp.json` (also mirrored to root `.mcp.json`).\n",
            pointer.trim()
        );
        let _ = fs::write(&canonical, body);
    } else if let Ok(cur) = fs::read_to_string(&canonical) {
        if !cur.contains(".agents/") || !cur.contains("truedeck-memory") {
            let _ = fs::write(&canonical, format!("{}\n\n{}", cur.trim_end(), pointer.trim()));
        }
    }

    // Thin root bridges
    for (name, title) in [("AGENTS.md", "# Agent instructions"), ("CLAUDE.md", "# Claude Code")] {
        let p = root.join(name);
        let bridge = format!(
            "{title}\n\n> **Canonical agent config:** [`.agents/AGENTS.md`](.agents/AGENTS.md)\n>\n> TrueDeck keeps a unified `.agents/` folder for all CLIs. Prefer that file over vendor-specific roots.\n\n{}\n",
            pointer.trim()
        );
        if !p.exists() {
            let _ = fs::write(&p, bridge);
        } else if let Ok(cur) = fs::read_to_string(&p) {
            if !cur.contains("truedeck-memory") {
                let _ = fs::write(&p, format!("{}\n\n{}", cur.trim_end(), pointer.trim()));
            } else if !cur.contains(".agents/") {
                // Upgrade legacy pointer that lacks unified folder mention
                let _ = fs::write(&p, format!("{}\n\n{}", cur.trim_end(), pointer.trim()));
            }
        }
    }

    // Global ~/.agents note
    if let Some(home) = dirs::home_dir() {
        let global = home.join(".agents");
        ensure_dir(&global);
        let note = global.join("truedeck-memory.md");
        let body = format!(
            "# TrueDeck memory (automatic)\n\nShared note for every coding CLI under TrueDeck.\n\n- Read project `.truedeck/auto-context.md` at session start.\n- Project agent rules: `.agents/AGENTS.md` (unified folder).\n- Durable notes: `.memory/` in the repo.\n- Do not ask the user to manage memory, Graphify, or MCP wiring.\n"
        );
        let _ = fs::write(note, body);
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
