use crate::models::{ProjectConfig, ProjectOnOpenCommand};
use crate::paths::{data_dir, ensure_dir, projects_path, repo_memory_dir};
use crate::sessions::now_ms;
use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use std::fs;
use std::path::Path;

fn load_all() -> Vec<ProjectConfig> {
    let path = projects_path();
    if let Ok(raw) = fs::read_to_string(path) {
        if let Ok(list) = serde_json::from_str::<Vec<ProjectConfig>>(&raw) {
            return list;
        }
    }
    vec![]
}

fn save_all(projects: &[ProjectConfig]) -> Result<()> {
    ensure_dir(&data_dir());
    fs::write(projects_path(), serde_json::to_string_pretty(projects)?)?;
    Ok(())
}

pub fn list_projects() -> Vec<ProjectConfig> {
    let mut list = load_all();
    list.sort_by(|a, b| b.last_opened.unwrap_or(0).cmp(&a.last_opened.unwrap_or(0)));
    list
}

pub fn get_project(id: &str) -> Option<ProjectConfig> {
    load_all().into_iter().find(|p| p.id == id)
}

pub fn get_by_root(root: &str) -> Option<ProjectConfig> {
    load_all().into_iter().find(|p| p.root == root)
}

pub fn upsert_project(root: &str, name: Option<String>) -> Result<ProjectConfig> {
    let mut projects = load_all();
    let existing = projects.iter().find(|p| p.root == root).cloned();
    let id = existing
        .as_ref()
        .map(|p| p.id.clone())
        .unwrap_or_else(|| URL_SAFE_NO_PAD.encode(root.as_bytes()).chars().take(16).collect());
    let basename = Path::new(root)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("project")
        .to_string();
    let next = ProjectConfig {
        id,
        name: name
            .or_else(|| existing.as_ref().map(|p| p.name.clone()))
            .unwrap_or(basename),
        root: root.to_string(),
        last_opened: Some(now_ms()),
        on_open_commands: existing
            .as_ref()
            .map(|p| p.on_open_commands.clone())
            .unwrap_or_default(),
        default_agents: existing
            .as_ref()
            .map(|p| p.default_agents.clone())
            .unwrap_or_else(|| vec!["shell".into()]),
        color: existing.and_then(|p| p.color),
    };
    projects.retain(|p| p.root != root);
    projects.push(next.clone());
    save_all(&projects)?;
    // Ensure repo memory tree
    let mem = repo_memory_dir(root);
    ensure_dir(&mem);
    ensure_dir(&mem.join("context"));
    ensure_dir(&mem.join("decisions"));
    Ok(next)
}

pub fn remove_project(id: &str) -> Result<bool> {
    let mut projects = load_all();
    let before = projects.len();
    projects.retain(|p| p.id != id);
    if projects.len() == before {
        return Ok(false);
    }
    save_all(&projects)?;
    Ok(true)
}

pub fn set_on_open(id: &str, commands: Vec<ProjectOnOpenCommand>) -> Result<ProjectConfig> {
    let mut projects = load_all();
    let p = projects
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| anyhow!("project not found"))?;
    p.on_open_commands = commands;
    let out = p.clone();
    save_all(&projects)?;
    Ok(out)
}

pub fn update_project(
    id: &str,
    name: Option<String>,
    on_open: Option<Vec<ProjectOnOpenCommand>>,
    default_agents: Option<Vec<String>>,
    color: Option<String>,
) -> Result<ProjectConfig> {
    let mut projects = load_all();
    let p = projects
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| anyhow!("project not found"))?;
    if let Some(n) = name {
        p.name = n;
    }
    if let Some(c) = on_open {
        p.on_open_commands = c;
    }
    if let Some(a) = default_agents {
        p.default_agents = a;
    }
    if color.is_some() {
        p.color = color;
    }
    let out = p.clone();
    save_all(&projects)?;
    Ok(out)
}

pub fn suggest_on_open(root: &str) -> Vec<ProjectOnOpenCommand> {
    let mut cmds = vec![];
    let root_p = Path::new(root);
    if root_p.join("default.project.json").exists() || root_p.join("dev.project.json").exists() {
        cmds.push(ProjectOnOpenCommand {
            id: "rojo-serve".into(),
            label: "Rojo Serve".into(),
            command: "rojo serve".into(),
            enabled: true,
        });
    }
    let pkg = root_p.join("package.json");
    if pkg.exists() {
        if let Ok(raw) = fs::read_to_string(pkg) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                if v.get("scripts")
                    .and_then(|s| s.get("dev"))
                    .is_some()
                {
                    cmds.push(ProjectOnOpenCommand {
                        id: "npm-dev".into(),
                        label: "npm run dev".into(),
                        command: "npm run dev".into(),
                        enabled: false,
                    });
                }
            }
        }
    }
    cmds
}
