//! Layer 1 of the Codex testing framework — schema-drift detector.
//!
//! Re-runs `codex app-server generate-json-schema` against the installed
//! Codex CLI and diffs the result against the schema bundle checked in
//! at `docs/internal/codex-app-server-schemas/`. Any drift fails the
//! test with a one-line remediation: re-run the generator and commit
//! the diff.
//!
//! This is the **cheap** layer of the framework:
//!   * Costs **zero** OpenAI credits (only invokes the binary's
//!     schema-emit subcommand — no auth, no network, no model).
//!   * Runs on every developer's machine + CI in <1s.
//!   * Catches: enum renames (kebab→camel, the bug class that bit us
//!     hardest), field additions/removals, type changes, new methods.
//!
//! Skipped (not failed) when `codex` is not on PATH so contributors
//! without the Codex install can still run `cargo test`. CI sets the
//! `CM_REQUIRE_CODEX=1` env to upgrade the skip to a hard failure on
//! the release-gate runners.
//!
//! Spec: this is the Codex analog of the empirical-truth flow Claude
//! has via `cli_protocol_capture.rs` — but cheaper, because Codex
//! self-documents its protocol via `generate-json-schema`. Documented
//! in `docs/internal/codex-app-server-schemas/README.md`.

use std::path::{Path, PathBuf};
use std::process::Command;

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

/// Normalise JSON whitespace + key ordering so cosmetic formatting
/// differences don't trip the drift check. Schemas with comments would
/// fail; both schema directories here are pure JSON so this is safe.
fn canonicalise(body: &str) -> String {
    match serde_json::from_str::<serde_json::Value>(body) {
        Ok(v) => serde_json::to_string_pretty(&v).unwrap_or_else(|_| body.to_string()),
        Err(_) => body.to_string(),
    }
}

#[test]
fn codex_schema_matches_committed_bundle() {
    if !codex_available() {
        if std::env::var("CM_REQUIRE_CODEX").as_deref() == Ok("1") {
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

    // 1. File set must match — adding or removing a schema file is
    //    always a meaningful change worth investigating.
    let live_names: std::collections::BTreeSet<&str> =
        live.iter().map(|(n, _)| n.as_str()).collect();
    let committed_names: std::collections::BTreeSet<&str> =
        committed.iter().map(|(n, _)| n.as_str()).collect();

    let added: Vec<&&str> = live_names.difference(&committed_names).collect();
    let removed: Vec<&&str> = committed_names.difference(&live_names).collect();
    if !added.is_empty() || !removed.is_empty() {
        panic!(
            "Codex schema drift — file set changed.\n  \
             ADDED in live (new schemas in Codex):\n{}\n  \
             REMOVED from live (gone from Codex):\n{}\n\n\
             To accept the new shape, run:\n  \
             codex app-server generate-json-schema --out docs/internal/codex-app-server-schemas/\n  \
             then commit + review what changed.",
            if added.is_empty() {
                "    (none)".to_string()
            } else {
                added.iter().map(|n| format!("    + {n}")).collect::<Vec<_>>().join("\n")
            },
            if removed.is_empty() {
                "    (none)".to_string()
            } else {
                removed.iter().map(|n| format!("    - {n}")).collect::<Vec<_>>().join("\n")
            },
        );
    }

    // 2. For every file the contents (post-canonicalisation) must match.
    //    Bail at the first diff with a precise pointer.
    let live_by_name: std::collections::BTreeMap<&str, &str> =
        live.iter().map(|(n, c)| (n.as_str(), c.as_str())).collect();
    for (name, committed_body) in &committed {
        let live_body = live_by_name
            .get(name.as_str())
            .expect("file-set parity already checked");
        let a = canonicalise(committed_body);
        let b = canonicalise(live_body);
        if a != b {
            // Truncated diff — full bodies are large.
            let preview_a: String = a.chars().take(400).collect();
            let preview_b: String = b.chars().take(400).collect();
            panic!(
                "Codex schema drift — `{name}` changed.\n\
                 COMMITTED (first 400 chars):\n{preview_a}\n\n\
                 LIVE (first 400 chars):\n{preview_b}\n\n\
                 To accept the new shape, run:\n  \
                 codex app-server generate-json-schema --out docs/internal/codex-app-server-schemas/\n  \
                 then commit + review what changed."
            );
        }
    }
}
