//! TrueDeck native backend — JSON-RPC over stdio.
//! Electron spawns this process and proxies renderer IPC.

mod agents;
mod memory;
mod models;
mod paths;
mod projects;
mod protocol;
mod resolve;
mod sessions;
mod settings;

use crate::protocol::{
    Request, Response, ResizeParams, SessionIdParams, SpawnCommandParams, SpawnParams, WriteParams,
};
use crate::sessions::{new_session_id, now_ms, SessionInfo, SessionManager};
use anyhow::Result;
use protocol::Event;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::sync::Arc;

const VERSION: &str = env!("CARGO_PKG_VERSION");

fn emit_line(v: &impl serde::Serialize) {
    let mut out = std::io::stdout().lock();
    if let Ok(line) = serde_json::to_string(v) {
        let _ = writeln!(out, "{line}");
        let _ = out.flush();
    }
}

fn main() {
    paths::ensure_dir(&paths::data_dir());

    let emit: Arc<dyn Fn(Event) + Send + Sync> = Arc::new(|ev: Event| {
        emit_line(&ev);
    });

    let sessions = Arc::new(SessionManager::new(emit.clone()));

    // Ready event (also a response-less push)
    emit_line(&Event::new(
        "ready",
        json!({
            "version": VERSION,
            "dataDir": paths::data_dir().to_string_lossy(),
        }),
    ));

    let stdin = std::io::stdin();
    let reader = BufReader::new(stdin.lock());

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                emit_line(&Event::new(
                    "error",
                    json!({ "message": format!("stdin: {e}") }),
                ));
                break;
            }
        };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let req: Request = match serde_json::from_str(line) {
            Ok(r) => r,
            Err(e) => {
                emit_line(&Response::err(0, format!("bad request: {e}")));
                continue;
            }
        };

        let resp = match handle(&sessions, &req) {
            Ok(v) => Response::ok(req.id, v),
            Err(e) => Response::err(req.id, e),
        };
        emit_line(&resp);

        if req.method == "shutdown" {
            sessions.kill_all();
            break;
        }
    }

    sessions.kill_all();
}

fn handle(sessions: &SessionManager, req: &Request) -> Result<Value, String> {
    match req.method.as_str() {
        "ping" => Ok(json!({ "pong": true, "version": VERSION })),
        "shutdown" => Ok(json!({ "bye": true })),

        // ── sessions ──
        "sessions.list" => Ok(json!(sessions.list())),
        "sessions.spawn" => {
            let p: SpawnParams =
                serde_json::from_value(req.params.clone()).map_err(|e| e.to_string())?;
            spawn_agent(sessions, p)
        }
        "sessions.spawnCommand" => {
            let p: SpawnCommandParams =
                serde_json::from_value(req.params.clone()).map_err(|e| e.to_string())?;
            spawn_command(sessions, p)
        }
        "sessions.write" => {
            let p: WriteParams =
                serde_json::from_value(req.params.clone()).map_err(|e| e.to_string())?;
            sessions.write(&p.id, &p.data).map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true }))
        }
        "sessions.resize" => {
            let p: ResizeParams =
                serde_json::from_value(req.params.clone()).map_err(|e| e.to_string())?;
            sessions
                .resize(&p.id, p.cols, p.rows)
                .map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true }))
        }
        "sessions.kill" => {
            let p: SessionIdParams =
                serde_json::from_value(req.params.clone()).map_err(|e| e.to_string())?;
            sessions.kill(&p.id);
            Ok(json!({ "ok": true }))
        }

        // ── projects ──
        "projects.list" => Ok(json!(projects::list_projects())),
        "projects.get" => {
            let id = req
                .params
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or("missing id")?;
            Ok(json!(projects::get_project(id)))
        }
        "projects.upsert" => {
            let root = req
                .params
                .get("root")
                .and_then(|v| v.as_str())
                .ok_or("missing root")?;
            let name = req
                .params
                .get("name")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let p = projects::upsert_project(root, name).map_err(|e| e.to_string())?;
            Ok(json!(p))
        }
        "projects.remove" => {
            let id = req
                .params
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or("missing id")?;
            Ok(json!(projects::remove_project(id).map_err(|e| e.to_string())?))
        }
        "projects.setOnOpen" => {
            let id = req
                .params
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or("missing id")?;
            let cmds = req
                .params
                .get("commands")
                .cloned()
                .ok_or("missing commands")?;
            let commands: Vec<models::ProjectOnOpenCommand> =
                serde_json::from_value(cmds).map_err(|e| e.to_string())?;
            Ok(json!(
                projects::set_on_open(id, commands).map_err(|e| e.to_string())?
            ))
        }
        "projects.update" => {
            let id = req
                .params
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or("missing id")?;
            let name = req
                .params
                .get("name")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let on_open = req
                .params
                .get("onOpenCommands")
                .cloned()
                .and_then(|v| serde_json::from_value(v).ok());
            let default_agents = req
                .params
                .get("defaultAgents")
                .cloned()
                .and_then(|v| serde_json::from_value(v).ok());
            let color = req
                .params
                .get("color")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            Ok(json!(projects::update_project(
                id,
                name,
                on_open,
                default_agents,
                color
            )
            .map_err(|e| e.to_string())?))
        }
        "projects.suggestOnOpen" => {
            let root = req
                .params
                .get("root")
                .and_then(|v| v.as_str())
                .ok_or("missing root")?;
            Ok(json!(projects::suggest_on_open(root)))
        }

        // ── agents ──
        "agents.list" => Ok(json!(agents::list_agents().map_err(|e| e.to_string())?)),
        "agents.save" => {
            let list: Vec<models::AgentPreset> =
                serde_json::from_value(req.params.clone()).map_err(|e| e.to_string())?;
            agents::save_agents(&list).map_err(|e| e.to_string())?;
            Ok(json!(list))
        }
        "agents.reset" => Ok(json!(agents::reset_agents().map_err(|e| e.to_string())?)),

        // ── settings ──
        "settings.get" => Ok(json!(settings::load_settings())),
        "settings.set" => {
            let s: models::AppSettings =
                serde_json::from_value(req.params.clone()).map_err(|e| e.to_string())?;
            Ok(json!(
                settings::save_settings(&s).map_err(|e| e.to_string())?
            ))
        }

        // ── layout ──
        "layout.get" => Ok(json!(settings::load_layout())),
        "layout.save" => {
            let l: models::SessionLayout =
                serde_json::from_value(req.params.clone()).map_err(|e| e.to_string())?;
            Ok(json!(settings::save_layout(&l).map_err(|e| e.to_string())?))
        }
        "layout.persist" => {
            // Snapshot from live sessions + focus hints
            let active_root = req
                .params
                .get("activeProjectRoot")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let active_id = req
                .params
                .get("activeSessionId")
                .and_then(|v| v.as_str());
            let split_id = req
                .params
                .get("splitSessionId")
                .and_then(|v| v.as_str());
            let ratio = req
                .params
                .get("splitRatio")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.5);
            let order: Vec<String> = req
                .params
                .get("sessionOrder")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();

            let live = sessions.list();
            let mut by_id: HashMap<String, SessionInfo> =
                live.into_iter().map(|s| (s.id.clone(), s)).collect();
            let mut ordered: Vec<SessionInfo> = vec![];
            for id in &order {
                if let Some(s) = by_id.remove(id) {
                    ordered.push(s);
                }
            }
            for (_, s) in by_id {
                ordered.push(s);
            }
            let tabs: Vec<models::SavedSessionTab> = ordered
                .iter()
                .filter(|s| s.status == "running")
                .take(settings::MAX_SAVED_TABS)
                .map(|s| models::SavedSessionTab {
                    agent_id: s.agent_id.clone(),
                    agent_name: s.agent_name.clone(),
                    project_root: s.project_root.clone(),
                    color: s.color.clone(),
                    kind: s.kind.clone(),
                    command_line: s.command_line.clone(),
                })
                .collect();
            let active_index = active_id
                .and_then(|id| ordered.iter().position(|s| s.id == id))
                .unwrap_or(0);
            let split_index =
                split_id.and_then(|id| ordered.iter().position(|s| s.id == id));
            let layout = models::SessionLayout {
                version: 1,
                active_project_root: active_root,
                active_index,
                split_index,
                split_ratio: ratio,
                tabs,
                saved_at: now_ms(),
            };
            Ok(json!(
                settings::save_layout(&layout).map_err(|e| e.to_string())?
            ))
        }
        "layout.restore" => restore_layout(sessions),

        // ── memory ──
        "memory.listSpaces" => Ok(json!(memory::list_spaces())),
        "memory.getPalacePath" => Ok(json!(memory::palace_path().to_string_lossy())),
        "memory.setPalacePath" => {
            let path = req
                .params
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or("missing path")?;
            memory::set_palace_path(path)?;
            Ok(json!(settings::load_settings()))
        }
        "memory.inject" => {
            let agent_id = req
                .params
                .get("agentId")
                .and_then(|v| v.as_str())
                .unwrap_or("claude");
            let project_root = req.params.get("projectRoot").and_then(|v| v.as_str());
            let palace = req.params.get("palacePath").and_then(|v| v.as_str());
            Ok(json!(memory::inject::inject_for_agent(
                agent_id,
                project_root,
                palace
            )))
        }
        "memory.env" => {
            let root = req
                .params
                .get("projectRoot")
                .and_then(|v| v.as_str())
                .ok_or("missing projectRoot")?;
            let _ = memory::write_auto_context_fast(root);
            Ok(json!(memory::memory_env(root)))
        }

        // ── onboarding ──
        "onboarding.get" => Ok(json!(settings::load_onboarding())),
        "onboarding.complete" => {
            let skipped = req
                .params
                .get("skipped")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            Ok(json!(
                settings::complete_onboarding(skipped).map_err(|e| e.to_string())?
            ))
        }
        "onboarding.reset" => Ok(json!(
            settings::reset_onboarding().map_err(|e| e.to_string())?
        )),

        "backend.info" => Ok(json!({
            "version": VERSION,
            "dataDir": paths::data_dir().to_string_lossy(),
            "engine": "rust",
        })),

        other => Err(format!("unknown method: {other}")),
    }
}

fn spawn_agent(sessions: &SessionManager, p: SpawnParams) -> Result<Value, String> {
    let agent = if let Some(cmd) = &p.command {
        // Direct command override
        models::AgentPreset {
            id: p.agent_id.clone(),
            name: p.agent_name.clone().unwrap_or_else(|| p.agent_id.clone()),
            command: cmd.clone(),
            args: p.args.clone().unwrap_or_default(),
            color: p.color.clone().unwrap_or_else(|| "#6cb6ff".into()),
            icon: "▶".into(),
            description: p.command_line.clone(),
        }
    } else {
        agents::get_agent(&p.agent_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("unknown agent: {}", p.agent_id))?
    };

    let resolved = resolve::resolve_agent_full(&agent.id, &agent.command, &agent.args);
    if !resolved.available {
        return Err(format!(
            "{} CLI not found ({}). Install the CLI, then retry.",
            agent.name, agent.command
        ));
    }
    let command = resolved.command;
    let args = resolved.args;
    let mut env = memory::memory_env(&p.project_root);
    // background-ish: write auto context without blocking long
    let _ = memory::write_auto_context_fast(&p.project_root);
    if let Some(extra) = p.env {
        for (k, v) in extra {
            env.insert(k, v);
        }
    }
    env.insert("TRUEDECK".into(), "1".into());
    env.insert("TRUEDECK_AGENT".into(), agent.id.clone());
    env.insert("TRUEDECK_PTY".into(), "rust".into());
    env.insert("TRUEDECK_BACKEND".into(), "rust".into());
    // Color identity (also enforced in sessions::spawn so parent NO_COLOR cannot win)
    env.insert("TERM".into(), "xterm-256color".into());
    env.insert("COLORTERM".into(), "truecolor".into());
    env.insert("TERM_PROGRAM".into(), "TrueDeck".into());
    env.insert("FORCE_COLOR".into(), "3".into());
    env.insert("CLICOLOR".into(), "1".into());
    env.insert("CLICOLOR_FORCE".into(), "1".into());
    env.remove("NO_COLOR");

    let id = new_session_id();
    let info = SessionInfo {
        id: id.clone(),
        agent_id: agent.id.clone(),
        agent_name: agent.name.clone(),
        color: agent.color.clone(),
        project_root: p.project_root.clone(),
        status: "running".into(),
        created_at: now_ms(),
        title: agent.name.clone(),
        exit_code: None,
        kind: p.kind.or_else(|| {
            if agent.id.starts_with("cmd-") {
                Some("command".into())
            } else {
                Some("agent".into())
            }
        }),
        command_line: p.command_line.or(agent.description),
    };

    let cols = p.cols.unwrap_or(120).max(40);
    let rows = p.rows.unwrap_or(36).max(12);
    // Grok Build / Codex read COLUMNS+LINES at startup before any WINCH
    env.insert("COLUMNS".into(), cols.to_string());
    env.insert("LINES".into(), rows.to_string());
    let spawned = sessions
        .spawn(&command, &args, &p.project_root, cols, rows, &env, info)
        .map_err(|e| e.to_string())?;
    Ok(json!(spawned))
}

fn spawn_command(sessions: &SessionManager, p: SpawnCommandParams) -> Result<Value, String> {
    let is_win = cfg!(windows);
    let (command, args) = if is_win {
        (
            "powershell.exe".to_string(),
            vec![
                "-NoLogo".into(),
                "-NoExit".into(),
                "-Command".into(),
                p.command.clone(),
            ],
        )
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
        (
            shell,
            vec!["-lc".into(), format!("{}; exec bash", p.command)],
        )
    };
    let mut env = memory::memory_env(&p.project_root);
    env.insert("TRUEDECK".into(), "1".into());
    env.insert("TRUEDECK_PTY".into(), "rust".into());
    env.insert("TERM".into(), "xterm-256color".into());
    env.insert("COLORTERM".into(), "truecolor".into());
    env.insert("TERM_PROGRAM".into(), "TrueDeck".into());
    env.insert("FORCE_COLOR".into(), "3".into());
    env.insert("CLICOLOR".into(), "1".into());
    env.insert("CLICOLOR_FORCE".into(), "1".into());
    env.remove("NO_COLOR");

    let id = new_session_id();
    let info = SessionInfo {
        id: id.clone(),
        agent_id: format!("cmd-{}", p.label),
        agent_name: p.label.clone(),
        color: p.color.unwrap_or_else(|| "#3b82f6".into()),
        project_root: p.project_root.clone(),
        status: "running".into(),
        created_at: now_ms(),
        title: p.label.clone(),
        exit_code: None,
        kind: Some("command".into()),
        command_line: Some(p.command.clone()),
    };
    let spawned = sessions
        .spawn(
            &command,
            &args,
            &p.project_root,
            p.cols.unwrap_or(120),
            p.rows.unwrap_or(30),
            &env,
            info,
        )
        .map_err(|e| e.to_string())?;
    Ok(json!(spawned))
}

fn restore_layout(sessions: &SessionManager) -> Result<Value, String> {
    let layout = settings::load_layout();
    if layout.tabs.is_empty() {
        return Ok(json!({
            "layout": layout,
            "sessions": [],
            "restored": 0,
        }));
    }
    let mut restored: Vec<SessionInfo> = vec![];
    let agents = agents::list_agents().map_err(|e| e.to_string())?;

    for tab in &layout.tabs {
        if restored.len() >= settings::MAX_SAVED_TABS {
            break;
        }
        if !std::path::Path::new(&tab.project_root).exists() {
            continue;
        }
        let _ = projects::upsert_project(&tab.project_root, Some(tab.agent_name.clone()));
        let r = if tab.kind.as_deref() == Some("command") || tab.command_line.is_some() {
            spawn_command(
                sessions,
                SpawnCommandParams {
                    project_root: tab.project_root.clone(),
                    label: tab.agent_name.clone(),
                    command: tab
                        .command_line
                        .clone()
                        .unwrap_or_else(|| "echo restored".into()),
                    color: Some(tab.color.clone()),
                    cols: None,
                    rows: None,
                },
            )
        } else if agents.iter().any(|a| a.id == tab.agent_id) {
            spawn_agent(
                sessions,
                SpawnParams {
                    project_root: tab.project_root.clone(),
                    agent_id: tab.agent_id.clone(),
                    cols: None,
                    rows: None,
                    command: None,
                    args: None,
                    agent_name: Some(tab.agent_name.clone()),
                    color: Some(tab.color.clone()),
                    kind: tab.kind.clone(),
                    command_line: None,
                    env: None,
                },
            )
        } else {
            continue;
        };
        if let Ok(v) = r {
            if let Ok(info) = serde_json::from_value::<SessionInfo>(v) {
                restored.push(info);
            }
        }
    }

    let n = restored.len();
    let next = models::SessionLayout {
        version: 1,
        active_project_root: layout.active_project_root,
        active_index: layout.active_index.min(n.saturating_sub(1)),
        split_index: if n < 2 {
            None
        } else {
            layout.split_index.map(|i| i.min(n - 1))
        },
        split_ratio: layout.split_ratio,
        tabs: restored
            .iter()
            .map(|s| models::SavedSessionTab {
                agent_id: s.agent_id.clone(),
                agent_name: s.agent_name.clone(),
                project_root: s.project_root.clone(),
                color: s.color.clone(),
                kind: s.kind.clone(),
                command_line: s.command_line.clone(),
            })
            .collect(),
        saved_at: now_ms(),
    };
    let saved = settings::save_layout(&next).map_err(|e| e.to_string())?;
    Ok(json!({
        "layout": saved,
        "sessions": restored,
        "restored": n,
    }))
}
