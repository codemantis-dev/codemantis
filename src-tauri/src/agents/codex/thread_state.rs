//! Per-thread state for a live Codex session.
//!
//! Sits **alongside** [`crate::agents::codex::client::CodexClient`] rather
//! than inside it: the client knows about JSON-RPC ids; this module knows
//! about Codex threads, turns, and items. A single session owns one
//! `CodexClient` plus one `ThreadState`.
//!
//! Spec: `_guidance/requirements/CodeMantis-Phase2-CodexAdapter-v1.0.md`
//! §4.3 (lifecycle) and §4.5 (approvals).
//!
//! Phase 2 Session 2 lands the structure + the bookkeeping primitives;
//! S3's translator + approvals are the first real consumers, S4's spawn
//! constructs the instance.

#![allow(dead_code)] // S2 lands the structure; consumers land in S3–S4.

use std::collections::HashMap;

use tokio::sync::Mutex;

use super::jsonrpc::Id as RpcId;

/// Which server-initiated approval is in flight, keyed by the
/// CodeMantis-side `request_id` (uuid) that the frontend modal answers.
/// When the user responds, we look up the kind to decide:
///   * which JSON-RPC id to respond on, and
///   * which response shape to send (decision vs. action vs. scope/permissions).
///
/// Spec §4.5 maps these four to the existing `tool-approval-request` Tauri
/// event so the modal layer is fully reused.
#[derive(Debug, Clone, PartialEq)]
pub enum ServerRequestKind {
    /// `item/commandExecution/requestApproval` — response shape
    /// `{ "decision": "accept" | "acceptForSession" | "decline" | "cancel" }`.
    CommandExecution { rpc_id: RpcId, item_id: String },
    /// `item/fileChange/requestApproval` — same `{ "decision": … }` shape.
    FileChange { rpc_id: RpcId, item_id: String },
    /// `mcpServer/elicitation/request` — response is
    /// `{ "action": "accept" | "decline" | "cancel", "content": {…} | null }`.
    McpElicitation { rpc_id: RpcId, item_id: String },
    /// `item/permissions/requestApproval` — response is
    /// `{ "scope": "session" | "turn", "permissions": { … } }`.
    PermissionRequest { rpc_id: RpcId, item_id: String },
    /// `execCommandApproval` — newer (cli 0.130.0+) bare-method form of
    /// `item/commandExecution/requestApproval`. Different response shape:
    /// `{ "decision": "approved" | "denied" | "abort" | "timed_out" |
    ///                "approved_for_session" | … }` (`ReviewDecision`).
    /// Correlates via `callId` rather than `itemId`. Schema:
    /// docs/internal/codex-app-server-schemas/ExecCommandApprovalParams.json
    ExecCommandApproval { rpc_id: RpcId, call_id: String },
    /// `applyPatchApproval` — same `ReviewDecision` response shape as
    /// `ExecCommandApproval`. Payload is a map of file changes (add /
    /// delete / update with unified_diff). Schema:
    /// docs/internal/codex-app-server-schemas/ApplyPatchApprovalParams.json
    ApplyPatchApproval { rpc_id: RpcId, call_id: String },
    /// `item/tool/requestUserInput` — Codex asks a structured form
    /// (questions array, each with optional options[]). The response
    /// shape is `{ answers: { [questionId]: { answers: string[] } } }`.
    /// Schema:
    /// docs/internal/codex-app-server-schemas/ToolRequestUserInputParams.json
    ToolRequestUserInput { rpc_id: RpcId, item_id: String },
}

impl ServerRequestKind {
    pub fn rpc_id(&self) -> &RpcId {
        match self {
            ServerRequestKind::CommandExecution { rpc_id, .. }
            | ServerRequestKind::FileChange { rpc_id, .. }
            | ServerRequestKind::McpElicitation { rpc_id, .. }
            | ServerRequestKind::PermissionRequest { rpc_id, .. }
            | ServerRequestKind::ExecCommandApproval { rpc_id, .. }
            | ServerRequestKind::ApplyPatchApproval { rpc_id, .. }
            | ServerRequestKind::ToolRequestUserInput { rpc_id, .. } => rpc_id,
        }
    }

    pub fn item_id(&self) -> &str {
        match self {
            ServerRequestKind::CommandExecution { item_id, .. }
            | ServerRequestKind::FileChange { item_id, .. }
            | ServerRequestKind::McpElicitation { item_id, .. }
            | ServerRequestKind::PermissionRequest { item_id, .. }
            | ServerRequestKind::ToolRequestUserInput { item_id, .. } => item_id,
            // The newer approval methods use `callId` rather than
            // `itemId`. The semantics are the same — a stable correlator
            // — so item_id() returns it transparently to callers.
            ServerRequestKind::ExecCommandApproval { call_id, .. }
            | ServerRequestKind::ApplyPatchApproval { call_id, .. } => call_id,
        }
    }
}

/// Accumulator for a streaming ThreadItem.
///
/// `agentMessage` and `reasoning` items emit `*/delta` notifications between
/// `item/started` and `item/completed` — the translator concatenates them
/// here so the UI can render incremental text. Bash-style
/// `commandExecution` items use `outputDelta` instead but share the same
/// "buffer until completed" shape; the translator drops the buffer once the
/// item completes.
///
/// The full Codex item shape arrives on `item/started` and is repeated on
/// `item/completed` — we store the started snapshot so the translator can
/// reference fields (e.g. `command` / `cwd`) without re-parsing.
#[derive(Debug, Clone, Default)]
pub struct ItemBuffer {
    /// What the translator emits as TextDelta concatenated text.
    pub text: String,
    /// True once `item/completed` (or `item/failed`) has been seen.
    pub completed: bool,
    /// The most-recently-seen full item shape (`item/started` snapshot).
    pub last_snapshot: Option<serde_json::Value>,
}

impl ItemBuffer {
    pub fn from_snapshot(snapshot: serde_json::Value) -> Self {
        Self {
            text: String::new(),
            completed: false,
            last_snapshot: Some(snapshot),
        }
    }

    pub fn append_delta(&mut self, delta: &str) {
        self.text.push_str(delta);
    }

    pub fn mark_completed(&mut self) {
        self.completed = true;
    }
}

/// Live state for a single Codex thread (one CodeMantis session).
///
/// Fields are individually `Mutex`-wrapped (rather than the whole struct)
/// so the JSON-RPC dispatch loop can update item buffers while the command
/// layer reads the current-turn id without contention.
pub struct ThreadState {
    /// The thread id assigned by Codex (`thr_…`). Set after the
    /// `thread/started` notification lands.
    pub thread_id: Mutex<Option<String>>,
    /// Active turn id (`turn_…`) within the current thread. `None` between
    /// turns. Used by `turn/interrupt` to cancel the right turn.
    pub current_turn_id: Mutex<Option<String>>,
    /// In-flight server-initiated approvals waiting on a frontend modal.
    /// Keyed by the CodeMantis-side `request_id` (uuid) so
    /// `resolve_tool_approval` can correlate.
    pub pending_server_requests: Mutex<HashMap<String, ServerRequestKind>>,
    /// Per-item accumulators for streaming text / reasoning deltas.
    /// Keyed by `itemId`.
    pub item_buffers: Mutex<HashMap<String, ItemBuffer>>,
}

impl ThreadState {
    pub fn new() -> Self {
        Self {
            thread_id: Mutex::new(None),
            current_turn_id: Mutex::new(None),
            pending_server_requests: Mutex::new(HashMap::new()),
            item_buffers: Mutex::new(HashMap::new()),
        }
    }

    pub async fn set_thread_id(&self, id: String) {
        *self.thread_id.lock().await = Some(id);
    }

    pub async fn set_current_turn(&self, turn_id: Option<String>) {
        *self.current_turn_id.lock().await = turn_id;
    }

    pub async fn register_server_request(
        &self,
        request_id: String,
        kind: ServerRequestKind,
    ) {
        self.pending_server_requests
            .lock()
            .await
            .insert(request_id, kind);
    }

    pub async fn take_server_request(
        &self,
        request_id: &str,
    ) -> Option<ServerRequestKind> {
        self.pending_server_requests.lock().await.remove(request_id)
    }
}

impl Default for ThreadState {
    fn default() -> Self {
        Self::new()
    }
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn server_request_kind_exposes_inner_fields_uniformly() {
        let kinds = [
            ServerRequestKind::CommandExecution {
                rpc_id: RpcId::Number(1),
                item_id: "i_1".into(),
            },
            ServerRequestKind::FileChange {
                rpc_id: RpcId::Number(2),
                item_id: "i_2".into(),
            },
            ServerRequestKind::McpElicitation {
                rpc_id: RpcId::Number(3),
                item_id: "i_3".into(),
            },
            ServerRequestKind::PermissionRequest {
                rpc_id: RpcId::Number(4),
                item_id: "i_4".into(),
            },
        ];
        for (idx, k) in kinds.iter().enumerate() {
            assert_eq!(*k.rpc_id(), RpcId::Number((idx + 1) as i64));
            assert_eq!(k.item_id(), &format!("i_{}", idx + 1));
        }
    }

    #[test]
    fn item_buffer_accumulates_deltas() {
        let mut buf = ItemBuffer::default();
        buf.append_delta("hel");
        buf.append_delta("lo");
        buf.append_delta(" world");
        assert_eq!(buf.text, "hello world");
        assert!(!buf.completed);
        buf.mark_completed();
        assert!(buf.completed);
    }

    #[test]
    fn item_buffer_keeps_started_snapshot() {
        let snap = json!({"type": "commandExecution", "command": "ls", "cwd": "/tmp"});
        let buf = ItemBuffer::from_snapshot(snap.clone());
        assert_eq!(buf.last_snapshot.as_ref().unwrap(), &snap);
        assert!(buf.text.is_empty());
    }

    #[tokio::test]
    async fn thread_state_thread_and_turn_lifecycle() {
        let state = ThreadState::new();
        assert!(state.thread_id.lock().await.is_none());
        assert!(state.current_turn_id.lock().await.is_none());

        state.set_thread_id("thr_42".into()).await;
        assert_eq!(state.thread_id.lock().await.as_deref(), Some("thr_42"));

        state.set_current_turn(Some("turn_a".into())).await;
        assert_eq!(
            state.current_turn_id.lock().await.as_deref(),
            Some("turn_a")
        );

        state.set_current_turn(None).await;
        assert!(state.current_turn_id.lock().await.is_none());
    }

    #[tokio::test]
    async fn pending_server_request_register_and_take() {
        let state = ThreadState::new();
        state
            .register_server_request(
                "req-1".into(),
                ServerRequestKind::CommandExecution {
                    rpc_id: RpcId::Number(7),
                    item_id: "i_1".into(),
                },
            )
            .await;
        assert_eq!(state.pending_server_requests.lock().await.len(), 1);

        let taken = state.take_server_request("req-1").await;
        assert!(matches!(
            taken,
            Some(ServerRequestKind::CommandExecution { rpc_id: RpcId::Number(7), .. })
        ));
        assert!(state.pending_server_requests.lock().await.is_empty());
        // Taking the same request twice yields None — guards against
        // double-resolve races between the modal close and a turn cancel.
        assert!(state.take_server_request("req-1").await.is_none());
    }

    #[tokio::test]
    async fn pending_server_requests_isolate_by_request_id() {
        let state = ThreadState::new();
        state
            .register_server_request(
                "req-a".into(),
                ServerRequestKind::FileChange {
                    rpc_id: RpcId::Number(1),
                    item_id: "i_a".into(),
                },
            )
            .await;
        state
            .register_server_request(
                "req-b".into(),
                ServerRequestKind::McpElicitation {
                    rpc_id: RpcId::Number(2),
                    item_id: "i_b".into(),
                },
            )
            .await;
        assert_eq!(state.pending_server_requests.lock().await.len(), 2);

        let a = state.take_server_request("req-a").await.unwrap();
        assert!(matches!(a, ServerRequestKind::FileChange { .. }));
        // The other request stays put.
        assert_eq!(state.pending_server_requests.lock().await.len(), 1);
    }
}
