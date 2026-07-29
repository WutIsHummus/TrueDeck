use crate::models::AgentPreset;
use crate::paths::{agents_path, ensure_dir, data_dir};
use anyhow::Result;
use std::fs;

fn default_agents() -> Vec<AgentPreset> {
    let shell = if cfg!(windows) {
        "powershell.exe"
    } else {
        "bash"
    };
    let shell_args = if cfg!(windows) {
        vec!["-NoLogo".into()]
    } else {
        vec![]
    };
    vec![
        AgentPreset {
            id: "grok".into(),
            name: "Grok".into(),
            command: "grok".into(),
            args: vec![],
            color: "#22d3ee".into(),
            icon: "✦".into(),
            description: Some("xAI Grok Build coding agent".into()),
        },
        AgentPreset {
            id: "codex".into(),
            name: "Codex".into(),
            command: "codex".into(),
            args: vec![],
            color: "#34d399".into(),
            icon: "◉".into(),
            description: Some("OpenAI Codex CLI".into()),
        },
        AgentPreset {
            id: "cursor".into(),
            name: "Cursor Agent".into(),
            command: "cursor-agent".into(),
            args: vec![],
            color: "#60a5fa".into(),
            icon: "◆".into(),
            description: Some("Cursor Agent CLI only (not the IDE)".into()),
        },
        AgentPreset {
            id: "claude".into(),
            name: "Claude".into(),
            command: "claude".into(),
            args: vec![],
            color: "#c084fc".into(),
            icon: "◎".into(),
            description: Some("Anthropic Claude Code CLI".into()),
        },
        AgentPreset {
            id: "gemini".into(),
            name: "Gemini".into(),
            command: "gemini".into(),
            args: vec![],
            color: "#fbbf24".into(),
            icon: "◇".into(),
            description: Some("Google Gemini CLI".into()),
        },
        AgentPreset {
            id: "shell".into(),
            name: "Shell".into(),
            command: shell.into(),
            args: shell_args,
            color: "#6b7280".into(),
            icon: "▣".into(),
            description: Some("Plain shell in the project folder".into()),
        },
        AgentPreset {
            id: "opencode".into(),
            name: "OpenCode".into(),
            command: "opencode".into(),
            args: vec![],
            color: "#f472b6".into(),
            icon: "△".into(),
            description: Some("OpenCode open-source agent".into()),
        },
        AgentPreset {
            id: "aider".into(),
            name: "Aider".into(),
            command: "aider".into(),
            args: vec![],
            color: "#fb923c".into(),
            icon: "▹".into(),
            description: Some("Aider pair-programming agent".into()),
        },
    ]
}

fn merge(stored: Vec<AgentPreset>) -> Vec<AgentPreset> {
    let mut by_id: std::collections::HashMap<String, AgentPreset> =
        stored.into_iter().map(|a| (a.id.clone(), a)).collect();
    let mut out = Vec::new();
    for d in default_agents() {
        if let Some(s) = by_id.remove(&d.id) {
            out.push(AgentPreset {
                id: d.id,
                name: s.name,
                command: s.command,
                args: s.args,
                color: s.color,
                icon: s.icon,
                description: s.description.or(d.description),
            });
        } else {
            out.push(d);
        }
    }
    for (_, s) in by_id {
        out.push(s);
    }
    out
}

pub fn list_agents() -> Result<Vec<AgentPreset>> {
    ensure_dir(&data_dir());
    let path = agents_path();
    if path.exists() {
        let raw = fs::read_to_string(&path)?;
        if let Ok(list) = serde_json::from_str::<Vec<AgentPreset>>(&raw) {
            if !list.is_empty() {
                let merged = merge(list);
                let _ = save_agents(&merged);
                return Ok(merged);
            }
        }
    }
    let d = default_agents();
    save_agents(&d)?;
    Ok(d)
}

pub fn save_agents(agents: &[AgentPreset]) -> Result<()> {
    ensure_dir(&data_dir());
    let path = agents_path();
    fs::write(path, serde_json::to_string_pretty(agents)?)?;
    Ok(())
}

pub fn get_agent(id: &str) -> Result<Option<AgentPreset>> {
    Ok(list_agents()?.into_iter().find(|a| a.id == id))
}

pub fn reset_agents() -> Result<Vec<AgentPreset>> {
    let d = default_agents();
    save_agents(&d)?;
    Ok(d)
}
