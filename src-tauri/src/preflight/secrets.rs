// Project-scoped secret storage for the Preflight System.
//
// Each (project_id, capability_id) pair is a slot. Ciphertext lives in
// `~/Library/Application Support/<bundle>/preflight_secrets.json` —
// separate from `settings.json` so the settings store never has to round-
// trip opaque blobs. Encryption uses `storage::secret_box` (AES-256-GCM).
//
// Threat model: see `storage::secret_box` — encryption-at-rest only.

#![allow(dead_code)] // Phase 2 wires this into the verification engine.

use crate::storage::secret_box;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

const SECRETS_FILE: &str = "preflight_secrets.json";

#[derive(Debug, thiserror::Error)]
pub enum SecretError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("encryption error: {0}")]
    Crypto(#[from] secret_box::SecretBoxError),
    #[error("app data directory not found")]
    NoDataDir,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct SecretsFile {
    /// slot_id ("<project_id>.<capability_id>") → AES-GCM ciphertext (base64).
    #[serde(default)]
    slots: HashMap<String, String>,
}

/// Compose the storage slot id used in the on-disk JSON.
pub fn slot_id(project_id: &str, capability_id: &str) -> String {
    format!("{}.{}", project_id, capability_id)
}

fn secrets_path() -> Result<PathBuf, SecretError> {
    let dir = crate::utils::paths::app_data_dir().ok_or(SecretError::NoDataDir)?;
    Ok(dir.join(SECRETS_FILE))
}

fn load_from_path(path: &Path) -> Result<SecretsFile, SecretError> {
    if !path.exists() {
        return Ok(SecretsFile::default());
    }
    let text = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&text)?)
}

fn save_to_path(path: &Path, file: &SecretsFile) -> Result<(), SecretError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(file)?;
    fs::write(path, text)?;
    Ok(())
}

/// Read a project secret by slot. Returns `None` if not stored or corrupted.
pub fn read(project_id: &str, capability_id: &str) -> Result<Option<String>, SecretError> {
    read_from_path(&secrets_path()?, project_id, capability_id)
}

/// Write a project secret. Replaces any existing value.
pub fn write(
    project_id: &str,
    capability_id: &str,
    plaintext: &str,
) -> Result<(), SecretError> {
    write_to_path(&secrets_path()?, project_id, capability_id, plaintext)
}

/// Delete a project secret. No-op if not present.
pub fn delete(project_id: &str, capability_id: &str) -> Result<(), SecretError> {
    delete_from_path(&secrets_path()?, project_id, capability_id)
}

/// Whether a slot has a stored value, without decrypting it.
pub fn is_present(project_id: &str, capability_id: &str) -> Result<bool, SecretError> {
    is_present_at_path(&secrets_path()?, project_id, capability_id)
}

// ── Path-aware variants for tests ──

fn read_from_path(
    path: &Path,
    project_id: &str,
    capability_id: &str,
) -> Result<Option<String>, SecretError> {
    let file = load_from_path(path)?;
    let key = slot_id(project_id, capability_id);
    let Some(b64) = file.slots.get(&key) else {
        return Ok(None);
    };
    match secret_box::decrypt_from_b64(b64) {
        Ok(plain) => Ok(Some(plain)),
        Err(e) => {
            log::warn!("preflight secret decrypt failed for {}: {}", key, e);
            Ok(None)
        }
    }
}

fn write_to_path(
    path: &Path,
    project_id: &str,
    capability_id: &str,
    plaintext: &str,
) -> Result<(), SecretError> {
    let mut file = load_from_path(path)?;
    let key = slot_id(project_id, capability_id);
    let cipher = secret_box::encrypt_to_b64(plaintext)?;
    file.slots.insert(key, cipher);
    save_to_path(path, &file)
}

fn delete_from_path(
    path: &Path,
    project_id: &str,
    capability_id: &str,
) -> Result<(), SecretError> {
    let mut file = load_from_path(path)?;
    let key = slot_id(project_id, capability_id);
    if file.slots.remove(&key).is_some() {
        save_to_path(path, &file)?;
    }
    Ok(())
}

fn is_present_at_path(
    path: &Path,
    project_id: &str,
    capability_id: &str,
) -> Result<bool, SecretError> {
    let file = load_from_path(path)?;
    let key = slot_id(project_id, capability_id);
    Ok(file.slots.contains_key(&key))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn slot_id_composes_project_and_capability() {
        assert_eq!(
            slot_id("atikon", "PREFLIGHT-stripe-key"),
            "atikon.PREFLIGHT-stripe-key"
        );
    }

    #[test]
    fn slot_id_handles_empty_project() {
        assert_eq!(slot_id("", "X"), ".X");
    }

    #[test]
    fn read_missing_returns_none() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("preflight_secrets.json");
        let got = read_from_path(&path, "p", "c").unwrap();
        assert!(got.is_none());
    }

    #[test]
    fn write_then_read_round_trips() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("preflight_secrets.json");
        write_to_path(&path, "atikon", "stripe", "sk_test_xyz").unwrap();
        let got = read_from_path(&path, "atikon", "stripe").unwrap();
        assert_eq!(got.as_deref(), Some("sk_test_xyz"));
    }

    #[test]
    fn write_does_not_leak_plaintext_to_disk() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("preflight_secrets.json");
        write_to_path(&path, "atikon", "stripe", "sk_test_super_secret_value").unwrap();
        let on_disk = fs::read_to_string(&path).unwrap();
        assert!(
            !on_disk.contains("sk_test_super_secret_value"),
            "plaintext leaked to disk: {}",
            on_disk
        );
    }

    #[test]
    fn delete_removes_slot() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("preflight_secrets.json");
        write_to_path(&path, "p", "c", "v").unwrap();
        assert!(is_present_at_path(&path, "p", "c").unwrap());
        delete_from_path(&path, "p", "c").unwrap();
        assert!(!is_present_at_path(&path, "p", "c").unwrap());
        assert!(read_from_path(&path, "p", "c").unwrap().is_none());
    }

    #[test]
    fn delete_missing_slot_is_noop() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("preflight_secrets.json");
        // No file yet — must not error.
        delete_from_path(&path, "p", "c").unwrap();
    }

    #[test]
    fn is_present_returns_false_for_missing() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("preflight_secrets.json");
        assert!(!is_present_at_path(&path, "p", "c").unwrap());
    }

    #[test]
    fn multiple_projects_kept_separate() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("preflight_secrets.json");
        write_to_path(&path, "alice", "openai", "key-a").unwrap();
        write_to_path(&path, "bob", "openai", "key-b").unwrap();
        assert_eq!(
            read_from_path(&path, "alice", "openai").unwrap().unwrap(),
            "key-a"
        );
        assert_eq!(
            read_from_path(&path, "bob", "openai").unwrap().unwrap(),
            "key-b"
        );
    }

    #[test]
    fn write_overwrites_existing_value() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("preflight_secrets.json");
        write_to_path(&path, "p", "c", "first").unwrap();
        write_to_path(&path, "p", "c", "second").unwrap();
        assert_eq!(
            read_from_path(&path, "p", "c").unwrap().unwrap(),
            "second"
        );
    }
}
