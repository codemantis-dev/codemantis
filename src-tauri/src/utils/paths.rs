use std::path::PathBuf;

const APP_ID: &str = "dev.codemantis.app";

/// Returns the application data directory, separated by build profile.
///
/// - Release builds: `~/Library/Application Support/dev.codemantis.app/`
/// - Debug  builds: `~/Library/Application Support/dev.codemantis.app.dev/`
///
/// This ensures development sessions never leak settings, API keys,
/// or onboarding state into production builds.
pub fn app_data_dir() -> Option<PathBuf> {
    let dir_name = if cfg!(debug_assertions) {
        format!("{}.dev", APP_ID)
    } else {
        APP_ID.to_string()
    };
    dirs::data_dir().map(|d| d.join(dir_name))
}
