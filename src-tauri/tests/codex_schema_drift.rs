//! Layer 1 of the Codex testing framework — schema-drift detector.
//!
//! Re-runs `codex app-server generate-json-schema` against the installed
//! Codex CLI and diffs the result against the schema bundle checked in
//! at `docs/internal/codex-app-server-schemas/`.
//!
//! ## Version-resilient classification (the important part)
//!
//! Codex ships frequently and almost every release ADDS methods, fields,
//! and enum variants. A test that hard-fails on *any* diff would block
//! every developer's build the day a new Codex lands — even when nothing
//! CodeMantis relies on actually changed. So drift is classified:
//!
//!   * **Breaking** (always fatal): a committed schema file disappeared,
//!     or a committed file is no longer a structural *subset* of the live
//!     one — i.e. something was removed, renamed, narrowed, or an enum
//!     value/oneOf variant we may depend on is gone. These are the
//!     changes that can silently break the wire contract.
//!   * **Additive** (warning in normal runs): new schema files, new
//!     optional fields, new enum variants, nullable widening. These don't
//!     break a defensive client, so they only print a reminder to
//!     regenerate + commit the bundle.
//!
//! On the **release gate** (`CM_REQUIRE_CODEX=1`) the policy tightens to
//! "any drift is fatal" so the committed bundle is forced back in sync
//! and reviewed before a release ships.
//!
//! Known blind spot (by design): a *newly-required* field on a request
//! params object reads as additive here (the committed `required` array is
//! still a subset of the live one). That class is caught empirically by
//! `codex_protocol_smoke.rs` / `codex_protocol_capture.rs`, which actually
//! drive the live protocol.
//!
//! This is the **cheap** layer: zero OpenAI credits (only the binary's
//! schema-emit subcommand), runs in <1s. Skipped (not failed) when
//! `codex` is not on PATH unless `CM_REQUIRE_CODEX=1`.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

fn workspace_root() -> PathBuf {
    // CARGO_MANIFEST_DIR points at `src-tauri/` — repo root is one up.
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("workspace has a parent")
        .to_path_buf()
}

fn checked_in_schema_dir() -> PathBuf {
    workspace_root().join("docs/internal/codex-app-server-schemas")
}

fn codex_available() -> bool {
    which::which("codex").is_ok()
}

/// Release-gate strict mode: ANY drift (even additive) is fatal so the
/// committed bundle is forced back in sync before shipping.
fn strict_mode() -> bool {
    std::env::var("CM_REQUIRE_CODEX").as_deref() == Ok("1")
}

/// Walk a schema directory and return `(relative_path, contents)` for
/// every `.json` file. Sorted by relative path so diffs are stable.
fn collect_schemas(root: &Path) -> Vec<(String, String)> {
    let mut out = Vec::new();
    fn walk(dir: &Path, base: &Path, out: &mut Vec<(String, String)>) {
        if !dir.exists() {
            return;
        }
        for entry in std::fs::read_dir(dir).expect("read_dir").flatten() {
            let p = entry.path();
            if p.is_dir() {
                walk(&p, base, out);
            } else if p.extension().and_then(|s| s.to_str()) == Some("json") {
                let rel = p.strip_prefix(base).unwrap().to_string_lossy().to_string();
                let body = std::fs::read_to_string(&p).unwrap_or_default();
                out.push((rel, body));
            }
        }
    }
    walk(root, root, &mut out);
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

/// Canonical JSON string (stable key order) — used to detect whether a
/// file changed *at all* (additive vs identical), independent of the
/// breaking/additive structural check.
fn canonicalise(body: &str) -> String {
    match serde_json::from_str::<Value>(body) {
        Ok(v) => serde_json::to_string_pretty(&v).unwrap_or_else(|_| body.to_string()),
        Err(_) => body.to_string(),
    }
}

/// Is `committed` a structural subset of `live`? True ⇒ every shape the
/// committed schema describes is still present in the live schema (only
/// additions happened) ⇒ **additive, non-breaking**. False ⇒ something
/// was removed/renamed/narrowed ⇒ **breaking**.
///
/// Rules:
///   * `live` is an array: every committed element (a scalar is treated
///     as a one-element array) must have a subset-match somewhere in
///     `live`. Handles enum/oneOf additions and nullable widening
///     (`"string"` → `["string","null"]`).
///   * `committed` is an array but `live` is not: narrowing ⇒ false.
///   * both objects: every committed key must exist in `live` with a
///     subset value (added keys in `live` are ignored ⇒ additive).
///   * `committed` is an object but `live` is not: false.
///   * scalars: must be equal.
pub fn deep_subset(committed: &Value, live: &Value) -> bool {
    match (committed, live) {
        (_, Value::Array(live_arr)) => {
            let committed_elems: Vec<&Value> = match committed {
                Value::Array(c) => c.iter().collect(),
                other => vec![other],
            };
            committed_elems
                .iter()
                .all(|ce| live_arr.iter().any(|le| deep_subset(ce, le)))
        }
        (Value::Array(_), _) => false,
        (Value::Object(c), Value::Object(l)) => c.iter().all(|(k, cv)| {
            l.get(k).map(|lv| deep_subset(cv, lv)).unwrap_or(false)
        }),
        (Value::Object(_), _) => false,
        (c, l) => c == l,
    }
}

fn parse(body: &str) -> Value {
    serde_json::from_str(body).unwrap_or(Value::Null)
}

#[test]
fn codex_schema_matches_committed_bundle() {
    if !codex_available() {
        if strict_mode() {
            panic!(
                "codex not on PATH but CM_REQUIRE_CODEX=1 — install codex \
                 (`npm install -g @openai/codex`) on the release-gate runner."
            );
        }
        eprintln!(
            "[schema-drift] SKIPPING — `codex` binary not on PATH. Install with \
             `npm install -g @openai/codex` to enable this check. \
             (Set CM_REQUIRE_CODEX=1 to fail instead.)"
        );
        return;
    }

    let tmp = tempfile::tempdir().expect("tempdir");
    let status = Command::new("codex")
        .args(["app-server", "generate-json-schema", "--out"])
        .arg(tmp.path())
        .output()
        .expect("spawn codex");
    assert!(
        status.status.success(),
        "`codex app-server generate-json-schema` exited {}: stderr={}",
        status.status,
        String::from_utf8_lossy(&status.stderr)
    );

    let checked_in = checked_in_schema_dir();
    if !checked_in.exists() {
        panic!(
            "missing committed schema dir at {} — first time setup: \
             copy the generated dir from {}",
            checked_in.display(),
            tmp.path().display()
        );
    }

    let live = collect_schemas(tmp.path());
    let committed = collect_schemas(&checked_in);

    let live_by_name: std::collections::BTreeMap<&str, &str> =
        live.iter().map(|(n, c)| (n.as_str(), c.as_str())).collect();
    let committed_names: std::collections::BTreeSet<&str> =
        committed.iter().map(|(n, _)| n.as_str()).collect();

    // ── Classify the drift ──
    let added_files: Vec<&str> = live
        .iter()
        .map(|(n, _)| n.as_str())
        .filter(|n| !committed_names.contains(n))
        .collect();

    let mut removed_files: Vec<&str> = Vec::new(); // BREAKING — a schema we had is gone
    let mut breaking_files: Vec<String> = Vec::new(); // committed not a subset of live
    let mut additive_files: Vec<&str> = Vec::new(); // changed but only additions

    for (name, committed_body) in &committed {
        let Some(live_body) = live_by_name.get(name.as_str()) else {
            removed_files.push(name.as_str());
            continue;
        };
        if canonicalise(committed_body) == canonicalise(live_body) {
            continue; // identical
        }
        let c = parse(committed_body);
        let l = parse(live_body);
        if deep_subset(&c, &l) {
            additive_files.push(name.as_str());
        } else {
            breaking_files.push(name.clone());
        }
    }

    let remediation = "To accept the new shape, run:\n  \
         codex app-server generate-json-schema --out docs/internal/codex-app-server-schemas/\n  \
         then commit + review what changed.";

    // ── Breaking drift: always fatal ──
    if !removed_files.is_empty() || !breaking_files.is_empty() {
        panic!(
            "Codex schema drift — BREAKING change(s) detected.\n  \
             REMOVED schema files (gone from Codex):\n{}\n  \
             STRUCTURALLY CHANGED (something removed/renamed/narrowed):\n{}\n\n{remediation}",
            if removed_files.is_empty() {
                "    (none)".to_string()
            } else {
                removed_files.iter().map(|n| format!("    - {n}")).collect::<Vec<_>>().join("\n")
            },
            if breaking_files.is_empty() {
                "    (none)".to_string()
            } else {
                breaking_files.iter().map(|n| format!("    ~ {n}")).collect::<Vec<_>>().join("\n")
            },
        );
    }

    // ── Additive drift: fatal only on the release gate ──
    if !added_files.is_empty() || !additive_files.is_empty() {
        let summary = format!(
            "Codex schema drift — ADDITIVE change(s) only.\n  \
             NEW schema files:\n{}\n  \
             FILES WITH NEW (optional) FIELDS / ENUM VARIANTS:\n{}\n\n{remediation}",
            if added_files.is_empty() {
                "    (none)".to_string()
            } else {
                added_files.iter().map(|n| format!("    + {n}")).collect::<Vec<_>>().join("\n")
            },
            if additive_files.is_empty() {
                "    (none)".to_string()
            } else {
                additive_files.iter().map(|n| format!("    * {n}")).collect::<Vec<_>>().join("\n")
            },
        );
        if strict_mode() {
            panic!("{summary}\n\n(CM_REQUIRE_CODEX=1 — additive drift is fatal on the release gate.)");
        }
        eprintln!("[schema-drift] WARNING (non-fatal):\n{summary}");
    }
}

#[cfg(test)]
mod tests {
    use super::deep_subset;
    use serde_json::json;

    #[test]
    fn identical_is_subset() {
        let v = json!({"a": 1, "enum": ["x", "y"]});
        assert!(deep_subset(&v, &v));
    }

    #[test]
    fn added_property_is_additive() {
        let committed = json!({"properties": {"a": {"type": "string"}}});
        let live = json!({"properties": {"a": {"type": "string"}, "b": {"type": "number"}}});
        assert!(deep_subset(&committed, &live));
    }

    #[test]
    fn added_enum_variant_is_additive() {
        let committed = json!({"enum": ["read-only", "workspace-write"]});
        let live = json!({"enum": ["read-only", "workspace-write", "danger-full-access"]});
        assert!(deep_subset(&committed, &live));
    }

    #[test]
    fn nullable_widening_is_additive() {
        // The most common Codex additive change: a field becomes nullable.
        let committed = json!({"type": "string"});
        let live = json!({"type": ["string", "null"]});
        assert!(deep_subset(&committed, &live));
    }

    #[test]
    fn removed_enum_variant_is_breaking() {
        let committed = json!({"enum": ["read-only", "workspace-write", "legacy"]});
        let live = json!({"enum": ["read-only", "workspace-write"]});
        assert!(!deep_subset(&committed, &live));
    }

    #[test]
    fn removed_property_is_breaking() {
        let committed = json!({"properties": {"a": {"type": "string"}, "b": {"type": "number"}}});
        let live = json!({"properties": {"a": {"type": "string"}}});
        assert!(!deep_subset(&committed, &live));
    }

    #[test]
    fn changed_scalar_is_breaking() {
        let committed = json!({"const": "thread/start"});
        let live = json!({"const": "thread/begin"});
        assert!(!deep_subset(&committed, &live));
    }

    #[test]
    fn narrowing_nullable_is_breaking() {
        let committed = json!({"type": ["string", "null"]});
        let live = json!({"type": "string"});
        assert!(!deep_subset(&committed, &live));
    }

    #[test]
    fn new_required_field_reads_as_additive_known_blind_spot() {
        // Documented blind spot: a newly-required field is a superset of
        // the committed `required` array, so it reads as additive here.
        // Caught instead by the live smoke/capture battery.
        let committed = json!({"required": ["a"]});
        let live = json!({"required": ["a", "b"]});
        assert!(deep_subset(&committed, &live));
    }
}
