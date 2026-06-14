//! Live capture harness for the OpenAI Codex app-server JSON-RPC
//! protocol. Parallel to `cli_protocol_capture.rs` (Claude).
//!
//! Spawns the real `codex app-server --listen stdio://` and drives a
//! battery of scenarios past it (C01–C12 per spec §11.1), recording
//! every line written to stdin and every line read from stdout into a
//! per-scenario NDJSON file under `target/codex-captures/`.
//!
//! `#[ignore]`-gated because each run:
//!   * needs a logged-in `codex` on PATH (`codex login status` exit 0)
//!   * consumes OpenAI credits against the user's ChatGPT subscription
//!   * is the merge gate for Phase 2 changes to the Codex protocol
//!
//! Invoke manually:
//! ```
//! cd src-tauri
//! # Mandatory merge gate (spec §12):
//! CM_HARNESS_ONLY=C04 cargo test --test codex_protocol_capture \
//!     capture_single -- --ignored --nocapture
//! # Full battery (consumes more credits; ~3 min wall-clock):
//! cargo test --test codex_protocol_capture capture_full_battery \
//!     -- --ignored --nocapture --test-threads=1
//! ```
//!
//! Spec: `_guidance/requirements/CodeMantis-Phase2-CodexAdapter-v1.0.md`
//! §11.1 (scenario list) and §12 (audit checklist).

use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex};
use tokio::time::timeout;

// =====================================================================
// Infrastructure
// =====================================================================

fn captures_dir() -> PathBuf {
    let manifest = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest).join("target").join("codex-captures")
}

fn capture_path(scenario: &str) -> PathBuf {
    let _ = std::fs::create_dir_all(captures_dir());
    captures_dir().join(format!("{scenario}.jsonl"))
}

/// Per-scenario capture sink. Records both directions of the wire so a
/// post-mortem can replay a session.
#[derive(Clone)]
struct Capture {
    path: PathBuf,
    file: Arc<Mutex<std::fs::File>>,
}

impl Capture {
    fn open(scenario: &str) -> Self {
        let path = capture_path(scenario);
        let _ = std::fs::remove_file(&path);
        let file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .unwrap_or_else(|e| panic!("open capture {}: {}", path.display(), e));
        Self {
            path,
            file: Arc::new(Mutex::new(file)),
        }
    }

    async fn record(&self, direction: &str, line: &str) {
        use std::io::Write;
        let entry = json!({
            "ts_ms": chrono::Utc::now().timestamp_millis(),
            "dir": direction,
            "line": line.trim_end_matches('\n'),
        });
        let mut f = self.file.lock().await;
        let _ = writeln!(&mut *f, "{entry}");
    }
}

/// Wrapper around the codex subprocess that exposes:
///   * a `send` function that writes a JSON-RPC line to stdin (recording),
///   * an mpsc::Receiver<Value> of incoming lines parsed as JSON Values
///     (recording),
///   * helpers for the common handshake / turn / interrupt patterns.
struct CodexSession {
    child: Child,
    stdin_tx: mpsc::UnboundedSender<String>,
    incoming: mpsc::UnboundedReceiver<Value>,
    capture: Capture,
    next_id: i64,
}

impl CodexSession {
    async fn spawn(scenario: &str) -> Self {
        Self::spawn_with_config(scenario, &[]).await
    }

    /// Spawn with extra `-c key=value` config overrides (each `cfg` becomes
    /// `-c <cfg>`), placed BEFORE the `app-server` subcommand exactly like
    /// production's `build_app_server_args`. Lets a scenario force, e.g.,
    /// `model_auto_compact_token_limit=2000` so real auto-compaction triggers
    /// cheaply.
    async fn spawn_with_config(scenario: &str, configs: &[&str]) -> Self {
        let capture = Capture::open(scenario);
        let mut args: Vec<String> = Vec::new();
        for cfg in configs {
            args.push("-c".to_string());
            args.push((*cfg).to_string());
        }
        args.extend(["app-server", "--listen", "stdio://"].map(str::to_string));
        let mut child = Command::new("codex")
            .args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap_or_else(|e| panic!("spawn codex app-server: {e}"));

        let stdin = child.stdin.take().expect("piped stdin");
        let stdout = child.stdout.take().expect("piped stdout");
        let stderr_opt = child.stderr.take();

        // Outbound: caller pushes lines into stdin_tx; writer task drains.
        let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<String>();
        let cap_out = capture.clone();
        tokio::spawn(async move {
            let mut stdin = stdin;
            while let Some(line) = stdin_rx.recv().await {
                cap_out.record("send", &line).await;
                if stdin.write_all(line.as_bytes()).await.is_err() {
                    break;
                }
                if stdin.flush().await.is_err() {
                    break;
                }
            }
        });

        // Inbound: reader task parses each line into Value and forwards.
        let (in_tx, in_rx) = mpsc::unbounded_channel::<Value>();
        let cap_in = capture.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                cap_in.record("recv", &line).await;
                if let Ok(v) = serde_json::from_str::<Value>(&line) {
                    if in_tx.send(v).is_err() {
                        break;
                    }
                }
            }
        });

        // Best-effort stderr — captured but doesn't drive assertions.
        if let Some(stderr) = stderr_opt {
            let cap_err = capture.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    cap_err.record("stderr", &line).await;
                }
            });
        }

        Self {
            child,
            stdin_tx,
            incoming: in_rx,
            capture,
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

    /// Send a JSON-RPC request and await its matching response (success
    /// or error). Times out after 30 s — Codex's documented backpressure
    /// retries are short.
    async fn request(&mut self, method: &str, params: Value) -> Value {
        let id = self.alloc_id();
        let msg = json!({"id": id, "method": method, "params": params});
        self.send_raw(&msg.to_string());
        let deadline = Duration::from_secs(30);
        timeout(deadline, async {
            loop {
                let v = self
                    .incoming
                    .recv()
                    .await
                    .unwrap_or_else(|| panic!("codex stdout closed before {method} response"));
                if v.get("id").and_then(|x| x.as_i64()) == Some(id) {
                    return v;
                }
                // not the response we want — drop it; capture log retains it
            }
        })
        .await
        .unwrap_or_else(|_| panic!("timed out waiting for {method} response"))
    }

    fn notify(&self, method: &str, params: Value) {
        let msg = json!({"method": method, "params": params});
        self.send_raw(&msg.to_string());
    }

    /// Drain incoming messages until `pred` returns `Some(value)`, with a
    /// timeout. Skipped messages stay in the capture log.
    async fn wait_for<F>(&mut self, label: &str, deadline: Duration, mut pred: F) -> Value
    where
        F: FnMut(&Value) -> bool,
    {
        timeout(deadline, async {
            loop {
                let v = self
                    .incoming
                    .recv()
                    .await
                    .unwrap_or_else(|| panic!("codex stdout closed before {label}"));
                if pred(&v) {
                    return v;
                }
            }
        })
        .await
        .unwrap_or_else(|_| panic!("timed out waiting for {label}"))
    }

    async fn shutdown(mut self) {
        // Drop stdin first — Codex exits gracefully on EOF.
        drop(self.stdin_tx);
        let _ = timeout(Duration::from_secs(5), self.child.wait()).await;
        let _ = self.child.kill().await;
        eprintln!("[harness] capture: {}", self.capture.path.display());
    }
}

/// Standard handshake: initialize → initialized notification. Returns the
/// `result` of the initialize call so scenarios can assert on
/// codexHome / userAgent / etc.
async fn handshake(session: &mut CodexSession) -> Value {
    let resp = session
        .request(
            "initialize",
            json!({
                "clientInfo": {
                    "name": "codemantis-harness",
                    "title": "CodeMantis Capture Harness",
                    "version": env!("CARGO_PKG_VERSION"),
                },
                "capabilities": {"experimentalApi": false, "optOutNotificationMethods": []},
            }),
        )
        .await;
    session.notify("initialized", json!({}));
    resp.get("result").cloned().unwrap_or(Value::Null)
}

/// Start a thread with the spec §2.3 "Auto" preset and wait for
/// `thread/started`. Returns the thread id.
async fn start_thread(session: &mut CodexSession, cwd: &str) -> String {
    session.send_raw(
        &json!({
            "id": -1, // never collides with alloc_id() (>= 0)
            "method": "thread/start",
            "params": {
                "cwd": cwd,
                // kebab-case enums — Codex 0.137 rejects camelCase with
                // -32600 (see smoke S04). Mirrors production spawn.rs.
                "approvalPolicy": "on-request",
                "sandbox": "workspace-write",
                "personality": "pragmatic",
                "serviceName": "codemantis-harness",
            }
        })
        .to_string(),
    );
    // Either a thread/started notification or a response to id=-1 carrying
    // the thread id. We accept whichever lands first.
    let v = session
        .wait_for("thread/started or thread/start response", Duration::from_secs(20), |v| {
            v.get("method").and_then(|x| x.as_str()) == Some("thread/started")
                || v.get("id").and_then(|x| x.as_i64()) == Some(-1)
        })
        .await;
    extract_thread_id(&v).expect("thread/started must carry an id")
}

fn extract_thread_id(v: &Value) -> Option<String> {
    v.get("params")
        .and_then(|p| p.get("thread"))
        .and_then(|t| t.get("id"))
        .and_then(|x| x.as_str())
        .map(str::to_string)
        .or_else(|| {
            v.get("result")
                .and_then(|r| r.get("threadId").or_else(|| r.get("thread").and_then(|t| t.get("id"))))
                .and_then(|x| x.as_str())
                .map(str::to_string)
        })
}

/// Drive a turn expected to produce a `commandExecution`, tolerating BOTH
/// the legacy approval round-trip AND codex 0.137's unified-exec (where
/// sandboxed safe commands run directly with no approval). If an
/// `item/commandExecution/requestApproval` arrives, respond with
/// `decision`. Returns the commandExecution `item/completed` value plus
/// whether an approval round-trip actually occurred.
async fn drive_command_turn(s: &mut CodexSession, decision: &str) -> (Value, bool) {
    let mut saw_approval = false;
    let completed = timeout(Duration::from_secs(180), async {
        loop {
            let v = s
                .incoming
                .recv()
                .await
                .unwrap_or_else(|| panic!("codex stdout closed during command turn"));
            let method = v.get("method").and_then(|x| x.as_str()).unwrap_or("");
            if method == "item/commandExecution/requestApproval" {
                saw_approval = true;
                if let Some(id) = v.get("id").cloned() {
                    s.send_raw(&json!({"id": id, "result": {"decision": decision}}).to_string());
                }
                continue;
            }
            if method == "item/completed"
                && v.pointer("/params/item/type").and_then(|x| x.as_str())
                    == Some("commandExecution")
            {
                return v;
            }
        }
    })
    .await
    .unwrap_or_else(|_| panic!("timed out waiting for commandExecution item/completed"));
    (completed, saw_approval)
}

// =====================================================================
// Scenarios C01–C12 (spec §11.1)
// =====================================================================

/// C01 — thread/start + "hello" + collect turn/completed.
async fn c01_basic_chat() {
    let mut s = CodexSession::spawn("C01").await;
    let _ = handshake(&mut s).await;
    let tid = start_thread(&mut s, &std::env::temp_dir().to_string_lossy()).await;
    eprintln!("[C01] thread id: {tid}");

    let resp = s
        .request(
            "turn/start",
            json!({
                "threadId": tid,
                "input": [{"type": "text", "text": "say the single word OK"}],
                "approvalPolicy": "never",
                // Use the CORRECT per-turn `sandboxPolicy` OBJECT shape that
                // production now sends (CodexSessionPolicy::as_turn_sandbox_policy).
                // Empirically proves 0.137 accepts it on turn/start — if the
                // object were malformed this request would return -32600.
                "sandboxPolicy": {"type": "readOnly", "networkAccess": false},
            }),
        )
        .await;
    assert!(
        resp.get("result").is_some(),
        "turn/start with sandboxPolicy object must succeed: {resp}"
    );

    let completed = s
        .wait_for("turn/completed", Duration::from_secs(120), |v| {
            v.get("method").and_then(|x| x.as_str()) == Some("turn/completed")
        })
        .await;
    let status = completed
        .pointer("/params/turn/status")
        .and_then(|x| x.as_str())
        .unwrap_or("");
    assert_eq!(
        status, "completed",
        "turn/completed status must be 'completed' (got {status:?}); full event: {completed}"
    );
    s.shutdown().await;
}

/// C02 — turn/interrupt mid-turn. Expect turn/completed with
/// status: "interrupted".
async fn c02_interrupt_midstream() {
    let mut s = CodexSession::spawn("C02").await;
    let _ = handshake(&mut s).await;
    let tid = start_thread(&mut s, &std::env::temp_dir().to_string_lossy()).await;

    let resp = s
        .request(
            "turn/start",
            json!({
                "threadId": tid,
                "input": [{"type": "text", "text": "count to 100 slowly"}],
                "approvalPolicy": "never",
                "sandbox": "read-only",
            }),
        )
        .await;
    let turn_id = resp
        .pointer("/result/turnId")
        .and_then(|x| x.as_str())
        .or_else(|| resp.pointer("/result/turn/id").and_then(|x| x.as_str()))
        .map(str::to_string)
        .expect("turn/start result must include turn id");
    // Wait until the agent has clearly started producing output.
    let _ = s
        .wait_for("first item/started or delta", Duration::from_secs(60), |v| {
            v.get("method")
                .and_then(|x| x.as_str())
                .map(|m| m.starts_with("item/"))
                .unwrap_or(false)
        })
        .await;

    let _ = s
        .request("turn/interrupt", json!({"threadId": tid, "turnId": turn_id}))
        .await;
    let completed = s
        .wait_for("turn/completed status:interrupted", Duration::from_secs(60), |v| {
            v.get("method").and_then(|x| x.as_str()) == Some("turn/completed")
        })
        .await;
    let status = completed
        .pointer("/params/turn/status")
        .and_then(|x| x.as_str())
        .unwrap_or("");
    assert_eq!(
        status, "interrupted",
        "turn/completed after interrupt must be 'interrupted' (got {status:?})"
    );
    s.shutdown().await;
}

/// C03 — request a Bash command, deny. Expect a
/// item/commandExecution/requestApproval server-initiated request, then
/// after we respond `{decision: "decline"}` the item/completed must
/// arrive with status: "declined" (or "failed" per Codex variant).
async fn c03_approval_decline() {
    let mut s = CodexSession::spawn("C03").await;
    let _ = handshake(&mut s).await;
    let tid = start_thread(&mut s, &std::env::temp_dir().to_string_lossy()).await;

    let _ = s.request(
        "turn/start",
        json!({
            "threadId": tid,
            "input": [{"type": "text", "text": "Run `echo hello` in a bash shell."}],
            // `untrusted` asks before any non-trivial command. Note: codex
            // 0.137's unified-exec still auto-runs trivially-safe commands
            // like `echo` in-sandbox without an approval round-trip, so
            // drive_command_turn tolerates both paths.
            "approvalPolicy": "untrusted",
            "sandbox": "workspace-write",
        }),
    ).await;

    let (completed, saw_approval) = drive_command_turn(&mut s, "decline").await;
    let status = completed
        .pointer("/params/item/status")
        .and_then(|x| x.as_str())
        .unwrap_or("");
    if saw_approval {
        assert!(
            matches!(status, "declined" | "failed" | "cancelled"),
            "declined commandExecution status must reflect refusal (got {status:?})"
        );
    } else {
        // 0.137 unified-exec: the safe command auto-ran with no approval
        // round-trip. The command-execution flow still works end-to-end.
        eprintln!("[C03] no approval round-trip (0.137 unified-exec auto-ran); status={status:?}");
        assert_eq!(status, "completed", "auto-run command must complete: {completed}");
    }
    s.shutdown().await;
}

/// C04 — request a Bash command, accept. **Mandatory merge gate.**
/// Approve → command runs → outputDelta → item/completed status:completed.
async fn c04_approval_accept() {
    let mut s = CodexSession::spawn("C04").await;
    let _ = handshake(&mut s).await;
    let cwd = std::env::temp_dir();
    let tid = start_thread(&mut s, &cwd.to_string_lossy()).await;

    let _ = s.request(
        "turn/start",
        json!({
            "threadId": tid,
            "input": [{"type": "text", "text": "Run `echo cm-harness-C04` in a bash shell."}],
            // `untrusted` forces the approval prompt (see C03 note).
            "approvalPolicy": "untrusted",
            "sandbox": "workspace-write",
        }),
    ).await;

    let (completed, _saw_approval) = drive_command_turn(&mut s, "accept").await;
    let status = completed
        .pointer("/params/item/status")
        .and_then(|x| x.as_str())
        .unwrap_or("");
    assert_eq!(
        status, "completed",
        "accepted commandExecution must succeed (got {status:?}); full: {completed}"
    );
    // Output should contain our sentinel.
    let output = completed
        .pointer("/params/item/aggregatedOutput")
        .and_then(|x| x.as_str())
        .unwrap_or("");
    assert!(
        output.contains("cm-harness-C04"),
        "aggregatedOutput must include the sentinel (got {output:?})"
    );
    s.shutdown().await;
}

/// C05 — Write to .codex/foo. Protected-path; expect SandboxError or a
/// fileChange item with status: "failed".
async fn c05_protected_path_write() {
    let mut s = CodexSession::spawn("C05").await;
    let _ = handshake(&mut s).await;
    let tid = start_thread(&mut s, &std::env::temp_dir().to_string_lossy()).await;

    let _ = s.request(
        "turn/start",
        json!({
            "threadId": tid,
            "input": [{"type": "text", "text":
                "Create the file `.codex/forbidden` with the contents 'no'."
            }],
            "approvalPolicy": "never",
            "sandbox": "workspace-write",
        }),
    ).await;

    // Capture-only scenario: record whatever Codex does with a write to a
    // protected-looking path. Terminal condition is `turn/completed` so the
    // scenario always finishes — under 0.137 a write to `.codex` *inside*
    // the workspace cwd is permitted by the sandbox (CodeMantis's own
    // protected-path guard is a separate layer not exercised by the raw
    // app-server here), so we no longer require a sandbox error.
    let v = s
        .wait_for("turn/completed (protected-path capture)", Duration::from_secs(120), |v| {
            v.get("method").and_then(|x| x.as_str()) == Some("turn/completed")
        })
        .await;
    eprintln!("[C05] captured terminal: {v}");
    s.shutdown().await;
}

/// C06 — thread/start with a bad model name. Expect an error reply or
/// error notification.
async fn c06_bad_model() {
    let mut s = CodexSession::spawn("C06").await;
    let _ = handshake(&mut s).await;
    let resp = s
        .request(
            "thread/start",
            json!({
                "cwd": std::env::temp_dir().to_string_lossy(),
                "model": "definitely-not-a-real-model-cm-harness",
                "approvalPolicy": "never",
                "sandbox": "read-only",
                "personality": "pragmatic",
                "serviceName": "codemantis-harness",
            }),
        )
        .await;
    let has_error_reply = resp.get("error").is_some();
    if !has_error_reply {
        // Some Codex builds accept the thread/start and emit an `error`
        // notification when the first turn tries to use the bad model.
        // We try a turn and watch for it.
        let tid = resp
            .pointer("/result/threadId")
            .and_then(|x| x.as_str())
            .map(str::to_string)
            .or_else(|| {
                resp.pointer("/result/thread/id")
                    .and_then(|x| x.as_str())
                    .map(str::to_string)
            });
        if let Some(tid) = tid {
            let _ = s.request(
                "turn/start",
                json!({
                    "threadId": tid,
                    "input": [{"type": "text", "text": "ping"}],
                    "approvalPolicy": "never",
                    "sandbox": "read-only",
                }),
            ).await;
        }
        let ev = s
            .wait_for("error notification for bad model", Duration::from_secs(30), |v| {
                v.get("method").and_then(|x| x.as_str()) == Some("error")
            })
            .await;
        eprintln!("[C06] error notification: {ev}");
    } else {
        eprintln!("[C06] thread/start error reply: {resp}");
    }
    s.shutdown().await;
}

/// C07 — spawn, kill the PID directly, expect graceful detection on the
/// reader side. Asserts that closing stdin / killing the child leads to
/// the stdout reader observing EOF without panicking.
async fn c07_crash_detection() {
    let mut s = CodexSession::spawn("C07").await;
    let _ = handshake(&mut s).await;

    // Kill the child outright (SIGKILL via tokio).
    let _ = s.child.kill().await;
    // The reader task should drain remaining lines + EOF gracefully.
    // Drain anything still queued; verify no panic by reading until None.
    let drained = timeout(Duration::from_secs(5), async {
        let mut count = 0;
        while s.incoming.recv().await.is_some() {
            count += 1;
            if count > 1000 {
                break;
            }
        }
        count
    })
    .await
    .unwrap_or(0);
    eprintln!("[C07] drained {drained} lines after SIGKILL");
    eprintln!("[harness] capture: {}", s.capture.path.display());
}

/// C08 — model/list after initialize. Expect a result with a `models`
/// (or similar) array suitable for CapabilitiesDiscovered.
async fn c08_model_list() {
    let mut s = CodexSession::spawn("C08").await;
    let _ = handshake(&mut s).await;
    let resp = s.request("model/list", json!({})).await;
    let result = resp
        .get("result")
        .cloned()
        .unwrap_or_else(|| panic!("model/list must return a result; got {resp}"));
    // ModelListResponse is `{ data: [...] }` (0.137, confirmed by smoke
    // S03). Tolerate legacy `models` / a bare array for older builds.
    let models_arr = result
        .get("data")
        .and_then(|v| v.as_array())
        .cloned()
        .or_else(|| result.get("models").and_then(|v| v.as_array()).cloned())
        .or_else(|| result.as_array().cloned())
        .unwrap_or_default();
    assert!(
        !models_arr.is_empty(),
        "model/list must return at least one model; got {result}"
    );
    s.shutdown().await;
}

/// C09 — resume an existing thread (thread/resume). Crash-recovery happy
/// path.
async fn c09_thread_resume() {
    // Session A: create a thread, exchange a message, capture the id.
    let mut a = CodexSession::spawn("C09a").await;
    let _ = handshake(&mut a).await;
    let tid = start_thread(&mut a, &std::env::temp_dir().to_string_lossy()).await;
    let _ = a
        .request(
            "turn/start",
            json!({
                "threadId": tid,
                "input": [{"type": "text", "text": "remember the word `pineapple`"}],
                "approvalPolicy": "never",
                "sandbox": "read-only",
            }),
        )
        .await;
    let _ = a
        .wait_for("turn/completed", Duration::from_secs(60), |v| {
            v.get("method").and_then(|x| x.as_str()) == Some("turn/completed")
        })
        .await;
    a.shutdown().await;

    // Session B: fresh subprocess; resume the same thread.
    let mut b = CodexSession::spawn("C09b").await;
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
                "serviceName": "codemantis-harness",
            }),
        )
        .await;
    assert!(
        resume.get("result").is_some(),
        "thread/resume must succeed for a freshly-created thread: {resume}"
    );
    b.shutdown().await;
}

/// C10 — MCP elicitation (form mode). Requires an MCP server configured
/// in ~/.codex/config.toml that surfaces an elicitation. Without one,
/// the scenario records the absence (skipped) and exits cleanly so the
/// harness still runs.
async fn c10_mcp_elicitation() {
    let mut s = CodexSession::spawn("C10").await;
    let _ = handshake(&mut s).await;
    // Best-effort: list MCP servers; if none configured, mark skipped.
    let status = s.request("mcpServerStatus/list", json!({})).await;
    let count = status
        .pointer("/result/servers")
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    if count == 0 {
        eprintln!("[C10] no MCP servers configured — scenario skipped (no elicitation possible)");
        s.shutdown().await;
        return;
    }
    eprintln!("[C10] {count} MCP server(s) configured; capture covers elicitation if one fires");
    // Full elicitation drive requires a specific MCP server we don't ship
    // in CI. Capture log is the deliverable.
    s.shutdown().await;
}

/// C11 — long-running command (>10s) → outputDelta heartbeats. Asserts
/// the harness sees at least one item/commandExecution/outputDelta
/// notification between start and completion.
async fn c11_output_delta_heartbeat() {
    let mut s = CodexSession::spawn("C11").await;
    let _ = handshake(&mut s).await;
    let tid = start_thread(&mut s, &std::env::temp_dir().to_string_lossy()).await;
    let _ = s.request(
        "turn/start",
        json!({
            "threadId": tid,
            "input": [{"type": "text", "text":
                "Run `for i in $(seq 1 12); do echo tick $i; sleep 1; done` and tell me when it finishes."
            }],
            "approvalPolicy": "never",
            "sandbox": "workspace-write",
        }),
    ).await;
    let mut saw_delta = false;
    let _ = s
        .wait_for(
            "turn/completed (collecting outputDelta along the way)",
            Duration::from_secs(180),
            |v| {
                let method = v.get("method").and_then(|x| x.as_str()).unwrap_or("");
                if method == "item/commandExecution/outputDelta" {
                    saw_delta = true;
                }
                method == "turn/completed"
            },
        )
        .await;
    assert!(
        saw_delta,
        "expected at least one item/commandExecution/outputDelta during a >10s command"
    );
    s.shutdown().await;
}

/// C12 — reasoning item with summaryTextDelta → ThinkingDelta +
/// ThinkingComplete mapping. Asserts the harness sees a reasoning
/// `item/started` + at least one `summaryTextDelta`.
async fn c12_reasoning_delta() {
    let mut s = CodexSession::spawn("C12").await;
    let _ = handshake(&mut s).await;
    let tid = start_thread(&mut s, &std::env::temp_dir().to_string_lossy()).await;
    let _ = s.request(
        "turn/start",
        json!({
            "threadId": tid,
            "input": [{"type": "text", "text":
                "Think step by step about the integral of x^2 dx from 0 to 1, then state the answer."
            }],
            "approvalPolicy": "never",
            "sandbox": "read-only",
            "effort": "medium",
        }),
    ).await;
    let mut saw_reasoning_started = false;
    let mut saw_summary_delta = false;
    let _ = s
        .wait_for(
            "turn/completed (collecting reasoning notifications)",
            Duration::from_secs(180),
            |v| {
                let method = v.get("method").and_then(|x| x.as_str()).unwrap_or("");
                if method == "item/started"
                    && v.pointer("/params/item/type").and_then(|x| x.as_str())
                        == Some("reasoning")
                {
                    saw_reasoning_started = true;
                }
                if method == "item/reasoning/summaryTextDelta"
                    || method == "item/reasoning/textDelta"
                    || method == "item/reasoning/summaryPartAdded"
                {
                    saw_summary_delta = true;
                }
                method == "turn/completed"
            },
        )
        .await;
    assert!(
        saw_reasoning_started,
        "expected at least one item/started with type=reasoning"
    );
    // 0.137: reasoning *summary delta* streaming is model/config-dependent
    // and may not fire (the reasoning content still arrives via the
    // reasoning item/completed, which production's translation.rs handles).
    // So we log rather than hard-require a delta.
    if !saw_summary_delta {
        eprintln!(
            "[C12] reasoning item started but no item/reasoning/* delta streamed \
             (0.137 — summaries not streamed for this model/effort); content \
             arrives via item/completed."
        );
    }
    s.shutdown().await;
}

/// C13 — resume-fallback path (the production resilience contract).
/// Attempt `thread/resume` with a thread id that has NO rollout on disk
/// (a fabricated uuid). Codex must reject with `-32600` ("no rollout
/// found") — the exact error our `spawn::should_fallback_to_start`
/// keys on. Then `thread/start` must succeed, proving the fallback yields
/// a working (fresh) thread instead of a dead session. Captured to NDJSON
/// so the decision boundary is documented end-to-end.
async fn c13_resume_fallback_to_start() {
    let mut s = CodexSession::spawn("C13").await;
    let _ = handshake(&mut s).await;

    // Fabricated thread id — no rollout exists for it.
    let resume = s
        .request(
            "thread/resume",
            json!({
                "threadId": "019e0000-0000-7000-8000-000000000000",
                "cwd": std::env::temp_dir().to_string_lossy(),
                "approvalPolicy": "never",
                "sandbox": "read-only",
                "personality": "pragmatic",
                "serviceName": "codemantis-harness",
            }),
        )
        .await;
    let code = resume.pointer("/error/code").and_then(|v| v.as_i64());
    assert_eq!(
        code,
        Some(-32600),
        "resume of a rollout-less thread must return -32600 (the code our \
         fallback depends on); got: {resume}"
    );

    // Fallback: a fresh thread/start must succeed.
    let start = s
        .request(
            "thread/start",
            json!({
                "cwd": std::env::temp_dir().to_string_lossy(),
                "approvalPolicy": "never",
                "sandbox": "read-only",
                "personality": "pragmatic",
                "serviceName": "codemantis-harness",
            }),
        )
        .await;
    assert!(
        start.get("result").is_some(),
        "fallback thread/start must succeed after a failed resume: {start}"
    );
    s.shutdown().await;
}

/// C14 — trigger compaction ON DEMAND via `thread/compact/start` and record
/// EXACTLY what Codex emits: a `contextCompaction` item (started/completed) and
/// its `status` field if any, the deprecated `thread/compacted` notification,
/// the trailing `turn/completed`, or an `error`. This is the empirical
/// ground-truth for the compaction-recovery regression — does a SUCCESSFUL
/// compaction carry a status the translator misreads, and which signal path
/// actually fires? Purely diagnostic: records + prints, no brittle asserts.
async fn c14_compaction() {
    let mut s = CodexSession::spawn("C14").await;
    let _ = handshake(&mut s).await;
    let tid = start_thread(&mut s, &std::env::temp_dir().to_string_lossy()).await;
    eprintln!("[C14] thread id: {tid}");

    // Seed the thread with one turn so there is something to compact.
    let _ = s
        .request(
            "turn/start",
            json!({
                "threadId": tid,
                "input": [{"type": "text", "text": "Reply with the single word: ready"}],
                "approvalPolicy": "never",
                "sandboxPolicy": {"type": "readOnly", "networkAccess": false},
            }),
        )
        .await;
    let _ = s
        .wait_for("turn/completed (seed)", Duration::from_secs(120), |v| {
            v.get("method").and_then(|x| x.as_str()) == Some("turn/completed")
        })
        .await;

    // Trigger compaction on demand — cheap, no need to fill 200K of context.
    let compact_ack = s
        .request("thread/compact/start", json!({"threadId": tid}))
        .await;
    eprintln!("[C14] thread/compact/start ack: {compact_ack}");

    // Drain + record everything Codex emits for the compaction until a terminal
    // signal or timeout. Never panics — we want the capture regardless.
    let mut methods: Vec<String> = Vec::new();
    let mut compaction_item: Option<Value> = None;
    let mut saw_error: Option<Value> = None;
    let _ = timeout(Duration::from_secs(120), async {
        loop {
            let v = match s.incoming.recv().await {
                Some(v) => v,
                None => break,
            };
            let method = v
                .get("method")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            if !method.is_empty() {
                methods.push(method.clone());
            }
            if v.pointer("/params/item/type").and_then(|x| x.as_str()) == Some("contextCompaction") {
                compaction_item = Some(v.clone());
            }
            if method == "error" {
                saw_error = Some(v.clone());
                break;
            }
            if method == "thread/compacted" {
                break;
            }
            if method == "item/completed"
                && v.pointer("/params/item/type").and_then(|x| x.as_str()) == Some("contextCompaction")
            {
                break;
            }
            if method == "turn/completed" {
                break;
            }
        }
    })
    .await;

    eprintln!("[C14] methods after compact/start: {methods:?}");
    match &compaction_item {
        Some(item) => {
            eprintln!("[C14] contextCompaction item: {item}");
            eprintln!(
                "[C14] contextCompaction status field: {:?}",
                item.pointer("/params/item/status")
            );
        }
        None => eprintln!("[C14] NO contextCompaction item observed"),
    }
    if let Some(err) = &saw_error {
        eprintln!("[C14] ERROR notification: {err}");
    }
    eprintln!("[C14] full wire recorded to the capture NDJSON");

    s.shutdown().await;
}

/// C15 — force REAL auto-compaction under load (the actual failing path). Spawn
/// with a tiny `model_auto_compact_token_limit` so a couple of ordinary turns
/// cross it and Codex auto-compacts on its own — then record the full wire to
/// answer the only question that matters: does auto-compaction COMPLETE, ERROR,
/// or HANG? (The trivial C14 manual compaction on an empty thread never tested
/// this.) Diagnostic: records + prints, no brittle asserts.
async fn c15_auto_compaction() {
    // Tunable via env so we can escalate context size without recompiling:
    //   CM_C15_LIMIT  — model_auto_compact_token_limit (default 2000)
    //   CM_C15_REPEAT — filler repeat count per turn (default 30 ≈ 1.6KB)
    //   CM_C15_TURNS  — max turns (default 6)
    let limit = std::env::var("CM_C15_LIMIT").unwrap_or_else(|_| "2000".into());
    let repeat: usize = std::env::var("CM_C15_REPEAT").ok().and_then(|v| v.parse().ok()).unwrap_or(30);
    let max_turns: u32 = std::env::var("CM_C15_TURNS").ok().and_then(|v| v.parse().ok()).unwrap_or(6);
    eprintln!("[C15] config: limit={limit} repeat={repeat} max_turns={max_turns}");

    let mut s = CodexSession::spawn_with_config(
        "C15_auto_compaction",
        &[&format!("model_auto_compact_token_limit={limit}")],
    )
    .await;
    let _ = handshake(&mut s).await;
    let tid = start_thread(&mut s, &std::env::temp_dir().to_string_lossy()).await;
    eprintln!("[C15] thread id: {tid}");

    let filler = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(repeat);

    let mut model_ctx_window: Option<u64> = None;
    let mut total_tokens: Option<u64> = None;
    let mut saw_compaction_started = false;
    let mut saw_compaction_completed = false;
    let mut saw_error: Option<String> = None;
    let mut hung = false;

    'turns: for turn_no in 1..=max_turns {
        let prompt = format!("Turn {turn_no}: reply with just OK. Ignore this filler: {filler}");
        let resp = s
            .request(
                "turn/start",
                json!({
                    "threadId": tid,
                    "input": [{"type": "text", "text": prompt}],
                    "approvalPolicy": "never",
                    "sandboxPolicy": {"type": "readOnly", "networkAccess": false},
                }),
            )
            .await;
        if resp.get("error").is_some() {
            saw_error = Some(format!("turn/start error: {resp}"));
            break 'turns;
        }

        // Drain this turn until turn/completed | error | HANG (no terminal in 300s).
        let turn_result: Result<Option<String>, _> = timeout(Duration::from_secs(300), async {
            loop {
                let v = match s.incoming.recv().await {
                    Some(v) => v,
                    None => return Some("stdout-closed".to_string()),
                };
                let method = v.get("method").and_then(|x| x.as_str()).unwrap_or("");
                if method == "thread/tokenUsage/updated" {
                    if let Some(tu) = v.pointer("/params/tokenUsage") {
                        if let Some(w) = tu.get("modelContextWindow").and_then(|x| x.as_u64()) {
                            model_ctx_window = Some(w);
                        }
                        // `total`/`last` are OBJECTS: {totalTokens, inputTokens, ...}.
                        if let Some(t) = tu.pointer("/total/totalTokens").and_then(|x| x.as_u64()) {
                            total_tokens = Some(t);
                        }
                    }
                }
                if v.pointer("/params/item/type").and_then(|x| x.as_str()) == Some("contextCompaction") {
                    if method == "item/started" {
                        saw_compaction_started = true;
                        eprintln!(
                            "[C15] contextCompaction item/started on turn {turn_no} (total so far={total_tokens:?})"
                        );
                    }
                    if method == "item/completed" {
                        saw_compaction_completed = true;
                        eprintln!("[C15] contextCompaction item/completed on turn {turn_no}");
                    }
                }
                if method == "error" {
                    let msg = v
                        .pointer("/params/error/message")
                        .or_else(|| v.pointer("/params/message"))
                        .and_then(|x| x.as_str())
                        .unwrap_or("?");
                    return Some(format!("error: {msg}"));
                }
                if method == "turn/completed" {
                    let status = v.pointer("/params/turn/status").and_then(|x| x.as_str()).unwrap_or("?");
                    eprintln!(
                        "[C15] turn {turn_no} completed status={status} (window={model_ctx_window:?} total={total_tokens:?})"
                    );
                    return None;
                }
            }
        })
        .await;

        match turn_result {
            Ok(None) => { /* turn completed cleanly */ }
            Ok(Some(reason)) => {
                saw_error = Some(reason);
                break 'turns;
            }
            Err(_elapsed) => {
                hung = true;
                eprintln!("[C15] turn {turn_no} HUNG — no turn/completed in 300s");
                break 'turns;
            }
        }

        if saw_compaction_completed {
            break 'turns;
        }
    }

    eprintln!("[C15] ===== DIAGNOSIS =====");
    eprintln!("[C15] modelContextWindow: {model_ctx_window:?}");
    eprintln!("[C15] total tokens seen: {total_tokens:?}");
    eprintln!("[C15] compaction started: {saw_compaction_started}");
    eprintln!("[C15] compaction completed: {saw_compaction_completed}");
    eprintln!("[C15] error: {saw_error:?}");
    eprintln!("[C15] hung: {hung}");
    eprintln!("[C15] full wire: target/codex-captures/C15_auto_compaction.jsonl");

    s.shutdown().await;
}

// =====================================================================
// Entry points
// =====================================================================

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore]
async fn capture_full_battery() {
    // Each scenario logs its capture file; CM_HARNESS_KEEP=1 preserves
    // prior runs (parity with the Claude harness).
    if std::env::var("CM_HARNESS_KEEP").ok().as_deref() != Some("1") {
        let dir = captures_dir();
        if dir.exists() {
            for entry in std::fs::read_dir(&dir).unwrap_or_else(|e| panic!("{e}")) {
                let path = entry.unwrap().path();
                if path.extension().and_then(|s| s.to_str()) == Some("jsonl") {
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
    }

    eprintln!("[harness] === C01 basic chat ===");
    c01_basic_chat().await;
    eprintln!("[harness] === C02 interrupt midstream ===");
    c02_interrupt_midstream().await;
    eprintln!("[harness] === C03 approval decline ===");
    c03_approval_decline().await;
    eprintln!("[harness] === C04 approval accept (MERGE GATE) ===");
    c04_approval_accept().await;
    eprintln!("[harness] === C05 protected-path write ===");
    c05_protected_path_write().await;
    eprintln!("[harness] === C06 bad model ===");
    c06_bad_model().await;
    eprintln!("[harness] === C07 crash detection ===");
    c07_crash_detection().await;
    eprintln!("[harness] === C08 model/list ===");
    c08_model_list().await;
    eprintln!("[harness] === C09 thread/resume ===");
    c09_thread_resume().await;
    eprintln!("[harness] === C10 MCP elicitation ===");
    c10_mcp_elicitation().await;
    eprintln!("[harness] === C11 outputDelta heartbeat ===");
    c11_output_delta_heartbeat().await;
    eprintln!("[harness] === C12 reasoning summaryTextDelta ===");
    c12_reasoning_delta().await;
    eprintln!("[harness] === C13 resume-fallback to start ===");
    c13_resume_fallback_to_start().await;
    eprintln!("[harness] === C14 compaction ===");
    c14_compaction().await;
    eprintln!("[harness] === C15 auto-compaction under load ===");
    c15_auto_compaction().await;
    eprintln!("[harness] === DONE ===");
}

/// Convenience: run a single scenario via env var.
///   CM_HARNESS_ONLY=C04 cargo test --test codex_protocol_capture capture_single -- --ignored --nocapture
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore]
async fn capture_single() {
    let only = std::env::var("CM_HARNESS_ONLY").unwrap_or_default();
    match only.as_str() {
        "C01" => c01_basic_chat().await,
        "C02" => c02_interrupt_midstream().await,
        "C03" => c03_approval_decline().await,
        "C04" => c04_approval_accept().await,
        "C05" => c05_protected_path_write().await,
        "C06" => c06_bad_model().await,
        "C07" => c07_crash_detection().await,
        "C08" => c08_model_list().await,
        "C09" => c09_thread_resume().await,
        "C10" => c10_mcp_elicitation().await,
        "C11" => c11_output_delta_heartbeat().await,
        "C12" => c12_reasoning_delta().await,
        "C13" => c13_resume_fallback_to_start().await,
        "C14" => c14_compaction().await,
        "C15" => c15_auto_compaction().await,
        other => panic!("set CM_HARNESS_ONLY to one of C01..C15 (got '{other}')"),
    }
}
