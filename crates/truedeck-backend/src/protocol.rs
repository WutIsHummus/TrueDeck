//! JSON-RPC style protocol over newline-delimited JSON.
//!
//! Request:  { "id": 1, "method": "sessions.spawn", "params": { ... } }
//! Response: { "id": 1, "ok": true, "result": ... }
//! Event:    { "event": "pty.data", "params": { ... } }

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
pub struct Request {
    pub id: u64,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
pub struct Response {
    pub id: u64,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Response {
    pub fn ok(id: u64, result: Value) -> Self {
        Self {
            id,
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    pub fn err(id: u64, message: impl Into<String>) -> Self {
        Self {
            id,
            ok: false,
            result: None,
            error: Some(message.into()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct Event {
    pub event: String,
    pub params: Value,
}

impl Event {
    pub fn new(event: impl Into<String>, params: Value) -> Self {
        Self {
            event: event.into(),
            params,
        }
    }
}

/// Params for sessions.spawn
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnParams {
    pub project_root: String,
    pub agent_id: String,
    #[serde(default)]
    pub cols: Option<u16>,
    #[serde(default)]
    pub rows: Option<u16>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Option<Vec<String>>,
    #[serde(default)]
    pub agent_name: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub command_line: Option<String>,
    #[serde(default)]
    pub env: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionIdParams {
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteParams {
    pub id: String,
    pub data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeParams {
    pub id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnCommandParams {
    pub project_root: String,
    pub label: String,
    pub command: String,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub cols: Option<u16>,
    #[serde(default)]
    pub rows: Option<u16>,
}
