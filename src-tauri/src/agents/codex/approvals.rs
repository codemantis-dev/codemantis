//! Codex server-initiated approval flow.
//!
//! Codex differs most sharply from Claude here. Where Claude gates tools
//! via the PreToolUse hook + the HTTP approval server, Codex pushes
//! **server-initiated JSON-RPC requests** at us:
//!   * `item/commandExecution/requestApproval`
//!   * `item/fileChange/requestApproval`
//!   * `mcpServer/elicitation/request`
//!   * `item/permissions/requestApproval`
//!
//! All four route onto the **same existing** `tool-approval-request` Tauri
//! event + the same `ToolApprovalModal` — we just translate the inbound
//! params into a unified [`ApprovalRequest`] for the modal layer and, when
//! the user answers, translate the decision back into the kind-specific
//! JSON-RPC response shape via [`build_response`].
//!
//! Spec: `CodeMantis-Phase2-CodexAdapter-v1.0.md` §2.4.5 (the four shapes)
//! and §4.5 (the routing diagram).
//!
//! State lives in [`crate::agents::codex::thread_state::ThreadState`];
//! this module is otherwise stateless.

#![allow(dead_code)] // S4 wires this into the spawn loop's server-request handler.

use serde::Serialize;
use serde_json::{json, Value};
use uuid::Uuid;

use super::jsonrpc::Id;
use super::thread_state::{ServerRequestKind, ThreadState};

/// The unified payload the spawn loop emits on `tool-approval-request`.
/// `forge_session_id` mirrors the Claude approval-event field name so the
/// existing frontend handler (`resolve_tool_approval`) works unchanged.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ApprovalRequest {
    pub request_id: String,
    pub forge_session_id: String,
    pub tool_name: String,
    pub tool_input: Value,
}

/// What the user picked, normalized across the four Codex kinds. `accept`
/// covers both `accept` and `acceptForSession` — the latter is a future
/// extension we don't surface in v1.3.0.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalDecision {
    Accept,
    Decline,
    Cancel,
}

impl ApprovalDecision {
    /// Convenience for callers that only see a `bool` from the existing
    /// `resolve_tool_approval` Tauri command.
    pub fn from_bool(approved: bool) -> Self {
        if approved {
            ApprovalDecision::Accept
        } else {
            ApprovalDecision::Decline
        }
    }
}

/// The JSON-RPC response to send back. Carries the original `rpc_id` so the
/// spawn layer can write the right `Message::Response`.
#[derive(Debug, Clone, PartialEq)]
pub struct ApprovalResponse {
    pub rpc_id: Id,
    pub result: Value,
}

/// Classify an inbound server-initiated request. Returns `None` for
/// methods that aren't one of the four documented approval shapes (those
/// are passed through to the client's default unknown-request handler).
///
/// Side effect: registers the resulting [`ServerRequestKind`] in
/// `state.pending_server_requests` under the generated `request_id` so
/// [`build_response_for`] can find it when the user answers.
pub async fn classify_server_request(
    state: &ThreadState,
    forge_session_id: &str,
    rpc_id: Id,
    method: &str,
    params: Value,
) -> Option<ApprovalRequest> {
    let item_id = params
        .get("itemId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let request_id = Uuid::new_v4().to_string();

    let (kind, tool_name, tool_input) = match method {
        "item/commandExecution/requestApproval" => {
            let command = params.get("command").cloned().unwrap_or(Value::Null);
            let cwd = params.get("cwd").cloned().unwrap_or(Value::Null);
            let reason = params.get("reason").cloned().unwrap_or(Value::Null);
            (
                ServerRequestKind::CommandExecution {
                    rpc_id: rpc_id.clone(),
                    item_id: item_id.clone(),
                },
                "Bash".to_string(),
                json!({"command": command, "cwd": cwd, "reason": reason}),
            )
        }
        "item/fileChange/requestApproval" => {
            let path = params.get("path").cloned().unwrap_or(Value::Null);
            let diff = params.get("diff").cloned().unwrap_or(Value::Null);
            (
                ServerRequestKind::FileChange {
                    rpc_id: rpc_id.clone(),
                    item_id: item_id.clone(),
                },
                "Edit".to_string(),
                json!({"path": path, "diff": diff}),
            )
        }
        "mcpServer/elicitation/request" => {
            let mode = params
                .get("mode")
                .and_then(|v| v.as_str())
                .unwrap_or("form")
                .to_string();
            let server = params
                .get("serverName")
                .and_then(|v| v.as_str())
                .unwrap_or("?");
            let schema = params.get("schema").cloned().unwrap_or(Value::Null);
            (
                ServerRequestKind::McpElicitation {
                    rpc_id: rpc_id.clone(),
                    item_id: item_id.clone(),
                },
                // Claude-compatible mcp__ convention so the approval
                // modal + activity feed format the tool as
                // "{server}: elicitation" via their shared mcp__ branches.
                format!("mcp__{server}__elicitation"),
                json!({"mode": mode, "schema": schema}),
            )
        }
        "item/permissions/requestApproval" => {
            let perms = params.get("permissions").cloned().unwrap_or(Value::Null);
            (
                ServerRequestKind::PermissionRequest {
                    rpc_id: rpc_id.clone(),
                    item_id,
                },
                "AskUserQuestion".to_string(),
                json!({"permissions": perms}),
            )
        }
        // Codex 0.130.0+ ships these as bare RPC methods alongside the
        // older `item/*` family. Same UX (approve / deny), different
        // wire shape: `callId` instead of `itemId`, ReviewDecision
        // response vocabulary (`approved` / `denied` / `abort`) instead
        // of `accept` / `decline` / `cancel`. We map them to the same
        // user-facing tool names so the modal stays readable.
        "execCommandApproval" => {
            let call_id = params
                .get("callId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let command_arr = params.get("command").cloned().unwrap_or(Value::Null);
            // The schema sends command as a string array; join for the
            // modal so users see `cmd arg1 arg2` rather than a JSON array.
            let command_str = command_arr
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str())
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .unwrap_or_default();
            let cwd = params.get("cwd").cloned().unwrap_or(Value::Null);
            let reason = params.get("reason").cloned().unwrap_or(Value::Null);
            (
                ServerRequestKind::ExecCommandApproval {
                    rpc_id: rpc_id.clone(),
                    call_id,
                },
                "Bash".to_string(),
                json!({"command": command_str, "cwd": cwd, "reason": reason}),
            )
        }
        "applyPatchApproval" => {
            let call_id = params
                .get("callId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let file_changes = params.get("fileChanges").cloned().unwrap_or(Value::Null);
            let reason = params.get("reason").cloned().unwrap_or(Value::Null);
            (
                ServerRequestKind::ApplyPatchApproval {
                    rpc_id: rpc_id.clone(),
                    call_id,
                },
                "Edit".to_string(),
                json!({"fileChanges": file_changes, "reason": reason}),
            )
        }
        _ => return None,
    };

    state.register_server_request(request_id.clone(), kind).await;

    Some(ApprovalRequest {
        request_id,
        forge_session_id: forge_session_id.to_string(),
        tool_name,
        tool_input,
    })
}

/// Drive the resolved-modal path. Looks up the kind in `state` by
/// `request_id` and builds the kind-specific JSON-RPC response. Returns
/// `None` if the request_id is stale (already resolved or never existed)
/// so the caller can warn-and-drop without panicking.
pub async fn build_response_for(
    state: &ThreadState,
    request_id: &str,
    decision: ApprovalDecision,
    content: Option<Value>,
) -> Option<ApprovalResponse> {
    let kind = state.take_server_request(request_id).await?;
    Some(build_response(&kind, decision, content))
}

/// Pure mapping kind × decision → JSON-RPC `result` value. Public for
/// tests + for callers that have already taken the kind out of
/// [`ThreadState`] themselves.
pub fn build_response(
    kind: &ServerRequestKind,
    decision: ApprovalDecision,
    content: Option<Value>,
) -> ApprovalResponse {
    let rpc_id = kind.rpc_id().clone();
    let result = match kind {
        ServerRequestKind::CommandExecution { .. }
        | ServerRequestKind::FileChange { .. } => {
            // Decision vocabulary per spec §2.4.5: accept | acceptForSession
            // | decline | cancel. We collapse to accept/decline/cancel in
            // v1.3.0 (acceptForSession deferred per spec).
            let d = match decision {
                ApprovalDecision::Accept => "accept",
                ApprovalDecision::Decline => "decline",
                ApprovalDecision::Cancel => "cancel",
            };
            json!({"decision": d})
        }
        ServerRequestKind::McpElicitation { .. } => {
            let action = match decision {
                ApprovalDecision::Accept => "accept",
                ApprovalDecision::Decline => "decline",
                ApprovalDecision::Cancel => "cancel",
            };
            json!({
                "action": action,
                "content": match decision {
                    ApprovalDecision::Accept => content.unwrap_or(Value::Null),
                    _ => Value::Null,
                }
            })
        }
        ServerRequestKind::PermissionRequest { .. } => {
            // Scope `"turn"` is the safe default — narrow, single-turn
            // grant. Permission set comes from the modal payload on
            // accept; on decline we send an empty set.
            json!({
                "scope": "turn",
                "permissions": match decision {
                    ApprovalDecision::Accept => content.unwrap_or_else(|| json!({})),
                    _ => json!({}),
                }
            })
        }
        ServerRequestKind::ExecCommandApproval { .. }
        | ServerRequestKind::ApplyPatchApproval { .. } => {
            // ReviewDecision vocabulary per schema: approved / denied /
            // abort / timed_out / approved_for_session / … We collapse
            // to the three primary states. Cancel maps to abort (per the
            // schema's "agent should not do anything until next user
            // command" semantics).
            let d = match decision {
                ApprovalDecision::Accept => "approved",
                ApprovalDecision::Decline => "denied",
                ApprovalDecision::Cancel => "abort",
            };
            json!({"decision": d})
        }
    };

    ApprovalResponse { rpc_id, result }
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn rpc(n: i64) -> Id {
        Id::Number(n)
    }

    // ── classify_server_request ──

    #[tokio::test]
    async fn classifies_command_execution_request() {
        let state = ThreadState::new();
        let req = classify_server_request(
            &state,
            "sess-1",
            rpc(7),
            "item/commandExecution/requestApproval",
            json!({
                "itemId": "i_1",
                "command": "rm -rf /tmp/x",
                "cwd": "/home/u",
                "reason": "cleanup",
            }),
        )
        .await
        .unwrap();
        assert_eq!(req.tool_name, "Bash");
        assert_eq!(req.tool_input["command"], "rm -rf /tmp/x");
        assert_eq!(req.tool_input["cwd"], "/home/u");
        assert_eq!(req.tool_input["reason"], "cleanup");
        assert_eq!(req.forge_session_id, "sess-1");
        // Stored under the generated request_id.
        let kind = state.take_server_request(&req.request_id).await.unwrap();
        assert!(matches!(
            kind,
            ServerRequestKind::CommandExecution { rpc_id: Id::Number(7), .. }
        ));
    }

    #[tokio::test]
    async fn classifies_file_change_request() {
        let state = ThreadState::new();
        let req = classify_server_request(
            &state,
            "s",
            rpc(8),
            "item/fileChange/requestApproval",
            json!({"itemId": "i_2", "path": "/p/x.rs", "diff": "+ x"}),
        )
        .await
        .unwrap();
        assert_eq!(req.tool_name, "Edit");
        assert_eq!(req.tool_input["path"], "/p/x.rs");
        let kind = state.take_server_request(&req.request_id).await.unwrap();
        assert!(matches!(kind, ServerRequestKind::FileChange { .. }));
    }

    #[tokio::test]
    async fn classifies_mcp_elicitation_request() {
        let state = ThreadState::new();
        let req = classify_server_request(
            &state,
            "s",
            rpc(9),
            "mcpServer/elicitation/request",
            json!({
                "itemId": "i_3",
                "mode": "form",
                "serverName": "context7",
                "schema": {"type": "object"},
            }),
        )
        .await
        .unwrap();
        assert_eq!(req.tool_name, "mcp__context7__elicitation");
        assert_eq!(req.tool_input["mode"], "form");
        let kind = state.take_server_request(&req.request_id).await.unwrap();
        assert!(matches!(kind, ServerRequestKind::McpElicitation { .. }));
    }

    #[tokio::test]
    async fn classifies_permission_request() {
        let state = ThreadState::new();
        let req = classify_server_request(
            &state,
            "s",
            rpc(10),
            "item/permissions/requestApproval",
            json!({"itemId": "i_4", "permissions": {"network": true}}),
        )
        .await
        .unwrap();
        assert_eq!(req.tool_name, "AskUserQuestion");
        assert_eq!(req.tool_input["permissions"]["network"], true);
        let kind = state.take_server_request(&req.request_id).await.unwrap();
        assert!(matches!(kind, ServerRequestKind::PermissionRequest { .. }));
    }

    #[tokio::test]
    async fn classify_returns_none_for_unknown_method() {
        let state = ThreadState::new();
        let req = classify_server_request(
            &state,
            "s",
            rpc(11),
            "future/server/request",
            json!({}),
        )
        .await;
        assert!(req.is_none());
        // And nothing was registered.
        assert!(state.pending_server_requests.lock().await.is_empty());
    }

    // ── build_response ──

    #[test]
    fn command_execution_accept_emits_decision_accept() {
        let kind = ServerRequestKind::CommandExecution {
            rpc_id: rpc(7),
            item_id: "i".into(),
        };
        let resp = build_response(&kind, ApprovalDecision::Accept, None);
        assert_eq!(resp.rpc_id, rpc(7));
        assert_eq!(resp.result["decision"], "accept");
    }

    #[test]
    fn command_execution_decline_emits_decision_decline() {
        let kind = ServerRequestKind::CommandExecution {
            rpc_id: rpc(7),
            item_id: "i".into(),
        };
        let resp = build_response(&kind, ApprovalDecision::Decline, None);
        assert_eq!(resp.result["decision"], "decline");
    }

    #[test]
    fn command_execution_cancel_emits_decision_cancel() {
        let kind = ServerRequestKind::FileChange {
            rpc_id: rpc(7),
            item_id: "i".into(),
        };
        let resp = build_response(&kind, ApprovalDecision::Cancel, None);
        assert_eq!(resp.result["decision"], "cancel");
    }

    #[test]
    fn mcp_elicitation_accept_passes_content_through() {
        let kind = ServerRequestKind::McpElicitation {
            rpc_id: rpc(9),
            item_id: "i".into(),
        };
        let resp = build_response(
            &kind,
            ApprovalDecision::Accept,
            Some(json!({"foo": "bar"})),
        );
        assert_eq!(resp.result["action"], "accept");
        assert_eq!(resp.result["content"]["foo"], "bar");
    }

    #[test]
    fn mcp_elicitation_decline_nulls_content() {
        let kind = ServerRequestKind::McpElicitation {
            rpc_id: rpc(9),
            item_id: "i".into(),
        };
        let resp = build_response(
            &kind,
            ApprovalDecision::Decline,
            Some(json!({"foo": "bar"})),
        );
        assert_eq!(resp.result["action"], "decline");
        assert!(resp.result["content"].is_null());
    }

    #[test]
    fn permission_request_accept_uses_turn_scope_and_passes_permissions() {
        let kind = ServerRequestKind::PermissionRequest {
            rpc_id: rpc(10),
            item_id: "i".into(),
        };
        let resp = build_response(
            &kind,
            ApprovalDecision::Accept,
            Some(json!({"network": true})),
        );
        assert_eq!(resp.result["scope"], "turn");
        assert_eq!(resp.result["permissions"]["network"], true);
    }

    #[test]
    fn permission_request_decline_uses_empty_permissions() {
        let kind = ServerRequestKind::PermissionRequest {
            rpc_id: rpc(10),
            item_id: "i".into(),
        };
        let resp = build_response(&kind, ApprovalDecision::Decline, None);
        assert_eq!(resp.result["scope"], "turn");
        assert!(resp.result["permissions"].is_object());
        assert_eq!(resp.result["permissions"].as_object().unwrap().len(), 0);
    }

    // ── build_response_for (round-trip via state) ──

    #[tokio::test]
    async fn build_response_for_consumes_pending_entry() {
        let state = ThreadState::new();
        let req = classify_server_request(
            &state,
            "s",
            rpc(42),
            "item/commandExecution/requestApproval",
            json!({"itemId": "i", "command": "ls"}),
        )
        .await
        .unwrap();
        let resp = build_response_for(&state, &req.request_id, ApprovalDecision::Accept, None)
            .await
            .unwrap();
        assert_eq!(resp.rpc_id, rpc(42));
        assert_eq!(resp.result["decision"], "accept");
        // Double-resolve is None — prevents stale-id replays.
        assert!(
            build_response_for(&state, &req.request_id, ApprovalDecision::Accept, None)
                .await
                .is_none()
        );
    }

    #[tokio::test]
    async fn build_response_for_unknown_id_returns_none() {
        let state = ThreadState::new();
        let resp = build_response_for(&state, "unknown-uuid", ApprovalDecision::Accept, None).await;
        assert!(resp.is_none());
    }

    // ── ApprovalDecision::from_bool ──

    #[test]
    fn approval_decision_from_bool_collapses_to_accept_or_decline() {
        assert_eq!(ApprovalDecision::from_bool(true), ApprovalDecision::Accept);
        assert_eq!(ApprovalDecision::from_bool(false), ApprovalDecision::Decline);
    }

    // ── Codex 0.130.0+ bare-method approval families ──

    #[tokio::test]
    async fn classifies_exec_command_approval() {
        // Newer family — bare method, callId correlator, command-as-array.
        // The translator should join the array into a display string and
        // map the tool name to Bash so the existing badge + modal layer
        // recognise it.
        let state = ThreadState::new();
        let req = classify_server_request(
            &state,
            "sess-x",
            rpc(11),
            "execCommandApproval",
            json!({
                "callId": "call_abc",
                "conversationId": "thr_1",
                "command": ["rm", "-rf", "/tmp/x"],
                "cwd": "/home/u",
                "parsedCmd": [],
                "reason": "cleanup",
            }),
        )
        .await
        .unwrap();
        assert_eq!(req.tool_name, "Bash");
        assert_eq!(req.tool_input["command"], "rm -rf /tmp/x");
        assert_eq!(req.tool_input["cwd"], "/home/u");
        let kind = state.take_server_request(&req.request_id).await.unwrap();
        match kind {
            ServerRequestKind::ExecCommandApproval { call_id, rpc_id } => {
                assert_eq!(call_id, "call_abc");
                assert_eq!(rpc_id, Id::Number(11));
            }
            other => panic!("expected ExecCommandApproval, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn classifies_apply_patch_approval() {
        let state = ThreadState::new();
        let req = classify_server_request(
            &state,
            "sess-y",
            rpc(12),
            "applyPatchApproval",
            json!({
                "callId": "call_def",
                "conversationId": "thr_1",
                "fileChanges": {
                    "/tmp/a.rs": { "type": "add", "content": "fn main() {}" }
                },
                "reason": "implementing plan",
            }),
        )
        .await
        .unwrap();
        assert_eq!(req.tool_name, "Edit");
        assert!(req.tool_input["fileChanges"].is_object());
        assert_eq!(req.tool_input["reason"], "implementing plan");
        let kind = state.take_server_request(&req.request_id).await.unwrap();
        match kind {
            ServerRequestKind::ApplyPatchApproval { call_id, .. } => {
                assert_eq!(call_id, "call_def");
            }
            other => panic!("expected ApplyPatchApproval, got {:?}", other),
        }
    }

    #[test]
    fn build_response_exec_command_uses_review_decision_vocabulary() {
        // ReviewDecision: approved / denied / abort — NOT accept/decline.
        // Schema: docs/internal/codex-app-server-schemas/ExecCommandApprovalResponse.json
        let kind = ServerRequestKind::ExecCommandApproval {
            rpc_id: rpc(1),
            call_id: "call_1".into(),
        };
        let approved = build_response(&kind, ApprovalDecision::Accept, None);
        assert_eq!(approved.result, json!({"decision": "approved"}));
        let denied = build_response(&kind, ApprovalDecision::Decline, None);
        assert_eq!(denied.result, json!({"decision": "denied"}));
        let cancelled = build_response(&kind, ApprovalDecision::Cancel, None);
        assert_eq!(cancelled.result, json!({"decision": "abort"}));
    }

    #[test]
    fn build_response_apply_patch_uses_review_decision_vocabulary() {
        let kind = ServerRequestKind::ApplyPatchApproval {
            rpc_id: rpc(2),
            call_id: "call_2".into(),
        };
        let approved = build_response(&kind, ApprovalDecision::Accept, None);
        assert_eq!(approved.result, json!({"decision": "approved"}));
    }
}
