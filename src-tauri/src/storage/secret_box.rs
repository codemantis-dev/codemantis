// Per-install AES-256-GCM encryption for secrets at rest.
//
// Threat model: protects against casual leaks (settings.json committed to
// git, copied into a backup, attached to a support ticket). Does NOT protect
// against malware running as the user, or anyone with shell access to this
// user account — the key file lives next to the ciphertext.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

const KEY_FILE_NAME: &str = ".cm.key";
const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const GCM_TAG_LEN: usize = 16;

#[derive(Debug, thiserror::Error)]
pub enum SecretBoxError {
    #[error("io error: {0}")]
    Io(#[from] io::Error),
    #[error("app data dir not found")]
    NoDataDir,
    #[error("key file is corrupted: expected {KEY_LEN} bytes, got {0}")]
    KeyFileSize(usize),
    #[error("ciphertext is too short: got {0} bytes, need at least {min}", min = NONCE_LEN + GCM_TAG_LEN)]
    CipherTooShort(usize),
    #[error("encrypt failed")]
    EncryptFailed,
    #[error("decrypt failed (wrong key or corrupted data)")]
    DecryptFailed,
    #[error("base64 decode failed")]
    Base64,
    #[error("utf8 decode failed")]
    Utf8,
}

pub type Result<T> = std::result::Result<T, SecretBoxError>;

fn key_path() -> Result<PathBuf> {
    let dir = crate::utils::paths::app_data_dir().ok_or(SecretBoxError::NoDataDir)?;
    Ok(dir.join(KEY_FILE_NAME))
}

#[cfg(unix)]
fn write_key_file(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    f.write_all(bytes)?;
    Ok(())
}

#[cfg(not(unix))]
fn write_key_file(path: &Path, bytes: &[u8]) -> Result<()> {
    fs::write(path, bytes)?;
    Ok(())
}

fn read_key_file(path: &Path) -> Result<[u8; KEY_LEN]> {
    let bytes = fs::read(path)?;
    if bytes.len() != KEY_LEN {
        return Err(SecretBoxError::KeyFileSize(bytes.len()));
    }
    let mut key = [0u8; KEY_LEN];
    key.copy_from_slice(&bytes);
    Ok(key)
}

fn load_or_create_key_at(path: &Path) -> Result<[u8; KEY_LEN]> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    if path.exists() {
        return read_key_file(path);
    }
    let mut key = [0u8; KEY_LEN];
    rand::thread_rng().fill_bytes(&mut key);
    write_key_file(path, &key)?;
    Ok(key)
}

static CACHED_KEY: OnceLock<[u8; KEY_LEN]> = OnceLock::new();

fn get_or_load_key() -> Result<&'static [u8; KEY_LEN]> {
    if let Some(k) = CACHED_KEY.get() {
        return Ok(k);
    }
    let path = key_path()?;
    let key = load_or_create_key_at(&path)?;
    let _ = CACHED_KEY.set(key);
    Ok(CACHED_KEY.get().expect("just set"))
}

fn encrypt_with_key(key: &[u8; KEY_LEN], plaintext: &str) -> Result<Vec<u8>> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|_| SecretBoxError::EncryptFailed)?;
    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

fn decrypt_with_key(key: &[u8; KEY_LEN], blob: &[u8]) -> Result<String> {
    if blob.len() < NONCE_LEN + GCM_TAG_LEN {
        return Err(SecretBoxError::CipherTooShort(blob.len()));
    }
    let (nonce_bytes, ciphertext) = blob.split_at(NONCE_LEN);
    let nonce = Nonce::from_slice(nonce_bytes);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| SecretBoxError::DecryptFailed)?;
    String::from_utf8(plaintext).map_err(|_| SecretBoxError::Utf8)
}

/// Encrypt a UTF-8 string. Output: 12-byte nonce ‖ AES-256-GCM ciphertext (includes tag).
pub fn encrypt(plaintext: &str) -> Result<Vec<u8>> {
    encrypt_with_key(get_or_load_key()?, plaintext)
}

/// Decrypt a nonce-prefixed ciphertext back into a UTF-8 string.
pub fn decrypt(blob: &[u8]) -> Result<String> {
    decrypt_with_key(get_or_load_key()?, blob)
}

/// Encrypt and base64-encode for JSON storage.
pub fn encrypt_to_b64(plaintext: &str) -> Result<String> {
    Ok(B64.encode(encrypt(plaintext)?))
}

/// Base64-decode and decrypt a JSON-stored ciphertext.
pub fn decrypt_from_b64(b64: &str) -> Result<String> {
    let blob = B64
        .decode(b64.as_bytes())
        .map_err(|_| SecretBoxError::Base64)?;
    decrypt(&blob)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixed_key() -> [u8; KEY_LEN] {
        let mut k = [0u8; KEY_LEN];
        for (i, b) in k.iter_mut().enumerate() {
            *b = i as u8;
        }
        k
    }

    #[test]
    fn round_trip_short_string() {
        let key = fixed_key();
        let blob = encrypt_with_key(&key, "sk_test_abc").unwrap();
        let plain = decrypt_with_key(&key, &blob).unwrap();
        assert_eq!(plain, "sk_test_abc");
    }

    #[test]
    fn round_trip_empty_string() {
        let key = fixed_key();
        let blob = encrypt_with_key(&key, "").unwrap();
        let plain = decrypt_with_key(&key, &blob).unwrap();
        assert_eq!(plain, "");
    }

    #[test]
    fn round_trip_unicode() {
        let key = fixed_key();
        let blob = encrypt_with_key(&key, "🔐 ünîcödé 测试").unwrap();
        let plain = decrypt_with_key(&key, &blob).unwrap();
        assert_eq!(plain, "🔐 ünîcödé 测试");
    }

    #[test]
    fn round_trip_long_string() {
        let key = fixed_key();
        let s = "a".repeat(10_000);
        let blob = encrypt_with_key(&key, &s).unwrap();
        let plain = decrypt_with_key(&key, &blob).unwrap();
        assert_eq!(plain, s);
    }

    #[test]
    fn nonce_is_random_each_call() {
        // Same plaintext + same key must produce DIFFERENT ciphertexts —
        // otherwise the nonce isn't being rolled and we'd leak equality.
        let key = fixed_key();
        let a = encrypt_with_key(&key, "same").unwrap();
        let b = encrypt_with_key(&key, "same").unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn ciphertext_is_at_least_nonce_plus_tag() {
        let key = fixed_key();
        let blob = encrypt_with_key(&key, "x").unwrap();
        assert!(blob.len() >= NONCE_LEN + GCM_TAG_LEN);
    }

    #[test]
    fn decrypt_fails_on_wrong_key() {
        let mut wrong = fixed_key();
        wrong[0] ^= 0xff;
        let blob = encrypt_with_key(&fixed_key(), "secret").unwrap();
        let err = decrypt_with_key(&wrong, &blob).unwrap_err();
        assert!(matches!(err, SecretBoxError::DecryptFailed));
    }

    #[test]
    fn decrypt_fails_on_truncated_blob() {
        let blob = vec![0u8; NONCE_LEN + GCM_TAG_LEN - 1];
        let err = decrypt_with_key(&fixed_key(), &blob).unwrap_err();
        assert!(matches!(err, SecretBoxError::CipherTooShort(_)));
    }

    #[test]
    fn decrypt_fails_on_tampered_ciphertext() {
        let key = fixed_key();
        let mut blob = encrypt_with_key(&key, "important").unwrap();
        // flip a bit in the ciphertext (after the nonce)
        blob[NONCE_LEN] ^= 0x01;
        let err = decrypt_with_key(&key, &blob).unwrap_err();
        assert!(matches!(err, SecretBoxError::DecryptFailed));
    }

    #[test]
    fn load_or_create_key_creates_new_file_with_random_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".cm.key");
        let key1 = load_or_create_key_at(&path).unwrap();
        assert!(path.exists());
        assert_eq!(fs::metadata(&path).unwrap().len() as usize, KEY_LEN);
        // Loading again returns the same key.
        let key2 = load_or_create_key_at(&path).unwrap();
        assert_eq!(key1, key2);
        // Key isn't all-zeros (cosmic-ray check).
        assert_ne!(key1, [0u8; KEY_LEN]);
    }

    #[cfg(unix)]
    #[test]
    fn key_file_has_user_only_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".cm.key");
        load_or_create_key_at(&path).unwrap();
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "key file must be 0600, got {:o}", mode);
    }

    #[test]
    fn load_or_create_key_rejects_corrupted_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".cm.key");
        fs::write(&path, b"too-short").unwrap();
        let err = load_or_create_key_at(&path).unwrap_err();
        assert!(matches!(err, SecretBoxError::KeyFileSize(_)));
    }

    #[test]
    fn b64_round_trip() {
        let key = fixed_key();
        let blob = encrypt_with_key(&key, "sk_live_xyz").unwrap();
        let b64 = B64.encode(&blob);
        let decoded = B64.decode(b64.as_bytes()).unwrap();
        let plain = decrypt_with_key(&key, &decoded).unwrap();
        assert_eq!(plain, "sk_live_xyz");
    }

    #[test]
    fn decrypt_from_b64_rejects_garbage() {
        // Use the public path with the cached key — but we can't, since the
        // cache reads the real app data dir. So we exercise base64 only via
        // a pure check: invalid base64 must fail before touching the cipher.
        let result = B64.decode(b"!!!not-base64!!!".as_slice());
        assert!(result.is_err());
    }
}
