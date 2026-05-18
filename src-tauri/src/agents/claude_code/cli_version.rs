//! Claude Code CLI version handling.
//!
//! Two responsibilities:
//! 1. Parse the version string emitted by `claude --version` into a `semver::Version`.
//! 2. Compare an installed version against a "latest published" baseline fetched
//!    from the npm registry, and classify it as Supported / Outdated / Unknown.
//!
//! Why not pin to a hardcoded minimum: the verified-against-live-CLI baseline
//! drifts every month. Computing the floor as `latest − N patches` keeps the
//! gate honest without code edits each release. If the registry isn't
//! reachable we fall back to a behaviour probe (see `cli_handshake_probe`).

use semver::Version;
use std::time::{Duration, Instant};

/// Number of patch versions back from the latest published release we still
/// consider "supported". Versions older than this on the same major.minor are
/// blocked. Anything below the latest minor is also blocked.
pub const SUPPORTED_PATCH_WINDOW: u64 = 10;

/// Hardcoded conservative floor used only when the npm registry is unreachable
/// AND the behaviour probe has not yet run. Matches the verified-baseline at
/// the time of writing (see project memory `project_cli_upgrade_v21126`).
pub const FALLBACK_MIN_VERSION: (u64, u64, u64) = (2, 1, 116);

/// How long to trust a cached `latest_version` lookup before refetching.
pub const LATEST_VERSION_TTL: Duration = Duration::from_secs(6 * 60 * 60);

/// npm registry "latest" tag endpoint for the Claude Code CLI package.
const NPM_LATEST_URL: &str = "https://registry.npmjs.org/@anthropic-ai/claude-code/latest";

/// User-facing classification of an installed CLI's compatibility.
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CliSupport {
    /// Version meets the minimum and we have verified registry data.
    Supported,
    /// Version is below the minimum. Block sessions.
    Outdated { reason: String },
    /// We couldn't determine compatibility (registry unreachable, version
    /// unparsable, etc.). Treat as supported by default — better to let the
    /// user proceed than block them on flaky network.
    Unknown { reason: String },
    /// CLI is not installed at all.
    NotInstalled,
}

/// Strip the optional "claude-code " prefix and parse the remainder as semver.
/// Real-world stdout is `"2.1.126 (Claude Code)"` — take the first whitespace
/// token after stripping, then strip a leading `v` if present.
pub fn parse_version(raw: &str) -> Option<Version> {
    let trimmed = raw.trim();
    let without_prefix = trimmed.strip_prefix("claude-code ").unwrap_or(trimmed);
    let token = without_prefix.split_whitespace().next()?;
    let token = token.strip_prefix('v').unwrap_or(token);
    Version::parse(token).ok()
}

/// Compute the minimum supported version given a "latest" baseline.
/// Rule: same major.minor as `latest`, patch = `latest.patch − SUPPORTED_PATCH_WINDOW`
/// (saturating). The caller is responsible for blocking versions on lower minors.
pub fn compute_min_supported(latest: &Version) -> Version {
    Version::new(
        latest.major,
        latest.minor,
        latest.patch.saturating_sub(SUPPORTED_PATCH_WINDOW),
    )
}

/// Classify an installed version against a known latest baseline.
pub fn classify(installed: &Version, latest: &Version) -> CliSupport {
    let min = compute_min_supported(latest);
    if installed.major != latest.major {
        if installed.major < latest.major {
            return CliSupport::Outdated {
                reason: format!(
                    "Detected v{installed}, but the supported major release is v{}.x. \
                     Latest is v{latest}.",
                    latest.major
                ),
            };
        }
        return CliSupport::Unknown {
            reason: format!(
                "Detected v{installed}, which is newer than the latest known release v{latest}. \
                 Proceeding optimistically."
            ),
        };
    }
    if installed.minor < latest.minor {
        return CliSupport::Outdated {
            reason: format!(
                "Detected v{installed}, minimum supported is v{min} (latest v{latest})."
            ),
        };
    }
    if installed.minor > latest.minor {
        return CliSupport::Unknown {
            reason: format!(
                "Detected v{installed}, which is ahead of the latest known release v{latest}. \
                 Proceeding optimistically."
            ),
        };
    }
    if installed < &min {
        return CliSupport::Outdated {
            reason: format!(
                "Detected v{installed}, minimum supported is v{min} (latest v{latest})."
            ),
        };
    }
    CliSupport::Supported
}

/// Cached "latest published" version. Populated lazily by `fetch_latest_version`.
pub type LatestVersionCache = tokio::sync::Mutex<Option<(Version, Instant)>>;

/// Fetch the npm-registry "latest" tag for the Claude Code CLI. Honors a
/// 6-hour cache to avoid hammering the registry across rapid rechecks.
///
/// Errors are intentionally swallowed and mapped to `None` — the caller falls
/// back to behaviour-based detection.
pub async fn fetch_latest_version(cache: &LatestVersionCache) -> Option<Version> {
    {
        let guard = cache.lock().await;
        if let Some((cached, at)) = guard.as_ref() {
            if at.elapsed() < LATEST_VERSION_TTL {
                return Some(cached.clone());
            }
        }
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .ok()?;
    let resp = client.get(NPM_LATEST_URL).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let json: serde_json::Value = resp.json().await.ok()?;
    let raw = json.get("version")?.as_str()?;
    let parsed = Version::parse(raw).ok()?;

    let mut guard = cache.lock().await;
    *guard = Some((parsed.clone(), Instant::now()));
    Some(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_version_accepts_plain_semver() {
        assert_eq!(parse_version("2.1.126"), Some(Version::new(2, 1, 126)));
    }

    #[test]
    fn parse_version_strips_claude_code_prefix() {
        assert_eq!(parse_version("claude-code 2.1.126"), Some(Version::new(2, 1, 126)));
    }

    #[test]
    fn parse_version_handles_real_world_stdout() {
        assert_eq!(parse_version("2.1.126 (Claude Code)"), Some(Version::new(2, 1, 126)));
        assert_eq!(parse_version("v2.1.126 (Claude Code)"), Some(Version::new(2, 1, 126)));
    }

    #[test]
    fn parse_version_rejects_garbage() {
        assert_eq!(parse_version(""), None);
        assert_eq!(parse_version("unreleased-dev"), None);
        assert_eq!(parse_version("nope"), None);
    }

    #[test]
    fn compute_min_saturates_when_patch_low() {
        let latest = Version::new(2, 1, 5);
        assert_eq!(compute_min_supported(&latest), Version::new(2, 1, 0));
    }

    #[test]
    fn compute_min_subtracts_window() {
        let latest = Version::new(2, 1, 126);
        assert_eq!(compute_min_supported(&latest), Version::new(2, 1, 116));
    }

    #[test]
    fn classify_in_window_is_supported() {
        let latest = Version::new(2, 1, 126);
        assert_eq!(classify(&Version::new(2, 1, 120), &latest), CliSupport::Supported);
        assert_eq!(classify(&Version::new(2, 1, 116), &latest), CliSupport::Supported);
        assert_eq!(classify(&latest, &latest), CliSupport::Supported);
    }

    #[test]
    fn classify_below_window_is_outdated() {
        let latest = Version::new(2, 1, 126);
        let result = classify(&Version::new(2, 1, 100), &latest);
        assert!(matches!(result, CliSupport::Outdated { .. }));
    }

    #[test]
    fn classify_lower_minor_is_outdated() {
        let latest = Version::new(2, 1, 126);
        let result = classify(&Version::new(2, 0, 200), &latest);
        assert!(matches!(result, CliSupport::Outdated { .. }));
    }

    #[test]
    fn classify_lower_major_is_outdated() {
        let latest = Version::new(2, 1, 126);
        let result = classify(&Version::new(1, 9, 999), &latest);
        assert!(matches!(result, CliSupport::Outdated { .. }));
    }

    #[test]
    fn classify_higher_major_is_unknown_not_outdated() {
        // Don't block users on a CLI that's newer than what we know about.
        let latest = Version::new(2, 1, 126);
        let result = classify(&Version::new(3, 0, 0), &latest);
        assert!(matches!(result, CliSupport::Unknown { .. }));
    }

    #[test]
    fn classify_higher_minor_is_unknown_not_outdated() {
        let latest = Version::new(2, 1, 126);
        let result = classify(&Version::new(2, 2, 0), &latest);
        assert!(matches!(result, CliSupport::Unknown { .. }));
    }
}
