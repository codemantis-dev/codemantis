//! Newline-delimited JSON-RPC 2.0 message vocabulary for Codex.
//!
//! Wire shape (per the Codex app-server README):
//!   * One JSON object per line, terminated by `\n`.
//!   * The `"jsonrpc": "2.0"` field is **omitted on the wire** by Codex; we
//!     do the same on outgoing messages and tolerate (ignore) it on incoming
//!     ones for robustness against future tightening.
//!   * Three message kinds:
//!     - **Request**:      `{ "id": N, "method": "...", "params": {...} }`
//!     - **Notification**: `{ "method": "...", "params": {...} }` (no id)
//!     - **Response**:     `{ "id": N, "result": ... }` or
//!       `{ "id": N, "error": { code, message, data? } }`
//!   * Server-initiated requests are real requests that the client must
//!     respond to (e.g. `item/commandExecution/requestApproval`).
//!
//! This module is the pure protocol layer. It owns no IO; the
//! [`crate::agents::codex::client`] module ties it to stdio.

#![allow(dead_code)] // Phase 2 S2 lands the vocabulary; consumers land in S3–S4.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// JSON-RPC 2.0 message id. The spec allows numbers, strings, or null; Codex
/// uses numbers in every documented example, but we accept strings so a
/// future client (or a fuzz input) doesn't crash the parser. `Null` ids are
/// rejected — they're ambiguous with notifications and the spec discourages
/// them.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Id {
    Number(i64),
    Str(String),
}

impl Id {
    /// Compact display for logs / pending-request keys.
    pub fn as_log_str(&self) -> String {
        match self {
            Id::Number(n) => n.to_string(),
            Id::Str(s) => s.clone(),
        }
    }
}

/// JSON-RPC 2.0 error object. `data` is optional and Codex-side-specific.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RpcError {
    pub code: i32,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl RpcError {
    /// Backpressure: per the Codex app-server README §"Errors", code
    /// `-32001` ("Server overloaded; retry later.") is retryable with
    /// exponential backoff and jitter.
    pub const SERVER_OVERLOADED: i32 = -32001;

    pub fn is_retryable(&self) -> bool {
        self.code == Self::SERVER_OVERLOADED
    }
}

/// The three on-wire message kinds, discriminated by the presence of
/// `id` / `method` / `result` / `error`.
///
/// We do **not** use serde's tag/content adjacency because the underlying
/// shapes don't share a tag field — the discriminator is structural.
/// [`parse_line`] walks the raw `Value` to pick the right arm explicitly.
#[derive(Debug, Clone, PartialEq)]
pub enum Message {
    /// `{ "id": N, "method": "...", "params": {...} }` — caller (us or the
    /// server) expects a matching `Response`. Server→client requests arrive
    /// here too; the dispatcher tells them apart by `method` prefix.
    Request {
        id: Id,
        method: String,
        params: Value,
    },
    /// `{ "method": "...", "params": {...} }` — fire-and-forget.
    Notification { method: String, params: Value },
    /// `{ "id": N, "result": ... }` — success reply to a request.
    Response { id: Id, result: Value },
    /// `{ "id": N, "error": { ... } }` — error reply to a request.
    ErrorResponse { id: Id, error: RpcError },
}

impl Message {
    /// Build the outgoing UTF-8 line (with a trailing `\n`). Omits the
    /// `"jsonrpc"` field per Codex's wire convention.
    pub fn to_wire_line(&self) -> Result<String, ParseError> {
        let value = match self {
            Message::Request { id, method, params } => serde_json::json!({
                "id": id,
                "method": method,
                "params": params,
            }),
            Message::Notification { method, params } => serde_json::json!({
                "method": method,
                "params": params,
            }),
            Message::Response { id, result } => serde_json::json!({
                "id": id,
                "result": result,
            }),
            Message::ErrorResponse { id, error } => serde_json::json!({
                "id": id,
                "error": error,
            }),
        };
        let mut s = serde_json::to_string(&value).map_err(ParseError::Serialize)?;
        s.push('\n');
        Ok(s)
    }
}

/// Parse errors surfaced as `ProtocolError` upstream. Malformed input does
/// not panic — the framer hands the error back to the caller and keeps
/// reading the next line.
#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("message is not a JSON object")]
    NotAnObject,
    #[error("response has both `result` and `error`")]
    ConflictingFields,
    #[error("missing required field: {0}")]
    MissingField(&'static str),
    #[error("id field is null (use a notification instead)")]
    NullId,
    #[error("serialize failed: {0}")]
    Serialize(serde_json::Error),
}

/// Parse a single newline-delimited JSON-RPC frame.
///
/// `line` may include a trailing `\n` / `\r\n`; both are tolerated. An empty
/// or whitespace-only line is treated as an error so callers can decide
/// whether to ignore or escalate (the upstream stdio loop ignores blanks).
pub fn parse_line(line: &str) -> Result<Message, ParseError> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Err(ParseError::MissingField("payload"));
    }

    let mut value: Value = serde_json::from_str(trimmed)?;
    let obj = value.as_object_mut().ok_or(ParseError::NotAnObject)?;

    // Tolerate but ignore `jsonrpc` on incoming.
    obj.remove("jsonrpc");

    let has_method = obj.contains_key("method");
    let has_id = obj.contains_key("id");
    let has_result = obj.contains_key("result");
    let has_error = obj.contains_key("error");

    if has_result && has_error {
        return Err(ParseError::ConflictingFields);
    }

    if has_method {
        let method = obj
            .remove("method")
            .and_then(|v| v.as_str().map(str::to_string))
            .ok_or(ParseError::MissingField("method"))?;
        let params = obj.remove("params").unwrap_or(Value::Null);
        if has_id {
            let id = parse_id(obj.remove("id").unwrap())?;
            Ok(Message::Request { id, method, params })
        } else {
            Ok(Message::Notification { method, params })
        }
    } else if has_result {
        let id_v = obj.remove("id").ok_or(ParseError::MissingField("id"))?;
        let id = parse_id(id_v)?;
        let result = obj.remove("result").unwrap_or(Value::Null);
        Ok(Message::Response { id, result })
    } else if has_error {
        let id_v = obj.remove("id").ok_or(ParseError::MissingField("id"))?;
        let id = parse_id(id_v)?;
        let error: RpcError = serde_json::from_value(obj.remove("error").unwrap())?;
        Ok(Message::ErrorResponse { id, error })
    } else {
        Err(ParseError::MissingField("method|result|error"))
    }
}

fn parse_id(v: Value) -> Result<Id, ParseError> {
    match v {
        Value::Null => Err(ParseError::NullId),
        Value::Number(n) => n
            .as_i64()
            .map(Id::Number)
            .ok_or(ParseError::MissingField("integer id")),
        Value::String(s) => Ok(Id::Str(s)),
        _ => Err(ParseError::MissingField("id (number or string)")),
    }
}

/// Compute backoff for a single retry attempt against
/// `RpcError::SERVER_OVERLOADED`. `attempt` is 1-indexed: attempt 1 returns
/// a small delay, attempt 2 doubles it, etc. Capped at 10 s. Jitter is
/// `±25%` of the base, derived from a caller-supplied RNG seed so tests are
/// deterministic.
///
/// We expose this as a pure function (not a `tokio::sleep` wrapper) so the
/// client module decides whether/how long to wait — keeping this module
/// transport-agnostic.
pub fn retry_backoff_ms(attempt: u32, jitter_seed: u64) -> u64 {
    if attempt == 0 {
        return 0;
    }
    let base = 100u64.saturating_mul(2u64.saturating_pow(attempt - 1));
    let capped = base.min(10_000);
    // Deterministic jitter from the seed: ±25%.
    let jitter_range = capped / 4;
    if jitter_range == 0 {
        return capped;
    }
    let mix = jitter_seed
        .wrapping_mul(0x9E37_79B9_7F4A_7C15)
        .wrapping_add(attempt as u64);
    let jitter = (mix % (2 * jitter_range + 1)) as i64 - jitter_range as i64;
    let signed = capped as i64 + jitter;
    signed.max(0) as u64
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ── parse_line ──

    #[test]
    fn parses_server_to_client_request() {
        // From the Codex README "Command execution approvals" §:
        let line = r#"{"id":7,"method":"item/commandExecution/requestApproval","params":{"threadId":"thr_1","turnId":"t_1","itemId":"i_1"}}"#;
        let msg = parse_line(line).unwrap();
        match msg {
            Message::Request { id, method, params } => {
                assert_eq!(id, Id::Number(7));
                assert_eq!(method, "item/commandExecution/requestApproval");
                assert_eq!(params["threadId"], "thr_1");
            }
            other => panic!("expected Request, got {:?}", other),
        }
    }

    #[test]
    fn parses_notification_no_id() {
        let line = r#"{"method":"turn/completed","params":{"turn":{"id":"t_1","status":"completed"}}}"#;
        let msg = parse_line(line).unwrap();
        match msg {
            Message::Notification { method, params } => {
                assert_eq!(method, "turn/completed");
                assert_eq!(params["turn"]["status"], "completed");
            }
            other => panic!("expected Notification, got {:?}", other),
        }
    }

    #[test]
    fn parses_success_response() {
        let line = r#"{"id":3,"result":{"models":["gpt-5.1-codex"]}}"#;
        let msg = parse_line(line).unwrap();
        match msg {
            Message::Response { id, result } => {
                assert_eq!(id, Id::Number(3));
                assert_eq!(result["models"][0], "gpt-5.1-codex");
            }
            other => panic!("expected Response, got {:?}", other),
        }
    }

    #[test]
    fn parses_error_response_with_backpressure_code() {
        let line = r#"{"id":4,"error":{"code":-32001,"message":"Server overloaded; retry later."}}"#;
        let msg = parse_line(line).unwrap();
        match msg {
            Message::ErrorResponse { id, error } => {
                assert_eq!(id, Id::Number(4));
                assert_eq!(error.code, -32001);
                assert!(error.is_retryable());
            }
            other => panic!("expected ErrorResponse, got {:?}", other),
        }
    }

    #[test]
    fn parses_string_id() {
        let line = r#"{"id":"req-abc","method":"thread/start","params":{}}"#;
        let msg = parse_line(line).unwrap();
        assert!(matches!(msg, Message::Request { id: Id::Str(ref s), .. } if s == "req-abc"));
    }

    #[test]
    fn tolerates_jsonrpc_field_on_incoming() {
        let line = r#"{"jsonrpc":"2.0","id":1,"result":{}}"#;
        let msg = parse_line(line).unwrap();
        assert!(matches!(msg, Message::Response { id: Id::Number(1), .. }));
    }

    #[test]
    fn tolerates_crlf_line_ending() {
        let line = "{\"id\":1,\"result\":{}}\r\n";
        let msg = parse_line(line).unwrap();
        assert!(matches!(msg, Message::Response { id: Id::Number(1), .. }));
    }

    #[test]
    fn rejects_malformed_json() {
        let err = parse_line(r#"{ not json"#).unwrap_err();
        assert!(matches!(err, ParseError::Json(_)));
    }

    #[test]
    fn rejects_non_object_payload() {
        let err = parse_line("42").unwrap_err();
        assert!(matches!(err, ParseError::NotAnObject));
    }

    #[test]
    fn rejects_response_with_both_result_and_error() {
        let line = r#"{"id":1,"result":{},"error":{"code":0,"message":""}}"#;
        let err = parse_line(line).unwrap_err();
        assert!(matches!(err, ParseError::ConflictingFields));
    }

    #[test]
    fn rejects_message_with_no_discriminator() {
        let line = r#"{"id":1}"#;
        let err = parse_line(line).unwrap_err();
        assert!(matches!(err, ParseError::MissingField(_)));
    }

    #[test]
    fn rejects_null_id_on_request() {
        let line = r#"{"id":null,"method":"x","params":{}}"#;
        let err = parse_line(line).unwrap_err();
        assert!(matches!(err, ParseError::NullId));
    }

    #[test]
    fn rejects_empty_line() {
        assert!(matches!(
            parse_line("   ").unwrap_err(),
            ParseError::MissingField("payload")
        ));
    }

    // ── to_wire_line ──

    #[test]
    fn writes_request_without_jsonrpc_field() {
        let msg = Message::Request {
            id: Id::Number(0),
            method: "initialize".into(),
            params: json!({"clientInfo": {"name": "codemantis"}}),
        };
        let line = msg.to_wire_line().unwrap();
        assert!(line.ends_with('\n'));
        let parsed: Value = serde_json::from_str(line.trim()).unwrap();
        assert!(parsed.get("jsonrpc").is_none(), "wire form must omit jsonrpc");
        assert_eq!(parsed["id"], 0);
        assert_eq!(parsed["method"], "initialize");
        assert_eq!(parsed["params"]["clientInfo"]["name"], "codemantis");
    }

    #[test]
    fn writes_notification_with_no_id() {
        let msg = Message::Notification {
            method: "initialized".into(),
            params: json!({}),
        };
        let line = msg.to_wire_line().unwrap();
        let parsed: Value = serde_json::from_str(line.trim()).unwrap();
        assert!(parsed.get("id").is_none());
        assert_eq!(parsed["method"], "initialized");
    }

    #[test]
    fn writes_response_without_error_field() {
        let msg = Message::Response {
            id: Id::Number(7),
            result: json!({"decision": "accept"}),
        };
        let line = msg.to_wire_line().unwrap();
        let parsed: Value = serde_json::from_str(line.trim()).unwrap();
        assert!(parsed.get("error").is_none());
        assert_eq!(parsed["result"]["decision"], "accept");
    }

    #[test]
    fn message_roundtrips_via_wire() {
        let original = Message::Request {
            id: Id::Number(42),
            method: "thread/start".into(),
            params: json!({"cwd": "/tmp", "approvalPolicy": "onRequest"}),
        };
        let line = original.to_wire_line().unwrap();
        let parsed = parse_line(&line).unwrap();
        assert_eq!(parsed, original);
    }

    // ── retry_backoff_ms ──

    #[test]
    fn backoff_zero_attempt_is_zero() {
        assert_eq!(retry_backoff_ms(0, 0), 0);
    }

    #[test]
    fn backoff_grows_geometrically_then_caps() {
        // Same seed → deterministic across attempts. Base doubles: 100,
        // 200, 400, 800 … until the 10 s cap.
        let a1 = retry_backoff_ms(1, 1);
        let a2 = retry_backoff_ms(2, 1);
        let a3 = retry_backoff_ms(3, 1);
        assert!(a1 < a2 && a2 < a3, "delays must monotonically grow: {a1}/{a2}/{a3}");

        // Cap at 10 s + jitter band → max possible is 12_500ms (cap + 25%).
        let big = retry_backoff_ms(20, 0xDEAD_BEEF);
        assert!(big <= 12_500, "must cap below 12.5s, got {big}");
        assert!(big >= 7_500, "must stay near cap once past ceiling, got {big}");
    }

    #[test]
    fn backoff_is_deterministic_for_same_seed() {
        assert_eq!(retry_backoff_ms(3, 99), retry_backoff_ms(3, 99));
    }

    #[test]
    fn backoff_varies_across_seeds() {
        // Two distinct seeds should produce two distinct values for a
        // mid-attempt with meaningful jitter range.
        let a = retry_backoff_ms(5, 1);
        let b = retry_backoff_ms(5, 2);
        assert_ne!(a, b);
    }

    // ── RpcError ──

    #[test]
    fn rpc_error_only_overload_is_retryable() {
        assert!(RpcError {
            code: RpcError::SERVER_OVERLOADED,
            message: "overload".into(),
            data: None
        }
        .is_retryable());
        assert!(!RpcError {
            code: -32600,
            message: "invalid".into(),
            data: None
        }
        .is_retryable());
    }
}
