//! Tauri event names + payloads emitted by the Duo-Coding module.
//! Keep names stable — the frontend `duoStore` subscribes to these strings.

#![allow(dead_code)]

use crate::duo::analyst::DuoAnalystReport;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// A fresh analyst snapshot is available for a run (backend-produced).
pub const EVENT_SNAPSHOT: &str = "duo:snapshot";

/// One point in a dashboard time series (per primary turn).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SeriesPoint {
    pub turn: u32,
    pub ts: i64,
    pub added: u32,
    pub removed: u32,
    /// "agree" | "concern" | "disagree" | null — verdict that followed this turn, if known.
    pub stance: Option<String>,
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotPayload {
    pub run_id: String,
    pub ts: i64,
    pub narrative: String,
    pub report: DuoAnalystReport,
    pub series: Vec<SeriesPoint>,
    /// Cost (USD) of the analyst API call that produced this snapshot — lets the
    /// frontend accumulate the analyst's share of the per-role cost breakdown.
    pub analyst_cost_usd: f64,
}

pub fn emit_snapshot(
    app: &AppHandle,
    run_id: &str,
    ts: i64,
    report: &DuoAnalystReport,
    series: &[SeriesPoint],
    analyst_cost_usd: f64,
) {
    let _ = app.emit(
        EVENT_SNAPSHOT,
        SnapshotPayload {
            run_id: run_id.to_string(),
            ts,
            narrative: report.narrative.clone(),
            report: report.clone(),
            series: series.to_vec(),
            analyst_cost_usd,
        },
    );
}
