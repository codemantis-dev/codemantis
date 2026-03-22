/**
 * Translates raw backend error strings into user-friendly messages with remediation.
 *
 * The Rust backend serializes AppError via thiserror's Display trait, producing
 * strings like "Claude CLI error: Failed to spawn: No such file or directory (os error 2)".
 * This module pattern-matches on those stable format strings and returns structured
 * messages suitable for UI display.
 */

export interface UserError {
  title: string;
  message: string;
  remediation?: string;
  toastMessage: string;
}

interface ErrorPattern {
  test: (raw: string) => boolean;
  map: (raw: string) => UserError;
}

const lower = (s: string): string => s.toLowerCase();

const ERROR_CATALOG: ErrorPattern[] = [
  // ── Claude CLI not found / spawn failure (file not found) ──
  {
    test: (r) => {
      const l = lower(r);
      return (
        l.includes("claude code cli not found") ||
        l.includes("claude cli not found") ||
        (l.includes("failed to spawn") &&
          (l.includes("no such file") || l.includes("os error 2")))
      );
    },
    map: () => ({
      title: "Claude Code not found",
      message:
        "The Claude Code CLI could not be found on this system. CodeMantis requires it to function.",
      remediation:
        "Install it by running npm install -g @anthropic-ai/claude-code in a terminal, then restart CodeMantis. You can also set the binary path manually in Settings.",
      toastMessage: "Claude Code CLI not found",
    }),
  },

  // ── Spawn failure: permission denied ──
  {
    test: (r) => {
      const l = lower(r);
      return (
        l.includes("failed to spawn") &&
        (l.includes("permission denied") || l.includes("os error 13"))
      );
    },
    map: () => ({
      title: "Permission denied",
      message:
        "The Claude Code binary exists but cannot be executed due to file permissions.",
      remediation:
        "Run chmod +x $(which claude) in a terminal to fix permissions, or reinstall Claude Code with npm install -g @anthropic-ai/claude-code.",
      toastMessage: "Claude binary: permission denied",
    }),
  },

  // ── Generic spawn failure (catch-all after specific spawn patterns) ──
  {
    test: (r) => lower(r).includes("failed to spawn"),
    map: (r) => {
      // Extract the OS error detail if present
      const osMatch = r.match(/:\s*(.+)$/);
      const detail = osMatch ? osMatch[1] : "";
      return {
        title: "Could not start Claude Code",
        message: `The Claude Code process failed to start.${detail ? ` (${detail})` : ""}`,
        remediation:
          "Make sure Claude Code is installed and accessible. Try running claude --version in a terminal to verify. You can also set the binary path in Settings.",
        toastMessage: "Could not start Claude Code",
      };
    },
  },

  // ── Session not found ──
  {
    test: (r) => lower(r).includes("session not found"),
    map: () => ({
      title: "Session expired",
      message:
        "This session is no longer available. It may have been closed or expired.",
      remediation: "Start a new session to continue working.",
      toastMessage: "Session no longer available",
    }),
  },

  // ── Process not running ──
  {
    test: (r) => lower(r).includes("process not running"),
    map: () => ({
      title: "Session disconnected",
      message:
        "The Claude process for this session has ended unexpectedly.",
      remediation:
        "Click \"Restart Session\" to reconnect, or start a new session.",
      toastMessage: "Session disconnected",
    }),
  },

  // ── Session limit ──
  {
    test: (r) => lower(r).includes("maximum") && lower(r).includes("sessions"),
    map: () => ({
      title: "Session limit reached",
      message:
        "You've reached the maximum number of open sessions.",
      remediation:
        "Close an existing session tab before opening a new one.",
      toastMessage: "Session limit reached",
    }),
  },

  // ── Database error ──
  {
    test: (r) => lower(r).includes("database error"),
    map: () => ({
      title: "Database error",
      message:
        "CodeMantis encountered a problem with its internal database.",
      remediation:
        "Try restarting CodeMantis. Your data is backed up automatically before each launch.",
      toastMessage: "Database error",
    }),
  },

  // ── Terminal error ──
  {
    test: (r) => lower(r).includes("terminal error"),
    map: () => ({
      title: "Terminal failed to start",
      message: "Could not open the integrated terminal.",
      remediation:
        "Ensure your default shell (zsh, bash, etc.) is installed and accessible.",
      toastMessage: "Terminal error",
    }),
  },

  // ── Setup / hook script errors ──
  {
    test: (r) => {
      const l = lower(r);
      return (
        l.includes("failed to write hook") ||
        l.includes("failed to create ~/.codemantis") ||
        l.includes("failed to chmod hook")
      );
    },
    map: () => ({
      title: "Setup error",
      message:
        "CodeMantis couldn't write its configuration files to ~/.codemantis/.",
      remediation:
        "Check that you have enough disk space and write permissions for your home directory.",
      toastMessage: "Configuration error",
    }),
  },

  // ── Process I/O capture failure ──
  {
    test: (r) => {
      const l = lower(r);
      return l.includes("no stdout") || l.includes("no stdin") || l.includes("no stderr");
    },
    map: () => ({
      title: "Process communication failed",
      message:
        "Claude started but its input/output could not be captured.",
      remediation: "Try restarting the session. If this persists, restart CodeMantis.",
      toastMessage: "Process communication error",
    }),
  },

  // ── Failed to send message ──
  {
    test: (r) => lower(r).includes("failed to send message"),
    map: () => ({
      title: "Message not delivered",
      message:
        "Your message could not be sent. The connection to Claude may have been interrupted.",
      remediation: "Try sending your message again. If the problem persists, restart the session.",
      toastMessage: "Failed to send message",
    }),
  },

  // ── JSON parse error ──
  {
    test: (r) => lower(r).includes("json parse error"),
    map: () => ({
      title: "Communication error",
      message:
        "An unexpected response was received from Claude Code.",
      remediation: "Try restarting the session. This is usually a transient issue.",
      toastMessage: "Communication error",
    }),
  },

  // ── IO / File system errors ──
  {
    test: (r) => {
      const l = lower(r);
      return l.includes("io error") || l.includes("file system error");
    },
    map: () => ({
      title: "File system error",
      message:
        "A file or folder could not be accessed.",
      remediation:
        "Check that the file or folder exists and that CodeMantis has permission to access it.",
      toastMessage: "File access error",
    }),
  },
];

/**
 * Translates a raw backend error string into a user-friendly UserError object.
 */
export function translateError(raw: string): UserError {
  for (const entry of ERROR_CATALOG) {
    if (entry.test(raw)) {
      return entry.map(raw);
    }
  }

  // Fallback: extract a reasonable summary
  const brief = raw.length > 80 ? raw.slice(0, 80) + "..." : raw;
  return {
    title: "Something went wrong",
    message: brief,
    remediation:
      "Try again, or restart CodeMantis if the problem persists.",
    toastMessage: brief,
  };
}

/**
 * Returns just the brief toast-friendly message for a raw error string.
 */
export function translateErrorForToast(raw: string): string {
  return translateError(raw).toastMessage;
}
