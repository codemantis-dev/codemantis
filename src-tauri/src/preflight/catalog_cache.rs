// Catalog cache — local on-disk store for catalog entries we generate at
// runtime via the AI fallback (Phase 5). Bundled entries always take
// priority; the cache is a long-tail layer.
//
// Location: ~/Library/Application Support/<bundle>/catalog-cache/<slug>.yaml
// where <slug> is the `catalog_ref` with non-alphanumeric characters
// replaced by '-'. We only ever write `trust_tier: ai_generated` (or
// `ai_generated_verified`) entries here; curated content stays bundled.

#![allow(dead_code)]

use crate::preflight::catalog::CatalogEntry;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum CacheError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("yaml: {0}")]
    Yaml(#[from] serde_yml::Error),
    #[error("app data dir not found")]
    NoDataDir,
}

const CACHE_DIR_NAME: &str = "catalog-cache";

fn cache_root() -> Result<PathBuf, CacheError> {
    Ok(crate::utils::paths::app_data_dir()
        .ok_or(CacheError::NoDataDir)?
        .join(CACHE_DIR_NAME))
}

/// Slugify a catalog_ref into a safe filename. Lowercase ASCII alphanumerics
/// pass through; everything else becomes `-`. Leading/trailing/duplicated
/// dashes collapse so the result stays clean even for weird refs.
pub fn slugify(catalog_ref: &str) -> String {
    let mut out = String::with_capacity(catalog_ref.len());
    let mut last_was_dash = false;
    for ch in catalog_ref.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_was_dash = false;
        } else if !last_was_dash && !out.is_empty() {
            out.push('-');
            last_was_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    out
}

fn entry_path_at(root: &Path, catalog_ref: &str) -> PathBuf {
    root.join(format!("{}.yaml", slugify(catalog_ref)))
}

pub fn write(catalog_ref: &str, entry: &CatalogEntry) -> Result<(), CacheError> {
    let root = cache_root()?;
    write_at(&root, catalog_ref, entry)
}

pub fn read(catalog_ref: &str) -> Result<Option<CatalogEntry>, CacheError> {
    let root = cache_root()?;
    read_at(&root, catalog_ref)
}

pub fn delete(catalog_ref: &str) -> Result<(), CacheError> {
    let root = cache_root()?;
    delete_at(&root, catalog_ref)
}

pub fn list() -> Result<Vec<CatalogEntry>, CacheError> {
    let root = cache_root()?;
    list_at(&root)
}

// ── Path-aware variants for tests ──

pub fn write_at(
    root: &Path,
    catalog_ref: &str,
    entry: &CatalogEntry,
) -> Result<(), CacheError> {
    fs::create_dir_all(root)?;
    let path = entry_path_at(root, catalog_ref);
    let yaml = serde_yml::to_string(entry)?;
    fs::write(path, yaml)?;
    Ok(())
}

pub fn read_at(root: &Path, catalog_ref: &str) -> Result<Option<CatalogEntry>, CacheError> {
    let path = entry_path_at(root, catalog_ref);
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path)?;
    Ok(Some(serde_yml::from_str(&text)?))
}

pub fn delete_at(root: &Path, catalog_ref: &str) -> Result<(), CacheError> {
    let path = entry_path_at(root, catalog_ref);
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

pub fn list_at(root: &Path) -> Result<Vec<CatalogEntry>, CacheError> {
    if !root.is_dir() {
        return Ok(vec![]);
    }
    let mut entries = Vec::new();
    for ent in fs::read_dir(root)? {
        let ent = ent?;
        let path = ent.path();
        if path.extension().and_then(|s| s.to_str()) != Some("yaml") {
            continue;
        }
        if let Ok(text) = fs::read_to_string(&path) {
            if let Ok(entry) = serde_yml::from_str::<CatalogEntry>(&text) {
                entries.push(entry);
            }
        }
    }
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preflight::catalog::{CatalogEntry, Remediation, ServiceMeta, TrustTier};
    use crate::preflight::manifest::Verification;
    use tempfile::tempdir;

    fn fake_entry(catalog_ref: &str) -> CatalogEntry {
        CatalogEntry {
            schema_version: "1.0".into(),
            catalog_ref: catalog_ref.into(),
            display_name: catalog_ref.into(),
            service: ServiceMeta {
                name: catalog_ref.into(),
                category: None,
                homepage: None,
                icon: None,
                trust_tier: TrustTier::AiGenerated,
                last_verified: None,
            },
            description: None,
            verification_recipe: Verification::SecretPresent {
                key: catalog_ref.into(),
            },
            value_validation: None,
            remediation: Remediation::ExternalOnly { info: None },
        }
    }

    #[test]
    fn slugify_transforms_dots_and_special_chars() {
        assert_eq!(slugify("stripe.api_key.secret"), "stripe-api-key-secret");
        assert_eq!(slugify("Some Service: v2"), "some-service-v2");
        assert_eq!(slugify("ALL_UPPER_CASE"), "all-upper-case");
    }

    #[test]
    fn slugify_collapses_consecutive_dashes_and_strips_trailing() {
        assert_eq!(slugify("a..b"), "a-b");
        assert_eq!(slugify("trailing.."), "trailing");
    }

    #[test]
    fn write_then_read_round_trips() {
        let dir = tempdir().unwrap();
        let entry = fake_entry("test.cap");
        write_at(dir.path(), "test.cap", &entry).unwrap();
        let got = read_at(dir.path(), "test.cap").unwrap().unwrap();
        assert_eq!(got.catalog_ref, "test.cap");
        assert_eq!(got.service.trust_tier, TrustTier::AiGenerated);
    }

    #[test]
    fn read_nonexistent_returns_none() {
        let dir = tempdir().unwrap();
        let got = read_at(dir.path(), "nope.x").unwrap();
        assert!(got.is_none());
    }

    #[test]
    fn delete_removes_cached_entry() {
        let dir = tempdir().unwrap();
        write_at(dir.path(), "x.y", &fake_entry("x.y")).unwrap();
        delete_at(dir.path(), "x.y").unwrap();
        assert!(read_at(dir.path(), "x.y").unwrap().is_none());
    }

    #[test]
    fn delete_missing_is_noop() {
        let dir = tempdir().unwrap();
        // Must not error.
        delete_at(dir.path(), "never.existed").unwrap();
    }

    #[test]
    fn list_returns_all_cached_entries() {
        let dir = tempdir().unwrap();
        write_at(dir.path(), "a.b", &fake_entry("a.b")).unwrap();
        write_at(dir.path(), "c.d", &fake_entry("c.d")).unwrap();
        let entries = list_at(dir.path()).unwrap();
        assert_eq!(entries.len(), 2);
    }

    #[test]
    fn list_returns_empty_for_missing_root() {
        let dir = tempdir().unwrap();
        let nonexistent = dir.path().join("not-here");
        let entries = list_at(&nonexistent).unwrap();
        assert!(entries.is_empty());
    }
}
