// File-based detection scanner — scans a strict allowlist of files for
// likely-credential variable definitions (e.g. `OPENAI_API_KEY=...`) and
// reports presence only. NEVER reads or stores the right-hand-side value.
//
// **Critical safety:**
//   - Allowlist of files: ~/.zshrc, ~/.bashrc, ~/.profile, plus the
//     PROJECT-local `.env` if `project_dir` is supplied. No `.env` outside
//     the project dir, ever.
//   - Only checks for `<HINT_VAR>=` literal substring (case-sensitive).
//     We do not parse the file or interpret the value.
//   - Only runs when called explicitly. The Tauri command path requires
//     consent via DetectionPrompt before invoking this scanner.

#![allow(dead_code)] // Wired in via the next refactor of preflight::detection.

use crate::preflight::manifest::{Capability, Category, Manifest};
use crate::preflight::status::DetectionHit;
use std::path::{Path, PathBuf};

const SOURCE_FILE: &str = "file";

/// Candidate files we ever scan. Anything not in this set is silently
/// ignored — even if a hint points there.
fn shell_rc_files() -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir() else {
        return vec![];
    };
    [".zshrc", ".bashrc", ".profile"]
        .iter()
        .map(|name| home.join(name))
        .collect()
}

/// Scan the manifest and return one DetectionHit per pre-existing capability
/// that has a hint variable definition in any allowlisted file.
pub fn scan(manifest: &Manifest, project_dir: Option<&Path>) -> Vec<DetectionHit> {
    let mut files: Vec<PathBuf> = shell_rc_files();
    if let Some(dir) = project_dir {
        files.push(dir.join(".env"));
    }
    let file_contents: Vec<(PathBuf, String)> = files
        .into_iter()
        .filter_map(|p| std::fs::read_to_string(&p).ok().map(|c| (p, c)))
        .collect();

    let mut hits = Vec::new();
    for cap in &manifest.capabilities {
        if cap.category != Category::PreExistingDetection {
            continue;
        }
        if let Some(hit) = scan_one(cap, &file_contents) {
            hits.push(hit);
        }
    }
    hits
}

fn scan_one(cap: &Capability, files: &[(PathBuf, String)]) -> Option<DetectionHit> {
    for var_name in &cap.detection_hints.env_vars {
        let needle = format!("{}=", var_name);
        for (path, content) in files {
            if content_has_definition(content, &needle) {
                return Some(DetectionHit {
                    capability_id: cap.id.clone(),
                    source: SOURCE_FILE.into(),
                    confidence: 0.7,
                    suggestion: Some(format!(
                        "${} is defined in {}",
                        var_name,
                        display_short(path)
                    )),
                });
            }
        }
    }
    None
}

/// Look for `VAR=` either at the start of a line, after `export `, or after
/// whitespace. Avoids matching `THIS_THAT_API_KEY=` when looking for `_KEY=`.
fn content_has_definition(content: &str, needle: &str) -> bool {
    for line in content.lines() {
        let trimmed = line.trim_start();
        // Skip obvious comments — quick wins, doesn't have to be perfect.
        if trimmed.starts_with('#') {
            continue;
        }
        // Strip optional `export ` prefix.
        let candidate = trimmed.strip_prefix("export ").unwrap_or(trimmed);
        if candidate.starts_with(needle) {
            return true;
        }
    }
    false
}

fn display_short(path: &Path) -> String {
    let Some(home) = dirs::home_dir() else {
        return path.display().to_string();
    };
    if let Ok(rel) = path.strip_prefix(&home) {
        format!("~/{}", rel.display())
    } else {
        path.display().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preflight::manifest::{Capability, Category, DetectionHints, Verification};
    use std::fs;
    use tempfile::tempdir;

    fn make_cap(id: &str, hints: &[&str]) -> Capability {
        Capability {
            id: id.into(),
            catalog_ref: "x".into(),
            name: id.into(),
            category: Category::PreExistingDetection,
            purpose: None,
            sessions_requiring: vec![],
            storage: None,
            verification: Verification::SecretPresent { key: id.into() },
            value_validation: None,
            required: true,
            blocks_self_drive: false,
            detection_hints: DetectionHints {
                env_vars: hints.iter().map(|s| s.to_string()).collect(),
            },
        }
    }

    fn manifest_with(caps: Vec<Capability>) -> Manifest {
        Manifest {
            schema_version: "1.0".into(),
            project: "test".into(),
            generated_by: None,
            generated_at: None,
            capabilities: caps,
        }
    }

    #[test]
    fn content_has_definition_matches_at_line_start() {
        assert!(content_has_definition("OPENAI_API_KEY=sk-xxx", "OPENAI_API_KEY="));
    }

    #[test]
    fn content_has_definition_matches_export_form() {
        assert!(content_has_definition(
            "export OPENAI_API_KEY=sk-xxx",
            "OPENAI_API_KEY="
        ));
    }

    #[test]
    fn content_has_definition_skips_comments() {
        assert!(!content_has_definition(
            "# OPENAI_API_KEY=example",
            "OPENAI_API_KEY="
        ));
    }

    #[test]
    fn content_has_definition_does_not_match_substring_of_other_var() {
        // "_API_KEY=" should not be found as a tail of "MY_API_KEY=..." because
        // we anchor at line start (post-export-prefix).
        assert!(!content_has_definition("MY_API_KEY=v", "_API_KEY="));
    }

    #[test]
    fn project_env_file_is_scanned_when_supplied() {
        let dir = tempdir().unwrap();
        let env_path = dir.path().join(".env");
        fs::write(&env_path, "OPENAI_API_KEY=sk-real").unwrap();
        let m = manifest_with(vec![make_cap("CAP-X", &["OPENAI_API_KEY"])]);
        let hits = scan(&m, Some(dir.path()));
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].source, SOURCE_FILE);
        assert!(hits[0].suggestion.as_ref().unwrap().contains("OPENAI_API_KEY"));
    }

    #[test]
    fn project_env_file_is_not_scanned_without_explicit_project_dir() {
        let dir = tempdir().unwrap();
        let env_path = dir.path().join(".env");
        fs::write(&env_path, "OPENAI_API_KEY=sk-real").unwrap();
        let m = manifest_with(vec![make_cap("CAP-X", &["OPENAI_API_KEY"])]);
        // Caller didn't pass project dir → we don't scan it.
        let hits = scan(&m, None);
        // Only home-dir RC files are scanned; this test machine's RC files
        // probably don't define this var, so no hit. (If they do, it's still
        // a non-default behaviour we expect — ensures we don't double-count.)
        let from_explicit_env = hits.iter().filter(|h| {
            h.suggestion
                .as_ref()
                .map(|s| s.contains(env_path.to_string_lossy().as_ref()))
                .unwrap_or(false)
        });
        assert_eq!(from_explicit_env.count(), 0);
    }

    #[test]
    fn missing_env_file_silently_skips() {
        // No .env in the dir; scanner must not error.
        let dir = tempdir().unwrap();
        let m = manifest_with(vec![make_cap("CAP-X", &["X"])]);
        let _ = scan(&m, Some(dir.path()));
    }

    #[test]
    fn skips_capabilities_outside_pre_existing_detection_category() {
        let dir = tempdir().unwrap();
        let env_path = dir.path().join(".env");
        fs::write(&env_path, "OPENAI_API_KEY=sk").unwrap();
        let mut cap = make_cap("X", &["OPENAI_API_KEY"]);
        cap.category = Category::GuidedHuman;
        let m = manifest_with(vec![cap]);
        let hits = scan(&m, Some(dir.path()));
        assert!(hits.is_empty());
    }

    #[test]
    fn capability_without_hints_finds_nothing() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join(".env"), "ANYTHING=v").unwrap();
        let m = manifest_with(vec![make_cap("X", &[])]);
        let hits = scan(&m, Some(dir.path()));
        assert!(hits.is_empty());
    }
}
