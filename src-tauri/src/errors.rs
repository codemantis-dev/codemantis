use serde::Serialize;

#[derive(Debug, thiserror::Error)]
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
