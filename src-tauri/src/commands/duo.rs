//! Duo-Coding command layer — thin wrappers over the `duo_*` database
//! accessors. The orchestration state machine lives in the frontend
//! `duoStore`; these commands only persist run/event/snapshot rows so the
//! dashboard, session history, and restart-recovery can read them back.
//!
//! Timestamps are stamped server-side (epoch millis) so persisted ordering
//! never depends on the frontend clock. See `project_duo_coding` plan.

use crate::agents::claude_code::session::AppState;
use crate::commands::settings;
use crate::duo::analyst::{self, AnalystContext, DuoAnalystReport};
use crate::duo::events::{self, SeriesPoint};
use crate::storage::database::{DuoEventRow, DuoRunRow, DuoSnapshotRow};
use tauri::State;

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Max event lines fed to the analyst prompt — recent-tail capped to bound cost.
const MAX_TIMELINE_EVENTS: usize = 80;

#[tauri::command]
pub async fn duo_start_run(
    state: State<'_, AppState>,
    id: String,
    primary_session_id: String,
    duo_session_id: String,
    project_path: String,
    config_json: String,
) -> Result<(), String> {
    state
        .database
        .insert_duo_run(
            &id,
            &primary_session_id,
            &duo_session_id,
            &project_path,
            "running",
            &config_json,
            now_ms(),
        )
        .map_err(|e| format!("Failed to start duo run: {}", e))
}

#[tauri::command]
pub async fn duo_complete_run(
    state: State<'_, AppState>,
    id: String,
    status: String,
    outcome: Option<String>,
) -> Result<(), String> {
    state
        .database
        .update_duo_run_status(&id, &status, outcome.as_deref(), Some(now_ms()))
        .map_err(|e| format!("Failed to complete duo run: {}", e))
}

#[tauri::command]
pub async fn duo_get_run(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<DuoRunRow>, String> {
    state
        .database
        .get_duo_run(&id)
        .map_err(|e| format!("Failed to get duo run: {}", e))
}

#[tauri::command]
pub async fn duo_list_runs(
    state: State<'_, AppState>,
    project_path: String,
) -> Result<Vec<DuoRunRow>, String> {
    state
        .database
        .list_duo_runs(&project_path)
        .map_err(|e| format!("Failed to list duo runs: {}", e))
}

#[tauri::command]
pub async fn duo_record_event(
    state: State<'_, AppState>,
    id: String,
    run_id: String,
    kind: String,
    actor: String,
    payload_json: String,
    diff_stats_json: Option<String>,
) -> Result<(), String> {
    state
        .database
        .insert_duo_event(
            &id,
            &run_id,
            now_ms(),
            &kind,
            &actor,
            &payload_json,
            diff_stats_json.as_deref(),
        )
        .map_err(|e| format!("Failed to record duo event: {}", e))
}

#[tauri::command]
pub async fn duo_list_events(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<Vec<DuoEventRow>, String> {
    state
        .database
        .list_duo_events(&run_id)
        .map_err(|e| format!("Failed to list duo events: {}", e))
}

#[tauri::command]
pub async fn duo_record_snapshot(
    state: State<'_, AppState>,
    id: String,
    run_id: String,
    narrative: String,
    metrics_json: String,
    series_json: String,
) -> Result<(), String> {
    state
        .database
        .insert_duo_snapshot(&id, &run_id, now_ms(), &narrative, &metrics_json, &series_json)
        .map_err(|e| format!("Failed to record duo snapshot: {}", e))
}

#[tauri::command]
pub async fn duo_latest_snapshot(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<Option<DuoSnapshotRow>, String> {
    state
        .database
        .latest_duo_snapshot(&run_id)
        .map_err(|e| format!("Failed to get latest duo snapshot: {}", e))
}

/// Reconcile Duo runs left `running` when the app exited (the two CLI sessions
/// are gone). Marks each as paused with outcome `interrupted-by-restart` and
/// returns them (newest first) so the UI can offer a read-only review. The
/// frontend reuses `duo_latest_snapshot` / `duo_list_events` to rehydrate.
#[tauri::command]
pub async fn duo_recover_interrupted(
    state: State<'_, AppState>,
) -> Result<Vec<DuoRunRow>, String> {
    let running = state
        .database
        .list_running_duo_runs()
        .map_err(|e| e.to_string())?;
    for run in &running {
        let _ = state.database.update_duo_run_status(
            &run.id,
            "paused",
            Some("interrupted-by-restart"),
            Some(now_ms()),
        );
    }
    Ok(running)
}

// ── Analyst (LLM observability) ───────────────────────────────────────────

fn payload_summary(payload_json: &str) -> String {
    serde_json::from_str::<serde_json::Value>(payload_json)
        .ok()
        .and_then(|v| v.get("summary").and_then(|s| s.as_str()).map(String::from))
        .unwrap_or_default()
}

/// Deterministic counts the dashboard already owns — handed to the analyst so it
/// reasons about them but never recomputes them. Returned as compact JSON.
pub fn compute_aggregates(events: &[DuoEventRow]) -> serde_json::Value {
    let mut counts: std::collections::BTreeMap<&str, u32> = std::collections::BTreeMap::new();
    for e in events {
        *counts.entry(e.kind.as_str()).or_insert(0) += 1;
    }
    let get = |k: &str| *counts.get(k).unwrap_or(&0);
    serde_json::json!({
        "turns": get("turn"),
        "agreements": get("agreement"),
        "disagreements": get("disagreement"),
        "concerns": get("concern"),
        "repairs": get("repair"),
        "dialogueExchanges": get("dialogue"),
        "driftIncidents": get("drift"),
        "escalations": get("escalation"),
    })
}

/// Per-turn diff series from `turn` events that carry diff stats.
pub fn compute_series(events: &[DuoEventRow]) -> Vec<SeriesPoint> {
    let mut series = Vec::new();
    let mut turn = 0u32;
    for e in events {
        if e.kind != "turn" {
            continue;
        }
        turn += 1;
        let (added, removed) = e
            .diff_stats_json
            .as_deref()
            .and_then(|j| serde_json::from_str::<serde_json::Value>(j).ok())
            .map(|v| {
                (
                    v.get("added").and_then(|x| x.as_u64()).unwrap_or(0) as u32,
                    v.get("removed").and_then(|x| x.as_u64()).unwrap_or(0) as u32,
                )
            })
            .unwrap_or((0, 0));
        series.push(SeriesPoint {
            turn,
            ts: e.ts,
            added,
            removed,
            stance: None,
            cost_usd: 0.0,
        });
    }
    series
}

/// Compact chronological "<kind>/<actor>: <summary>" lines (recent-tail capped).
pub fn build_timeline(events: &[DuoEventRow]) -> String {
    let start = events.len().saturating_sub(MAX_TIMELINE_EVENTS);
    events[start..]
        .iter()
        .map(|e| {
            let s = payload_summary(&e.payload_json);
            if s.is_empty() {
                format!("{}/{}", e.kind, e.actor)
            } else {
                format!("{}/{}: {}", e.kind, e.actor, s)
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Write a deterministic project-progress (changelog) entry summarizing a
/// finished Duo run. Linked to the primary session so it appears in both the
/// session's and the project's changelog feeds, under the `duo-coding` category.
#[tauri::command]
pub async fn duo_log_completion(
    state: State<'_, AppState>,
    run_id: String,
    outcome: String,
) -> Result<(), String> {
    let run = state
        .database
        .get_duo_run(&run_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Duo run not found: {}", run_id))?;
    let events = state.database.list_duo_events(&run_id).map_err(|e| e.to_string())?;
    let agg = compute_aggregates(&events);
    let run_config: serde_json::Value =
        serde_json::from_str(&run.config_json).unwrap_or(serde_json::Value::Null);
    let task = run_config["task"].as_str().unwrap_or("Duo-Coding run");

    let headline = {
        let t: String = task.chars().take(72).collect();
        format!("Duo run: {}", t)
    };
    let description = format!(
        "Outcome: {}. {} turns · {} agreements · {} disagreements · {} repairs · {} drift.",
        outcome,
        agg["turns"],
        agg["agreements"],
        agg["disagreements"],
        agg["repairs"],
        agg["driftIncidents"],
    );
    let technical_details = format!(
        "Primary {} · Mentor {}",
        agent_label(&run_config, "primary"),
        agent_label(&run_config, "duo"),
    );

    state
        .database
        .insert_changelog_entry(
            &uuid::Uuid::new_v4().to_string(),
            &run.primary_session_id,
            &chrono::Utc::now().to_rfc3339(),
            &headline,
            &description,
            "duo-coding",
            "[]",
            0,
            &technical_details,
            "",
        )
        .map_err(|e| e.to_string())
}

/// Pull a human label "agentId/model" for a side out of the run's config JSON.
fn agent_label(config: &serde_json::Value, side: &str) -> String {
    let s = &config[side];
    let agent = s["agentId"].as_str().unwrap_or("unknown");
    match s["model"].as_str() {
        Some(m) if !m.is_empty() => format!("{}/{}", agent, m),
        _ => agent.to_string(),
    }
}

/// Run the analyst over a Duo run: load events, call the LLM, persist a snapshot,
/// log the API cost, and emit a real-time `duo:snapshot` event. Returns the
/// sanitized report. No-op error if the analyst is disabled or unconfigured.
#[tauri::command]
pub async fn duo_analyze(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    run_id: String,
) -> Result<DuoAnalystReport, String> {
    let app_settings = settings::get_settings()?;
    let cfg = &app_settings.duo;
    if !cfg.analyst_enabled {
        return Err("Duo analyst is disabled".to_string());
    }

    let run = state
        .database
        .get_duo_run(&run_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Duo run not found: {}", run_id))?;
    let events = state.database.list_duo_events(&run_id).map_err(|e| e.to_string())?;

    let run_config: serde_json::Value =
        serde_json::from_str(&run.config_json).unwrap_or(serde_json::Value::Null);
    let task = run_config["task"].as_str().unwrap_or("(task unavailable)").to_string();
    let tie_break_policy = run_config["tieBreakPolicy"]
        .as_str()
        .unwrap_or("pause")
        .to_string();

    let series = compute_series(&events);
    let ctx = AnalystContext {
        task,
        primary_label: agent_label(&run_config, "primary"),
        duo_label: agent_label(&run_config, "duo"),
        tie_break_policy,
        aggregates_json: compute_aggregates(&events).to_string(),
        event_timeline: build_timeline(&events),
    };

    let provider = &cfg.analyst_provider;
    let model = &cfg.analyst_model;
    let api_key = app_settings.api_keys.get(provider).cloned().unwrap_or_default();
    if api_key.is_empty() {
        return Err(format!("No API key configured for {}", provider));
    }

    let result = analyst::analyze(provider, &api_key, model, &ctx).await;

    // Log the API call regardless of outcome (mirrors the changelog pattern).
    let (input_tokens, output_tokens, success, error_msg) = match &result {
        Ok((_, i, o)) => (*i, *o, true, None),
        Err(e) => (0, 0, false, Some(e.clone())),
    };
    let cost = app_settings
        .model_pricing
        .get(model)
        .map(|p| {
            (input_tokens as f64 / 1_000_000.0 * p.input)
                + (output_tokens as f64 / 1_000_000.0 * p.output)
        })
        .unwrap_or(0.0);
    let _ = state.database.insert_api_log(
        &uuid::Uuid::new_v4().to_string(),
        &chrono::Utc::now().to_rfc3339(),
        provider,
        model,
        &run_id,
        input_tokens,
        output_tokens,
        cost,
        success,
        error_msg.as_deref(),
    );

    let (report, _, _) = result?;

    let ts = now_ms();
    state
        .database
        .insert_duo_snapshot(
            &uuid::Uuid::new_v4().to_string(),
            &run_id,
            ts,
            &report.narrative,
            &serde_json::to_string(&report).map_err(|e| e.to_string())?,
            &serde_json::to_string(&series).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;

    events::emit_snapshot(&app, &run_id, ts, &report, &series);
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::{build_timeline, compute_aggregates, compute_series, MAX_TIMELINE_EVENTS};
    use crate::storage::database::DuoEventRow;
    use crate::test_helpers::test_db;

    fn evt(kind: &str, actor: &str, summary: &str, diff: Option<&str>) -> DuoEventRow {
        DuoEventRow {
            id: format!("e-{}-{}", kind, summary),
            run_id: "r1".into(),
            ts: 0,
            kind: kind.into(),
            actor: actor.into(),
            payload_json: serde_json::json!({ "summary": summary }).to_string(),
            diff_stats_json: diff.map(String::from),
        }
    }

    #[test]
    fn aggregates_count_by_kind() {
        let events = vec![
            evt("turn", "primary", "t1", None),
            evt("turn", "primary", "t2", None),
            evt("agreement", "duo", "ok", None),
            evt("disagreement", "duo", "no", None),
            evt("drift", "duo", "rm -rf", None),
        ];
        let agg = compute_aggregates(&events);
        assert_eq!(agg["turns"], 2);
        assert_eq!(agg["agreements"], 1);
        assert_eq!(agg["disagreements"], 1);
        assert_eq!(agg["driftIncidents"], 1);
        assert_eq!(agg["repairs"], 0);
    }

    #[test]
    fn series_extracts_diff_stats_from_turn_events() {
        let events = vec![
            evt("turn", "primary", "t1", Some("{\"added\":10,\"removed\":2,\"files\":1}")),
            evt("agreement", "duo", "ok", None),
            evt("turn", "primary", "t2", Some("{\"added\":3,\"removed\":0,\"files\":1}")),
        ];
        let series = compute_series(&events);
        assert_eq!(series.len(), 2);
        assert_eq!(series[0].turn, 1);
        assert_eq!(series[0].added, 10);
        assert_eq!(series[1].turn, 2);
        assert_eq!(series[1].added, 3);
    }

    #[test]
    fn timeline_formats_and_caps_events() {
        let events = vec![
            evt("turn", "primary", "did work", None),
            evt("verdict", "duo", "", None),
        ];
        let tl = build_timeline(&events);
        assert!(tl.contains("turn/primary: did work"));
        assert!(tl.contains("verdict/duo"));
    }

    #[test]
    fn recover_interrupted_marks_running_runs_paused() {
        let db = test_db();
        db.insert_duo_run("r-run", "p", "d", "/proj", "running", "{}", 2).unwrap();
        db.insert_duo_run("r-done", "p", "d", "/proj", "completed", "{}", 1).unwrap();
        // Mirror duo_recover_interrupted's reconciliation.
        let running = db.list_running_duo_runs().unwrap();
        assert_eq!(running.len(), 1);
        assert_eq!(running[0].id, "r-run");
        for run in &running {
            db.update_duo_run_status(&run.id, "paused", Some("interrupted-by-restart"), Some(99)).unwrap();
        }
        let row = db.get_duo_run("r-run").unwrap().unwrap();
        assert_eq!(row.status, "paused");
        assert_eq!(row.outcome.as_deref(), Some("interrupted-by-restart"));
        // Already-finished runs are untouched.
        assert_eq!(db.get_duo_run("r-done").unwrap().unwrap().status, "completed");
        assert!(db.list_running_duo_runs().unwrap().is_empty());
    }

    #[test]
    fn completion_changelog_entry_is_written_under_duo_category() {
        // Mirrors duo_log_completion's DB writes (the command is a thin wrapper).
        let db = test_db();
        // changelog_entries FKs to sessions — the primary session is real in prod.
        db.insert_session("sess-p", "Primary", "/proj", "connected", "2026-01-01T00:00:00Z", None, 0, "codex").unwrap();
        db.insert_duo_run("r1", "sess-p", "d", "/proj", "running", "{\"task\":\"Add logout\"}", 1).unwrap();
        db.insert_duo_event("e1", "r1", 1, "turn", "primary", "{}", None).unwrap();
        db.insert_duo_event("e2", "r1", 2, "agreement", "duo", "{}", None).unwrap();
        db.insert_changelog_entry(
            "cl1", "sess-p", "2026-01-01T00:00:00Z",
            "Duo run: Add logout", "Outcome: agreed. 1 turns · 1 agreements.",
            "duo-coding", "[]", 0, "Primary codex · Mentor claude_code", "",
        ).unwrap();
        let entries = db.list_changelog_entries("sess-p").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].category, "duo-coding");
        assert!(entries[0].headline.contains("Add logout"));
    }

    #[test]
    fn timeline_keeps_only_the_recent_tail() {
        let events: Vec<DuoEventRow> = (0..200)
            .map(|i| evt("turn", "primary", &format!("turn {i}"), None))
            .collect();
        let tl = build_timeline(&events);
        assert_eq!(tl.lines().count(), MAX_TIMELINE_EVENTS);
        assert!(tl.contains("turn 199")); // newest retained
        assert!(!tl.contains("turn 0")); // oldest dropped
    }

    // The `#[tauri::command]` wrappers are thin pass-throughs over these db
    // accessors (the project convention — see commands/super_bro.rs tests).
    // Each test exercises the success path plus a representative error/empty path.

    #[test]
    fn start_run_then_get_returns_row() {
        let db = test_db();
        db.insert_duo_run("r1", "primary", "duo", "/proj", "running", "{\"enabled\":true}", 10)
            .unwrap();
        let row = db.get_duo_run("r1").unwrap().expect("run exists");
        assert_eq!(row.primary_session_id, "primary");
        assert_eq!(row.status, "running");
    }

    #[test]
    fn get_run_unknown_id_returns_none() {
        let db = test_db();
        assert!(db.get_duo_run("ghost").unwrap().is_none());
    }

    #[test]
    fn complete_run_sets_status_outcome_and_completion() {
        let db = test_db();
        db.insert_duo_run("r1", "p", "d", "/proj", "running", "{}", 1).unwrap();
        db.update_duo_run_status("r1", "completed", Some("agreed"), Some(99)).unwrap();
        let row = db.get_duo_run("r1").unwrap().unwrap();
        assert_eq!(row.status, "completed");
        assert_eq!(row.outcome.as_deref(), Some("agreed"));
        assert_eq!(row.completed_at, Some(99));
    }

    #[test]
    fn list_runs_scoped_to_project() {
        let db = test_db();
        db.insert_duo_run("r1", "p", "d", "/a", "running", "{}", 1).unwrap();
        db.insert_duo_run("r2", "p", "d", "/b", "running", "{}", 2).unwrap();
        assert_eq!(db.list_duo_runs("/a").unwrap().len(), 1);
        assert!(db.list_duo_runs("/none").unwrap().is_empty());
    }

    #[test]
    fn record_and_list_events_in_order() {
        let db = test_db();
        db.insert_duo_run("r1", "p", "d", "/proj", "running", "{}", 1).unwrap();
        db.insert_duo_event("e1", "r1", 10, "turn", "primary", "{}", None).unwrap();
        db.insert_duo_event("e2", "r1", 20, "verdict", "duo", "{\"stance\":\"agree\"}", None).unwrap();
        let events = db.list_duo_events("r1").unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].kind, "turn");
        assert_eq!(events[1].actor, "duo");
    }

    #[test]
    fn list_events_unknown_run_is_empty() {
        let db = test_db();
        assert!(db.list_duo_events("ghost").unwrap().is_empty());
    }

    #[test]
    fn record_and_fetch_latest_snapshot() {
        let db = test_db();
        db.insert_duo_run("r1", "p", "d", "/proj", "running", "{}", 1).unwrap();
        db.insert_duo_snapshot("s1", "r1", 10, "early", "{}", "[]").unwrap();
        db.insert_duo_snapshot("s2", "r1", 20, "late", "{}", "[]").unwrap();
        let snap = db.latest_duo_snapshot("r1").unwrap().unwrap();
        assert_eq!(snap.narrative, "late");
    }

    #[test]
    fn latest_snapshot_unknown_run_is_none() {
        let db = test_db();
        assert!(db.latest_duo_snapshot("ghost").unwrap().is_none());
    }
}
