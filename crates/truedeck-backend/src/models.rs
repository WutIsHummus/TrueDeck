use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPreset {
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub color: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectOnOpenCommand {
    pub id: String,
    pub label: String,
    pub command: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConfig {
    pub id: String,
    pub name: String,
    pub root: String,
    #[serde(default)]
    pub last_opened: Option<u64>,
    #[serde(default)]
    pub on_open_commands: Vec<ProjectOnOpenCommand>,
    #[serde(default)]
    pub default_agents: Vec<String>,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_true")]
    pub inject_memory_on_agent_start: bool,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_font")]
    pub font_size: u32,
    #[serde(default = "default_layout")]
    pub layout_mode: String,
    #[serde(default)]
    pub auto_grid: bool,
    #[serde(default)]
    pub show_quick_agents: bool,
    #[serde(default = "default_true")]
    pub reopen_last_project: bool,
    #[serde(default)]
    pub preferred_agent_id: Option<String>,
    #[serde(default)]
    pub palace_path: Option<String>,
}

fn default_true() -> bool {
    true
}
fn default_theme() -> String {
    "dark".into()
}
fn default_font() -> u32 {
    13
}
fn default_layout() -> String {
    "tabs".into()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            inject_memory_on_agent_start: true,
            theme: default_theme(),
            font_size: default_font(),
            layout_mode: default_layout(),
            auto_grid: false,
            show_quick_agents: false,
            reopen_last_project: true,
            preferred_agent_id: None,
            palace_path: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedSessionTab {
    pub agent_id: String,
    pub agent_name: String,
    pub project_root: String,
    pub color: String,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub command_line: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLayout {
    pub version: u32,
    pub active_project_root: Option<String>,
    pub active_index: usize,
    pub split_index: Option<usize>,
    pub split_ratio: f64,
    pub tabs: Vec<SavedSessionTab>,
    pub saved_at: u64,
}

impl Default for SessionLayout {
    fn default() -> Self {
        Self {
            version: 1,
            active_project_root: None,
            active_index: 0,
            split_index: None,
            split_ratio: 0.5,
            tabs: vec![],
            saved_at: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingState {
    pub completed: bool,
    #[serde(default)]
    pub skipped: Option<bool>,
    #[serde(default)]
    pub completed_at: Option<u64>,
}

impl Default for OnboardingState {
    fn default() -> Self {
        Self {
            completed: false,
            skipped: None,
            completed_at: None,
        }
    }
}
