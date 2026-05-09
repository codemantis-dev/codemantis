// Capability status types — what the verification engine emits and what the
// Mission Control UI consumes. Persisted to `preflight_capabilities` (SQLite)
// so the user sees a meaningful "ready / needs setup" state on app open
// before any fresh verification has run.

#![allow(dead_code)] // Phase 2 wires these into commands; Phase 3 renders them.

use crate::storage::Database;
use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityState {
    Unknown,
    Detecting,
    Satisfied,
    Missing,
    Stale,
    AutoInstalling,
    AwaitingUserAction,
}

impl CapabilityState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Detecting => "detecting",
            Self::Satisfied => "satisfied",
            Self::Missing => "missing",
            Self::Stale => "stale",
            Self::AutoInstalling => "auto_installing",
            Self::AwaitingUserAction => "awaiting_user_action",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        Some(match s {
            "unknown" => Self::Unknown,
            "detecting" => Self::Detecting,
            "satisfied" => Self::Satisfied,
            "missing" => Self::Missing,
            "stale" => Self::Stale,
            "auto_installing" => Self::AutoInstalling,
            "awaiting_user_action" => Self::AwaitingUserAction,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityStatus {
    pub project_id: String,
    pub capability_id: String,
    #[serde(default)]
    pub catalog_ref: Option<String>,
    pub state: CapabilityState,
    /// Unix epoch milliseconds.
    pub last_checked: i64,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub detection_source: Option<String>,
    #[serde(default)]
    pub user_acknowledged_optional_skip: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightStatus {
    pub project_id: String,
    pub all_satisfied: bool,
    pub blocking_count: u32,
    pub optional_count: u32,
    pub capabilities: Vec<CapabilityStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionHit {
    pub capability_id: String,
    pub source: String, // "env_var" | "secret_store" | "file" (Phase 5)
    pub confidence: f32, // 0.0 .. 1.0
    #[serde(default)]
    pub suggestion: Option<String>,
}

fn slot_pk(project_id: &str, capability_id: &str) -> String {
    format!("{}:{}", project_id, capability_id)
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

/// Insert or update the status row for a single capability.
pub fn upsert(db: &Database, status: &CapabilityStatus) -> rusqlite::Result<()> {
    let conn = db.conn().lock().expect("poisoned");
    let id = slot_pk(&status.project_id, &status.capability_id);
    let now = now_ms();
    conn.execute(
        "INSERT INTO preflight_capabilities (
            id, project_id, capability_id, catalog_ref, state,
            last_checked, last_message, last_error, detection_source,
            user_acknowledged_optional_skip, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
        ON CONFLICT(id) DO UPDATE SET
            catalog_ref = excluded.catalog_ref,
            state = excluded.state,
            last_checked = excluded.last_checked,
            last_message = excluded.last_message,
            last_error = excluded.last_error,
            detection_source = excluded.detection_source,
            user_acknowledged_optional_skip = excluded.user_acknowledged_optional_skip,
            updated_at = excluded.updated_at",
        params![
            id,
            status.project_id,
            status.capability_id,
            status.catalog_ref,
            status.state.as_str(),
            status.last_checked,
            status.message,
            status.error,
            status.detection_source,
            i64::from(status.user_acknowledged_optional_skip),
            now,
        ],
    )?;
    Ok(())
}

/// Read all stored statuses for a project.
pub fn list_for_project(db: &Database, project_id: &str) -> rusqlite::Result<Vec<CapabilityStatus>> {
    let conn = db.conn().lock().expect("poisoned");
    let mut stmt = conn.prepare(
        "SELECT project_id, capability_id, catalog_ref, state, last_checked,
                last_message, last_error, detection_source,
                user_acknowledged_optional_skip
         FROM preflight_capabilities WHERE project_id = ?1
         ORDER BY capability_id",
    )?;
    let rows = stmt.query_map(params![project_id], |row| {
        Ok(CapabilityStatus {
            project_id: row.get(0)?,
            capability_id: row.get(1)?,
            catalog_ref: row.get(2)?,
            state: CapabilityState::from_str(&row.get::<_, String>(3)?)
                .unwrap_or(CapabilityState::Unknown),
            last_checked: row.get(4)?,
            message: row.get(5)?,
            error: row.get(6)?,
            detection_source: row.get(7)?,
            user_acknowledged_optional_skip: row.get::<_, i64>(8)? != 0,
        })
    })?;
    rows.collect()
}

/// Read the status for a single capability, if stored.
pub fn get(
    db: &Database,
    project_id: &str,
    capability_id: &str,
) -> rusqlite::Result<Option<CapabilityStatus>> {
    let conn = db.conn().lock().expect("poisoned");
    let id = slot_pk(project_id, capability_id);
    conn.query_row(
        "SELECT project_id, capability_id, catalog_ref, state, last_checked,
                last_message, last_error, detection_source,
                user_acknowledged_optional_skip
         FROM preflight_capabilities WHERE id = ?1",
        params![id],
        |row| {
            Ok(CapabilityStatus {
                project_id: row.get(0)?,
                capability_id: row.get(1)?,
                catalog_ref: row.get(2)?,
                state: CapabilityState::from_str(&row.get::<_, String>(3)?)
                    .unwrap_or(CapabilityState::Unknown),
                last_checked: row.get(4)?,
                message: row.get(5)?,
                error: row.get(6)?,
                detection_source: row.get(7)?,
                user_acknowledged_optional_skip: row.get::<_, i64>(8)? != 0,
            })
        },
    )
    .optional()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::Database;
    use tempfile::tempdir;

    fn fresh_db() -> (Database, tempfile::TempDir) {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let db = Database::new(db_path.to_str().unwrap()).unwrap();
        (db, dir)
    }

    #[test]
    fn state_round_trips_via_str() {
        for s in &[
            CapabilityState::Unknown,
            CapabilityState::Detecting,
            CapabilityState::Satisfied,
            CapabilityState::Missing,
            CapabilityState::Stale,
            CapabilityState::AutoInstalling,
            CapabilityState::AwaitingUserAction,
        ] {
            assert_eq!(CapabilityState::from_str(s.as_str()), Some(*s));
        }
    }

    #[test]
    fn unknown_state_string_returns_none() {
        assert_eq!(CapabilityState::from_str("bogus"), None);
    }

    #[test]
    fn upsert_then_get_round_trips() {
        let (db, _dir) = fresh_db();
        let status = CapabilityStatus {
            project_id: "atikon".into(),
            capability_id: "PREFLIGHT-stripe".into(),
            catalog_ref: Some("stripe.api_key.secret".into()),
            state: CapabilityState::Missing,
            last_checked: 1_700_000_000_000,
            message: Some("not yet entered".into()),
            error: None,
            detection_source: None,
            user_acknowledged_optional_skip: false,
        };
        upsert(&db, &status).unwrap();
        let got = get(&db, "atikon", "PREFLIGHT-stripe").unwrap().unwrap();
        assert_eq!(got.state, CapabilityState::Missing);
        assert_eq!(got.catalog_ref.as_deref(), Some("stripe.api_key.secret"));
        assert_eq!(got.message.as_deref(), Some("not yet entered"));
    }

    #[test]
    fn upsert_overwrites_state() {
        let (db, _dir) = fresh_db();
        let mut status = CapabilityStatus {
            project_id: "p".into(),
            capability_id: "c".into(),
            catalog_ref: None,
            state: CapabilityState::Missing,
            last_checked: 100,
            message: None,
            error: None,
            detection_source: None,
            user_acknowledged_optional_skip: false,
        };
        upsert(&db, &status).unwrap();
        status.state = CapabilityState::Satisfied;
        status.last_checked = 200;
        upsert(&db, &status).unwrap();
        let got = get(&db, "p", "c").unwrap().unwrap();
        assert_eq!(got.state, CapabilityState::Satisfied);
        assert_eq!(got.last_checked, 200);
    }

    #[test]
    fn get_missing_returns_none() {
        let (db, _dir) = fresh_db();
        let got = get(&db, "no", "such").unwrap();
        assert!(got.is_none());
    }

    #[test]
    fn list_for_project_filters_by_project_and_orders_by_id() {
        let (db, _dir) = fresh_db();
        for (project, cap) in [("a", "c-2"), ("a", "c-1"), ("b", "c-3")] {
            let status = CapabilityStatus {
                project_id: project.into(),
                capability_id: cap.into(),
                catalog_ref: None,
                state: CapabilityState::Unknown,
                last_checked: 0,
                message: None,
                error: None,
                detection_source: None,
                user_acknowledged_optional_skip: false,
            };
            upsert(&db, &status).unwrap();
        }
        let listed = list_for_project(&db, "a").unwrap();
        assert_eq!(listed.len(), 2);
        // ORDER BY capability_id ascending → c-1, c-2.
        assert_eq!(listed[0].capability_id, "c-1");
        assert_eq!(listed[1].capability_id, "c-2");
    }

    #[test]
    fn ack_skip_round_trips() {
        let (db, _dir) = fresh_db();
        let status = CapabilityStatus {
            project_id: "p".into(),
            capability_id: "c".into(),
            catalog_ref: None,
            state: CapabilityState::Missing,
            last_checked: 0,
            message: None,
            error: None,
            detection_source: None,
            user_acknowledged_optional_skip: true,
        };
        upsert(&db, &status).unwrap();
        let got = get(&db, "p", "c").unwrap().unwrap();
        assert!(got.user_acknowledged_optional_skip);
    }
}
