use crate::models::{AppSettings, OnboardingState, SessionLayout};
use crate::paths::{
    data_dir, ensure_dir, onboarding_path, session_layout_path, settings_path,
};
use crate::sessions::now_ms;
use anyhow::Result;
use std::fs;

pub fn load_settings() -> AppSettings {
    let path = settings_path();
    if let Ok(raw) = fs::read_to_string(path) {
        if let Ok(s) = serde_json::from_str::<AppSettings>(&raw) {
            return s;
        }
    }
    AppSettings::default()
}

pub fn save_settings(s: &AppSettings) -> Result<AppSettings> {
    ensure_dir(&data_dir());
    fs::write(settings_path(), serde_json::to_string_pretty(s)?)?;
    Ok(s.clone())
}

/// Hard cap — never restore/persist more than this many tabs.
pub const MAX_SAVED_TABS: usize = 8;

fn clamp_tabs(tabs: Vec<crate::models::SavedSessionTab>) -> Vec<crate::models::SavedSessionTab> {
    let cleaned: Vec<_> = tabs
        .into_iter()
        .filter(|t| {
            if t.project_root.is_empty() || t.agent_id.is_empty() {
                return false;
            }
            let name = t.agent_name.to_lowercase();
            let cmd = t.command_line.as_deref().unwrap_or("").to_lowercase();
            if name.contains("install") || cmd.contains("=== install") {
                return false;
            }
            true
        })
        .collect();
    if cleaned.len() <= MAX_SAVED_TABS {
        return cleaned;
    }
    let mut agents = Vec::new();
    let mut commands = Vec::new();
    for t in cleaned {
        if t.kind.as_deref() == Some("command") {
            commands.push(t);
        } else {
            agents.push(t);
        }
    }
    agents.extend(commands);
    agents.truncate(MAX_SAVED_TABS);
    agents
}

pub fn load_layout() -> SessionLayout {
    let path = session_layout_path();
    if let Ok(raw) = fs::read_to_string(path) {
        if let Ok(mut l) = serde_json::from_str::<SessionLayout>(&raw) {
            let n = l.tabs.len();
            l.tabs = clamp_tabs(l.tabs);
            if n > l.tabs.len() {
                // Rewrite bloated layout immediately
                let _ = save_layout(&l);
            }
            return l;
        }
    }
    SessionLayout::default()
}

pub fn save_layout(l: &SessionLayout) -> Result<SessionLayout> {
    ensure_dir(&data_dir());
    let mut next = l.clone();
    next.tabs = clamp_tabs(next.tabs);
    next.saved_at = now_ms();
    next.version = 1;
    if next.active_index >= next.tabs.len() {
        next.active_index = next.tabs.len().saturating_sub(1);
    }
    if next.tabs.len() < 2 {
        next.split_index = None;
    } else if let Some(i) = next.split_index {
        next.split_index = Some(i.min(next.tabs.len() - 1));
    }
    fs::write(session_layout_path(), serde_json::to_string_pretty(&next)?)?;
    Ok(next)
}

pub fn load_onboarding() -> OnboardingState {
    let path = onboarding_path();
    if let Ok(raw) = fs::read_to_string(path) {
        if let Ok(s) = serde_json::from_str::<OnboardingState>(&raw) {
            return s;
        }
    }
    OnboardingState::default()
}

pub fn complete_onboarding(skipped: bool) -> Result<OnboardingState> {
    let s = OnboardingState {
        completed: true,
        skipped: Some(skipped),
        completed_at: Some(now_ms()),
    };
    ensure_dir(&data_dir());
    fs::write(onboarding_path(), serde_json::to_string_pretty(&s)?)?;
    Ok(s)
}

pub fn reset_onboarding() -> Result<OnboardingState> {
    let s = OnboardingState::default();
    ensure_dir(&data_dir());
    fs::write(onboarding_path(), serde_json::to_string_pretty(&s)?)?;
    Ok(s)
}
