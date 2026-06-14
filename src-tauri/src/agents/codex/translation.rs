//! Codex `ThreadEvent` → [`NormalizedEvent`] translator.
//!
//! The Codex `codex app-server --listen stdio://` protocol streams a mix of
//! JSON-RPC notifications (`turn/started`, `item/*`, `error`) and
//! server-initiated requests (the four `*/requestApproval` kinds). This
//! module owns the **notification** side of that — turning each Codex
//! notification into 0..n [`NormalizedEvent`]s that match what the
//! frontend already knows how to render for Claude.
//!
//! The approval-request side lives in
//! [`crate::agents::codex::approvals`].
//!
//! Spec: `_guidance/requirements/CodeMantis-Phase2-CodexAdapter-v1.0.md`
//! §2.4.4 (item mapping table), §2.4.7 (error mapping).
//!
//! Defensive parsing: every field is fetched with `value.get(…)` rather
//! than struct deserialization so a single missing field (Codex's wire is
//! still evolving) downgrades to a no-op or a `ProcessError` instead of
//! poisoning the whole session.

#![allow(dead_code)] // S4 wires this into the spawn loop.

use std::sync::Arc;

use serde_json::Value;

use super::thread_state::{ItemBuffer, ThreadState};
use crate::agents::{AgentId, NormalizedEvent, PermissionDenial};

/// Translator for one Codex thread. Cheap to clone — every method takes
/// `&self`, mutation is funneled through the inner `ThreadState`.
#[derive(Clone)]
pub struct Translator {
    /// Always [`AgentId::Codex`]. Plumbed for parity with how the Claude
    /// translator carries an `agent_id`.
    pub agent_id: AgentId,
    /// CodeMantis session id (UUID), not Codex's thread id. Stamped onto
    /// every emitted event so the frontend can correlate to a tab.
    pub session_id: String,
    /// Per-thread accumulators (current turn, item buffers, pending
    /// server-initiated approvals).
    pub state: Arc<ThreadState>,
}

impl Translator {
    pub fn new(session_id: String, state: Arc<ThreadState>) -> Self {
        Self {
            agent_id: AgentId::Codex,
            session_id,
            state,
        }
    }

    /// Top-level dispatch. Given a Codex JSON-RPC notification, produce
    /// the zero-or-more frontend events to emit. Returns an empty `Vec` for
    /// uninteresting events (`turn/started`, `userMessage` echo, …) so the
    /// caller can fire-and-forget the result of every notification.
    pub async fn on_notification(&self, method: &str, params: Value) -> Vec<NormalizedEvent> {
        match method {
            "thread/started" => self.on_thread_started(params).await,
            "thread/closed" | "thread/archived" => Vec::new(),
            "turn/started" => self.on_turn_started(params).await,
            "turn/completed" => self.on_turn_completed(params).await,
            "item/started" => self.on_item_started(params).await,
            "item/completed" => self.on_item_completed(params).await,
            // The most common delta channels per spec §2.4.4. Treat anything
            // we don't recognise as a no-op so an upgraded Codex doesn't
            // crash the dispatcher.
            "item/agentMessage/delta" => self.on_agent_message_delta(params).await,
            "item/reasoning/summaryTextDelta"
            | "item/reasoning/textDelta"
            | "item/reasoning/summaryPartAdded" => self.on_reasoning_delta(params).await,
            "item/commandExecution/outputDelta" => self.on_command_output_delta(params).await,
            // Per-turn token accumulation (incl. reasoningOutputTokens).
            // Schema: docs/internal/codex-app-server-schemas/v2/ThreadTokenUsageUpdatedNotification.json
            // We surface `last` (the most-recent step's delta) so the
            // existing `accumulateUsage` accumulator pattern works without
            // double-counting — `total` would re-add the running sum on
            // every notification.
            "thread/tokenUsage/updated" => self.on_token_usage_updated(params),
            // Hook lifecycle (HookStartedNotification / HookCompletedNotification).
            // Separate from `hookPrompt` ThreadItems: lifecycle markers
            // tell us a hook ran (started / failed / completed), while
            // ThreadItems carry the *content* injected by the hook.
            "hook/started" => self.on_hook_lifecycle(params, "started"),
            "hook/completed" => self.on_hook_lifecycle(params, "completed"),
            // v1.4.1 Phase B.2 — Codex MCP server lifecycle + account
            // rate-limit updates. Schemas:
            //   v2/McpServerStatusUpdatedNotification.json
            //   v2/AccountRateLimitsUpdatedNotification.json
            "mcpServer/startupStatus/updated" => self.on_mcp_startup_status(params),
            "account/rateLimits/updated" => self.on_rate_limits_updated(params),
            // Codex reports its real collaboration mode here. The native Plan
            // pill doesn't trigger this (it only flips our read-only override),
            // but if Codex ever reports `collaborationMode.mode == "plan"`
            // (e.g. set via a TUI excursion, or a future settable lever), this
            // keeps the in-app plan indicator in sync.
            // Schema: docs/internal/codex-app-server-schemas/v2/ThreadSettingsUpdatedNotification.json
            "thread/settings/updated" => self.on_thread_settings_updated(params),
            "error" => self.map_error(params).await,
            // Intentionally NOT handled (v1.4.1 Phase A.4):
            //   `item/fileChange/outputDelta` — the schema at
            //   docs/internal/codex-app-server-schemas/v2/FileChangeOutputDeltaNotification.json
            //   line 4 marks this notification as deprecated; the server
            //   no longer emits it. Adding an arm here would be dead code.
            //   If a future Codex version revives the method, add the arm
            //   alongside item/commandExecution/outputDelta — they share
            //   the same `{itemId, delta}` shape.
            // Unknown notification — log and swallow (S4 wires the logger).
            _ => Vec::new(),
        }
    }

    /// Translate `thread/settings/updated` → `CodexPlanModeChanged` when the
    /// reported `collaborationMode.mode` flips. Emits nothing for non-mode
    /// settings changes (model/sandbox/etc.) so we don't spam the frontend.
    /// Params shape: `{ threadId, threadSettings: { collaborationMode: { mode } } }`.
    fn on_thread_settings_updated(&self, params: Value) -> Vec<NormalizedEvent> {
        let mode = params
            .get("threadSettings")
            .and_then(|s| s.get("collaborationMode"))
            .and_then(|c| c.get("mode"))
            .and_then(|m| m.as_str());
        match mode {
            Some(m) => vec![NormalizedEvent::CodexPlanModeChanged {
                agent_id: self.agent_id,
                session_id: self.session_id.clone(),
                enabled: m == "plan",
            }],
            None => Vec::new(),
        }
    }

    /// Translate `thread/tokenUsage/updated` → `UsageUpdate`.
    /// Schema:
    /// docs/internal/codex-app-server-schemas/v2/ThreadTokenUsageUpdatedNotification.json
    ///
    /// Codex sends `{ threadId, turnId, tokenUsage: { last, total,
    /// modelContextWindow } }` where `last` is the most-recent step's
    /// delta and `total` is the cumulative thread total. We forward
    /// `last` so the existing frontend accumulator pattern adds without
    /// double-counting.
    ///
    /// UsageInfo's serde field names are snake_case (Claude convention)
    /// so we hand-build it from the camelCase Codex payload rather than
    /// polluting the shared struct with Codex-only aliases.
    fn on_token_usage_updated(&self, params: Value) -> Vec<NormalizedEvent> {
        let tu = params.get("tokenUsage");
        // Tier-1 diagnostic: log the REAL window + cumulative total so we can
        // reconcile the misleading "Nm tokens" UI counter and the "compacting at
        // ctx X%" question against ground truth (`total` is cumulative/monotonic).
        if let Some(tu) = tu {
            log::info!(
                "[codex {}] tokenUsage: window={:?} total={:?} last={:?}",
                self.session_id,
                tu.get("modelContextWindow").and_then(|v| v.as_u64()),
                tu.pointer("/total/totalTokens").and_then(|v| v.as_u64()),
                tu.pointer("/last/totalTokens").and_then(|v| v.as_u64()),
            );
        }
        let breakdown = match tu.and_then(|v| v.get("last")) {
            Some(v) => v,
            None => return Vec::new(),
        };
        let usage = crate::agents::UsageInfo {
            input_tokens: breakdown.get("inputTokens").and_then(|v| v.as_u64()),
            output_tokens: breakdown.get("outputTokens").and_then(|v| v.as_u64()),
            cache_creation_input_tokens: None, // Codex doesn't track this
            cache_read_input_tokens: breakdown.get("cachedInputTokens").and_then(|v| v.as_u64()),
            service_tier: None,
            server_tool_use: None,
            iterations: None,
            reasoning_output_tokens: breakdown
                .get("reasoningOutputTokens")
                .and_then(|v| v.as_u64()),
            // Codex's authoritative window → the meter shows the real ctx %
            // instead of a guessed window (the "47% while actually 93%" bug).
            model_context_window: tu
                .and_then(|t| t.get("modelContextWindow"))
                .and_then(|v| v.as_u64()),
        };
        vec![NormalizedEvent::UsageUpdate {
            agent_id: AgentId::Codex,
            session_id: self.session_id.clone(),
            usage,
        }]
    }

    /// v1.4.1 Phase B.2 — MCP server startup status notification.
    /// Emit only on `failed` / `cancelled` so users see why an MCP tool
    /// stopped responding; `starting` / `ready` are silent (too noisy).
    fn on_mcp_startup_status(&self, params: Value) -> Vec<NormalizedEvent> {
        let name = params
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("?")
            .to_string();
        let status = params
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if status != "failed" && status != "cancelled" {
            return Vec::new();
        }
        let error = params
            .get("error")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        vec![NormalizedEvent::McpStartupStatus {
            agent_id: AgentId::Codex,
            session_id: self.session_id.clone(),
            name,
            status,
            error,
        }]
    }

    /// v1.4.1 Phase B.2 — account rate-limits. Codex sends a dual-window
    /// `{ primary, secondary }` structure. We compute the higher of the
    /// two utilizations and emit a `RateLimitWarning` (Claude already
    /// uses this event for the existing rate-limit banner) when
    /// utilization ≥ 0.8 OR a `rateLimitReachedType` is set. Schema:
    /// docs/internal/codex-app-server-schemas/v2/AccountRateLimitsUpdatedNotification.json
    fn on_rate_limits_updated(&self, params: Value) -> Vec<NormalizedEvent> {
        let limits = match params.get("rateLimits") {
            Some(v) => v,
            None => return Vec::new(),
        };
        let pct = |obj: &Value| -> Option<f64> {
            obj.get("usedPercent").and_then(|v| v.as_f64())
        };
        let primary = limits.get("primary").map(pct).unwrap_or(None);
        let secondary = limits.get("secondary").map(pct).unwrap_or(None);
        let max_pct = match (primary, secondary) {
            (Some(p), Some(s)) => Some(p.max(s)),
            (Some(p), None) => Some(p),
            (None, Some(s)) => Some(s),
            (None, None) => None,
        };
        let reached_type = limits
            .get("rateLimitReachedType")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        // Threshold: 80% of either window OR an explicit reachedType.
        let utilization_frac = max_pct.map(|p| p / 100.0).unwrap_or(0.0);
        let trigger_threshold = utilization_frac >= 0.8 || reached_type.is_some();
        if !trigger_threshold {
            return Vec::new();
        }
        // Pull resetsAt from whichever window is closer to the cap.
        let resets_at = match (primary, secondary) {
            (Some(p), Some(s)) if s >= p => limits
                .get("secondary")
                .and_then(|w| w.get("resetsAt"))
                .and_then(|v| v.as_f64()),
            _ => limits
                .get("primary")
                .and_then(|w| w.get("resetsAt"))
                .and_then(|v| v.as_f64()),
        };
        vec![NormalizedEvent::RateLimitWarning {
            agent_id: AgentId::Codex,
            session_id: self.session_id.clone(),
            utilization: utilization_frac,
            resets_at,
            rate_limit_type: reached_type.clone().or_else(|| {
                limits
                    .get("limitName")
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
            }),
            overage_status: None,
            is_using_overage: None,
        }]
    }

    fn on_hook_lifecycle(&self, params: Value, kind: &str) -> Vec<NormalizedEvent> {
        let run = params.get("run").cloned().unwrap_or(Value::Null);
        let run_id = run
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let event_name = run
            .get("eventName")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let status = run
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let duration_ms = run.get("durationMs").and_then(|v| v.as_u64());
        vec![NormalizedEvent::HookStatus {
            agent_id: AgentId::Codex,
            session_id: self.session_id.clone(),
            run_id,
            event_name,
            kind: kind.to_string(),
            status,
            duration_ms,
        }]
    }

    // ── Lifecycle ──

    async fn on_thread_started(&self, params: Value) -> Vec<NormalizedEvent> {
        let thread = params.get("thread").cloned().unwrap_or(params);
        let Some(tid) = thread
            .get("id")
            .and_then(|v| v.as_str())
            .map(str::to_string)
        else {
            return Vec::new();
        };
        self.state.set_thread_id(tid.clone()).await;
        vec![NormalizedEvent::CliSessionId {
            agent_id: AgentId::Codex,
            session_id: self.session_id.clone(),
            cli_session_id: tid,
        }]
    }

    async fn on_turn_started(&self, params: Value) -> Vec<NormalizedEvent> {
        // Spec §2.4.4: turn/started carries no UI-relevant payload — its
        // job is just to advance state. Record the active turn id so a
        // later turn/interrupt knows what to cancel.
        let turn_id = params
            .get("turn")
            .and_then(|t| t.get("id"))
            .and_then(|v| v.as_str())
            .map(str::to_string);
        self.state.set_current_turn(turn_id).await;
        Vec::new()
    }

    async fn on_turn_completed(&self, params: Value) -> Vec<NormalizedEvent> {
        // Always clear the active turn — even if the turn was interrupted
        // or failed, it is no longer the target of turn/interrupt.
        self.state.set_current_turn(None).await;

        let turn = params.get("turn").unwrap_or(&params);
        let status = turn
            .get("status")
            .and_then(|v| v.as_str())
            .map(str::to_string);

        // Surface interrupts as TurnComplete (same as Claude, spec §2.9
        // "Turn-end semantics") with a terminal_reason hint. The frontend
        // turn-complete handler already special-cases the interrupted path.
        let terminal_reason = match status.as_deref() {
            Some("interrupted") => Some("aborted_streaming".to_string()),
            Some("failed") => Some("turn_failed".to_string()),
            _ => None,
        };

        let usage = turn
            .get("usage")
            .cloned()
            .and_then(|v| serde_json::from_value(v).ok());

        let duration_ms = turn.get("durationMs").and_then(|v| v.as_u64());
        let duration_api_ms = turn.get("durationApiMs").and_then(|v| v.as_u64());

        vec![NormalizedEvent::TurnComplete {
            agent_id: AgentId::Codex,
            session_id: self.session_id.clone(),
            duration_ms,
            usage,
            cost_usd: turn.get("costUsd").and_then(|v| v.as_f64()),
            duration_api_ms,
            num_turns: None,
            stop_reason: status,
            terminal_reason,
            model_name: turn
                .get("model")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            context_window: turn.get("contextWindow").and_then(|v| v.as_u64()),
            max_output_tokens: turn.get("maxOutputTokens").and_then(|v| v.as_u64()),
        }]
    }

    // ── Items ──

    async fn on_item_started(&self, params: Value) -> Vec<NormalizedEvent> {
        let item = params.get("item").cloned().unwrap_or(params);
        let Some(item_type) = item.get("type").and_then(|v| v.as_str()).map(str::to_string)
        else {
            return Vec::new();
        };
        let Some(item_id) = item.get("id").and_then(|v| v.as_str()).map(str::to_string)
        else {
            return Vec::new();
        };

        // Buffer the snapshot so item/completed can reference it for
        // streaming items.
        {
            let mut buffers = self.state.item_buffers.lock().await;
            buffers.insert(item_id.clone(), ItemBuffer::from_snapshot(item.clone()));
        }

        match item_type.as_str() {
            // Internal echo of the user's input — not surfaced.
            "userMessage" => Vec::new(),
            // Streaming text: no event on start; the delta channel does
            // the work. item/completed emits TextComplete with the final
            // text.
            "agentMessage" | "reasoning" => Vec::new(),

            "commandExecution" => {
                let command = item
                    .get("command")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let cwd = item.get("cwd").and_then(|v| v.as_str()).unwrap_or("");
                vec![NormalizedEvent::ToolUseStart {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    tool_use_id: item_id,
                    tool_name: "Bash".to_string(),
                    tool_input: serde_json::json!({"command": command, "cwd": cwd}),
                }]
            }

            "fileChange" => {
                let path = item.get("path").and_then(|v| v.as_str()).unwrap_or("");
                let diff = item.get("diff").cloned().unwrap_or(Value::Null);
                // Codex doesn't distinguish Write vs. Edit at the item
                // level; we use "Edit" as the more common case (matches
                // Claude's Edit tool semantics for incremental changes).
                let tool_name = if item
                    .get("changeKind")
                    .and_then(|v| v.as_str())
                    == Some("create")
                {
                    "Write"
                } else {
                    "Edit"
                };
                vec![NormalizedEvent::ToolUseStart {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    tool_use_id: item_id,
                    tool_name: tool_name.to_string(),
                    tool_input: serde_json::json!({"path": path, "diff": diff}),
                }]
            }

            "mcpToolCall" => {
                let server = item.get("serverName").and_then(|v| v.as_str()).unwrap_or("?");
                let tool = item.get("toolName").and_then(|v| v.as_str()).unwrap_or("?");
                let args = item.get("arguments").cloned().unwrap_or(Value::Null);
                // Match Claude's `mcp__server__tool` convention so
                // ActivityFeed / event-classifier / activity-type helpers
                // recognise the call as MCP and format the badge as
                // "server: tool" instead of dumping the raw string.
                vec![NormalizedEvent::ToolUseStart {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    tool_use_id: item_id,
                    tool_name: format!("mcp__{server}__{tool}"),
                    tool_input: args,
                }]
            }

            "webSearch" => {
                let query = item.get("query").and_then(|v| v.as_str()).unwrap_or("");
                vec![NormalizedEvent::ToolUseStart {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    tool_use_id: item_id,
                    tool_name: "WebSearch".to_string(),
                    tool_input: serde_json::json!({"query": query}),
                }]
            }

            "imageView" => {
                let file = item.get("filePath").and_then(|v| v.as_str()).unwrap_or("");
                vec![NormalizedEvent::ToolUseStart {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    tool_use_id: item_id,
                    tool_name: "Read".to_string(),
                    tool_input: serde_json::json!({"file_path": file}),
                }]
            }

            "contextCompaction" => {
                log::info!("[codex {}] contextCompaction started (item/started)", self.session_id);
                vec![NormalizedEvent::CompactingStatus {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    is_compacting: true,
                }]
            }

            // ── v1.4.0 ThreadItem types ──
            // Phase 2 spec §2.4.4 deferred these as v1.4.0 work; the
            // user-approved plan in /Users/hr/.claude/plans/i-want-to-add-gentle-duckling.md
            // brings them forward.

            // `plan` text is authoritative only at item/completed — see
            // schema comment in ItemStartedNotification.json:617. We emit
            // nothing on start; the completed handler synthesises an
            // ExitPlanMode ToolUseStart so the existing PlanCompleteModal
            // pipeline picks it up unchanged.
            "plan" => Vec::new(),

            // Review-mode lifecycle markers — the `review` field is
            // populated on item/completed. Started is no-op.
            "enteredReviewMode" | "exitedReviewMode" => Vec::new(),

            // Hook prompt: fragments arrive at completion.
            "hookPrompt" => Vec::new(),

            // Image generation: the `result` URL / `savedPath` is
            // authoritative at completion; nothing useful to surface on
            // start beyond the activity badge.
            "imageGeneration" => vec![NormalizedEvent::ToolUseStart {
                agent_id: AgentId::Codex,
                session_id: self.session_id.clone(),
                tool_use_id: item_id,
                tool_name: "ImageGeneration".to_string(),
                tool_input: serde_json::json!({
                    "revisedPrompt": item.get("revisedPrompt").cloned().unwrap_or(Value::Null),
                }),
            }],

            // Dynamic tool call: namespaced name so the existing
            // event-classifier / ActivityFeed `dyn__namespace__tool`
            // branch (mirrors mcp__ convention) formats the badge as
            // "namespace: tool" instead of dumping the raw string.
            "dynamicToolCall" => {
                let tool = item.get("tool").and_then(|v| v.as_str()).unwrap_or("?");
                let namespace = item.get("namespace").and_then(|v| v.as_str());
                let tool_name = match namespace {
                    Some(ns) if !ns.is_empty() => format!("dyn__{ns}__{tool}"),
                    _ => format!("dyn__{tool}"),
                };
                let args = item.get("arguments").cloned().unwrap_or(Value::Null);
                vec![NormalizedEvent::ToolUseStart {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    tool_use_id: item_id,
                    tool_name,
                    tool_input: args,
                }]
            }

            // collabAgentToolCall — OBSERVED-ONLY per Phase 2 anti-goal
            // (multi-agent coordination was deliberately out of scope).
            // We surface the call through the existing SubAgent
            // infrastructure so users can see it happening, but we do
            // NOT add any UI to spawn / steer / close sub-agents from
            // CodeMantis. If a future contributor wants to add steering
            // UI, that's a separate decision — see the plan file at
            // /Users/hr/.claude/plans/i-want-to-add-gentle-duckling.md
            // (Tier 3) for context.
            "collabAgentToolCall" => {
                let tool = item.get("tool").and_then(|v| v.as_str()).unwrap_or("?");
                let receivers: Vec<String> = item
                    .get("receiverThreadIds")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default();
                let receivers_label = if receivers.len() <= 2 {
                    receivers.join(", ")
                } else {
                    format!("{}+{} more", receivers[..2].join(", "), receivers.len() - 2)
                };
                let description = format!("{tool} → {receivers_label}");
                let tool_input = serde_json::json!({
                    "tool": tool,
                    "receiverThreadIds": receivers,
                    "prompt": item.get("prompt").cloned().unwrap_or(Value::Null),
                    "model": item.get("model").cloned().unwrap_or(Value::Null),
                    "reasoningEffort": item.get("reasoningEffort").cloned().unwrap_or(Value::Null),
                });
                vec![
                    NormalizedEvent::ToolUseStart {
                        agent_id: AgentId::Codex,
                        session_id: self.session_id.clone(),
                        tool_use_id: item_id.clone(),
                        tool_name: "Agent".to_string(),
                        tool_input,
                    },
                    NormalizedEvent::SubAgentStarted {
                        agent_id: AgentId::Codex,
                        session_id: self.session_id.clone(),
                        tool_use_id: item_id,
                        description,
                        subagent_type: tool.to_string(),
                    },
                ]
            }

            // Unknown item type — log and drop. Adding a new arm here
            // (rather than silently swallowing) is the empirical-first
            // path the drift detector enforces.
            _ => Vec::new(),
        }
    }

    async fn on_item_completed(&self, params: Value) -> Vec<NormalizedEvent> {
        let item = params.get("item").cloned().unwrap_or(params);
        let Some(item_type) = item.get("type").and_then(|v| v.as_str()).map(str::to_string)
        else {
            return Vec::new();
        };
        let Some(item_id) = item.get("id").and_then(|v| v.as_str()).map(str::to_string)
        else {
            return Vec::new();
        };
        let status = item
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("completed")
            .to_string();

        // Pop the buffer so we don't leak memory; for streaming items the
        // accumulated text is the authoritative fallback if the item
        // snapshot lacks a final `text` field.
        let buffer = {
            let mut buffers = self.state.item_buffers.lock().await;
            buffers.remove(&item_id)
        };

        match item_type.as_str() {
            "agentMessage" => {
                let full = item
                    .get("text")
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
                    .or_else(|| buffer.as_ref().map(|b| b.text.clone()))
                    .unwrap_or_default();
                vec![NormalizedEvent::TextComplete {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    full_text: full,
                }]
            }

            "reasoning" => {
                // Empirical (cli 0.130.0, verified 2026-05-22; schema bundle
                // re-generated + structurally re-checked against 0.137.0 2026-06-08):
                //   ReasoningThreadItem schema is `{ id, type: "reasoning",
                //   summary: array<string>, content: array<string> }`
                //   with both arrays defaulting to []. In practice Codex
                //   leaves them empty and emits NO delta notifications,
                //   so the reasoning panel stays blank for Codex turns.
                //   This is by design — OpenAI's o-series reasoning text
                //   is hidden by default; only `reasoningOutputTokens` in
                //   the usage block tells us reasoning happened.
                // We read both arrays AS arrays (not as_str — the old code
                // assumed scalar fields and silently fell through to the
                // empty fallback) so when Codex eventually exposes the
                // reasoning text (or older / non-default models do), it
                // will land in the Reasoning panel automatically.
                let summary_parts: Vec<String> = item
                    .get("summary")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default();
                let content_parts: Vec<String> = item
                    .get("content")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default();
                let from_arrays = if !content_parts.is_empty() {
                    Some(content_parts.join("\n\n"))
                } else if !summary_parts.is_empty() {
                    Some(summary_parts.join("\n\n"))
                } else {
                    None
                };
                // Back-compat: a future schema variant might use scalar
                // `summary` / `text` fields; try those before the buffer.
                let full = from_arrays
                    .or_else(|| {
                        item.get("summary")
                            .and_then(|v| v.as_str())
                            .map(str::to_string)
                    })
                    .or_else(|| item.get("text").and_then(|v| v.as_str()).map(str::to_string))
                    .or_else(|| buffer.as_ref().map(|b| b.text.clone()))
                    .unwrap_or_default();
                vec![NormalizedEvent::ThinkingComplete {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    full_thinking: full,
                }]
            }

            "commandExecution"
            | "fileChange"
            | "mcpToolCall"
            | "webSearch"
            | "imageView" => {
                let content = item
                    .get("aggregatedOutput")
                    .or_else(|| item.get("output"))
                    .or_else(|| item.get("result"))
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
                let is_error = status != "completed";
                vec![NormalizedEvent::ToolResult {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    tool_use_id: item_id,
                    content,
                    is_error,
                }]
            }

            "contextCompaction" => {
                // Respect the item's terminal status. A compaction can complete
                // as `failed`/`incomplete` (e.g. the server-side summarisation
                // stream dropped). Treating that as success would falsely toast
                // "compaction complete" AND clear the compacting flag without a
                // real reply — and a failed compaction doesn't shrink context,
                // so the next turn re-attempts it (the deadlock loop). Route
                // failures through ProcessError so they hit the same handling as
                // the error-notification path: the frontend's compaction-failure
                // card (`error-messages.ts`) + the compacting-flag reset in
                // `handleProcessError`. The message text deliberately contains
                // "compact"/"failed" so that catalog rule matches.
                log::info!(
                    "[codex {}] contextCompaction completed (item/completed status={status})",
                    self.session_id
                );
                if status == "completed" {
                    let pre_tokens = item.get("preTokens").and_then(|v| v.as_u64());
                    vec![NormalizedEvent::CompactComplete {
                        agent_id: AgentId::Codex,
                        session_id: self.session_id.clone(),
                        trigger: "auto".to_string(),
                        pre_tokens,
                    }]
                } else {
                    vec![NormalizedEvent::ProcessError {
                        agent_id: AgentId::Codex,
                        session_id: self.session_id.clone(),
                        error: format!(
                            "Context compaction failed (Codex reported status: {status})"
                        ),
                    }]
                }
            }

            // ── v1.4.0 ThreadItem completions ──

            // `plan` → synthesise an ExitPlanMode ToolUseStart so the
            // existing activity.ts:119-193 handler pumps the plan text
            // into uiStore.setPlanCompleteContent → PlanCompleteModal.
            // Followed by a no-error ToolResult so the activity entry
            // resolves cleanly. Schema: { id, text }.
            "plan" => {
                let text = item
                    .get("text")
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
                    .or_else(|| buffer.as_ref().map(|b| b.text.clone()))
                    .unwrap_or_default();
                vec![
                    NormalizedEvent::ToolUseStart {
                        agent_id: AgentId::Codex,
                        session_id: self.session_id.clone(),
                        tool_use_id: item_id.clone(),
                        tool_name: "ExitPlanMode".to_string(),
                        tool_input: serde_json::json!({ "plan": text }),
                    },
                    NormalizedEvent::ToolResult {
                        agent_id: AgentId::Codex,
                        session_id: self.session_id.clone(),
                        tool_use_id: item_id,
                        content: None,
                        is_error: false,
                    },
                ]
            }

            "enteredReviewMode" => {
                let review = item
                    .get("review")
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
                    .unwrap_or_default();
                vec![NormalizedEvent::ReviewModeEntered {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    item_id,
                    review,
                }]
            }

            "exitedReviewMode" => {
                let final_review = item
                    .get("review")
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
                    .unwrap_or_default();
                vec![NormalizedEvent::ReviewModeExited {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    item_id,
                    final_review,
                }]
            }

            "hookPrompt" => {
                let fragments: Vec<crate::agents::HookPromptFragment> = item
                    .get("fragments")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|f| {
                                let hook_run_id = f
                                    .get("hookRunId")
                                    .and_then(|v| v.as_str())?
                                    .to_string();
                                let text =
                                    f.get("text").and_then(|v| v.as_str())?.to_string();
                                Some(crate::agents::HookPromptFragment {
                                    hook_run_id,
                                    text,
                                })
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                if fragments.is_empty() {
                    return Vec::new();
                }
                vec![NormalizedEvent::HookPrompt {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    item_id,
                    fragments,
                }]
            }

            // imageGeneration — emit ToolResult with markdown image. The
            // chat-level result renderer's markdown pipeline already
            // renders inline images via remarkGfm. Prefer savedPath
            // (absolute local) over `result` (may be a remote URL).
            // Path safety: the frontend reads local images via
            // read_file_bytes + Object URL (no file:// to the webview).
            "imageGeneration" => {
                let saved_path = item
                    .get("savedPath")
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
                let result_url = item
                    .get("result")
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
                let target = saved_path.or(result_url).unwrap_or_default();
                let content = if target.is_empty() {
                    None
                } else {
                    Some(format!("![Generated]({target})"))
                };
                let is_error = status != "completed";
                vec![NormalizedEvent::ToolResult {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    tool_use_id: item_id,
                    content,
                    is_error,
                }]
            }

            // dynamicToolCall completion — render contentItems. Text
            // entries concatenate; inputImage entries become markdown
            // images. The MCP-like name format is already in place from
            // on_item_started so the badge renders correctly.
            "dynamicToolCall" => {
                let mut parts: Vec<String> = Vec::new();
                if let Some(items) =
                    item.get("contentItems").and_then(|v| v.as_array())
                {
                    for ci in items {
                        let kind = ci.get("type").and_then(|v| v.as_str()).unwrap_or("");
                        match kind {
                            "inputText" => {
                                if let Some(t) =
                                    ci.get("text").and_then(|v| v.as_str())
                                {
                                    parts.push(t.to_string());
                                }
                            }
                            "inputImage" => {
                                if let Some(u) =
                                    ci.get("imageUrl").and_then(|v| v.as_str())
                                {
                                    parts.push(format!("![dynamic tool output]({u})"));
                                }
                            }
                            _ => {}
                        }
                    }
                }
                let content = if parts.is_empty() { None } else { Some(parts.join("\n\n")) };
                let success = item.get("success").and_then(|v| v.as_bool());
                let is_error = match success {
                    Some(s) => !s,
                    None => status != "completed",
                };
                vec![NormalizedEvent::ToolResult {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    tool_use_id: item_id,
                    content,
                    is_error,
                }]
            }

            "collabAgentToolCall" => {
                let final_states = item
                    .get("agentsStates")
                    .cloned()
                    .unwrap_or(Value::Null);
                let summary = serde_json::to_string(&final_states).unwrap_or_default();
                let success = item
                    .get("status")
                    .and_then(|v| v.as_str())
                    .map(|s| s == "completed")
                    .unwrap_or(false);
                vec![
                    NormalizedEvent::SubAgentComplete {
                        agent_id: AgentId::Codex,
                        session_id: self.session_id.clone(),
                        tool_use_id: item_id.clone(),
                        tool_count: None,
                        token_count: None,
                    },
                    NormalizedEvent::ToolResult {
                        agent_id: AgentId::Codex,
                        session_id: self.session_id.clone(),
                        tool_use_id: item_id,
                        content: Some(format!("agents: {summary}")),
                        is_error: !success,
                    },
                ]
            }

            _ => Vec::new(),
        }
    }

    // ── Streaming deltas ──

    async fn on_agent_message_delta(&self, params: Value) -> Vec<NormalizedEvent> {
        let item_id = params
            .get("itemId")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let delta = params
            .get("delta")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if delta.is_empty() {
            return Vec::new();
        }
        if let Some(id) = &item_id {
            let mut buffers = self.state.item_buffers.lock().await;
            buffers.entry(id.clone()).or_default().append_delta(&delta);
        }
        vec![NormalizedEvent::TextDelta {
            agent_id: AgentId::Codex,
            session_id: self.session_id.clone(),
            text: delta,
        }]
    }

    async fn on_reasoning_delta(&self, params: Value) -> Vec<NormalizedEvent> {
        let item_id = params
            .get("itemId")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        // Codex sends one of several delta shapes here; tolerate any of
        // them by trying the documented field names in order.
        let delta = params
            .get("delta")
            .or_else(|| params.get("text"))
            .or_else(|| params.get("summaryPart"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if delta.is_empty() {
            return Vec::new();
        }
        if let Some(id) = &item_id {
            let mut buffers = self.state.item_buffers.lock().await;
            buffers.entry(id.clone()).or_default().append_delta(&delta);
        }
        vec![NormalizedEvent::ThinkingDelta {
            agent_id: AgentId::Codex,
            session_id: self.session_id.clone(),
            thinking: delta,
        }]
    }

    async fn on_command_output_delta(&self, params: Value) -> Vec<NormalizedEvent> {
        let item_id = params
            .get("itemId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let elapsed_seconds = params
            .get("elapsedSeconds")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        vec![NormalizedEvent::ToolProgress {
            agent_id: AgentId::Codex,
            session_id: self.session_id.clone(),
            tool_use_id: item_id,
            tool_name: "Bash".to_string(),
            elapsed_seconds,
        }]
    }

    // ── Errors (spec §2.4.7) ──

    /// Map a Codex `error` notification onto one or more frontend events.
    /// The classifier is structural: it reads `error.codexErrorInfo.type`
    /// (when present) and falls back to a generic `ProcessError` for
    /// anything unrecognised.
    pub async fn map_error(&self, params: Value) -> Vec<NormalizedEvent> {
        let error = params.get("error").unwrap_or(&params);
        let info_type = error
            .get("codexErrorInfo")
            .and_then(|i| i.get("type"))
            .and_then(|v| v.as_str())
            .map(str::to_string);
        // Tier-1 diagnostic: always log the full Codex error (type + message).
        // This is where a compaction-stream drop surfaces.
        log::warn!(
            "[codex {}] error notification: type={:?} message={:?}",
            self.session_id,
            info_type,
            error.get("message").and_then(|v| v.as_str()),
        );
        let message = error
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Codex error")
            .to_string();

        match info_type.as_deref() {
            Some("ContextWindowExceeded") | Some("UsageLimitExceeded") => {
                // Reuse the existing context-warning UI: utilization 1.0
                // says "you're out", and the existing toast renders it.
                vec![NormalizedEvent::RateLimitWarning {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    utilization: 1.0,
                    resets_at: None,
                    rate_limit_type: info_type,
                    overage_status: None,
                    is_using_overage: None,
                }]
            }
            Some("Unauthorized") => vec![NormalizedEvent::ProcessError {
                agent_id: AgentId::Codex,
                session_id: self.session_id.clone(),
                error: format!(
                    "Codex authentication expired. Run `codex login` in a terminal, then retry. ({message})"
                ),
            }],
            Some("SandboxError") => self.map_sandbox_error(error, &message).await,
            _ => vec![NormalizedEvent::ProcessError {
                agent_id: AgentId::Codex,
                session_id: self.session_id.clone(),
                error: message,
            }],
        }
    }

    /// SandboxError needs special handling: the in-flight item the
    /// sandbox denied is mid-`ToolUseStart`, and the existing
    /// `Running command...` activity entry will spin forever unless we
    /// emit a matching `ToolResult` for it. The previous implementation
    /// always emitted `ProtectedPathDeny` with a hardcoded `tool_name:
    /// "Write"`, which (a) didn't close the activity entry and (b)
    /// misrouted Bash exec denials through the protected-path toast.
    ///
    /// New behaviour:
    ///   * Look up the item by `itemId` in the in-flight buffer.
    ///   * If it's a `commandExecution`: emit a `ToolResult{is_error:
    ///     true}` for the Bash item + a `ProcessError` with an
    ///     escalation hint pointing at the policy picker.
    ///   * If it's a `fileChange`: keep the `ProtectedPathDeny` path
    ///     (Write/Edit semantics — the existing chat handler shows the
    ///     "settings file blocked" toast which is correct for writes).
    ///   * If we can't identify the item: surface a generic
    ///     `ProcessError` carrying the original Codex message.
    async fn map_sandbox_error(&self, error: &Value, message: &str) -> Vec<NormalizedEvent> {
        let item_id = error
            .get("itemId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let snapshot = if item_id.is_empty() {
            None
        } else {
            let buffers = self.state.item_buffers.lock().await;
            buffers
                .get(&item_id)
                .and_then(|b| b.last_snapshot.clone())
        };

        let item_type = snapshot
            .as_ref()
            .and_then(|s| s.get("type"))
            .and_then(|v| v.as_str())
            .map(str::to_string);

        match item_type.as_deref() {
            Some("commandExecution") => {
                let command = snapshot
                    .as_ref()
                    .and_then(|s| s.get("command"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("(unknown command)")
                    .to_string();
                let toast = format!(
                    "Sandbox denied `{command}`. Codex can't reach the host \
                     for this command. Switch the Policy pill to \
                     `workspace-write · on-failure` or `danger-full-access` \
                     to allow it, then retry. ({message})"
                );
                vec![
                    // Close the spinning activity entry first — without
                    // this the "Running command..." indicator stays on
                    // forever (defect #2 of the Codex-stuck bug).
                    NormalizedEvent::ToolResult {
                        agent_id: AgentId::Codex,
                        session_id: self.session_id.clone(),
                        tool_use_id: item_id,
                        content: Some(format!(
                            "Sandbox denied: {message}\n\nCommand: {command}\n\n\
                             Hint: switch Policy to `workspace-write · on-failure` \
                             or `danger-full-access` if you want Codex to run this."
                        )),
                        is_error: true,
                    },
                    // Plus a chat-channel toast so the failure is
                    // visible even if the user has the Files panel open
                    // instead of the Activity feed.
                    NormalizedEvent::ProcessError {
                        agent_id: AgentId::Codex,
                        session_id: self.session_id.clone(),
                        error: toast,
                    },
                ]
            }
            Some("fileChange") => {
                let path = error
                    .get("path")
                    .and_then(|v| v.as_str())
                    .or_else(|| {
                        snapshot
                            .as_ref()
                            .and_then(|s| s.get("path"))
                            .and_then(|v| v.as_str())
                    })
                    .unwrap_or("")
                    .to_string();
                vec![NormalizedEvent::ProtectedPathDeny {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    denials: vec![PermissionDenial {
                        tool_name: "Write".to_string(),
                        tool_use_id: item_id,
                        tool_input: serde_json::json!({"file_path": path}),
                    }],
                }]
            }
            _ => {
                // Unknown item type or no item lookup possible. Surface
                // a generic error so the user at least sees something.
                vec![NormalizedEvent::ProcessError {
                    agent_id: AgentId::Codex,
                    session_id: self.session_id.clone(),
                    error: format!("Codex sandbox denied an operation: {message}"),
                }]
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn translator() -> Translator {
        Translator::new("s1".into(), Arc::new(ThreadState::new()))
    }

    fn extract_session_id(ev: &NormalizedEvent) -> &str {
        // Helper for tests: every variant carries a session_id; serde to
        // value to extract uniformly.
        let v = serde_json::to_value(ev).unwrap();
        v["session_id"].as_str().unwrap_or("").to_string().leak()
    }

    // ── lifecycle ──

    #[tokio::test]
    async fn thread_started_emits_cli_session_id_and_stores_thread_id() {
        let t = translator();
        let events = t
            .on_notification(
                "thread/started",
                json!({"thread": {"id": "thr_abc", "path": null}}),
            )
            .await;
        assert_eq!(events.len(), 1);
        match &events[0] {
            NormalizedEvent::CliSessionId { cli_session_id, agent_id, .. } => {
                assert_eq!(cli_session_id, "thr_abc");
                assert_eq!(*agent_id, AgentId::Codex);
            }
            other => panic!("expected CliSessionId, got {:?}", other),
        }
        assert_eq!(
            t.state.thread_id.lock().await.as_deref(),
            Some("thr_abc")
        );
    }

    #[tokio::test]
    async fn turn_started_records_turn_id_and_emits_nothing() {
        let t = translator();
        let events = t
            .on_notification("turn/started", json!({"turn": {"id": "turn_1"}}))
            .await;
        assert!(events.is_empty());
        assert_eq!(
            t.state.current_turn_id.lock().await.as_deref(),
            Some("turn_1")
        );
    }

    #[tokio::test]
    async fn turn_completed_emits_turn_complete_and_clears_active_turn() {
        let t = translator();
        t.state.set_current_turn(Some("turn_1".into())).await;
        let events = t
            .on_notification(
                "turn/completed",
                json!({"turn": {"id": "turn_1", "status": "completed", "model": "gpt-5.1-codex", "durationMs": 1234}}),
            )
            .await;
        assert_eq!(events.len(), 1);
        match &events[0] {
            NormalizedEvent::TurnComplete {
                stop_reason,
                model_name,
                duration_ms,
                terminal_reason,
                ..
            } => {
                assert_eq!(stop_reason.as_deref(), Some("completed"));
                assert_eq!(model_name.as_deref(), Some("gpt-5.1-codex"));
                assert_eq!(*duration_ms, Some(1234));
                assert!(terminal_reason.is_none());
            }
            other => panic!("expected TurnComplete, got {:?}", other),
        }
        assert!(t.state.current_turn_id.lock().await.is_none());
    }

    #[tokio::test]
    async fn interrupted_turn_marks_terminal_reason() {
        let t = translator();
        let events = t
            .on_notification(
                "turn/completed",
                json!({"turn": {"id": "t", "status": "interrupted"}}),
            )
            .await;
        let NormalizedEvent::TurnComplete { terminal_reason, .. } = &events[0] else {
            panic!("not TurnComplete");
        };
        assert_eq!(terminal_reason.as_deref(), Some("aborted_streaming"));
    }

    // ── item/started ──

    #[tokio::test]
    async fn user_message_item_emits_nothing() {
        let t = translator();
        let events = t
            .on_notification(
                "item/started",
                json!({"item": {"type": "userMessage", "id": "i_1"}}),
            )
            .await;
        assert!(events.is_empty());
    }

    #[tokio::test]
    async fn agent_message_started_buffers_but_emits_nothing() {
        let t = translator();
        let events = t
            .on_notification(
                "item/started",
                json!({"item": {"type": "agentMessage", "id": "i_2"}}),
            )
            .await;
        assert!(events.is_empty());
        let buffers = t.state.item_buffers.lock().await;
        assert!(buffers.contains_key("i_2"));
    }

    #[tokio::test]
    async fn command_execution_started_emits_bash_tool_use() {
        let t = translator();
        let events = t
            .on_notification(
                "item/started",
                json!({"item": {
                    "type": "commandExecution",
                    "id": "i_cmd",
                    "command": "ls -la",
                    "cwd": "/tmp"
                }}),
            )
            .await;
        assert_eq!(events.len(), 1);
        match &events[0] {
            NormalizedEvent::ToolUseStart {
                tool_name,
                tool_input,
                tool_use_id,
                ..
            } => {
                assert_eq!(tool_name, "Bash");
                assert_eq!(tool_use_id, "i_cmd");
                assert_eq!(tool_input["command"], "ls -la");
                assert_eq!(tool_input["cwd"], "/tmp");
            }
            other => panic!("expected ToolUseStart, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn file_change_create_uses_write_tool() {
        let t = translator();
        let events = t
            .on_notification(
                "item/started",
                json!({"item": {
                    "type": "fileChange",
                    "id": "i_fc",
                    "path": "/p/new.rs",
                    "changeKind": "create",
                    "diff": {"added": ["fn main(){}"]},
                }}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::ToolUseStart { tool_name, tool_input, .. } => {
                assert_eq!(tool_name, "Write");
                assert_eq!(tool_input["path"], "/p/new.rs");
            }
            other => panic!("expected ToolUseStart, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn file_change_default_uses_edit_tool() {
        let t = translator();
        let events = t
            .on_notification(
                "item/started",
                json!({"item": {"type": "fileChange", "id": "i_e", "path": "/p/x"}}),
            )
            .await;
        let NormalizedEvent::ToolUseStart { tool_name, .. } = &events[0] else {
            panic!()
        };
        assert_eq!(tool_name, "Edit");
    }

    #[tokio::test]
    async fn mcp_tool_call_namespaces_tool_name() {
        let t = translator();
        let events = t
            .on_notification(
                "item/started",
                json!({"item": {
                    "type": "mcpToolCall",
                    "id": "i_m",
                    "serverName": "context7",
                    "toolName": "query-docs",
                    "arguments": {"q": "tauri"}
                }}),
            )
            .await;
        let NormalizedEvent::ToolUseStart { tool_name, tool_input, .. } = &events[0] else {
            panic!()
        };
        // Claude-compatible double-underscore convention so ActivityFeed
        // formats it as "context7: query-docs" via its mcp__ branch.
        assert_eq!(tool_name, "mcp__context7__query-docs");
        assert_eq!(tool_input["q"], "tauri");
    }

    #[tokio::test]
    async fn web_search_emits_websearch_tool_use() {
        let t = translator();
        let events = t
            .on_notification(
                "item/started",
                json!({"item": {"type": "webSearch", "id": "i_w", "query": "rust async-trait"}}),
            )
            .await;
        let NormalizedEvent::ToolUseStart { tool_name, tool_input, .. } = &events[0] else {
            panic!()
        };
        assert_eq!(tool_name, "WebSearch");
        assert_eq!(tool_input["query"], "rust async-trait");
    }

    #[tokio::test]
    async fn image_view_emits_read_tool_use() {
        let t = translator();
        let events = t
            .on_notification(
                "item/started",
                json!({"item": {"type": "imageView", "id": "i_iv", "filePath": "/tmp/a.png"}}),
            )
            .await;
        let NormalizedEvent::ToolUseStart { tool_name, tool_input, .. } = &events[0] else {
            panic!()
        };
        assert_eq!(tool_name, "Read");
        assert_eq!(tool_input["file_path"], "/tmp/a.png");
    }

    #[tokio::test]
    async fn context_compaction_started_emits_compacting_status() {
        let t = translator();
        let events = t
            .on_notification(
                "item/started",
                json!({"item": {"type": "contextCompaction", "id": "i_cc"}}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::CompactingStatus { is_compacting, .. } => {
                assert!(*is_compacting);
            }
            other => panic!("expected CompactingStatus, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn item_started_unknown_type_is_no_op() {
        let t = translator();
        let events = t
            .on_notification(
                "item/started",
                json!({"item": {"type": "someUnknownFutureType", "id": "i_p"}}),
            )
            .await;
        assert!(events.is_empty());
    }

    // ── deltas ──

    #[tokio::test]
    async fn agent_message_delta_emits_text_delta_and_buffers() {
        let t = translator();
        let events = t
            .on_notification(
                "item/agentMessage/delta",
                json!({"itemId": "i_2", "delta": "hello"}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::TextDelta { text, .. } => assert_eq!(text, "hello"),
            other => panic!("expected TextDelta, got {:?}", other),
        }
        let buffers = t.state.item_buffers.lock().await;
        assert_eq!(buffers.get("i_2").unwrap().text, "hello");
    }

    #[tokio::test]
    async fn empty_delta_is_dropped() {
        let t = translator();
        let events = t
            .on_notification(
                "item/agentMessage/delta",
                json!({"itemId": "i_2", "delta": ""}),
            )
            .await;
        assert!(events.is_empty());
    }

    #[tokio::test]
    async fn reasoning_delta_uses_thinking_delta() {
        let t = translator();
        let events = t
            .on_notification(
                "item/reasoning/summaryTextDelta",
                json!({"itemId": "i_r", "delta": "thought"}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::ThinkingDelta { thinking, .. } => assert_eq!(thinking, "thought"),
            other => panic!("expected ThinkingDelta, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn command_output_delta_emits_tool_progress() {
        let t = translator();
        let events = t
            .on_notification(
                "item/commandExecution/outputDelta",
                json!({"itemId": "i_cmd", "elapsedSeconds": 1.5, "chunk": "stdout"}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::ToolProgress {
                tool_use_id,
                tool_name,
                elapsed_seconds,
                ..
            } => {
                assert_eq!(tool_use_id, "i_cmd");
                assert_eq!(tool_name, "Bash");
                assert!((*elapsed_seconds - 1.5).abs() < f64::EPSILON);
            }
            other => panic!("expected ToolProgress, got {:?}", other),
        }
    }

    // ── item/completed ──

    #[tokio::test]
    async fn agent_message_completed_emits_text_complete_with_full_text() {
        let t = translator();
        // Stream three deltas, then complete with explicit final text.
        t.on_notification("item/agentMessage/delta", json!({"itemId": "i_2", "delta": "a"})).await;
        t.on_notification("item/agentMessage/delta", json!({"itemId": "i_2", "delta": "b"})).await;
        let events = t
            .on_notification(
                "item/completed",
                json!({"item": {"type": "agentMessage", "id": "i_2", "text": "ab"}}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::TextComplete { full_text, .. } => assert_eq!(full_text, "ab"),
            other => panic!("expected TextComplete, got {:?}", other),
        }
        // Buffer should be cleared.
        assert!(t.state.item_buffers.lock().await.get("i_2").is_none());
    }

    #[tokio::test]
    async fn agent_message_completed_falls_back_to_buffered_text() {
        let t = translator();
        t.on_notification("item/agentMessage/delta", json!({"itemId": "i_2", "delta": "via-buffer"}))
            .await;
        // Snapshot lacks final `text` field — translator must use the
        // accumulated buffer.
        let events = t
            .on_notification(
                "item/completed",
                json!({"item": {"type": "agentMessage", "id": "i_2"}}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::TextComplete { full_text, .. } => {
                assert_eq!(full_text, "via-buffer")
            }
            other => panic!("got {:?}", other),
        }
    }

    #[tokio::test]
    async fn command_execution_completed_marks_is_error_on_non_completed_status() {
        let t = translator();
        let events = t
            .on_notification(
                "item/completed",
                json!({"item": {
                    "type": "commandExecution",
                    "id": "i_cmd",
                    "status": "failed",
                    "aggregatedOutput": "permission denied",
                }}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::ToolResult {
                tool_use_id,
                content,
                is_error,
                ..
            } => {
                assert_eq!(tool_use_id, "i_cmd");
                assert_eq!(content.as_deref(), Some("permission denied"));
                assert!(*is_error);
            }
            other => panic!("got {:?}", other),
        }
    }

    #[tokio::test]
    async fn command_execution_completed_clear_is_error_on_completed_status() {
        let t = translator();
        let events = t
            .on_notification(
                "item/completed",
                json!({"item": {
                    "type": "commandExecution",
                    "id": "i_ok",
                    "status": "completed",
                    "aggregatedOutput": "total 0",
                }}),
            )
            .await;
        let NormalizedEvent::ToolResult { is_error, .. } = &events[0] else {
            panic!()
        };
        assert!(!*is_error);
    }

    #[tokio::test]
    async fn context_compaction_completed_emits_compact_complete() {
        let t = translator();
        let events = t
            .on_notification(
                "item/completed",
                json!({"item": {"type": "contextCompaction", "id": "i_cc", "preTokens": 1234}}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::CompactComplete {
                trigger,
                pre_tokens,
                ..
            } => {
                assert_eq!(trigger, "auto");
                assert_eq!(*pre_tokens, Some(1234));
            }
            other => panic!("got {:?}", other),
        }
    }

    #[tokio::test]
    async fn context_compaction_failed_emits_process_error_not_false_complete() {
        // Regression: a contextCompaction item that completes with a non-success
        // status must NOT masquerade as a successful CompactComplete (which would
        // falsely toast "compaction complete" and clear the compacting flag
        // without a real reply). It must surface as a ProcessError so the
        // frontend shows the compaction-failure card and resets the flag.
        let t = translator();
        let events = t
            .on_notification(
                "item/completed",
                json!({"item": {"type": "contextCompaction", "id": "i_cc", "status": "failed"}}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::ProcessError { error, .. } => {
                // Message must match the frontend's compaction-failure catalog
                // rule (`compact` + `failed`).
                let lower = error.to_lowercase();
                assert!(lower.contains("compact"), "got {error:?}");
                assert!(lower.contains("failed"), "got {error:?}");
            }
            other => panic!("expected ProcessError, got {:?}", other),
        }
    }

    // ── errors ──

    #[tokio::test]
    async fn error_context_window_exceeded_emits_rate_limit_warning() {
        let t = translator();
        let events = t
            .on_notification(
                "error",
                json!({"error": {
                    "message": "out of context",
                    "codexErrorInfo": {"type": "ContextWindowExceeded"},
                }}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::RateLimitWarning {
                utilization,
                rate_limit_type,
                ..
            } => {
                assert!((utilization - 1.0).abs() < f64::EPSILON);
                assert_eq!(rate_limit_type.as_deref(), Some("ContextWindowExceeded"));
            }
            other => panic!("got {:?}", other),
        }
    }

    #[tokio::test]
    async fn error_unauthorized_emits_process_error_with_login_hint() {
        let t = translator();
        let events = t
            .on_notification(
                "error",
                json!({"error": {
                    "message": "token expired",
                    "codexErrorInfo": {"type": "Unauthorized"},
                }}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::ProcessError { error, .. } => {
                assert!(error.contains("codex login"), "got: {error}");
                assert!(error.contains("token expired"));
            }
            other => panic!("got {:?}", other),
        }
    }

    #[tokio::test]
    async fn error_sandbox_for_file_change_synthesises_protected_path_deny() {
        let t = translator();
        // Pre-register the in-flight item so the translator knows the
        // sandbox denial was a write, not a Bash exec.
        t.on_notification(
            "item/started",
            json!({"item": {
                "id": "i_x",
                "type": "fileChange",
                "path": ".codex/forbidden",
                "changeKind": "update",
            }}),
        )
        .await;
        let events = t
            .map_error(json!({"error": {
                "message": "blocked",
                "path": ".codex/forbidden",
                "itemId": "i_x",
                "codexErrorInfo": {"type": "SandboxError"},
            }}))
            .await;
        match &events[0] {
            NormalizedEvent::ProtectedPathDeny { denials, .. } => {
                assert_eq!(denials.len(), 1);
                assert_eq!(denials[0].tool_name, "Write");
                assert_eq!(denials[0].tool_input["file_path"], ".codex/forbidden");
            }
            other => panic!("got {:?}", other),
        }
    }

    #[tokio::test]
    async fn error_sandbox_for_command_execution_closes_tool_use_and_emits_toast() {
        // Defect #2 of the Codex-stuck bug: previously, a SandboxError
        // for a `commandExecution` item misclassified as a write deny
        // and never emitted a ToolResult, so the activity bar stayed at
        // "Running command..." forever. The fix: emit ToolResult{is_error}
        // for the in-flight Bash item + a ProcessError toast with an
        // escalation hint pointing at the Policy pill.
        let t = translator();
        t.on_notification(
            "item/started",
            json!({"item": {
                "id": "i_bash",
                "type": "commandExecution",
                "command": "docker compose ps",
                "cwd": "/Users/me/project",
            }}),
        )
        .await;
        let events = t
            .map_error(json!({"error": {
                "message": "permission denied while trying to connect to the docker API",
                "itemId": "i_bash",
                "codexErrorInfo": {"type": "SandboxError"},
            }}))
            .await;
        assert_eq!(events.len(), 2, "expect ToolResult + ProcessError");
        match &events[0] {
            NormalizedEvent::ToolResult {
                tool_use_id,
                is_error,
                content,
                ..
            } => {
                assert_eq!(tool_use_id, "i_bash");
                assert!(is_error);
                let c = content.as_deref().unwrap_or("");
                assert!(c.contains("Sandbox denied"));
                assert!(c.contains("docker compose ps"));
                // Hint must mention the policy switch so users have an
                // actionable next step.
                assert!(c.contains("workspace-write") || c.contains("danger-full-access"));
            }
            other => panic!("expected ToolResult first, got {:?}", other),
        }
        match &events[1] {
            NormalizedEvent::ProcessError { error, .. } => {
                assert!(error.contains("docker compose ps"));
                assert!(error.contains("Policy"));
            }
            other => panic!("expected ProcessError second, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn error_sandbox_with_unknown_item_falls_back_to_process_error() {
        let t = translator();
        // No item registered → translator can't tell what was denied;
        // surface a generic ProcessError so the user at least sees a
        // toast and isn't stuck wondering.
        let events = t
            .map_error(json!({"error": {
                "message": "denied",
                "itemId": "i_missing",
                "codexErrorInfo": {"type": "SandboxError"},
            }}))
            .await;
        match &events[0] {
            NormalizedEvent::ProcessError { error, .. } => {
                assert!(error.contains("sandbox denied"));
                assert!(error.contains("denied"));
            }
            other => panic!("got {:?}", other),
        }
    }

    #[tokio::test]
    async fn error_unknown_kind_emits_generic_process_error() {
        let t = translator();
        let events = t
            .on_notification(
                "error",
                json!({"error": {"message": "wat"}}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::ProcessError { error, .. } => assert_eq!(error, "wat"),
            other => panic!("got {:?}", other),
        }
    }

    #[tokio::test]
    async fn unknown_notification_method_is_silently_ignored() {
        let t = translator();
        let events = t.on_notification("future/event", json!({})).await;
        assert!(events.is_empty());
    }

    // ── general ──

    #[tokio::test]
    async fn every_emitted_event_carries_codex_agent_id() {
        // Sample one from each emit-path to catch typos in agent_id.
        let t = translator();
        for events in [
            t.on_notification("thread/started", json!({"thread": {"id": "thr_1"}})).await,
            t.on_notification("item/started", json!({"item": {"type": "commandExecution", "id": "i", "command": "x", "cwd": "/"}})).await,
            t.on_notification("item/agentMessage/delta", json!({"itemId": "i", "delta": "y"})).await,
            t.on_notification("error", json!({"error": {"message": "z"}})).await,
        ] {
            for ev in &events {
                let v = serde_json::to_value(ev).unwrap();
                assert_eq!(v["agent_id"], "codex", "wrong agent_id on {:?}", ev);
            }
        }
        let _ = extract_session_id; // silence dead-code lint on the helper
    }

    // ── v1.4.0 ThreadItem types ──

    // ── v1.4.1 Phase B.2 — MCP startup + rate limits ──

    #[tokio::test]
    async fn mcp_startup_status_failed_emits_event() {
        let t = translator();
        let events = t
            .on_notification(
                "mcpServer/startupStatus/updated",
                json!({"name": "postgres", "status": "failed", "error": "config bad"}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::McpStartupStatus { name, status, error, .. } => {
                assert_eq!(name, "postgres");
                assert_eq!(status, "failed");
                assert_eq!(error.as_deref(), Some("config bad"));
            }
            other => panic!("expected McpStartupStatus, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn mcp_startup_status_cancelled_emits_event() {
        let t = translator();
        let events = t
            .on_notification(
                "mcpServer/startupStatus/updated",
                json!({"name": "github", "status": "cancelled", "error": null}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::McpStartupStatus { status, error, .. } => {
                assert_eq!(status, "cancelled");
                assert!(error.is_none());
            }
            other => panic!("expected McpStartupStatus, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn mcp_startup_status_starting_or_ready_is_no_op() {
        // Silent transitions — would be too noisy as toasts.
        let t = translator();
        for status in ["starting", "ready"] {
            let events = t
                .on_notification(
                    "mcpServer/startupStatus/updated",
                    json!({"name": "x", "status": status, "error": null}),
                )
                .await;
            assert!(events.is_empty(), "expected no event for status={status}");
        }
    }

    #[tokio::test]
    async fn rate_limits_updated_emits_warning_above_threshold() {
        // Primary at 90% triggers a RateLimitWarning.
        let t = translator();
        let events = t
            .on_notification(
                "account/rateLimits/updated",
                json!({
                    "rateLimits": {
                        "primary": {"usedPercent": 90, "resetsAt": 1779999999, "windowDurationMins": 60},
                        "secondary": {"usedPercent": 12, "resetsAt": null, "windowDurationMins": null},
                        "credits": {"hasCredits": true, "unlimited": false, "balance": "$5"},
                        "planType": "plus",
                        "limitId": null,
                        "limitName": null,
                        "rateLimitReachedType": null,
                    }
                }),
            )
            .await;
        match &events[0] {
            NormalizedEvent::RateLimitWarning { utilization, resets_at, .. } => {
                // 90 / 100 = 0.9
                assert!((utilization - 0.9).abs() < 1e-6);
                // Higher of the two windows is primary at 90%, so its resetsAt.
                assert_eq!(*resets_at, Some(1779999999.0));
            }
            other => panic!("expected RateLimitWarning, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn rate_limits_updated_silent_below_threshold() {
        let t = translator();
        let events = t
            .on_notification(
                "account/rateLimits/updated",
                json!({
                    "rateLimits": {
                        "primary": {"usedPercent": 30, "resetsAt": null, "windowDurationMins": null},
                        "secondary": {"usedPercent": 5, "resetsAt": null, "windowDurationMins": null},
                        "rateLimitReachedType": null,
                    }
                }),
            )
            .await;
        assert!(events.is_empty());
    }

    #[tokio::test]
    async fn rate_limits_updated_emits_when_reached_type_set() {
        // Even at 0% the explicit reachedType triggers a warning.
        let t = translator();
        let events = t
            .on_notification(
                "account/rateLimits/updated",
                json!({
                    "rateLimits": {
                        "primary": {"usedPercent": 0, "resetsAt": null, "windowDurationMins": null},
                        "rateLimitReachedType": "workspace_owner_credits_depleted",
                    }
                }),
            )
            .await;
        match &events[0] {
            NormalizedEvent::RateLimitWarning { rate_limit_type, .. } => {
                assert_eq!(
                    rate_limit_type.as_deref(),
                    Some("workspace_owner_credits_depleted")
                );
            }
            other => panic!("expected RateLimitWarning, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn token_usage_updated_emits_usage_update_with_reasoning_tokens() {
        // Empirical Codex 0.130.0 payload — `last` carries the delta,
        // `total` is the running thread sum. We forward `last` so the
        // frontend accumulator doesn't double-count across notifications.
        let t = translator();
        let events = t
            .on_notification(
                "thread/tokenUsage/updated",
                json!({
                    "threadId": "thr_1",
                    "turnId": "turn_1",
                    "tokenUsage": {
                        "last": {
                            "cachedInputTokens": 12160,
                            "inputTokens": 13374,
                            "outputTokens": 73,
                            "reasoningOutputTokens": 40,
                            "totalTokens": 13447,
                        },
                        "total": {
                            "cachedInputTokens": 12160,
                            "inputTokens": 13374,
                            "outputTokens": 73,
                            "reasoningOutputTokens": 40,
                            "totalTokens": 13447,
                        },
                        "modelContextWindow": 200000,
                    },
                }),
            )
            .await;
        match &events[0] {
            NormalizedEvent::UsageUpdate { usage, .. } => {
                assert_eq!(usage.input_tokens, Some(13374));
                assert_eq!(usage.output_tokens, Some(73));
                assert_eq!(usage.cache_read_input_tokens, Some(12160));
                assert_eq!(usage.reasoning_output_tokens, Some(40));
            }
            other => panic!("expected UsageUpdate, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn token_usage_updated_missing_last_is_no_op() {
        let t = translator();
        let events = t
            .on_notification(
                "thread/tokenUsage/updated",
                json!({"threadId": "thr_1", "turnId": "turn_1"}),
            )
            .await;
        assert!(events.is_empty());
    }

    #[tokio::test]
    async fn reasoning_completed_reads_array_fields() {
        // Empirical: Codex 0.130.0 emits reasoning ThreadItems with
        // `summary: []` and `content: []` (text-hidden by design). When
        // a future version DOES populate them, our handler must read
        // them as arrays rather than scalars. Regression test: the
        // pre-hotfix-#16 code called `.as_str()` on `summary`, which
        // silently fell through to the empty fallback even if a string
        // array was present.
        let t = translator();
        let events = t
            .on_notification(
                "item/completed",
                json!({"item": {
                    "type": "reasoning",
                    "id": "rs_x",
                    "summary": ["First, I considered…", "Then I weighed…"],
                    "content": [],
                    "status": "completed",
                }}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::ThinkingComplete { full_thinking, .. } => {
                assert!(full_thinking.contains("First, I considered"));
                assert!(full_thinking.contains("Then I weighed"));
            }
            other => panic!("expected ThinkingComplete, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn reasoning_completed_prefers_content_array_over_summary() {
        // When both are non-empty, content carries the full text and
        // summary is a higher-level synopsis; we surface the richer
        // signal.
        let t = translator();
        let events = t
            .on_notification(
                "item/completed",
                json!({"item": {
                    "type": "reasoning",
                    "id": "rs_x",
                    "summary": ["one-line synopsis"],
                    "content": ["paragraph 1", "paragraph 2"],
                    "status": "completed",
                }}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::ThinkingComplete { full_thinking, .. } => {
                assert!(full_thinking.contains("paragraph 1"));
                assert!(full_thinking.contains("paragraph 2"));
                assert!(!full_thinking.contains("one-line synopsis"));
            }
            other => panic!("expected ThinkingComplete, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn reasoning_completed_empty_arrays_emit_blank_thinking_complete() {
        // The current empirical shape: both arrays present but empty.
        // We still emit ThinkingComplete (the lifecycle event) so the
        // store flips off the isThinking flag; full_thinking is "".
        let t = translator();
        let events = t
            .on_notification(
                "item/completed",
                json!({"item": {
                    "type": "reasoning",
                    "id": "rs_x",
                    "summary": [],
                    "content": [],
                    "status": "completed",
                }}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::ThinkingComplete { full_thinking, .. } => {
                assert_eq!(full_thinking, "");
            }
            other => panic!("expected ThinkingComplete, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn plan_item_completed_emits_synthetic_exit_plan_mode() {
        // Plan items reuse the Claude ExitPlanMode → PlanCompleteModal
        // pipeline. Translator emits ToolUseStart + a no-error ToolResult
        // so the existing activity.ts handler picks up tool_input.plan.
        let t = translator();
        let events = t
            .on_notification(
                "item/completed",
                json!({"item": {
                    "type": "plan",
                    "id": "i_plan",
                    "text": "1. Add X\n2. Test X\n3. Ship X",
                    "status": "completed",
                }}),
            )
            .await;
        assert_eq!(events.len(), 2);
        match &events[0] {
            NormalizedEvent::ToolUseStart { tool_name, tool_input, .. } => {
                assert_eq!(tool_name, "ExitPlanMode");
                assert_eq!(tool_input["plan"], "1. Add X\n2. Test X\n3. Ship X");
            }
            other => panic!("expected ToolUseStart, got {:?}", other),
        }
        match &events[1] {
            NormalizedEvent::ToolResult { is_error, .. } => {
                assert!(!is_error);
            }
            other => panic!("expected ToolResult, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn entered_review_mode_completed_emits_review_mode_entered() {
        let t = translator();
        let events = t
            .on_notification(
                "item/completed",
                json!({"item": {
                    "type": "enteredReviewMode",
                    "id": "i_er",
                    "review": "Reviewing changes to foo.rs",
                    "status": "completed",
                }}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::ReviewModeEntered { item_id, review, .. } => {
                assert_eq!(item_id, "i_er");
                assert_eq!(review, "Reviewing changes to foo.rs");
            }
            other => panic!("expected ReviewModeEntered, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn exited_review_mode_completed_emits_review_mode_exited() {
        let t = translator();
        let events = t
            .on_notification(
                "item/completed",
                json!({"item": {
                    "type": "exitedReviewMode",
                    "id": "i_ex",
                    "review": "Review summary: looks good.",
                    "status": "completed",
                }}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::ReviewModeExited { item_id, final_review, .. } => {
                assert_eq!(item_id, "i_ex");
                assert_eq!(final_review, "Review summary: looks good.");
            }
            other => panic!("expected ReviewModeExited, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn thread_settings_updated_plan_mode_emits_enabled() {
        let t = translator();
        let events = t
            .on_notification(
                "thread/settings/updated",
                json!({
                    "threadId": "thr_abc",
                    "threadSettings": {
                        "collaborationMode": { "mode": "plan", "settings": {} }
                    }
                }),
            )
            .await;
        assert_eq!(events.len(), 1);
        match &events[0] {
            NormalizedEvent::CodexPlanModeChanged { enabled, agent_id, .. } => {
                assert!(*enabled);
                assert_eq!(*agent_id, AgentId::Codex);
            }
            other => panic!("expected CodexPlanModeChanged, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn thread_settings_updated_default_mode_emits_disabled() {
        let t = translator();
        let events = t
            .on_notification(
                "thread/settings/updated",
                json!({
                    "threadId": "thr_abc",
                    "threadSettings": {
                        "collaborationMode": { "mode": "default", "settings": {} }
                    }
                }),
            )
            .await;
        assert_eq!(events.len(), 1);
        match &events[0] {
            NormalizedEvent::CodexPlanModeChanged { enabled, .. } => assert!(!*enabled),
            other => panic!("expected CodexPlanModeChanged, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn thread_settings_updated_without_collaboration_mode_emits_nothing() {
        let t = translator();
        let events = t
            .on_notification(
                "thread/settings/updated",
                json!({ "threadId": "thr_abc", "threadSettings": { "model": "gpt-5" } }),
            )
            .await;
        assert!(events.is_empty());
    }

    #[tokio::test]
    async fn hook_prompt_completed_emits_hook_prompt_with_fragments() {
        let t = translator();
        let events = t
            .on_notification(
                "item/completed",
                json!({"item": {
                    "type": "hookPrompt",
                    "id": "i_hp",
                    "fragments": [
                        {"hookRunId": "r1", "text": "extra context"},
                        {"hookRunId": "r2", "text": "more context"},
                    ],
                    "status": "completed",
                }}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::HookPrompt { fragments, .. } => {
                assert_eq!(fragments.len(), 2);
                assert_eq!(fragments[0].hook_run_id, "r1");
                assert_eq!(fragments[1].text, "more context");
            }
            other => panic!("expected HookPrompt, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn hook_lifecycle_emits_hook_status() {
        // Hook started + hook completed are RPC-level (separate from
        // ThreadItem `hookPrompt`). Both produce HookStatus.
        let t = translator();
        let started = t
            .on_notification(
                "hook/started",
                json!({
                    "run": {
                        "id": "run_1",
                        "eventName": "preToolUse",
                        "status": "running",
                        "durationMs": null,
                    },
                    "threadId": "thr_1",
                }),
            )
            .await;
        match &started[0] {
            NormalizedEvent::HookStatus { run_id, event_name, kind, status, .. } => {
                assert_eq!(run_id, "run_1");
                assert_eq!(event_name, "preToolUse");
                assert_eq!(kind, "started");
                assert_eq!(status, "running");
            }
            other => panic!("expected HookStatus, got {:?}", other),
        }
        let completed = t
            .on_notification(
                "hook/completed",
                json!({
                    "run": {
                        "id": "run_1",
                        "eventName": "preToolUse",
                        "status": "completed",
                        "durationMs": 42,
                    },
                    "threadId": "thr_1",
                }),
            )
            .await;
        match &completed[0] {
            NormalizedEvent::HookStatus { kind, status, duration_ms, .. } => {
                assert_eq!(kind, "completed");
                assert_eq!(status, "completed");
                assert_eq!(*duration_ms, Some(42));
            }
            other => panic!("expected HookStatus, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn dynamic_tool_call_started_uses_dyn_prefix() {
        let t = translator();
        let events = t
            .on_notification(
                "item/started",
                json!({"item": {
                    "type": "dynamicToolCall",
                    "id": "i_dyn",
                    "tool": "calculate",
                    "namespace": "mathkit",
                    "arguments": {"x": 1},
                    "status": "inProgress",
                }}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::ToolUseStart { tool_name, tool_input, .. } => {
                // Claude-style namespacing so event-classifier / ActivityFeed
                // format the badge as "mathkit: calculate".
                assert_eq!(tool_name, "dyn__mathkit__calculate");
                assert_eq!(tool_input["x"], 1);
            }
            other => panic!("expected ToolUseStart, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn dynamic_tool_call_started_without_namespace() {
        let t = translator();
        let events = t
            .on_notification(
                "item/started",
                json!({"item": {
                    "type": "dynamicToolCall",
                    "id": "i_dyn",
                    "tool": "ping",
                    "arguments": {},
                    "status": "inProgress",
                }}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::ToolUseStart { tool_name, .. } => {
                assert_eq!(tool_name, "dyn__ping");
            }
            other => panic!("expected ToolUseStart, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn dynamic_tool_call_completed_renders_content_items() {
        let t = translator();
        let events = t
            .on_notification(
                "item/completed",
                json!({"item": {
                    "type": "dynamicToolCall",
                    "id": "i_dyn",
                    "tool": "ping",
                    "arguments": {},
                    "status": "completed",
                    "success": true,
                    "contentItems": [
                        {"type": "inputText", "text": "pong"},
                        {"type": "inputImage", "imageUrl": "https://cdn/img.png"},
                    ],
                }}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::ToolResult { content, is_error, .. } => {
                let body = content.as_ref().expect("content");
                assert!(body.contains("pong"));
                assert!(body.contains("![dynamic tool output](https://cdn/img.png)"));
                assert!(!is_error);
            }
            other => panic!("expected ToolResult, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn image_generation_started_emits_tool_use_start() {
        let t = translator();
        let events = t
            .on_notification(
                "item/started",
                json!({"item": {
                    "type": "imageGeneration",
                    "id": "i_ig",
                    "result": "",
                    "status": "inProgress",
                    "revisedPrompt": "an orange cat",
                }}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::ToolUseStart { tool_name, tool_input, .. } => {
                assert_eq!(tool_name, "ImageGeneration");
                assert_eq!(tool_input["revisedPrompt"], "an orange cat");
            }
            other => panic!("expected ToolUseStart, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn image_generation_completed_renders_markdown_image_from_saved_path() {
        // Prefer savedPath (absolute local) over result URL — the frontend
        // serves local images via read_file_bytes Object URLs.
        let t = translator();
        let events = t
            .on_notification(
                "item/completed",
                json!({"item": {
                    "type": "imageGeneration",
                    "id": "i_ig",
                    "result": "https://cdn/img.png",
                    "savedPath": "/Users/hr/.codex/images/gen.png",
                    "status": "completed",
                }}),
            )
            .await;
        match &events[0] {
            NormalizedEvent::ToolResult { content, is_error, .. } => {
                let body = content.as_ref().expect("content");
                assert_eq!(body, "![Generated](/Users/hr/.codex/images/gen.png)");
                assert!(!is_error);
            }
            other => panic!("expected ToolResult, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn collab_agent_tool_call_started_emits_sub_agent_pair() {
        // Observed-only per Phase 2 anti-goal: surface via existing
        // sub-agent activity-feed treatment, no steering UI.
        let t = translator();
        let events = t
            .on_notification(
                "item/started",
                json!({"item": {
                    "type": "collabAgentToolCall",
                    "id": "i_collab",
                    "senderThreadId": "thr_parent",
                    "receiverThreadIds": ["thr_child_1", "thr_child_2"],
                    "tool": "spawnAgent",
                    "status": "inProgress",
                    "agentsStates": {},
                    "prompt": "do the thing",
                    "model": "gpt-5.5",
                }}),
            )
            .await;
        assert_eq!(events.len(), 2);
        match &events[0] {
            NormalizedEvent::ToolUseStart { tool_name, tool_input, .. } => {
                assert_eq!(tool_name, "Agent");
                assert_eq!(tool_input["tool"], "spawnAgent");
                assert_eq!(tool_input["receiverThreadIds"].as_array().unwrap().len(), 2);
            }
            other => panic!("expected ToolUseStart, got {:?}", other),
        }
        match &events[1] {
            NormalizedEvent::SubAgentStarted {
                description, subagent_type, ..
            } => {
                assert!(description.contains("spawnAgent"));
                assert!(description.contains("thr_child_1"));
                assert_eq!(subagent_type, "spawnAgent");
            }
            other => panic!("expected SubAgentStarted, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn collab_agent_tool_call_completed_emits_sub_agent_complete() {
        let t = translator();
        let events = t
            .on_notification(
                "item/completed",
                json!({"item": {
                    "type": "collabAgentToolCall",
                    "id": "i_collab",
                    "senderThreadId": "thr_parent",
                    "receiverThreadIds": ["thr_child_1"],
                    "tool": "spawnAgent",
                    "status": "completed",
                    "agentsStates": {
                        "thr_child_1": {"status": "completed", "message": null}
                    },
                }}),
            )
            .await;
        assert_eq!(events.len(), 2);
        match &events[0] {
            NormalizedEvent::SubAgentComplete { .. } => {}
            other => panic!("expected SubAgentComplete, got {:?}", other),
        }
        match &events[1] {
            NormalizedEvent::ToolResult { content, is_error, .. } => {
                let body = content.as_ref().expect("content");
                assert!(body.contains("thr_child_1"));
                assert!(!is_error);
            }
            other => panic!("expected ToolResult, got {:?}", other),
        }
    }
}
