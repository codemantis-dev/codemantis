// Project-scoped secret storage for the Preflight System.
//
// Each (project_id, capability_id) pair is a key into the encrypted store.
// The actual ciphertext lives in `settings.json::api_keys_encrypted` for
// LLM provider keys, OR in a future `preflight_secrets` settings field for
// per-project credentials. Phase 0 ships the API surface; Phase 2 adds the
// concrete settings-field plumbing alongside the verification engine.
//
// Threat model: see `storage::secret_box` — encryption-at-rest only.

#![allow(dead_code)] // Phase 2 wires this into the verification engine.

use crate::storage::secret_box;

#[derive(Debug, thiserror::Error)]
pub enum SecretError {
    #[error("encryption failed: {0}")]
    Encrypt(#[from] secret_box::SecretBoxError),
}

/// Compose the storage slot id used by both the settings file and any
/// future project-scoped store. Format: `<project_id>.<capability_id>`.
pub fn slot_id(project_id: &str, capability_id: &str) -> String {
    format!("{}.{}", project_id, capability_id)
}

/// Encrypt a plaintext secret to a base64 blob suitable for JSON storage.
pub fn encrypt(plaintext: &str) -> Result<String, SecretError> {
    Ok(secret_box::encrypt_to_b64(plaintext)?)
}

/// Decrypt a base64 ciphertext back to plaintext.
pub fn decrypt(b64: &str) -> Result<String, SecretError> {
    Ok(secret_box::decrypt_from_b64(b64)?)
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
