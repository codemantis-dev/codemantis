use serde::Serialize;

#[derive(Debug, thiserror::Error)]
#[allow(dead_code)]
pub enum AppError {
    #[error("Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code")]
    ClaudeNotFound,

    #[error("Claude CLI error: {0}")]
    ClaudeCliError(String),

    #[error("Session not found: {0}")]
    SessionNotFound(String),

    #[error("Process not running for session: {0}")]
    ProcessNotRunning(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON parse error: {0}")]
    JsonParse(#[from] serde_json::Error),

    #[error("Failed to send message: {0}")]
    SendFailed(String),

    #[error("File system error: {0}")]
    FileSystem(String),

    #[error("Database error: {0}")]
    DatabaseError(String),

    #[error("Terminal error: {0}")]
    TerminalError(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_not_found_serializes_to_expected_string() {
        let error = AppError::ClaudeNotFound;
        let json = serde_json::to_string(&error).unwrap();
        assert_eq!(
            json,
            "\"Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code\""
        );
    }

    #[test]
    fn string_variants_serialize_with_payload() {
        let cases: Vec<(AppError, &str)> = vec![
            (
                AppError::ClaudeCliError("exit code 1".into()),
                "\"Claude CLI error: exit code 1\"",
            ),
            (
                AppError::SessionNotFound("abc-123".into()),
                "\"Session not found: abc-123\"",
            ),
            (
                AppError::ProcessNotRunning("abc-123".into()),
                "\"Process not running for session: abc-123\"",
            ),
            (
                AppError::SendFailed("channel closed".into()),
                "\"Failed to send message: channel closed\"",
            ),
            (
                AppError::FileSystem("permission denied".into()),
                "\"File system error: permission denied\"",
            ),
            (
                AppError::DatabaseError("table missing".into()),
                "\"Database error: table missing\"",
            ),
            (
                AppError::TerminalError("pty spawn failed".into()),
                "\"Terminal error: pty spawn failed\"",
            ),
        ];

        for (error, expected) in cases {
            let json = serde_json::to_string(&error).unwrap();
            assert_eq!(json, expected, "mismatch for {:?}", error);
        }
    }

    #[test]
    fn from_io_error_converts_and_serializes() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let app_err = AppError::from(io_err);

        let json = serde_json::to_string(&app_err).unwrap();
        assert_eq!(json, "\"IO error: file missing\"");
    }

    #[test]
    fn from_serde_json_error_converts_and_serializes() {
        // Trigger a real serde_json::Error by parsing invalid JSON
        let serde_err = serde_json::from_str::<serde_json::Value>("not json").unwrap_err();
        let app_err = AppError::from(serde_err);

        let json = serde_json::to_string(&app_err).unwrap();
        assert!(
            json.starts_with("\"JSON parse error: "),
            "unexpected serialization: {}",
            json
        );
    }

    #[test]
    fn display_matches_serialize_output() {
        let errors: Vec<AppError> = vec![
            AppError::ClaudeNotFound,
            AppError::ClaudeCliError("boom".into()),
            AppError::SessionNotFound("s1".into()),
            AppError::ProcessNotRunning("s1".into()),
            AppError::SendFailed("closed".into()),
            AppError::FileSystem("denied".into()),
            AppError::DatabaseError("locked".into()),
            AppError::TerminalError("gone".into()),
        ];

        for error in errors {
            let display = error.to_string();
            let serialized = serde_json::to_string(&error).unwrap();
            // Serialized form is the Display string wrapped in JSON double quotes
            assert_eq!(
                serialized,
                format!("\"{}\"", display),
                "Display vs Serialize mismatch for {:?}",
                error
            );
        }
    }

    #[test]
    fn all_variants_serialize_as_json_strings_not_objects() {
        let errors: Vec<AppError> = vec![
            AppError::ClaudeNotFound,
            AppError::ClaudeCliError("x".into()),
            AppError::SessionNotFound("x".into()),
            AppError::ProcessNotRunning("x".into()),
            AppError::from(std::io::Error::other("x")),
            AppError::SendFailed("x".into()),
            AppError::FileSystem("x".into()),
            AppError::DatabaseError("x".into()),
            AppError::TerminalError("x".into()),
        ];

        for error in &errors {
            let json = serde_json::to_string(error).unwrap();
            // A JSON string starts with '"'; an object starts with '{'
            assert!(
                json.starts_with('"'),
                "{:?} serialized to a non-string JSON value: {}",
                error,
                json
            );
        }
    }

    #[test]
    fn io_and_json_from_impls_preserve_source_message() {
        let io_err = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "access denied");
        let app_err = AppError::from(io_err);
        assert_eq!(app_err.to_string(), "IO error: access denied");

        let serde_err = serde_json::from_str::<bool>("???").unwrap_err();
        let original_msg = serde_err.to_string();
        let app_err = AppError::from(serde_err);
        assert_eq!(
            app_err.to_string(),
            format!("JSON parse error: {}", original_msg)
        );
    }
}
