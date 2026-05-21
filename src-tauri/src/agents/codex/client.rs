//! Codex JSON-RPC client (transport-agnostic).
//!
//! Owns the in-flight request bookkeeping that ties an outgoing
//! [`Message::Request`] to its eventual [`Message::Response`] /
//! [`Message::ErrorResponse`]. Stdio plumbing — actually spawning
//! `codex app-server --listen stdio://` and shuttling bytes — lives in
//! Session 4's `spawn.rs` module. This file only sees lines.
//!
//! Lifecycle in the production code path:
//!   1. Construct a [`CodexClient`] with an outbound `mpsc::Sender<String>`,
//!      a notification handler, and a server-initiated-request handler.
//!   2. The spawn module spawns a stdout-reader task that calls
//!      [`CodexClient::handle_incoming_line`] on every newline-terminated
//!      line it reads.
//!   3. The command layer calls [`CodexClient::send_request`] to issue a
//!      JSON-RPC request and await its response.
//!   4. The server-request handler (see [`crate::agents::codex::approvals`]
//!      in S3) calls [`CodexClient::respond`] when the user has answered the
//!      modal.
//!
//! Spec: `_guidance/requirements/CodeMantis-Phase2-CodexAdapter-v1.0.md`
//! §2.4 (wire shape + backpressure) and §4.3 (lifecycle).

#![allow(dead_code)] // Phase 2 S2 lands the client; the spawn loop lands in S4.

use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use log::{debug, warn};
use serde_json::Value;
use tokio::sync::{mpsc, oneshot, Mutex};

use super::jsonrpc::{parse_line, retry_backoff_ms, Id, Message, ParseError, RpcError};

/// Errors surfaced by [`CodexClient::send_request`].
#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    /// The server replied with a JSON-RPC error (`{"error": {...}}`).
    #[error("rpc error {code}: {message}")]
    Rpc {
        code: i32,
        message: String,
        data: Option<Value>,
    },
    /// The outbound channel was closed before the line was written — usually
    /// because the child process exited.
    #[error("transport closed before send")]
    Closed,
    /// The waiting oneshot was dropped before a response arrived — usually
    /// because the client was shut down.
    #[error("request was cancelled")]
    Cancelled,
    /// The response correlator was poisoned. Should never happen in
    /// practice; surfaced so tests can assert on it.
    #[error("internal: pending-request map poisoned")]
    Poisoned,
}

impl ClientError {
    pub fn is_backpressure(&self) -> bool {
        matches!(self, ClientError::Rpc { code, .. } if *code == RpcError::SERVER_OVERLOADED)
    }
}

/// Callback invoked for every server-initiated request
/// (`item/.../requestApproval`, `mcpServer/elicitation/request`, …). The
/// callback owns responding via [`CodexClient::respond`] — the client itself
/// only routes.
///
/// `Arc<dyn …>` so the same client can be cloned (it is) and the handler
/// captured behind `Arc<CodexClient>`.
pub type ServerRequestHandler =
    Arc<dyn Fn(Id, String, Value) + Send + Sync + 'static>;

/// Callback invoked for every notification (`turn/started`, `item/started`,
/// `error`, etc.). The S3 translator wires this to the
/// `RawStreamEvent → NormalizedEvent` mapper.
pub type NotificationHandler =
    Arc<dyn Fn(String, Value) + Send + Sync + 'static>;

/// Transport-agnostic Codex JSON-RPC client. Cheap to clone — every clone
/// shares the same in-flight bookkeeping, outbound channel, and handlers.
#[derive(Clone)]
pub struct CodexClient {
    inner: Arc<ClientInner>,
}

struct ClientInner {
    outbound: mpsc::UnboundedSender<String>,
    next_id: AtomicI64,
    pending: Mutex<HashMap<Id, oneshot::Sender<Result<Value, RpcError>>>>,
    on_notification: NotificationHandler,
    on_server_request: ServerRequestHandler,
}

impl CodexClient {
    /// Construct a new client. The outbound channel feeds whatever stdin
    /// writer the spawn module sets up; the handlers cover the inbound
    /// non-response traffic. The `start_id` lets callers reserve low ids
    /// for the lifecycle handshake (`initialize` = 0, `model/list` = 1, …).
    pub fn new(
        outbound: mpsc::UnboundedSender<String>,
        start_id: i64,
        on_notification: NotificationHandler,
        on_server_request: ServerRequestHandler,
    ) -> Self {
        Self {
            inner: Arc::new(ClientInner {
                outbound,
                next_id: AtomicI64::new(start_id),
                pending: Mutex::new(HashMap::new()),
                on_notification,
                on_server_request,
            }),
        }
    }

    /// Allocate the next outgoing request id. Monotonically increasing;
    /// wraps back to 0 only after `i64::MAX` requests, which is never.
    pub fn next_id(&self) -> Id {
        let n = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        Id::Number(n)
    }

    /// Issue a JSON-RPC request and await its response. Returns the
    /// server's `result` value on success, or [`ClientError::Rpc`] on a
    /// server-reported error.
    ///
    /// **Does not retry on backpressure** — call
    /// [`CodexClient::send_request_with_retry`] if you want that. Surfacing
    /// `-32001` lets caller code decide (e.g. an interrupt has its own
    /// urgency policy).
    pub async fn send_request(
        &self,
        method: impl Into<String>,
        params: Value,
    ) -> Result<Value, ClientError> {
        let id = self.next_id();
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.inner.pending.lock().await;
            pending.insert(id.clone(), tx);
        }

        let msg = Message::Request {
            id: id.clone(),
            method: method.into(),
            params,
        };
        let line = msg
            .to_wire_line()
            .map_err(|e| ClientError::Rpc {
                code: -32603,
                message: format!("internal: {e}"),
                data: None,
            })?;

        if self.inner.outbound.send(line).is_err() {
            // Channel closed before we could write. Drop the pending slot.
            let mut pending = self.inner.pending.lock().await;
            pending.remove(&id);
            return Err(ClientError::Closed);
        }

        match rx.await {
            Ok(Ok(result)) => Ok(result),
            Ok(Err(err)) => Err(ClientError::Rpc {
                code: err.code,
                message: err.message,
                data: err.data,
            }),
            Err(_) => Err(ClientError::Cancelled),
        }
    }

    /// Like [`send_request`] but retries up to `max_attempts` times on a
    /// `-32001` ("Server overloaded") error with exponential-backoff jitter.
    /// Other RPC errors are not retried.
    ///
    /// The `sleep` callback is injected so tests can advance time without
    /// actually waiting; production callers pass `tokio::time::sleep`.
    pub async fn send_request_with_retry<S, Fut>(
        &self,
        method: impl Into<String> + Clone,
        params: Value,
        max_attempts: u32,
        jitter_seed: u64,
        sleep: S,
    ) -> Result<Value, ClientError>
    where
        S: Fn(std::time::Duration) -> Fut,
        Fut: std::future::Future<Output = ()>,
    {
        let mut last_err: Option<ClientError> = None;
        for attempt in 1..=max_attempts.max(1) {
            match self.send_request(method.clone(), params.clone()).await {
                Ok(v) => return Ok(v),
                Err(e) if e.is_backpressure() && attempt < max_attempts => {
                    let delay_ms = retry_backoff_ms(attempt, jitter_seed);
                    debug!(
                        "[codex-client] backpressure on attempt {}, retrying in {} ms",
                        attempt, delay_ms
                    );
                    sleep(std::time::Duration::from_millis(delay_ms)).await;
                    last_err = Some(e);
                }
                Err(e) => return Err(e),
            }
        }
        Err(last_err.unwrap_or(ClientError::Cancelled))
    }

    /// Send a fire-and-forget JSON-RPC notification (no id, no pending
    /// slot). Used during the handshake (`initialized`) and on
    /// disconnect-class flows. Notifications are write-only — there is no
    /// matching response by spec.
    pub fn send_notification(
        &self,
        method: impl Into<String>,
        params: Value,
    ) -> Result<(), ClientError> {
        let msg = Message::Notification {
            method: method.into(),
            params,
        };
        let line = msg.to_wire_line().map_err(|e| ClientError::Rpc {
            code: -32603,
            message: format!("internal: {e}"),
            data: None,
        })?;
        self.inner.outbound.send(line).map_err(|_| ClientError::Closed)
    }

    /// Respond to a server-initiated request. The server-request handler
    /// (see [`crate::agents::codex::approvals`] in S3) calls this once the
    /// user has answered the modal. `result` is the JSON-RPC `result` field
    /// per the corresponding `*/requestApproval` schema, e.g.
    /// `{"decision":"accept"}` for command-execution.
    pub fn respond(&self, id: Id, result: Value) -> Result<(), ClientError> {
        let msg = Message::Response { id, result };
        let line = msg.to_wire_line().map_err(|e| ClientError::Rpc {
            code: -32603,
            message: format!("internal: {e}"),
            data: None,
        })?;
        self.inner.outbound.send(line).map_err(|_| ClientError::Closed)
    }

    /// Respond to a server-initiated request with an error.
    pub fn respond_error(&self, id: Id, error: RpcError) -> Result<(), ClientError> {
        let msg = Message::ErrorResponse { id, error };
        let line = msg.to_wire_line().map_err(|e| ClientError::Rpc {
            code: -32603,
            message: format!("internal: {e}"),
            data: None,
        })?;
        self.inner.outbound.send(line).map_err(|_| ClientError::Closed)
    }

    /// Handle a single newline-terminated line read from the child's stdout.
    /// On a parse error we log and continue — the framer is forgiving so the
    /// session survives a malformed line (e.g. a stray log emission from a
    /// buggy mid-version Codex). Returns the parse outcome for tests.
    pub async fn handle_incoming_line(&self, line: &str) -> Result<(), ParseError> {
        let msg = parse_line(line)?;
        match msg {
            Message::Response { id, result } => self.complete_pending(id, Ok(result)).await,
            Message::ErrorResponse { id, error } => {
                self.complete_pending(id, Err(error)).await
            }
            Message::Notification { method, params } => {
                (self.inner.on_notification)(method, params);
            }
            Message::Request { id, method, params } => {
                (self.inner.on_server_request)(id, method, params);
            }
        }
        Ok(())
    }

    async fn complete_pending(
        &self,
        id: Id,
        outcome: Result<Value, RpcError>,
    ) {
        let waiter = {
            let mut pending = self.inner.pending.lock().await;
            pending.remove(&id)
        };
        match waiter {
            Some(tx) => {
                if tx.send(outcome).is_err() {
                    debug!(
                        "[codex-client] response for id {} arrived after caller cancelled",
                        id.as_log_str()
                    );
                }
            }
            None => {
                warn!(
                    "[codex-client] response for unknown id {} — dropping",
                    id.as_log_str()
                );
            }
        }
    }

    /// Number of in-flight requests (visible for tests + diagnostics).
    pub async fn pending_count(&self) -> usize {
        self.inner.pending.lock().await.len()
    }
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Mutex as StdMutex;

    fn no_op_notif() -> NotificationHandler {
        Arc::new(|_method, _params| {})
    }
    fn no_op_server_req() -> ServerRequestHandler {
        Arc::new(|_id, _method, _params| {})
    }

    /// Spin up a CodexClient backed by an in-memory outbound channel.
    fn make_client() -> (CodexClient, mpsc::UnboundedReceiver<String>) {
        let (tx, rx) = mpsc::unbounded_channel();
        let client = CodexClient::new(tx, 0, no_op_notif(), no_op_server_req());
        (client, rx)
    }

    #[tokio::test]
    async fn next_id_is_monotonic() {
        let (client, _rx) = make_client();
        assert_eq!(client.next_id(), Id::Number(0));
        assert_eq!(client.next_id(), Id::Number(1));
        assert_eq!(client.next_id(), Id::Number(2));
    }

    #[tokio::test]
    async fn send_request_writes_correct_line_and_blocks_for_response() {
        let (client, mut rx) = make_client();

        // Send the request from a spawned task so we can observe the line.
        let c2 = client.clone();
        let fut = tokio::spawn(async move {
            c2.send_request("thread/start", json!({"cwd": "/tmp"})).await
        });

        // Drain the outbound line.
        let line = rx.recv().await.unwrap();
        let parsed: Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(parsed["id"], 0);
        assert_eq!(parsed["method"], "thread/start");
        assert_eq!(parsed["params"]["cwd"], "/tmp");
        assert!(parsed.get("jsonrpc").is_none());

        // Synthesise the response.
        client
            .handle_incoming_line(r#"{"id":0,"result":{"threadId":"thr_1"}}"#)
            .await
            .unwrap();

        let result = fut.await.unwrap().unwrap();
        assert_eq!(result["threadId"], "thr_1");
        assert_eq!(client.pending_count().await, 0);
    }

    #[tokio::test]
    async fn error_response_propagates_rpc_error() {
        let (client, mut rx) = make_client();
        let c2 = client.clone();
        let fut = tokio::spawn(async move {
            c2.send_request("model/list", json!({})).await
        });
        let _ = rx.recv().await.unwrap();
        client
            .handle_incoming_line(
                r#"{"id":0,"error":{"code":-32600,"message":"invalid"}}"#,
            )
            .await
            .unwrap();
        let err = fut.await.unwrap().unwrap_err();
        match err {
            ClientError::Rpc { code, message, .. } => {
                assert_eq!(code, -32600);
                assert_eq!(message, "invalid");
            }
            other => panic!("expected Rpc, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn closed_outbound_returns_closed_error() {
        let (tx, rx) = mpsc::unbounded_channel::<String>();
        drop(rx); // close the outbound channel
        let client = CodexClient::new(tx, 0, no_op_notif(), no_op_server_req());
        let err = client
            .send_request("ping", json!({}))
            .await
            .unwrap_err();
        assert!(matches!(err, ClientError::Closed));
        // Pending slot was cleaned up.
        assert_eq!(client.pending_count().await, 0);
    }

    #[tokio::test]
    async fn unknown_response_id_is_dropped_quietly() {
        let (client, _rx) = make_client();
        // No pending request exists for id 99.
        client
            .handle_incoming_line(r#"{"id":99,"result":{}}"#)
            .await
            .unwrap();
        // Should not panic; state remains empty.
        assert_eq!(client.pending_count().await, 0);
    }

    #[tokio::test]
    async fn malformed_line_returns_parse_error_without_corrupting_state() {
        let (client, _rx) = make_client();
        let err = client.handle_incoming_line("{ not json").await.unwrap_err();
        assert!(matches!(err, ParseError::Json(_)));
        // Subsequent valid line still works.
        client
            .handle_incoming_line(r#"{"method":"turn/started","params":{}}"#)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn notification_routes_to_handler() {
        let received: Arc<StdMutex<Vec<(String, Value)>>> =
            Arc::new(StdMutex::new(Vec::new()));
        let captured = received.clone();
        let handler: NotificationHandler = Arc::new(move |method, params| {
            captured.lock().unwrap().push((method, params));
        });
        let (tx, _rx) = mpsc::unbounded_channel();
        let client = CodexClient::new(tx, 0, handler, no_op_server_req());

        client
            .handle_incoming_line(
                r#"{"method":"turn/completed","params":{"turn":{"id":"t_1"}}}"#,
            )
            .await
            .unwrap();

        let got = received.lock().unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].0, "turn/completed");
        assert_eq!(got[0].1["turn"]["id"], "t_1");
    }

    #[tokio::test]
    async fn server_initiated_request_routes_to_handler() {
        let received: Arc<StdMutex<Vec<(Id, String, Value)>>> =
            Arc::new(StdMutex::new(Vec::new()));
        let captured = received.clone();
        let handler: ServerRequestHandler = Arc::new(move |id, method, params| {
            captured.lock().unwrap().push((id, method, params));
        });
        let (tx, _rx) = mpsc::unbounded_channel();
        let client = CodexClient::new(tx, 0, no_op_notif(), handler);

        client
            .handle_incoming_line(
                r#"{"id":7,"method":"item/commandExecution/requestApproval","params":{"command":"ls"}}"#,
            )
            .await
            .unwrap();

        let got = received.lock().unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].0, Id::Number(7));
        assert_eq!(got[0].1, "item/commandExecution/requestApproval");
        assert_eq!(got[0].2["command"], "ls");
    }

    #[tokio::test]
    async fn send_notification_writes_no_id_line() {
        let (client, mut rx) = make_client();
        client
            .send_notification("initialized", json!({}))
            .unwrap();
        let line = rx.recv().await.unwrap();
        let parsed: Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(parsed["method"], "initialized");
        assert!(parsed.get("id").is_none(), "notification must have no id");
        assert!(parsed.get("jsonrpc").is_none());
    }

    #[tokio::test]
    async fn respond_writes_response_line() {
        let (client, mut rx) = make_client();
        client.respond(Id::Number(7), json!({"decision": "accept"})).unwrap();
        let line = rx.recv().await.unwrap();
        let parsed: Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(parsed["id"], 7);
        assert_eq!(parsed["result"]["decision"], "accept");
        assert!(parsed.get("error").is_none());
    }

    #[tokio::test]
    async fn respond_error_writes_error_response_line() {
        let (client, mut rx) = make_client();
        client
            .respond_error(
                Id::Number(7),
                RpcError {
                    code: -32603,
                    message: "internal".into(),
                    data: None,
                },
            )
            .unwrap();
        let line = rx.recv().await.unwrap();
        let parsed: Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(parsed["id"], 7);
        assert_eq!(parsed["error"]["code"], -32603);
    }

    #[tokio::test]
    async fn send_request_with_retry_retries_on_backpressure() {
        let (client, mut rx) = make_client();
        let attempts: Arc<StdMutex<u32>> = Arc::new(StdMutex::new(0));

        // Background task: pop each outgoing line, count it, reply with
        // backpressure twice, then succeed on the third.
        let c2 = client.clone();
        let counter = attempts.clone();
        let responder = tokio::spawn(async move {
            for _ in 0..3 {
                let line = rx.recv().await.unwrap();
                let parsed: Value = serde_json::from_str(line.trim()).unwrap();
                let id = parsed["id"].as_i64().unwrap();
                let n = {
                    let mut a = counter.lock().unwrap();
                    *a += 1;
                    *a
                };
                let reply = if n < 3 {
                    format!(
                        r#"{{"id":{id},"error":{{"code":-32001,"message":"Server overloaded; retry later."}}}}"#
                    )
                } else {
                    format!(r#"{{"id":{id},"result":{{"ok":true}}}}"#)
                };
                c2.handle_incoming_line(&reply).await.unwrap();
            }
        });

        // Zero-delay sleep so the test is fast.
        let zero_sleep = |_d: std::time::Duration| async {};
        let result = client
            .send_request_with_retry("ping", json!({}), 5, 1, zero_sleep)
            .await
            .unwrap();
        responder.await.unwrap();
        assert_eq!(result["ok"], true);
        assert_eq!(*attempts.lock().unwrap(), 3);
    }

    #[tokio::test]
    async fn send_request_with_retry_does_not_retry_other_errors() {
        let (client, mut rx) = make_client();
        let c2 = client.clone();
        let responder = tokio::spawn(async move {
            let line = rx.recv().await.unwrap();
            let parsed: Value = serde_json::from_str(line.trim()).unwrap();
            let id = parsed["id"].as_i64().unwrap();
            c2.handle_incoming_line(&format!(
                r#"{{"id":{id},"error":{{"code":-32600,"message":"invalid"}}}}"#
            ))
            .await
            .unwrap();
        });
        let zero_sleep = |_d: std::time::Duration| async {};
        let err = client
            .send_request_with_retry("ping", json!({}), 5, 0, zero_sleep)
            .await
            .unwrap_err();
        responder.await.unwrap();
        match err {
            ClientError::Rpc { code, .. } => assert_eq!(code, -32600),
            other => panic!("expected Rpc(-32600), got {:?}", other),
        }
    }

    #[tokio::test]
    async fn send_request_with_retry_gives_up_after_max_attempts() {
        let (client, mut rx) = make_client();
        let c2 = client.clone();
        let responder = tokio::spawn(async move {
            // Always reply with backpressure.
            while let Some(line) = rx.recv().await {
                let parsed: Value = serde_json::from_str(line.trim()).unwrap();
                let id = parsed["id"].as_i64().unwrap();
                c2.handle_incoming_line(&format!(
                    r#"{{"id":{id},"error":{{"code":-32001,"message":"overloaded"}}}}"#
                ))
                .await
                .unwrap();
            }
        });
        let zero_sleep = |_d: std::time::Duration| async {};
        let err = client
            .send_request_with_retry("ping", json!({}), 3, 0, zero_sleep)
            .await
            .unwrap_err();
        // The final attempt's error is surfaced.
        assert!(err.is_backpressure());
        // The responder holds a client clone (and therefore an outbound
        // sender) so the rx loop won't end on its own — terminate it.
        responder.abort();
    }
}
