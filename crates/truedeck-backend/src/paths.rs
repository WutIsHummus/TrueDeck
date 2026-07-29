use std::path::{Path, PathBuf};

/// Global data directory: TRUEDECK_DATA_DIR or platform default.
pub fn data_dir() -> PathBuf {
    if let Ok(p) = std::env::var("TRUEDECK_DATA_DIR") {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("TrueDeck")
        .join("data")
}

pub fn projects_path() -> PathBuf {
    data_dir().join("projects.json")
}

pub fn agents_path() -> PathBuf {
    data_dir().join("agents.json")
}

pub fn settings_path() -> PathBuf {
    data_dir().join("settings.json")
}

pub fn session_layout_path() -> PathBuf {
    data_dir().join("session-layout.json")
}

pub fn onboarding_path() -> PathBuf {
    data_dir().join("onboarding.json")
}

pub fn global_memory_dir() -> PathBuf {
    data_dir().join("memory")
}

pub fn ensure_dir(p: &Path) {
    let _ = std::fs::create_dir_all(p);
}

pub fn repo_memory_dir(project_root: &str) -> PathBuf {
    PathBuf::from(project_root).join(".memory")
}

pub fn truedeck_dir(project_root: &str) -> PathBuf {
    PathBuf::from(project_root).join(".truedeck")
}

pub fn auto_context_path(project_root: &str) -> PathBuf {
    truedeck_dir(project_root).join("auto-context.md")
}

pub fn default_palace_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".mempalace")
        .join("palace")
}
