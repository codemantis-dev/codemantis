//! Layer 2 of the Codex testing framework — credit-free smoke harness.
//!
//! Drives the real `codex app-server --listen stdio://` against scenarios
//! that exercise our request shapes WITHOUT triggering any model turn:
//!
//!   * S00_handshake               — initialize + initialized
//!   * S01_thread_start            — thread/start with our full payload
//!   * S02_thread_resume_roundtrip — start → close → resume same thread
//!   * S03_model_list              — model/list response shape
//!   * S04_bad_field_rejection     — old camelCase enum → expect -32600
//!   * S05_thread_close            — graceful shutdown via stdin EOF
//!
//! These run on every PR / CI build because they don't consume OpenAI
//! credits. The credit-burning, real-turn scenarios (C01–C12) live in
//! `codex_protocol_capture.rs` and stay `#[ignore]`-gated.
//!
//! Skip vs fail: like the schema-drift detector, these tests skip
//! cleanly if `codex` isn't on PATH. CI sets `CM_REQUIRE_CODEX=1` to
//! turn the skip into a hard failure on the release-gate runner.

use serde_json::{json, Value};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;
use tokio::time::timeout;

fn codex_available() -> bool {
    which::which("codex").is_ok()
}

fn require_codex_or_skip(scenario: &str) -> bool {
    if codex_available() {
        return true;
    }
    if std::env::var("CM_REQUIRE_CODEX").as_deref() == Ok("1") {
        panic!(
            "{scenario}: codex not on PATH but CM_REQUIRE_CODEX=1 — install \
             codex (`npm install -g @openai/codex`) on the release-gate runner."
        );
    }
    eprintln!(
        "[{scenario}] SKIPPING — `codex` binary not on PATH. Install with \
         `npm install -g @openai/codex` to enable. (CM_REQUIRE_CODEX=1 \
         turns this skip into a failure.)"
    );
    false
}

/// Lightweight session wrapper — copy of the harness primitives in
/// `codex_protocol_capture.rs` minus the capture-file plumbing.
struct Session {
    child: Child,
    stdin_tx: mpsc::UnboundedSender<String>,
    incoming: mpsc::UnboundedReceiver<Value>,
    next_id: i64,
}

impl Session {
    async fn spawn() -> Self {
        Self::spawn_inner(None).await
    }

    /// Spawn with `$CODEX_HOME` pointed at an isolated dir — used by the
    /// config-write scenario so it never mutates the developer's real
    /// `~/.codex/config.toml`.
    async fn spawn_with_codex_home(home: &std::path::Path) -> Self {
        Self::spawn_inner(Some(home)).await
    }

    async fn spawn_inner(codex_home: Option<&std::path::Path>) -> Self {
        let mut cmd = Command::new("codex");
        cmd.args(["app-server", "--listen", "stdio://"]);
        if let Some(home) = codex_home {
            cmd.env("CODEX_HOME", home);
        }
        let mut child = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn codex app-server");

        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();

        let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<String>();
        tokio::spawn(async move {
            let mut stdin = stdin;
            while let Some(line) = stdin_rx.recv().await {
                if stdin.write_all(line.as_bytes()).await.is_err() {
                    break;
                }
                if stdin.flush().await.is_err() {
                    break;
                }
            }
        });

        let (in_tx, in_rx) = mpsc::unbounded_channel::<Value>();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Ok(v) = serde_json::from_str::<Value>(&line) {
                    if in_tx.send(v).is_err() {
                        break;
                    }
                }
            }
        });

        Self {
            child,
            stdin_tx,
            incoming: in_rx,
            next_id: 0,
        }
    }

    fn alloc_id(&mut self) -> i64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    fn send_raw(&self, line: &str) {
        let mut s = line.to_string();
        if !s.ends_with('\n') {
            s.push('\n');
        }
        let _ = self.stdin_tx.send(s);
    }

    async fn request(&mut self, method: &str, params: Value) -> Value {
        let id = self.alloc_id();
        let msg = json!({"id": id, "method": method, "params": params});
        self.send_raw(&msg.to_string());
        timeout(Duration::from_secs(15), async {
            loop {
                let v = self
                    .incoming
                    .recv()
                    .await
                    .unwrap_or_else(|| panic!("codex stdout closed before {method} response"));
                if v.get("id").and_then(|x| x.as_i64()) == Some(id) {
                    return v;
                }
            }
        })
        .await
        .unwrap_or_else(|_| panic!("timed out waiting for {method} response"))
    }

    fn notify(&self, method: &str, params: Value) {
        self.send_raw(&json!({"method": method, "params": params}).to_string());
    }

    async fn shutdown(mut self) {
        drop(self.stdin_tx);
        let _ = timeout(Duration::from_secs(3), self.child.wait()).await;
        let _ = self.child.kill().await;
    }
}

async fn handshake(s: &mut Session) -> Value {
    let resp = s
        .request(
            "initialize",
            json!({
                "clientInfo": {
                    "name": "codemantis-smoke",
                    "version": env!("CARGO_PKG_VERSION"),
                },
                "capabilities": {"experimentalApi": false, "optOutNotificationMethods": []},
            }),
        )
        .await;
    s.notify("initialized", json!({}));
    resp
}

// =====================================================================
// S00 — handshake. Validates: initialize accepted, response shape has
// the documented keys, notifying `initialized` doesn't error.
// =====================================================================
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s00_handshake() {
    if !require_codex_or_skip("S00_handshake") {
        return;
    }
    let mut s = Session::spawn().await;
    let resp = handshake(&mut s).await;
    let result = resp
        .get("result")
        .expect("initialize must return a result");
    // Schema source-of-truth: v1/InitializeResponse.json
    for key in &["userAgent", "codexHome", "platformFamily", "platformOs"] {
        assert!(
            result.get(*key).is_some(),
            "initialize response missing `{key}` key — re-check schema bundle"
        );
    }
    s.shutdown().await;
}

// =====================================================================
// S01 — thread/start. Validates: our production payload (kebab-case
// enums + personality + serviceName) is accepted. This is the
// regression that hotfixes #5–#6 fixed. Failure = wire format drifted
// again.
// =====================================================================
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s01_thread_start() {
    if !require_codex_or_skip("S01_thread_start") {
        return;
    }
    let mut s = Session::spawn().await;
    let _ = handshake(&mut s).await;

    let resp = s
        .request(
            "thread/start",
            json!({
                "cwd": std::env::temp_dir().to_string_lossy(),
                "approvalPolicy": "on-request",
                "sandbox": "workspace-write",
                "personality": "pragmatic",
                "serviceName": "codemantis-smoke",
            }),
        )
        .await;
    assert!(
        resp.get("result").is_some(),
        "thread/start must succeed with our production payload; got: {resp}"
    );
    let tid = resp
        .pointer("/result/thread/id")
        .and_then(|v| v.as_str())
        .or_else(|| resp.pointer("/result/threadId").and_then(|v| v.as_str()));
    assert!(tid.is_some(), "thread/start result must carry an id: {resp}");
    s.shutdown().await;
}

// =====================================================================
// S02 — thread/resume wire-shape probe.
//
// EMPIRICAL FINDING (smoke harness, 2026-05-22): Codex only persists
// a thread's rollout file (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl)
// once the thread has had at least one *turn*. Resuming a fresh
// thread that was started + closed without a turn returns:
//   {"error":{"code":-32600,"message":"no rollout found for thread id <uuid>"}}
//
// This test validates the wire-shape of resume + the documented
// no-rollout error — useful for crash recovery code paths. A real
// "happy path" resume after a turn lives in
// `codex_protocol_capture.rs::C09_thread_resume` (credit-burning,
// `#[ignore]`-gated).
// =====================================================================
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s02_thread_resume_wire_shape() {
    if !require_codex_or_skip("S02_thread_resume_wire_shape") {
        return;
    }
    // Open A, start a thread, close. No turn → no rollout.
    let mut a = Session::spawn().await;
    let _ = handshake(&mut a).await;
    let start = a
        .request(
            "thread/start",
            json!({
                "cwd": std::env::temp_dir().to_string_lossy(),
                "approvalPolicy": "never",
                "sandbox": "read-only",
                "personality": "pragmatic",
                "serviceName": "codemantis-smoke",
            }),
        )
        .await;
    let tid = start
        .pointer("/result/thread/id")
        .and_then(|v| v.as_str())
        .or_else(|| start.pointer("/result/threadId").and_then(|v| v.as_str()))
        .map(str::to_string)
        .expect("thread id");
    a.shutdown().await;

    // Open B, try to resume. With no rollout, Codex returns -32600.
    // We assert the WIRE SHAPE of that error — message + code — so our
    // translator (`agents::codex::translation::map_error`) can rely on
    // it for the crash-recovery UI's "thread no longer on disk" toast.
    let mut b = Session::spawn().await;
    let _ = handshake(&mut b).await;
    let resume = b
        .request(
            "thread/resume",
            json!({
                "threadId": tid,
                "cwd": std::env::temp_dir().to_string_lossy(),
                "approvalPolicy": "never",
                "sandbox": "read-only",
                "personality": "pragmatic",
                "serviceName": "codemantis-smoke",
            }),
        )
        .await;
    let err = resume
        .get("error")
        .expect("resume of a turn-less thread must error (no rollout persisted)");
    let code = err.get("code").and_then(|v| v.as_i64()).unwrap_or(0);
    let msg = err.get("message").and_then(|v| v.as_str()).unwrap_or("");
    assert_eq!(code, -32600, "expected -32600 Invalid Request; got {code}");
    assert!(
        msg.contains("rollout") && msg.contains(&tid),
        "expected 'no rollout found for thread id <uuid>' message; got: {msg}"
    );
    b.shutdown().await;
}

// =====================================================================
// S03 — model/list. Validates: response shape has `data` array, each
// model has the keys ModelListResponse.json mandates. This is what
// the ModelSelector now reads after spawn (v1.3.1 hotfix #8).
// =====================================================================
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s03_model_list() {
    if !require_codex_or_skip("S03_model_list") {
        return;
    }
    let mut s = Session::spawn().await;
    let _ = handshake(&mut s).await;

    let resp = s.request("model/list", json!({})).await;
    let data = resp
        .pointer("/result/data")
        .and_then(|v| v.as_array())
        .cloned()
        .expect("model/list result must include a data array");
    assert!(!data.is_empty(), "Codex must report at least one model");
    // Per v2/ModelListResponse.json Model definition, every entry must
    // have these keys (matches what spawn.rs's transform reads).
    for m in &data {
        for k in &["id", "model", "displayName", "description", "isDefault", "hidden"] {
            assert!(
                m.get(*k).is_some(),
                "model entry missing `{k}` key — schema drift; entry: {m}"
            );
        }
        let efforts = m
            .get("supportedReasoningEfforts")
            .and_then(|v| v.as_array())
            .expect("supportedReasoningEfforts must be an array");
        assert!(
            !efforts.is_empty(),
            "every model must support at least one reasoning effort"
        );
    }
    s.shutdown().await;
}

// =====================================================================
// S04 — bad-field rejection. Send the OLD camelCase enum value and
// expect a -32600 Invalid Request. Locks the hotfix #6 finding: if
// Codex ever DID accept camelCase, this test would flag the spec
// could be relaxed (and we'd avoid converting unnecessarily). If
// Codex tightens further, this surfaces it explicitly.
// =====================================================================
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s04_bad_field_rejection() {
    if !require_codex_or_skip("S04_bad_field_rejection") {
        return;
    }
    let mut s = Session::spawn().await;
    let _ = handshake(&mut s).await;

    let resp = s
        .request(
            "thread/start",
            json!({
                "cwd": std::env::temp_dir().to_string_lossy(),
                // INTENTIONALLY WRONG (camelCase, used to be sent in v1.3.0):
                "approvalPolicy": "onRequest",
                "sandbox": "workspaceWrite",
            }),
        )
        .await;
    let err = resp
        .get("error")
        .expect("camelCase enum must be rejected; got success: see hotfix #6");
    let code = err.get("code").and_then(|v| v.as_i64()).unwrap_or(0);
    assert_eq!(
        code, -32600,
        "expected JSON-RPC Invalid Request (-32600) for camelCase enum; got code {code} ({err})"
    );
    s.shutdown().await;
}

// =====================================================================
// S06 — config/read. Validates the management panel's read path: the
// result carries a `config` object (additionalProperties — render
// generically) and `origins`. Credit-free.
// =====================================================================
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s06_config_read() {
    if !require_codex_or_skip("S06_config_read") {
        return;
    }
    let mut s = Session::spawn().await;
    let _ = handshake(&mut s).await;
    let resp = s.request("config/read", json!({ "includeLayers": false })).await;
    assert!(
        resp.pointer("/result/config").map(|c| c.is_object()).unwrap_or(false),
        "config/read result must carry a `config` object; got: {resp}"
    );
    s.shutdown().await;
}

// =====================================================================
// S07 — mcpServerStatus/list. Validates the MCP tab's read path: the
// result carries a `data` array (may be empty). Method name is
// `mcpServerStatus/list` (NOT `listMcpServerStatus`). Credit-free.
// =====================================================================
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s07_mcp_status_list() {
    if !require_codex_or_skip("S07_mcp_status_list") {
        return;
    }
    let mut s = Session::spawn().await;
    let _ = handshake(&mut s).await;
    let resp = s.request("mcpServerStatus/list", json!({ "detail": "full" })).await;
    assert!(
        resp.pointer("/result/data").map(|d| d.is_array()).unwrap_or(false),
        "mcpServerStatus/list result must carry a `data` array; got: {resp}"
    );
    s.shutdown().await;
}

// =====================================================================
// S08 — config/value/write round-trip, ISOLATED to a temp CODEX_HOME so
// it never touches the developer's real config. Writes a scalar, reads
// it back. Validates the write response shape (filePath + version) our
// panel relies on. Credit-free.
// =====================================================================
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s08_config_value_write_roundtrip() {
    if !require_codex_or_skip("S08_config_value_write_roundtrip") {
        return;
    }
    let tmp = tempfile::tempdir().expect("tempdir");
    let mut s = Session::spawn_with_codex_home(tmp.path()).await;
    let _ = handshake(&mut s).await;

    let write = s
        .request(
            "config/value/write",
            json!({ "keyPath": "model", "mergeStrategy": "replace", "value": "gpt-5.1-codex" }),
        )
        .await;
    // Tolerate older binaries lacking the method (skip the assert then).
    if let Some(err) = write.get("error") {
        let code = err.get("code").and_then(|v| v.as_i64()).unwrap_or(0);
        if code == -32601 {
            eprintln!("[S08] config/value/write not supported on this binary — skipping");
            s.shutdown().await;
            return;
        }
        panic!("config/value/write errored unexpectedly: {write}");
    }
    assert!(
        write.pointer("/result/filePath").is_some(),
        "config write result must carry filePath; got: {write}"
    );

    let read = s.request("config/read", json!({ "includeLayers": false })).await;
    assert_eq!(
        read.pointer("/result/config/model").and_then(|v| v.as_str()),
        Some("gpt-5.1-codex"),
        "written value must read back; got: {read}"
    );
    s.shutdown().await;
}

// =====================================================================
// S10 — account/read. Validates the Account tab's read path returns a
// well-formed response (result OR a structured error when not logged in).
// Isolated CODEX_HOME so it doesn't depend on the dev's login state.
// Credit-free.
//
// (S09 — the -32600 "no rollout found" resume error our resume-fallback
// depends on — is already pinned by S02 above.)
// =====================================================================
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s10_account_read() {
    if !require_codex_or_skip("S10_account_read") {
        return;
    }
    let tmp = tempfile::tempdir().expect("tempdir");
    let mut s = Session::spawn_with_codex_home(tmp.path()).await;
    let _ = handshake(&mut s).await;
    let resp = s.request("account/read", json!({})).await;
    assert!(
        resp.get("result").is_some() || resp.get("error").is_some(),
        "account/read must return a result or a structured error; got: {resp}"
    );
    s.shutdown().await;
}

// =====================================================================
// S05 — graceful shutdown. Stdin EOF must lead to the child exiting
// cleanly (Codex emits no error notification, just exits). Used to
// prove the spawn-loop's shutdown contract works for normal close.
// =====================================================================
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s05_thread_close() {
    if !require_codex_or_skip("S05_thread_close") {
        return;
    }
    let mut s = Session::spawn().await;
    let _ = handshake(&mut s).await;
    // Drop stdin → child sees EOF, should exit on its own within a
    // reasonable window. (Shutdown impl also kills as a safety net.)
    drop(s.stdin_tx);
    let exited = timeout(Duration::from_secs(5), s.child.wait())
        .await
        .ok()
        .and_then(|r| r.ok());
    assert!(
        exited.is_some(),
        "codex app-server must exit within 5s of stdin EOF (clean shutdown)"
    );
}
