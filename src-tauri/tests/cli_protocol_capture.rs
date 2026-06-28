//! Live capture harness for the Claude Code CLI control protocol.
//!
//! Spawns the real `claude` binary with the same flags CodeMantis uses in
//! production and drives a fixed battery of scenarios past it, recording
//! every stdin / stdout / stderr line plus every PreToolUse hook
//! request/response observed by the embedded approval stub.
//!
//! Marked `#[ignore]` because each run consumes Anthropic credits and
//! depends on a logged-in `claude` binary on PATH. Invoke manually:
//!
//! ```
//! cd src-tauri
//! cargo test --test cli_protocol_capture -- --ignored --nocapture --test-threads=1
//! ```
//!
//! The plan that motivated this harness lives at
//! `~/.claude/plans/there-have-been-substantial-velvet-sky.md`. The
//! synthesised report lives at `docs/internal/cli-2.1.126-protocol-report.md`.

use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::timeout;

// =====================================================================
// CONSTANTS — keep aligned with src/claude/process.rs
// =====================================================================

/// Mirror of the production spawn flags from `process.rs:330-347`.
/// Single source of truth so harness and prod cannot drift on flags.
fn production_cli_args() -> Vec<&'static str> {
    vec![
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        "--verbose",
        "--dangerously-skip-permissions",
        "--thinking-display",
        "summarized",
    ]
}

/// Extra args layered on for the harness to surface hook lifecycle in the
/// stream and to capture CLI-internal hook decisions on stderr. Production
/// does not pass these — they exist only to widen the capture surface.
fn diagnostic_cli_args() -> Vec<&'static str> {
    vec![
        "--include-hook-events",
        "--debug",
        "api,hooks",
    ]
}

/// Where captures land. Wiped at the start of each run unless
/// `CM_HARNESS_KEEP=1`.
fn captures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("captures")
}

// =====================================================================
// HOOK ENVELOPE TYPES — re-derived from CLI behaviour, NOT imported from
// production code. If the test discovers a shape mismatch, that IS a
// finding worth surfacing.
// =====================================================================

#[derive(Debug, Clone, Deserialize, Serialize)]
struct HookInput {
    #[serde(default)]
    forge_session_id: Option<String>,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    tool_name: Option<String>,
    #[serde(default)]
    tool_input: Option<Value>,
    #[serde(flatten)]
    other: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HookResponse {
    hook_specific_output: HookSpecificOutput,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HookSpecificOutput {
    hook_event_name: String,
    permission_decision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    permission_decision_reason: Option<String>,
}

impl HookResponse {
    fn allow() -> Self {
        Self {
            hook_specific_output: HookSpecificOutput {
                hook_event_name: "PreToolUse".into(),
                permission_decision: "allow".into(),
                permission_decision_reason: None,
            },
        }
    }
    fn deny(reason: &str) -> Self {
        Self {
            hook_specific_output: HookSpecificOutput {
                hook_event_name: "PreToolUse".into(),
                permission_decision: "deny".into(),
                permission_decision_reason: Some(reason.into()),
            },
        }
    }
    fn ask(reason: &str) -> Self {
        Self {
            hook_specific_output: HookSpecificOutput {
                hook_event_name: "PreToolUse".into(),
                permission_decision: "ask".into(),
                permission_decision_reason: Some(reason.into()),
            },
        }
    }
}

// =====================================================================
// HOOK POLICY — a pluggable Fn the axum stub consults per request.
// =====================================================================

/// A hook policy decides what response to return for a given PreToolUse
/// payload, and how long to wait before responding.
type HookPolicy = Arc<dyn Fn(&HookInput) -> HookOutcome + Send + Sync>;

#[derive(Debug, Clone)]
enum HookOutcome {
    Respond(HookResponse),
    /// Sleep this long before responding allow — used to test slow hooks.
    SlowAllow(Duration),
    /// Return HTTP 500.
    HttpError,
}

fn allow_all() -> HookPolicy {
    Arc::new(|_| HookOutcome::Respond(HookResponse::allow()))
}

// =====================================================================
// CAPTURE WRITER — appends NDJSON entries to the per-scenario file.
// =====================================================================

#[derive(Clone)]
struct CaptureWriter {
    file: Arc<Mutex<tokio::fs::File>>,
}

impl CaptureWriter {
    async fn create(path: &Path) -> Self {
        let file = tokio::fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(path)
            .await
            .unwrap_or_else(|e| panic!("open capture {}: {e}", path.display()));
        Self {
            file: Arc::new(Mutex::new(file)),
        }
    }

    async fn write(&self, entry: Value) {
        let mut line = serde_json::to_string(&entry).unwrap();
        line.push('\n');
        let mut f = self.file.lock().await;
        let _ = f.write_all(line.as_bytes()).await;
        let _ = f.flush().await;
    }

    async fn log(&self, dir: &str, raw: &str) {
        self.write(json!({
            "ts": now_ts(),
            "dir": dir,
            "raw": raw,
        })).await;
    }

    async fn log_event(&self, what: &str, details: Value) {
        self.write(json!({
            "ts": now_ts(),
            "dir": "harness_event",
            "what": what,
            "details": details,
        })).await;
    }
}

fn now_ts() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}

// =====================================================================
// AXUM HOOK STUB — minimal /tool-approval server on a random local port.
// =====================================================================

#[derive(Clone)]
struct StubState {
    policy: HookPolicy,
    capture: CaptureWriter,
}

async fn handle_tool_approval(
    State(state): State<StubState>,
    body: String,
) -> impl IntoResponse {
    let started = Instant::now();
    state.capture.log("hook_in_raw", &body).await;

    let parsed: HookInput = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(e) => {
            state.capture.log_event(
                "hook_parse_error",
                json!({ "error": e.to_string() }),
            ).await;
            return (
                StatusCode::OK,
                Json(HookResponse::deny("malformed input"))
            ).into_response();
        }
    };

    let outcome = (state.policy)(&parsed);

    let resp = match outcome {
        HookOutcome::Respond(r) => r,
        HookOutcome::SlowAllow(d) => {
            tokio::time::sleep(d).await;
            HookResponse::allow()
        }
        HookOutcome::HttpError => {
            state.capture.log_event(
                "hook_returning_500",
                json!({ "tool": parsed.tool_name }),
            ).await;
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    let body_json = serde_json::to_value(&resp).unwrap_or(json!(null));
    state.capture.write(json!({
        "ts": now_ts(),
        "dir": "hook_out",
        "body": body_json,
        "latency_ms": started.elapsed().as_millis(),
        "tool_name": parsed.tool_name,
    })).await;

    (StatusCode::OK, Json(resp)).into_response()
}

async fn spawn_stub(policy: HookPolicy, capture: CaptureWriter) -> u16 {
    let app = Router::new()
        .route("/tool-approval", post(handle_tool_approval))
        .with_state(StubState { policy, capture });
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    port
}

// =====================================================================
// HOOK SCRIPT — generated into a tempdir; mirrors the production
// approval-hook.sh in process.rs:26-63 byte-for-byte.
// =====================================================================

fn write_hook_script(dir: &Path) -> PathBuf {
    let path = dir.join("approval-hook.sh");
    let script = r#"#!/bin/bash
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "$CODEMANTIS_SESSION_ID" ]; then
    if command -v jq >/dev/null 2>&1; then
        INPUT=$(echo "$INPUT" | jq -c --arg sid "$CODEMANTIS_SESSION_ID" '.forge_session_id = $sid')
    else
        INPUT=$(echo "$INPUT" | sed "s/^{/{\"forge_session_id\":\"${CODEMANTIS_SESSION_ID}\",/")
    fi
fi
case "$TOOL_NAME" in
  Read|Glob|Grep|ListDirectory|LS|TodoRead|Monitor)
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
    exit 0
    ;;
esac
RESPONSE=$(echo "$INPUT" | curl -s --max-time 300 -X POST \
  -H "Content-Type: application/json" \
  -d @- \
  "http://127.0.0.1:${CODEMANTIS_APPROVAL_PORT}/tool-approval" 2>/dev/null)
if [ $? -eq 0 ] && [ -n "$RESPONSE" ]; then
    echo "$RESPONSE"
else
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"CodeMantis approval server unavailable"}}'
fi
"#;
    std::fs::write(&path, script).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755));
    }
    path
}

fn settings_json(hook_path: &Path) -> String {
    settings_json_with_timeout(hook_path, 300)
}

/// Like `settings_json` but with a configurable PreToolUse hook `timeout`
/// (seconds). S16 uses a SHORT timeout to observe what the CLI injects when the
/// hook process exceeds its deadline — the production hook script's
/// `curl --max-time 300` and this `timeout` are both 300 today, a latent race.
fn settings_json_with_timeout(hook_path: &Path, hook_timeout_secs: u64) -> String {
    let cmd = format!("bash \"{}\"", hook_path.display());
    json!({
        "alwaysThinkingEnabled": true,
        "showThinkingSummaries": true,
        "hooks": {
            "PreToolUse": [{
                "matcher": ".*",
                "hooks": [{
                    "type": "command",
                    "command": cmd,
                    "timeout": hook_timeout_secs
                }]
            }]
        }
    }).to_string()
}

/// Like `settings_json_with_timeout` but adds a `permissions.allow` block — the
/// candidate Step-2 fix for the 2.1.195 MCP regression (the CLI ignores the
/// PreToolUse hook's `allow` for `mcp__*` tools, so a static permission grant is
/// needed). `allow_rules` are CLI permission rule strings, e.g. `"mcp__*"`,
/// `"mcp__teststub"` (whole server), or `"mcp__teststub__echo"` (exact tool).
fn settings_json_with_permissions(
    hook_path: &Path,
    hook_timeout_secs: u64,
    allow_rules: &[&str],
) -> String {
    let cmd = format!("bash \"{}\"", hook_path.display());
    json!({
        "alwaysThinkingEnabled": true,
        "showThinkingSummaries": true,
        "permissions": { "allow": allow_rules },
        "hooks": {
            "PreToolUse": [{
                "matcher": ".*",
                "hooks": [{
                    "type": "command",
                    "command": cmd,
                    "timeout": hook_timeout_secs
                }]
            }]
        }
    }).to_string()
}

/// Fully-flexible settings builder for the S20 production-discovery repro:
/// optional `permissions.allow` rules and the optional `enableAllProjectMcpServers`
/// trust flag (the candidate that governs auto-discovered project `.mcp.json`
/// servers — the production path that diverges from S14/S19's `--mcp-config`).
fn settings_json_custom(
    hook_path: &Path,
    hook_timeout_secs: u64,
    allow_rules: &[&str],
    enable_all_project_mcp: bool,
) -> String {
    let cmd = format!("bash \"{}\"", hook_path.display());
    let mut v = json!({
        "alwaysThinkingEnabled": true,
        "showThinkingSummaries": true,
        "hooks": {
            "PreToolUse": [{
                "matcher": ".*",
                "hooks": [{ "type": "command", "command": cmd, "timeout": hook_timeout_secs }]
            }]
        }
    });
    if !allow_rules.is_empty() {
        v["permissions"] = json!({ "allow": allow_rules });
    }
    if enable_all_project_mcp {
        v["enableAllProjectMcpServers"] = json!(true);
    }
    v.to_string()
}

// =====================================================================
// MCP STUB — a minimal stdio JSON-RPC MCP server (one `echo` tool) the
// CLI can load via --mcp-config. Lets S14 observe how MCP tools
// (`mcp__teststub__echo`) flow through the PreToolUse hook under the
// production --dangerously-skip-permissions config, deterministically and
// without depending on the user's real MCP stack.
// =====================================================================

fn write_mcp_stub(dir: &Path) -> PathBuf {
    let path = dir.join("mcp-stub.js");
    // Newline-delimited JSON-RPC 2.0 over stdio (MCP stdio transport).
    let script = r#"const rl = require('readline').createInterface({ input: process.stdin });
function send(msg){ process.stdout.write(JSON.stringify(msg) + "\n"); }
rl.on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch (e) { return; }
  if (m.method === 'initialize') {
    send({ jsonrpc:"2.0", id:m.id, result:{ protocolVersion:"2024-11-05",
      capabilities:{ tools:{} }, serverInfo:{ name:"teststub", version:"0.0.1" } } });
  } else if (m.method === 'tools/list') {
    send({ jsonrpc:"2.0", id:m.id, result:{ tools:[{ name:"echo",
      description:"Echo back the provided text.",
      inputSchema:{ type:"object", properties:{ text:{ type:"string" } }, required:["text"] } }] } });
  } else if (m.method === 'tools/call') {
    const text = (m.params && m.params.arguments && m.params.arguments.text) || "";
    send({ jsonrpc:"2.0", id:m.id, result:{ content:[{ type:"text", text:"echo: " + text }] } });
  } else if (m.id !== undefined && m.id !== null) {
    send({ jsonrpc:"2.0", id:m.id, result:{} });
  }
});
"#;
    std::fs::write(&path, script).unwrap();
    path
}

/// Write an `.mcp.json`-shaped config registering the stub under server
/// name `teststub` (so its tool surfaces as `mcp__teststub__echo`).
fn write_mcp_config(dir: &Path, stub_path: &Path) -> PathBuf {
    let path = dir.join("mcp-config.json");
    let cfg = json!({
        "mcpServers": {
            "teststub": {
                "command": "node",
                "args": [ stub_path.display().to_string() ]
            }
        }
    });
    std::fs::write(&path, cfg.to_string()).unwrap();
    path
}

/// Write a PROJECT-scoped `.mcp.json` into `dir` (the CLI auto-discovers this
/// from cwd — no `--mcp-config` flag). This is the production path: CodeMantis
/// does NOT pass `--mcp-config`/`--strict-mcp-config`, so the real
/// stable-browser-gateway is loaded via config discovery, which is approval/
/// trust-gated in a way `--mcp-config` servers are not. S20 probes whether THAT
/// gate is the field-incident trigger.
fn write_project_mcp_json(dir: &Path, stub_path: &Path) -> PathBuf {
    let path = dir.join(".mcp.json");
    let cfg = json!({
        "mcpServers": {
            "teststub": {
                "command": "node",
                "args": [ stub_path.display().to_string() ]
            }
        }
    });
    std::fs::write(&path, cfg.to_string()).unwrap();
    path
}

/// A minimal **Streamable HTTP** MCP server (one `echo` tool) — the transport
/// the real `shared-browser-mcp` uses (`http://127.0.0.1:8931/mcp`). S14 only
/// exercised stdio; S15 uses this to test whether HTTP-transport MCP tools are
/// permissioned differently (the leading un-reproduced hypothesis for the
/// field incident). Reads its port from `MCP_HTTP_PORT`. Responds to each
/// JSON-RPC POST with a single `application/json` body (the spec lets the
/// server choose JSON over an SSE stream), 202 for notifications, 405 for GET
/// (no server→client SSE — explicitly allowed).
fn write_http_mcp_stub(dir: &Path) -> PathBuf {
    let path = dir.join("mcp-http-stub.js");
    let script = r#"const http = require('http');
const PORT = parseInt(process.env.MCP_HTTP_PORT || '0', 10);
function rpc(id, result){ return JSON.stringify({ jsonrpc:"2.0", id, result }); }
const server = http.createServer((req, res) => {
  if (req.method === 'POST') {
    let body=''; req.on('data', c => body+=c);
    req.on('end', () => {
      let m; try { m = JSON.parse(body); } catch (e) { res.writeHead(400).end(); return; }
      if (m.id === undefined || m.id === null) { res.writeHead(202).end(); return; }
      if (m.method === 'initialize') {
        res.writeHead(200, { 'Content-Type':'application/json', 'Mcp-Session-Id':'stub-session-1' });
        res.end(rpc(m.id, { protocolVersion:"2024-11-05", capabilities:{ tools:{} },
          serverInfo:{ name:"httpstub", version:"0.0.1" } })); return;
      }
      let result = {};
      if (m.method === 'tools/list') {
        result = { tools:[{ name:"echo", description:"Echo back the provided text.",
          inputSchema:{ type:"object", properties:{ text:{ type:"string" } }, required:["text"] } }] };
      } else if (m.method === 'tools/call') {
        const text = (m.params && m.params.arguments && m.params.arguments.text) || "";
        result = { content:[{ type:"text", text:"echo: " + text }] };
      }
      res.writeHead(200, { 'Content-Type':'application/json' });
      res.end(rpc(m.id, result));
    });
  } else if (req.method === 'DELETE') {
    res.writeHead(200).end();
  } else {
    res.writeHead(405).end();
  }
});
server.listen(PORT, '127.0.0.1', () => { process.stdout.write('LISTENING\n'); });
"#;
    std::fs::write(&path, script).unwrap();
    path
}

/// Config registering the HTTP stub under server name `httpstub` (tool surfaces
/// as `mcp__httpstub__echo`). Uses `type: "http"` (Streamable HTTP) to match
/// the real shared-browser-mcp.
fn write_http_mcp_config(dir: &Path, port: u16) -> PathBuf {
    let path = dir.join("mcp-http-config.json");
    let cfg = json!({
        "mcpServers": {
            "httpstub": { "type": "http", "url": format!("http://127.0.0.1:{port}/mcp") }
        }
    });
    std::fs::write(&path, cfg.to_string()).unwrap();
    path
}

// =====================================================================
// SPAWN — launch claude with the production flag set + extras.
// =====================================================================

struct Spawned {
    child: Child,
    stdin: tokio::process::ChildStdin,
}

async fn spawn_cli(
    capture: &CaptureWriter,
    hook_port: u16,
    hook_path: &Path,
    permission_mode: Option<&str>,
    cwd: &Path,
    initial_prompt: Option<&str>,
) -> Spawned {
    spawn_cli_with_extra(
        capture, hook_port, hook_path, permission_mode, cwd, initial_prompt, &[], 300,
    )
    .await
}

/// Like `spawn_cli` but layers `extra_args` after the `--settings` block and
/// takes a configurable PreToolUse hook `timeout` (seconds). Used by S14/S15
/// to add `--mcp-config` / `--allowedTools` and by S16 to set a short hook
/// timeout — without churning every other scenario's call site.
#[allow(clippy::too_many_arguments)]
async fn spawn_cli_with_extra(
    capture: &CaptureWriter,
    hook_port: u16,
    hook_path: &Path,
    permission_mode: Option<&str>,
    cwd: &Path,
    initial_prompt: Option<&str>,
    extra_args: &[String],
    hook_timeout_secs: u64,
) -> Spawned {
    let settings = settings_json_with_timeout(hook_path, hook_timeout_secs);
    spawn_cli_with_settings(
        capture, hook_port, permission_mode, cwd, initial_prompt, extra_args, &settings,
    )
    .await
}

/// Lowest-level spawn: takes the fully-built `--settings` JSON string so a
/// scenario can inject a `permissions` block (S19) without churning every other
/// call site. The PreToolUse hook command is already embedded in
/// `settings_override`.
#[allow(clippy::too_many_arguments)]
async fn spawn_cli_with_settings(
    capture: &CaptureWriter,
    hook_port: u16,
    permission_mode: Option<&str>,
    cwd: &Path,
    initial_prompt: Option<&str>,
    extra_args: &[String],
    settings_override: &str,
) -> Spawned {
    let mut cmd = Command::new("claude");

    for a in production_cli_args() {
        cmd.arg(a);
    }
    for a in diagnostic_cli_args() {
        cmd.arg(a);
    }
    cmd.args(["--settings", settings_override]);

    for a in extra_args {
        cmd.arg(a);
    }

    if let Some(mode) = permission_mode {
        cmd.args(["--permission-mode", mode]);
    }
    if let Some(p) = initial_prompt {
        cmd.arg(p);
    }

    cmd.env("CODEMANTIS_APPROVAL_PORT", hook_port.to_string());
    cmd.env(
        "CODEMANTIS_SESSION_ID",
        format!("harness-{}", uuid::Uuid::new_v4()),
    );
    cmd.current_dir(cwd);
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let arg_view: Vec<String> =
        cmd.as_std().get_args().map(|s| s.to_string_lossy().into_owned()).collect();
    capture.log_event(
        "spawn",
        json!({
            "binary": "claude",
            "args": arg_view,
            "cwd": cwd.display().to_string(),
            "permission_mode": permission_mode,
            "hook_port": hook_port,
        }),
    ).await;

    let mut child = cmd.spawn().expect("spawn claude");
    let stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    let stderr = child.stderr.take().expect("stderr");

    // Forward stdout
    let cap_out = capture.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            cap_out.log("stdout", &line).await;
        }
    });

    // Forward stderr
    let cap_err = capture.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            cap_err.log("stderr", &line).await;
        }
    });

    Spawned { child, stdin }
}

async fn send_line(spawned: &mut Spawned, capture: &CaptureWriter, line: &str) {
    capture.log("stdin", line).await;
    let _ = spawned.stdin.write_all(line.as_bytes()).await;
    let _ = spawned.stdin.write_all(b"\n").await;
    let _ = spawned.stdin.flush().await;
}

async fn send_user(spawned: &mut Spawned, capture: &CaptureWriter, prompt: &str) {
    let msg = json!({
        "type": "user",
        "message": { "role": "user", "content": prompt }
    });
    send_line(spawned, capture, &msg.to_string()).await;
}

async fn send_control(
    spawned: &mut Spawned,
    capture: &CaptureWriter,
    request_id: &str,
    request: Value,
) {
    let msg = json!({
        "type": "control_request",
        "request_id": request_id,
        "request": request,
    });
    send_line(spawned, capture, &msg.to_string()).await;
}

/// Read the capture file looking for ≥1 line where `dir == "stdout"` and
/// the parsed JSON satisfies `pred`. Returns Some(parsed) on first match.
async fn poll_for(
    capture_path: &Path,
    pred: impl Fn(&Value) -> bool + Send + 'static + Copy,
    deadline: Duration,
) -> Option<Value> {
    let started = Instant::now();
    while started.elapsed() < deadline {
        if let Ok(contents) = tokio::fs::read_to_string(capture_path).await {
            for line in contents.lines() {
                let entry: Value = match serde_json::from_str(line) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                if entry.get("dir").and_then(Value::as_str) != Some("stdout") {
                    continue;
                }
                let raw = match entry.get("raw").and_then(Value::as_str) {
                    Some(s) => s,
                    None => continue,
                };
                let parsed: Value = match serde_json::from_str(raw) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                if pred(&parsed) {
                    return Some(parsed);
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
    None
}

async fn wait_for_result(capture_path: &Path, deadline: Duration) -> Option<Value> {
    poll_for(
        capture_path,
        |v| v.get("type").and_then(Value::as_str) == Some("result"),
        deadline,
    ).await
}

/// Multi-turn helper: `poll_for`/`wait_for_result` rescan the whole capture
/// file from the top, so a second `wait_for_result` returns the *first*
/// turn's result immediately. This waits until at least `n` total `result`
/// events have been written, which is what a multi-turn scenario (S17) needs
/// to sequence one turn after another. Returns the count actually seen.
async fn wait_for_nth_result(capture_path: &Path, n: usize, deadline: Duration) -> usize {
    let started = Instant::now();
    let mut last = 0usize;
    while started.elapsed() < deadline {
        if let Ok(contents) = tokio::fs::read_to_string(capture_path).await {
            let mut count = 0usize;
            for line in contents.lines() {
                let entry: Value = match serde_json::from_str(line) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                if entry.get("dir").and_then(Value::as_str) != Some("stdout") {
                    continue;
                }
                let raw = match entry.get("raw").and_then(Value::as_str) {
                    Some(s) => s,
                    None => continue,
                };
                if let Ok(parsed) = serde_json::from_str::<Value>(raw) {
                    if parsed.get("type").and_then(Value::as_str) == Some("result") {
                        count += 1;
                    }
                }
            }
            last = count;
            if count >= n {
                return count;
            }
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
    last
}

async fn wait_for_control_response(
    capture_path: &Path,
    request_id: String,
    deadline: Duration,
) -> Option<Value> {
    let id = request_id.clone();
    let started = Instant::now();
    while started.elapsed() < deadline {
        if let Ok(contents) = tokio::fs::read_to_string(capture_path).await {
            for line in contents.lines() {
                let entry: Value = match serde_json::from_str(line) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                if entry.get("dir").and_then(Value::as_str) != Some("stdout") {
                    continue;
                }
                let raw = match entry.get("raw").and_then(Value::as_str) {
                    Some(s) => s,
                    None => continue,
                };
                let parsed: Value = match serde_json::from_str(raw) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                // Direct shape
                let resp = parsed
                    .get("response")
                    .and_then(|r| r.get("request_id"))
                    .and_then(Value::as_str);
                if resp == Some(&id)
                    && parsed.get("type").and_then(Value::as_str) == Some("control_response")
                {
                    return Some(parsed);
                }
                // stream_event-wrapped shape
                if parsed.get("type").and_then(Value::as_str) == Some("stream_event") {
                    if let Some(inner) = parsed.get("event") {
                        let resp = inner
                            .get("response")
                            .and_then(|r| r.get("request_id"))
                            .and_then(Value::as_str);
                        if resp == Some(&id) {
                            return Some(inner.clone());
                        }
                    }
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(120)).await;
    }
    None
}

// =====================================================================
// SCENARIO RUNNER — sets up axum + tempdir + capture file, returns the
// path so each scenario fn can wait/poll on it.
// =====================================================================

struct Ctx {
    capture_path: PathBuf,
    capture: CaptureWriter,
    hook_port: u16,
    hook_path: PathBuf,
    cwd: PathBuf,
    _tempdir: tempfile::TempDir,
}

async fn setup(scenario: &str, policy: HookPolicy) -> Ctx {
    let dir = captures_dir();
    std::fs::create_dir_all(&dir).unwrap();
    let capture_path = dir.join(format!("{scenario}.jsonl"));
    let capture = CaptureWriter::create(&capture_path).await;
    let hook_port = spawn_stub(policy, capture.clone()).await;

    let tempdir = tempfile::tempdir().expect("tempdir");
    let hook_path = write_hook_script(tempdir.path());

    capture.log_event(
        "scenario_start",
        json!({
            "scenario": scenario,
            "cli_version_hint": std::env::var("CLAUDE_VERSION").ok(),
            "ts": now_ts(),
        }),
    ).await;

    Ctx {
        capture_path,
        capture,
        hook_port,
        hook_path,
        cwd: tempdir.path().to_path_buf(),
        _tempdir: tempdir,
    }
}

async fn cleanup(spawned: &mut Spawned, ctx: &Ctx) {
    // Close stdin by dropping it first (ChildStdin is tied to mut ref so
    // we must let the spawn struct go out of scope or take it).
    let _ = spawned.stdin.shutdown().await;
    let _ = timeout(Duration::from_secs(3), spawned.child.wait()).await;
    let _ = spawned.child.start_kill();
    let _ = spawned.child.wait().await;
    ctx.capture.log_event("scenario_end", json!({ "ts": now_ts() })).await;
}

// =====================================================================
// SCENARIOS
// =====================================================================

async fn s01_initialize() {
    let ctx = setup("S01-initialize", allow_all()).await;
    let mut spawned = spawn_cli(
        &ctx.capture, ctx.hook_port, &ctx.hook_path,
        None, &ctx.cwd, None,
    ).await;

    let req_id = "req_init".to_string();
    send_control(&mut spawned, &ctx.capture, &req_id, json!({"subtype": "initialize"})).await;
    let resp = wait_for_control_response(&ctx.capture_path, req_id, Duration::from_secs(15)).await;
    ctx.capture.log_event(
        "initialize_observed",
        json!({ "got_response": resp.is_some() }),
    ).await;
    cleanup(&mut spawned, &ctx).await;
}

async fn s02_subtype_sweep() {
    let ctx = setup("S02-subtype-sweep", allow_all()).await;
    let mut spawned = spawn_cli(
        &ctx.capture, ctx.hook_port, &ctx.hook_path,
        None, &ctx.cwd, None,
    ).await;

    // Every subtype name we can think of, including SDK-only ones.
    let subtypes_simple = [
        "initialize", "interrupt",
        "compact", "get_context", "getContext",
        "set_effort", "setEffort",
        "set_output_style", "setOutputStyle",
        "get_account_info", "get_session_id", "get_server_info",
        "get_usage", "get_cost",
        "get_mcp_status", "reconnect_mcp_server",
        "toggle_mcp_server", "add_mcp_server",
        "remove_mcp_server", "set_mcp_servers",
        "can_use_tool", "tool_permission_request",
        "request_permission", "ask_user_question",
    ];

    let mut idx = 0u32;
    for s in subtypes_simple {
        idx += 1;
        let req_id = format!("req_sweep_{idx}");
        send_control(&mut spawned, &ctx.capture, &req_id, json!({"subtype": s})).await;
        let _ = wait_for_control_response(
            &ctx.capture_path, req_id, Duration::from_secs(4),
        ).await;
    }

    // Subtypes that need extra fields:
    idx += 1;
    let id = format!("req_sweep_{idx}");
    send_control(&mut spawned, &ctx.capture, &id,
        json!({"subtype": "set_model", "model": "haiku"})).await;
    let _ = wait_for_control_response(&ctx.capture_path, id, Duration::from_secs(4)).await;

    idx += 1;
    let id = format!("req_sweep_{idx}");
    send_control(&mut spawned, &ctx.capture, &id,
        json!({"subtype": "set_permission_mode", "mode": "default"})).await;
    let _ = wait_for_control_response(&ctx.capture_path, id, Duration::from_secs(4)).await;

    idx += 1;
    let id = format!("req_sweep_{idx}");
    send_control(&mut spawned, &ctx.capture, &id,
        json!({"subtype": "set_max_thinking_tokens", "max_thinking_tokens": 5000})).await;
    let _ = wait_for_control_response(&ctx.capture_path, id, Duration::from_secs(4)).await;

    idx += 1;
    let id = format!("req_sweep_{idx}");
    send_control(&mut spawned, &ctx.capture, &id,
        json!({"subtype": "stop_task", "task_id": "task_nonexistent_xyz"})).await;
    let _ = wait_for_control_response(&ctx.capture_path, id, Duration::from_secs(4)).await;

    cleanup(&mut spawned, &ctx).await;
}

async fn s03_interrupt_midstream() {
    let ctx = setup("S03-interrupt-midstream", allow_all()).await;
    let mut spawned = spawn_cli(
        &ctx.capture, ctx.hook_port, &ctx.hook_path,
        None, &ctx.cwd, None,
    ).await;

    send_user(&mut spawned, &ctx.capture,
        "Please write a 1500-word essay about the history of programming languages, with detailed paragraphs.").await;

    // Wait for first content_block_delta or partial assistant chunk.
    let _ = poll_for(&ctx.capture_path, |v| {
        let t = v.get("type").and_then(Value::as_str);
        matches!(t, Some("content_block_delta") | Some("stream_event"))
    }, Duration::from_secs(20)).await;

    // Fire interrupt.
    let req_id = "req_interrupt".to_string();
    send_control(&mut spawned, &ctx.capture, &req_id, json!({"subtype": "interrupt"})).await;

    // Wait for the result event that should arrive after interrupt.
    let _ = wait_for_result(&ctx.capture_path, Duration::from_secs(15)).await;

    cleanup(&mut spawned, &ctx).await;
}

async fn s04_set_model() {
    let ctx = setup("S04-set-model", allow_all()).await;
    let mut spawned = spawn_cli(
        &ctx.capture, ctx.hook_port, &ctx.hook_path,
        None, &ctx.cwd, None,
    ).await;
    for (i, m) in ["haiku", "sonnet", "default"].iter().enumerate() {
        let id = format!("req_model_{i}");
        send_control(&mut spawned, &ctx.capture, &id,
            json!({"subtype": "set_model", "model": m})).await;
        let _ = wait_for_control_response(&ctx.capture_path, id, Duration::from_secs(4)).await;
    }
    cleanup(&mut spawned, &ctx).await;
}

async fn s05_set_permission_mode() {
    let ctx = setup("S05-set-permission-mode", allow_all()).await;
    let mut spawned = spawn_cli(
        &ctx.capture, ctx.hook_port, &ctx.hook_path,
        None, &ctx.cwd, None,
    ).await;
    for (i, m) in [
        "acceptEdits", "auto", "bypassPermissions",
        "default", "dontAsk", "plan", "invalidModeXYZ",
    ].iter().enumerate() {
        let id = format!("req_pm_{i}");
        send_control(&mut spawned, &ctx.capture, &id,
            json!({"subtype": "set_permission_mode", "mode": m})).await;
        let _ = wait_for_control_response(&ctx.capture_path, id, Duration::from_secs(4)).await;
    }
    cleanup(&mut spawned, &ctx).await;
}

/// Hook that mimics the production approval_server.rs allow logic for the
/// mode-control + read-only set, plus the tools the agent typically wants
/// to use to look up control-tool signatures (ToolSearch). Denies
/// everything else so denial behaviour is observable on uninvited tools.
fn cm_like_policy() -> HookPolicy {
    Arc::new(|input| {
        let tool = input.tool_name.as_deref().unwrap_or("");
        match tool {
            "ExitPlanMode" | "EnterPlanMode" | "AskUserQuestion"
            | "Read" | "Glob" | "Grep" | "ListDirectory" | "LS"
            | "TodoRead" | "Monitor" | "ToolSearch"
            | "Write" | "Edit" | "Agent"
            => HookOutcome::Respond(HookResponse::allow()),
            _ => HookOutcome::Respond(HookResponse::deny("denied by harness policy")),
        }
    })
}

/// Switch the running CLI into plan mode via the control_request channel.
/// `--permission-mode plan` at spawn is silently overridden by
/// `--dangerously-skip-permissions` (confirmed in S06/S07 system/init —
/// `permissionMode: "bypassPermissions"`). The runtime control_request is
/// the only way to actually enter plan mode in this configuration.
async fn switch_to_plan_mode(spawned: &mut Spawned, capture: &CaptureWriter) {
    let id = format!("req_plan_{}", uuid::Uuid::new_v4().simple());
    send_control(spawned, capture, &id,
        json!({"subtype": "set_permission_mode", "mode": "plan"})).await;
    // We don't have the capture path here; just give the CLI a moment.
    tokio::time::sleep(Duration::from_millis(400)).await;
}

async fn s06_exit_plan_mode_allow() {
    let ctx = setup("S06-ExitPlanMode-allow", cm_like_policy()).await;
    let mut spawned = spawn_cli(
        &ctx.capture, ctx.hook_port, &ctx.hook_path,
        None, &ctx.cwd, None,
    ).await;
    switch_to_plan_mode(&mut spawned, &ctx.capture).await;
    send_user(&mut spawned, &ctx.capture,
        "You are in plan mode. Output the plan as a single ExitPlanMode tool call with `plan` set to a 3-step markdown plan for adding a hello-world React component. Do not call ToolSearch — ExitPlanMode is in your tool set, just call it.").await;
    let _ = wait_for_result(&ctx.capture_path, Duration::from_secs(120)).await;
    cleanup(&mut spawned, &ctx).await;
}

async fn s07_exit_plan_mode_deny() {
    let policy: HookPolicy = Arc::new(|input| {
        let tool = input.tool_name.as_deref().unwrap_or("");
        match tool {
            "ExitPlanMode" => HookOutcome::Respond(HookResponse::deny("denied for harness S07")),
            _ => HookOutcome::Respond(HookResponse::allow()),
        }
    });
    let ctx = setup("S07-ExitPlanMode-deny", policy).await;
    let mut spawned = spawn_cli(
        &ctx.capture, ctx.hook_port, &ctx.hook_path,
        None, &ctx.cwd, None,
    ).await;
    switch_to_plan_mode(&mut spawned, &ctx.capture).await;
    send_user(&mut spawned, &ctx.capture,
        "You are in plan mode. Output the plan as a single ExitPlanMode tool call with `plan` set to a 2-step markdown plan for renaming a variable. Do not call ToolSearch.").await;
    let _ = wait_for_result(&ctx.capture_path, Duration::from_secs(120)).await;
    cleanup(&mut spawned, &ctx).await;
}

async fn s08_exit_plan_mode_ask() {
    let policy: HookPolicy = Arc::new(|input| {
        let tool = input.tool_name.as_deref().unwrap_or("");
        match tool {
            "ExitPlanMode" => HookOutcome::Respond(HookResponse::ask("escalating to user")),
            _ => HookOutcome::Respond(HookResponse::allow()),
        }
    });
    let ctx = setup("S08-ExitPlanMode-ask", policy).await;
    let mut spawned = spawn_cli(
        &ctx.capture, ctx.hook_port, &ctx.hook_path,
        None, &ctx.cwd, None,
    ).await;
    switch_to_plan_mode(&mut spawned, &ctx.capture).await;
    send_user(&mut spawned, &ctx.capture,
        "You are in plan mode. Output the plan as a single ExitPlanMode tool call with `plan` set to a 2-step markdown plan for adding a function. Do not call ToolSearch.").await;
    let _ = wait_for_result(&ctx.capture_path, Duration::from_secs(90)).await;
    cleanup(&mut spawned, &ctx).await;
}

async fn s09_ask_user_question() {
    let ctx = setup("S09-AskUserQuestion", cm_like_policy()).await;
    let mut spawned = spawn_cli(
        &ctx.capture, ctx.hook_port, &ctx.hook_path,
        None, &ctx.cwd, None,
    ).await;
    send_user(&mut spawned, &ctx.capture,
        "Use the AskUserQuestion tool to ask me what color I prefer between red, green, and blue. Wait for my answer; do not just guess.").await;
    let _ = wait_for_result(&ctx.capture_path, Duration::from_secs(45)).await;
    cleanup(&mut spawned, &ctx).await;
}

async fn s10_protected_path_baseline() {
    let ctx = setup("S10-protected-path", allow_all()).await;
    // cwd MUST contain a .claude/ subdir to make the relative target real
    std::fs::create_dir_all(ctx.cwd.join(".claude/skills/harness-test")).unwrap();
    let mut spawned = spawn_cli(
        &ctx.capture, ctx.hook_port, &ctx.hook_path,
        None, &ctx.cwd, None,
    ).await;
    send_user(&mut spawned, &ctx.capture,
        "Use the Write tool to create a file at .claude/skills/harness-test/SKILL.md with the literal contents 'test'. Do this in one Write call.").await;
    let _ = wait_for_result(&ctx.capture_path, Duration::from_secs(60)).await;
    cleanup(&mut spawned, &ctx).await;
}

async fn s11_mixed_denials() {
    let target_b = "/tmp/cm-harness-S11-b.md".to_string();
    let target_b_arc = target_b.clone();
    let policy: HookPolicy = Arc::new(move |input| {
        let tool = input.tool_name.as_deref().unwrap_or("");
        let path = input.tool_input.as_ref()
            .and_then(|v| v.get("file_path"))
            .and_then(Value::as_str)
            .unwrap_or("");
        if tool == "Write" && path == target_b_arc {
            HookOutcome::Respond(HookResponse::deny("denied by harness S11 (target b)"))
        } else {
            HookOutcome::Respond(HookResponse::allow())
        }
    });
    let ctx = setup("S11-mixed-denials", policy).await;
    std::fs::create_dir_all(ctx.cwd.join(".claude")).unwrap();
    let _ = std::fs::remove_file(&target_b);
    let mut spawned = spawn_cli(
        &ctx.capture, ctx.hook_port, &ctx.hook_path,
        None, &ctx.cwd, None,
    ).await;
    send_user(&mut spawned, &ctx.capture, &format!(
        "Make exactly two Write tool calls in sequence: first write 'a' to .claude/x.md, then write 'b' to {}. After both writes, summarize what happened in plain text.", target_b
    )).await;
    let _ = wait_for_result(&ctx.capture_path, Duration::from_secs(90)).await;
    cleanup(&mut spawned, &ctx).await;
}

async fn s12a_hook_slow() {
    let policy: HookPolicy = Arc::new(|input| {
        let tool = input.tool_name.as_deref().unwrap_or("");
        if tool == "Write" {
            // 8s — well past the user-visible "is it stuck?" threshold but
            // short enough not to actually time out the curl in the script
            // (which has --max-time 300).
            HookOutcome::SlowAllow(Duration::from_secs(8))
        } else {
            HookOutcome::Respond(HookResponse::allow())
        }
    });
    let ctx = setup("S12a-hook-slow", policy).await;
    let mut spawned = spawn_cli(
        &ctx.capture, ctx.hook_port, &ctx.hook_path,
        None, &ctx.cwd, None,
    ).await;
    send_user(&mut spawned, &ctx.capture,
        "Use Write to create /tmp/cm-harness-S12a.txt with contents 'slow-test'. Just one Write call.").await;
    let _ = wait_for_result(&ctx.capture_path, Duration::from_secs(60)).await;
    cleanup(&mut spawned, &ctx).await;
}

async fn s12b_hook_500() {
    let policy: HookPolicy = Arc::new(|input| {
        let tool = input.tool_name.as_deref().unwrap_or("");
        if tool == "Write" {
            HookOutcome::HttpError
        } else {
            HookOutcome::Respond(HookResponse::allow())
        }
    });
    let ctx = setup("S12b-hook-500", policy).await;
    let mut spawned = spawn_cli(
        &ctx.capture, ctx.hook_port, &ctx.hook_path,
        None, &ctx.cwd, None,
    ).await;
    send_user(&mut spawned, &ctx.capture,
        "Use Write to create /tmp/cm-harness-S12b.txt with contents 'error-test'. Just one Write call.").await;
    let _ = wait_for_result(&ctx.capture_path, Duration::from_secs(60)).await;
    cleanup(&mut spawned, &ctx).await;
}

/// S14 — MCP tool under the production hook + `--dangerously-skip-permissions`.
///
/// The motivating incident: `mcp__shared-browser-mcp__browser_navigate` was
/// denied with the CLI's *generic, no-reason* default ("The user doesn't want
/// to proceed…") and the user never saw a CodeMantis approval prompt. No
/// CodeMantis hook path emits a reasonless deny, and captures S07/S11/S12b
/// prove the CLI relays hook reasons verbatim — so the deny did NOT come from
/// CodeMantis's approval pipeline. This scenario pins WHERE it comes from.
///
/// Runs two sub-captures, both with a hook policy that ALLOWS the MCP tool:
///   * `S14a-mcp-no-allowlist` — production flags only. If the CLI denies the
///     MCP tool despite the hook returning allow, MCP gating is *separate*
///     from the PreToolUse hook (the root cause).
///   * `S14b-mcp-allowlist` — adds `--allowedTools mcp__teststub__echo`. If the
///     tool now runs (hook consulted, real tool_result), allow-listing is the
///     fix for Phase 4.
///
/// Inspect each capture for: a `hook_in_raw`/`hook_out` pair for the MCP tool
/// (did the hook fire?), any `permission_denials` entry in the `result` event,
/// and the synthetic `tool_result.content` (empty CLI default vs a reason).
/// `allow_list`: the value to pass to `--allowedTools`, or None to omit it.
/// Used to compare no-allowlist vs the exact-tool form vs the whole-server form
/// (the form CodeMantis production uses — see `mcp_allowed_tools_arg`).
async fn run_mcp_scenario(scenario: &str, allow_list: Option<&str>) {
    let ctx = setup(scenario, allow_all()).await;

    let stub = write_mcp_stub(&ctx.cwd);
    let mcp_config = write_mcp_config(&ctx.cwd, &stub);

    let mut extra: Vec<String> = vec![
        "--mcp-config".into(),
        mcp_config.display().to_string(),
        // Ignore the user's real MCP servers so the capture is hermetic.
        "--strict-mcp-config".into(),
    ];
    if let Some(allowed) = allow_list {
        extra.push("--allowedTools".into());
        extra.push(allowed.into());
    }

    let mut spawned = spawn_cli_with_extra(
        &ctx.capture, ctx.hook_port, &ctx.hook_path,
        None, &ctx.cwd, None, &extra, 300,
    ).await;

    send_user(&mut spawned, &ctx.capture,
        "Call the echo tool (its name is mcp__teststub__echo) with text \"hello from S14\". \
         It is in your tool set — call it directly, do not call ToolSearch. After it returns, \
         tell me in plain text exactly what it returned.").await;

    let _ = wait_for_result(&ctx.capture_path, Duration::from_secs(90)).await;
    cleanup(&mut spawned, &ctx).await;
}

async fn s14_mcp_tool() {
    eprintln!("[harness] S14a — MCP tool, no allowlist");
    run_mcp_scenario("S14a-mcp-no-allowlist", None).await;
    eprintln!("[harness] S14b — MCP tool, exact-tool allowlist");
    run_mcp_scenario("S14b-mcp-allowlist", Some("mcp__teststub__echo")).await;
    // S14c uses the WHOLE-SERVER form `mcp__<server>` — the form CodeMantis
    // production emits (mcp_allowed_tools_arg in process.rs), since tool names
    // aren't known at spawn. Confirms it also routes the tool through the hook.
    eprintln!("[harness] S14c — MCP tool, whole-server allowlist");
    run_mcp_scenario("S14c-mcp-server-allowlist", Some("mcp__teststub")).await;
}

/// S15 — MCP tool over **HTTP (Streamable HTTP)** transport, no allow-list,
/// production flags. The field incident server (`shared-browser-mcp`) is HTTP;
/// S14 only tested stdio and showed MCP tools route through the hook fine, so
/// HTTP transport is the leading un-reproduced hypothesis for the silent deny.
///
/// Inspect the capture for: `mcp_servers` status in `system/init` (did the CLI
/// connect to the HTTP server?), a `hook_in_raw`/`hook_out` pair for
/// `mcp__httpstub__echo` (did the hook fire — i.e. route through CodeMantis?),
/// the synthetic `tool_result` (real echo vs CLI's reasonless deny), and any
/// `permission_denials` entry. ALSO check for `rate_limit_event` / `api_retry`
/// before concluding — a throttled run proves nothing (the S14a lesson).
async fn s15_http_mcp_tool() {
    let ctx = setup("S15-mcp-http", allow_all()).await;

    // Pick a free port, then start the Node HTTP MCP stub on it.
    let port = {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let p = l.local_addr().unwrap().port();
        drop(l);
        p
    };
    let stub_js = write_http_mcp_stub(&ctx.cwd);
    let mut stub = Command::new("node")
        .arg(&stub_js)
        .env("MCP_HTTP_PORT", port.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn node http mcp stub");

    // Wait until the stub accepts TCP connections (server is up).
    let mut reachable = false;
    for _ in 0..50 {
        if tokio::net::TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
            reachable = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    ctx.capture
        .log_event("http_mcp_stub", json!({ "port": port, "reachable": reachable }))
        .await;

    let mcp_config = write_http_mcp_config(&ctx.cwd, port);
    // NO --allowedTools — match production exactly.
    let extra = vec![
        "--mcp-config".to_string(),
        mcp_config.display().to_string(),
        "--strict-mcp-config".to_string(),
    ];

    let mut spawned = spawn_cli_with_extra(
        &ctx.capture, ctx.hook_port, &ctx.hook_path, None, &ctx.cwd, None, &extra, 300,
    )
    .await;

    send_user(&mut spawned, &ctx.capture,
        "Call the echo tool (its name is mcp__httpstub__echo) with text \"hello from S15\". \
         It is in your tool set — call it directly, do not call ToolSearch. After it returns, \
         tell me in plain text exactly what it returned.").await;

    let _ = wait_for_result(&ctx.capture_path, Duration::from_secs(90)).await;
    cleanup(&mut spawned, &ctx).await;

    // Reap the Node stub so it doesn't outlive the scenario.
    let _ = stub.start_kill();
    let _ = stub.wait().await;
}

/// S16 — hook response time EXCEEDS the CLI PreToolUse `timeout`. The hook
/// stub takes 5s; the CLI hook `timeout` is set to 2s. Observe what the CLI
/// injects when it gives up on the hook: does it produce its OWN generic
/// reasonless deny ("The user doesn't want to proceed…" — the field-incident
/// symptom) and a `permission_denials` entry, or does it fail open?
///
/// Why it matters: in production the hook script's `curl --max-time 300`, the
/// approval server's internal oneshot timeout (300s), and the CLI hook
/// `timeout` (300s) are ALL 300s — a latent race. A never-acted-on modal can
/// trip the CLI timeout FIRST, so the model sees the CLI's reasonless default
/// instead of CodeMantis's reasoned "Approval timed out". This scenario tells
/// us whether de-racing those timers (curl < CLI-timeout, both > server-timeout)
/// is the right resilience fix. (Check for `rate_limit_event`/`api_retry`
/// before concluding — a throttled run proves nothing.)
async fn s16_hook_exceeds_cli_timeout() {
    let policy: HookPolicy = Arc::new(|input| {
        let tool = input.tool_name.as_deref().unwrap_or("");
        if tool == "Write" {
            HookOutcome::SlowAllow(Duration::from_secs(5))
        } else {
            HookOutcome::Respond(HookResponse::allow())
        }
    });
    let ctx = setup("S16-hook-exceeds-cli-timeout", policy).await;
    // hook_timeout_secs = 2 → the CLI kills the (5s) hook at 2s.
    let mut spawned = spawn_cli_with_extra(
        &ctx.capture, ctx.hook_port, &ctx.hook_path, None, &ctx.cwd, None, &[], 2,
    )
    .await;
    send_user(&mut spawned, &ctx.capture,
        "Use the Write tool to create /tmp/cm-harness-S16.txt with contents 'timeout-test'. \
         Just one Write call.").await;
    let _ = wait_for_result(&ctx.capture_path, Duration::from_secs(60)).await;
    cleanup(&mut spawned, &ctx).await;
}

/// S17 — manual `/compact` over `--input-format stream-json`.
///
/// Settles the open question behind the "CONTEXT meter doesn't reset after
/// /compact" report: does compaction in stream-json (print) mode actually
/// shrink the *next* turn's context the way the interactive TUI does, or does
/// it merely emit a summary while the next turn still carries full history?
///
/// Sequence:
///   T1, T2  — two substantive turns to build a non-trivial conversation.
///   T3      — `/compact` (the summarization turn; reads the whole history).
///   T4      — a tiny follow-up ("hi") whose `usage.input_tokens` reveals
///             whether the working context was reduced.
///
/// Read from `S17-compaction.jsonl`:
///   1. `system/status:"compacting"` and `system/subtype:"compact_boundary"`
///      fire? (confirms our detection in message_router.rs is current).
///   2. `compact_metadata` contents — only `pre_tokens`, or a post count too?
///   3. DECISIVE: T4's input_tokens « T2/T3's input_tokens  → /compact really
///      compacts (cosmetic meter lag only). T4 ≈ T3  → genuine stream-json
///      limitation (the meter is actually correct).
async fn s17_compaction() {
    let ctx = setup("S17-compaction", allow_all()).await;
    let mut spawned = spawn_cli(
        &ctx.capture, ctx.hook_port, &ctx.hook_path, None, &ctx.cwd, None,
    )
    .await;

    // T1 + T2: build conversation history worth compacting.
    send_user(&mut spawned, &ctx.capture,
        "Write three detailed paragraphs about the history of the C programming language.").await;
    wait_for_nth_result(&ctx.capture_path, 1, Duration::from_secs(90)).await;

    send_user(&mut spawned, &ctx.capture,
        "Now write three more detailed paragraphs about the history of the Rust programming language.").await;
    wait_for_nth_result(&ctx.capture_path, 2, Duration::from_secs(90)).await;

    // T3: manual compaction. Sent as plain text exactly like CodeMantis does.
    send_user(&mut spawned, &ctx.capture, "/compact").await;
    wait_for_nth_result(&ctx.capture_path, 3, Duration::from_secs(120)).await;
    // Give any trailing compact_boundary system event a moment to land.
    tokio::time::sleep(Duration::from_millis(800)).await;

    // T4: tiny follow-up. Its input_tokens is the decisive measurement.
    send_user(&mut spawned, &ctx.capture, "Reply with just the word: ok").await;
    wait_for_nth_result(&ctx.capture_path, 4, Duration::from_secs(90)).await;

    cleanup(&mut spawned, &ctx).await;
}

/// S18 — what triggers `/compact` on CLI 2.1.186 (regression probe).
///
/// Field report (CodeMantis): running `/compact` no longer compacts. The CLI
/// instead lets the model answer the literal text `/compact` conversationally
/// (a "checkpoint" handoff summary), and no `compact_boundary` ever fires.
/// S17 verified plain-text `/compact` DID compact on 2.1.185 — so this is a
/// fresh break one patch later (2.1.186).
///
/// This scenario builds a small compactable history, then probes — IN ORDER,
/// with `probe_*` marker events delimiting each — the candidate 2.1.186
/// trigger mechanisms, so `S18-compaction-mechanism.jsonl` reveals which (if
/// any) now emits `system/status:"compacting"` + `system/compact_boundary`:
///
///   Probe A  — `/compact` as plain `user` text (reproduce the break).
///   Probe B  — `compact` as a `control_request` subtype (was "Unsupported"
///              through 2.1.185; re-test in case compaction moved onto the
///              control channel).
///   Probe C  — two-phase: re-send `/compact` then a bare confirmation turn
///              ("yes") to test whether 2.1.186 made it a preview/confirm flow.
///
/// Read decisively: find the `compact_boundary` (if any) in the capture and
/// look back at the nearest preceding `dir:"stdin"` line — that envelope is
/// the new trigger and the basis for the host-side fix.
async fn s18_compaction_mechanism() {
    let ctx = setup("S18-compaction-mechanism", allow_all()).await;
    let mut spawned = spawn_cli(
        &ctx.capture, ctx.hook_port, &ctx.hook_path, None, &ctx.cwd, None,
    )
    .await;

    // T1 + T2: build a small but non-trivial history worth compacting.
    send_user(&mut spawned, &ctx.capture,
        "Write one short paragraph about the history of the C programming language.").await;
    wait_for_nth_result(&ctx.capture_path, 1, Duration::from_secs(90)).await;

    send_user(&mut spawned, &ctx.capture,
        "Now write one short paragraph about the history of the Rust programming language.").await;
    wait_for_nth_result(&ctx.capture_path, 2, Duration::from_secs(90)).await;

    // Probe A — plain-text `/compact` (the current CodeMantis path).
    ctx.capture.log_event("probe_a_plaintext_compact", json!({ "ts": now_ts() })).await;
    send_user(&mut spawned, &ctx.capture, "/compact").await;
    wait_for_nth_result(&ctx.capture_path, 3, Duration::from_secs(120)).await;
    tokio::time::sleep(Duration::from_millis(800)).await;

    // Probe B — `compact` as a control_request subtype.
    ctx.capture.log_event("probe_b_control_request_compact", json!({ "ts": now_ts() })).await;
    let req_id = "req_compact".to_string();
    send_control(&mut spawned, &ctx.capture, &req_id, json!({ "subtype": "compact" })).await;
    let _ = wait_for_control_response(&ctx.capture_path, req_id, Duration::from_secs(10)).await;
    tokio::time::sleep(Duration::from_millis(800)).await;

    // Probe C — two-phase: re-send `/compact`, then a bare confirmation turn.
    ctx.capture.log_event("probe_c_two_phase_compact", json!({ "ts": now_ts() })).await;
    send_user(&mut spawned, &ctx.capture, "/compact").await;
    wait_for_nth_result(&ctx.capture_path, 4, Duration::from_secs(120)).await;
    tokio::time::sleep(Duration::from_millis(500)).await;
    send_user(&mut spawned, &ctx.capture, "yes").await;
    wait_for_nth_result(&ctx.capture_path, 5, Duration::from_secs(120)).await;
    tokio::time::sleep(Duration::from_millis(800)).await;

    // Final tiny turn — its usage.input_tokens reveals whether ANY probe
    // actually shrank the working context.
    ctx.capture.log_event("probe_final_measurement", json!({ "ts": now_ts() })).await;
    send_user(&mut spawned, &ctx.capture, "Reply with just the word: ok").await;
    wait_for_nth_result(&ctx.capture_path, 6, Duration::from_secs(90)).await;

    cleanup(&mut spawned, &ctx).await;
}

/// S19 — MCP permission grant via the `--settings` `permissions.allow` block
/// (the CLI 2.1.195 regression fix). On 2.1.195 the PreToolUse hook's `allow` is
/// IGNORED for `mcp__*` tools (S14a denies the tool despite the hook returning
/// allow), so CodeMantis needs a static permission grant the CLI's own system
/// honors. This probes which rule form works under `--dangerously-skip-permissions`
/// and — decisively — that a hook DENY still gates an allow-listed MCP tool, so
/// the user-approval modal stays meaningful.
///
/// Read each sub-capture for: `system/init` mcp_servers status (did the CLI
/// connect?), the `hook_in_raw`/`hook_out` pair for `mcp__teststub__echo` (did
/// the hook fire?), the synthetic `tool_result` (real "echo: ..." vs the CLI's
/// reasonless deny), and `result.permission_denials`. ALWAYS check for
/// `rate_limit_event` / `api_retry` first — a throttled run proves nothing (the
/// S14a lesson).
async fn run_mcp_permissions_scenario(scenario: &str, allow_rules: &[&str], deny_mcp: bool) {
    let policy: HookPolicy = if deny_mcp {
        Arc::new(|input| {
            let tool = input.tool_name.as_deref().unwrap_or("");
            if tool.starts_with("mcp__") {
                HookOutcome::Respond(HookResponse::deny("S19 user denied the MCP tool"))
            } else {
                HookOutcome::Respond(HookResponse::allow())
            }
        })
    } else {
        allow_all()
    };
    let ctx = setup(scenario, policy).await;

    let stub = write_mcp_stub(&ctx.cwd);
    let mcp_config = write_mcp_config(&ctx.cwd, &stub);
    // NO --allowedTools — the permission grant must come from --settings alone.
    let extra: Vec<String> = vec![
        "--mcp-config".into(),
        mcp_config.display().to_string(),
        "--strict-mcp-config".into(),
    ];

    let settings = settings_json_with_permissions(&ctx.hook_path, 300, allow_rules);
    let mut spawned = spawn_cli_with_settings(
        &ctx.capture, ctx.hook_port, None, &ctx.cwd, None, &extra, &settings,
    )
    .await;

    send_user(&mut spawned, &ctx.capture,
        "Call the echo tool (its name is mcp__teststub__echo) with text \"hello from S19\". \
         It is in your tool set — call it directly, do not call ToolSearch. After it returns, \
         tell me in plain text exactly what it returned.").await;

    let _ = wait_for_result(&ctx.capture_path, Duration::from_secs(90)).await;
    cleanup(&mut spawned, &ctx).await;
}

async fn s19_mcp_permissions() {
    eprintln!("[harness] S19a — settings permissions.allow=[mcp__*], hook ALLOW");
    run_mcp_permissions_scenario("S19a-perm-wildcard", &["mcp__*"], false).await;
    eprintln!("[harness] S19a — settings permissions.allow=[mcp__teststub], hook ALLOW");
    run_mcp_permissions_scenario("S19a-perm-server", &["mcp__teststub"], false).await;
    eprintln!("[harness] S19b — settings permissions.allow=[mcp__teststub], hook DENY (gate check)");
    run_mcp_permissions_scenario("S19b-perm-deny-gates", &["mcp__teststub"], true).await;
}

/// S20 — PRODUCTION-FAITHFUL MCP discovery repro (the field incident).
///
/// The hermetic S14/S19 scenarios pass `--mcp-config --strict-mcp-config`, but
/// production does NOT — CodeMantis lets the CLI auto-discover servers from a
/// project `.mcp.json` / user config. Auto-discovered project servers are
/// TRUST-gated (the CLI normally prompts "approve this MCP server?"), unlike
/// `--mcp-config` servers. The field-incident pattern — the PreToolUse hook
/// FIRES and returns allow, yet the CLI denies the MCP tool with its generic
/// "user doesn't want to proceed" — is consistent with a server-level trust
/// gate applied AFTER the tool-level hook. S20 tests exactly that, with the
/// production flag set (NO `--mcp-config`, NO `--allowedTools`), hook = ALLOW:
///
///   * S20a-discover-plain — bare production settings. REPRO candidate: does an
///     auto-discovered project server's tool get denied despite hook allow? (Or
///     surface as "No such tool" = server silently not loaded.)
///   * S20b-discover-enable-all — adds `enableAllProjectMcpServers: true`.
///   * S20c-discover-perm-grant — adds `permissions.allow: ["mcp__*"]`.
///
/// Read each capture for: `system/init.mcp_servers` (status: connected /
/// needs-auth / absent), a `hook_in_raw`/`hook_out` pair for the MCP tool (did
/// the hook fire — i.e. was the tool recognized?), the synthetic `tool_result`
/// (real echo vs reasonless deny vs "No such tool"), `result.permission_denials`,
/// and `rate_limit_info.status` (must be "allowed" to trust the run).
async fn run_mcp_discovery_scenario(
    scenario: &str,
    allow_rules: &[&str],
    enable_all_project_mcp: bool,
) {
    let ctx = setup(scenario, allow_all()).await;

    let stub = write_mcp_stub(&ctx.cwd);
    // Project-scoped discovery: write `.mcp.json` in cwd, pass NO --mcp-config.
    let _mcp_json = write_project_mcp_json(&ctx.cwd, &stub);

    // Production-faithful: no --mcp-config, no --strict-mcp-config, no --allowedTools.
    let extra: Vec<String> = vec![];
    let settings = settings_json_custom(&ctx.hook_path, 300, allow_rules, enable_all_project_mcp);

    let mut spawned = spawn_cli_with_settings(
        &ctx.capture, ctx.hook_port, None, &ctx.cwd, None, &extra, &settings,
    )
    .await;

    send_user(&mut spawned, &ctx.capture,
        "Call the echo tool (its name is mcp__teststub__echo) with text \"hello from S20\". \
         It is in your tool set — call it directly, do not call ToolSearch. After it returns, \
         tell me in plain text exactly what it returned.").await;

    let _ = wait_for_result(&ctx.capture_path, Duration::from_secs(90)).await;
    cleanup(&mut spawned, &ctx).await;
}

async fn s20_mcp_discovery() {
    eprintln!("[harness] S20a — project .mcp.json discovery, bare settings (REPRO attempt)");
    run_mcp_discovery_scenario("S20a-discover-plain", &[], false).await;
    eprintln!("[harness] S20b — discovery + enableAllProjectMcpServers");
    run_mcp_discovery_scenario("S20b-discover-enable-all", &[], true).await;
    eprintln!("[harness] S20c — discovery + permissions.allow=[mcp__*]");
    run_mcp_discovery_scenario("S20c-discover-perm-grant", &["mcp__*"], false).await;
}

// =====================================================================
// MAIN — runs the whole battery sequentially.
// =====================================================================

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore]
async fn capture_full_battery() {
    if std::env::var("CM_HARNESS_KEEP").ok().as_deref() != Some("1") {
        let dir = captures_dir();
        if dir.exists() {
            for entry in std::fs::read_dir(&dir).unwrap_or_else(|e| panic!("{e}")) {
                let entry = entry.unwrap();
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("jsonl") {
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
    }

    eprintln!("[harness] === S01 initialize ===");
    s01_initialize().await;
    eprintln!("[harness] === S02 subtype sweep ===");
    s02_subtype_sweep().await;
    eprintln!("[harness] === S03 interrupt midstream ===");
    s03_interrupt_midstream().await;
    eprintln!("[harness] === S04 set_model ===");
    s04_set_model().await;
    eprintln!("[harness] === S05 set_permission_mode ===");
    s05_set_permission_mode().await;
    eprintln!("[harness] === S06 ExitPlanMode allow ===");
    s06_exit_plan_mode_allow().await;
    eprintln!("[harness] === S07 ExitPlanMode deny ===");
    s07_exit_plan_mode_deny().await;
    eprintln!("[harness] === S08 ExitPlanMode ask ===");
    s08_exit_plan_mode_ask().await;
    eprintln!("[harness] === S09 AskUserQuestion ===");
    s09_ask_user_question().await;
    eprintln!("[harness] === S10 protected-path baseline ===");
    s10_protected_path_baseline().await;
    eprintln!("[harness] === S11 mixed denials ===");
    s11_mixed_denials().await;
    eprintln!("[harness] === S12a hook slow ===");
    s12a_hook_slow().await;
    eprintln!("[harness] === S12b hook 500 ===");
    s12b_hook_500().await;
    eprintln!("[harness] === S14 MCP tool under hook + skip-permissions ===");
    s14_mcp_tool().await;
    eprintln!("[harness] === S15 MCP tool over HTTP transport ===");
    s15_http_mcp_tool().await;
    eprintln!("[harness] === S16 hook exceeds CLI timeout ===");
    s16_hook_exceeds_cli_timeout().await;
    eprintln!("[harness] === S17 manual /compact over stream-json ===");
    s17_compaction().await;
    eprintln!("[harness] === S18 /compact trigger mechanism (2.1.186 regression) ===");
    s18_compaction_mechanism().await;
    eprintln!("[harness] === S19 MCP permissions.allow grant (2.1.195 regression) ===");
    s19_mcp_permissions().await;
    eprintln!("[harness] === DONE ===");
}

/// Verifies the *spawn-time* effort path: passing `--effort <level>` (the
/// documented Anthropic CLI flag, see `claude --help`) to the CLI for each
/// of `low / medium / high / xhigh` causes the CLI to spawn cleanly (no
/// "unrecognised option" error on stderr) and emit a normal `system/init`
/// event. Note: the CLI does NOT echo the effort back in any event in
/// v2.1.126, so this test asserts the spawn path stays clean — not that
/// the budget actually changed (which can only be measured by token
/// usage on a real prompt).
///
/// Also captures (in the same scenario file) the empirical fact that
/// `/effort <level>` typed as a user message returns
/// "/effort isn't available in this environment." That's the gate the
/// CLI puts on the slash command in non-TTY mode and is the reason the
/// CodeMantis dropdown only takes effect on next-session spawn.
/// Capture: `S13-spawn-effort-<level>.jsonl`.
async fn s13_spawn_time_effort() {
    use tokio::io::AsyncWriteExt;

    for level in ["low", "medium", "high", "xhigh"] {
        let scenario = format!("S13-spawn-effort-{level}");
        let ctx = setup(&scenario, allow_all()).await;

        let mut cmd = tokio::process::Command::new("claude");
        for a in production_cli_args() { cmd.arg(a); }
        for a in diagnostic_cli_args() { cmd.arg(a); }
        cmd.args(["--settings", &settings_json(&ctx.hook_path)]);
        cmd.args(["--effort", level]);
        cmd.env("CODEMANTIS_APPROVAL_PORT", ctx.hook_port.to_string());
        cmd.env(
            "CODEMANTIS_SESSION_ID",
            format!("harness-{}", uuid::Uuid::new_v4()),
        );
        cmd.current_dir(&ctx.cwd);
        cmd.stdin(std::process::Stdio::piped());
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        let arg_view: Vec<String> = cmd.as_std().get_args()
            .map(|s| s.to_string_lossy().into_owned()).collect();
        ctx.capture.log_event("spawn", serde_json::json!({
            "binary": "claude", "args": arg_view, "level_under_test": level,
        })).await;

        let mut child = cmd.spawn().expect("spawn claude");
        let mut stdin = child.stdin.take().expect("stdin");
        let stdout = child.stdout.take().expect("stdout");
        let stderr = child.stderr.take().expect("stderr");

        let cap_out = ctx.capture.clone();
        tokio::spawn(async move {
            let mut lines = tokio::io::BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                cap_out.log("stdout", &line).await;
            }
        });
        let cap_err = ctx.capture.clone();
        tokio::spawn(async move {
            let mut lines = tokio::io::BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                cap_err.log("stderr", &line).await;
            }
        });

        let user = serde_json::json!({
            "type": "user",
            "message": { "role": "user", "content": "ping" }
        });
        ctx.capture.log("stdin", &user.to_string()).await;
        let _ = stdin.write_all(format!("{user}\n").as_bytes()).await;
        let _ = stdin.flush().await;

        let init = poll_for(
            &ctx.capture_path,
            |v| {
                v.get("type").and_then(Value::as_str) == Some("system")
                    && v.get("subtype").and_then(Value::as_str) == Some("init")
            },
            Duration::from_secs(20),
        ).await;

        ctx.capture.log_event("init_observed", serde_json::json!({
            "level_requested": level,
            "got_init": init.is_some(),
            // Documented as None in 2.1.126 — see memory
            // project_cli_effort_runtime_constraints.md.
            "thinking_effort_in_init": init.as_ref()
                .and_then(|v| v.get("thinking_effort"))
                .and_then(Value::as_str)
                .map(|s| s.to_string()),
        })).await;

        // Probe `/effort <level>` as a user message to keep documenting
        // that the slash command is gated to TTY mode in v2.1.126.
        let probe_level = if level == "low" { "high" } else { "low" };
        let probe = serde_json::json!({
            "type": "user",
            "message": { "role": "user",
                "content": format!("/effort {probe_level}") }
        });
        ctx.capture.log("stdin", &probe.to_string()).await;
        let _ = stdin.write_all(format!("{probe}\n").as_bytes()).await;
        let _ = stdin.flush().await;
        tokio::time::sleep(Duration::from_secs(3)).await;

        let _ = stdin.shutdown().await;
        let _ = tokio::time::timeout(Duration::from_secs(3), child.wait()).await;
        let _ = child.start_kill();
        let _ = child.wait().await;
        ctx.capture.log_event("scenario_end",
            serde_json::json!({ "ts": now_ts() })).await;
    }
}

// Convenience: run a single scenario via env var.
//   CM_HARNESS_ONLY=S03 cargo test --test cli_protocol_capture -- --ignored --nocapture
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore]
async fn capture_single() {
    let only = std::env::var("CM_HARNESS_ONLY").unwrap_or_default();
    match only.as_str() {
        "S01" => s01_initialize().await,
        "S02" => s02_subtype_sweep().await,
        "S03" => s03_interrupt_midstream().await,
        "S04" => s04_set_model().await,
        "S05" => s05_set_permission_mode().await,
        "S06" => s06_exit_plan_mode_allow().await,
        "S07" => s07_exit_plan_mode_deny().await,
        "S08" => s08_exit_plan_mode_ask().await,
        "S09" => s09_ask_user_question().await,
        "S10" => s10_protected_path_baseline().await,
        "S11" => s11_mixed_denials().await,
        "S12a" => s12a_hook_slow().await,
        "S12b" => s12b_hook_500().await,
        "S13" => s13_spawn_time_effort().await,
        "S14" => s14_mcp_tool().await,
        "S15" => s15_http_mcp_tool().await,
        "S16" => s16_hook_exceeds_cli_timeout().await,
        "S17" => s17_compaction().await,
        "S18" => s18_compaction_mechanism().await,
        "S19" => s19_mcp_permissions().await,
        "S20" => s20_mcp_discovery().await,
        other => panic!("set CM_HARNESS_ONLY to one of S01..S20 (got '{other}')"),
    }
}
