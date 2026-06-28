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

/** Extracts the provider name (e.g. "OpenRouter") from a Rust-formatted API error string. */
function extractProviderName(raw: string): string | null {
  const match = raw.match(/^(OpenAI|Gemini|Anthropic|OpenRouter)\s/);
  return match?.[1] ?? null;
}

/** Attempts to extract a human-readable message from the JSON body embedded in an API error. */
function extractApiErrorMessage(raw: string): string | null {
  const jsonStart = raw.indexOf("{");
  if (jsonStart === -1) return null;
  try {
    const parsed = JSON.parse(raw.slice(jsonStart));
    if (typeof parsed?.error?.message === "string") return parsed.error.message;
    if (typeof parsed?.message === "string") return parsed.message;
    if (Array.isArray(parsed?.error) && typeof parsed.error[0]?.message === "string") {
      return parsed.error[0].message;
    }
  } catch {
    // Not valid JSON
  }
  return null;
}

/**
 * Formats a UserError into markdown suitable for display in a chat message bubble.
 */
export function formatErrorAsMarkdown(userError: UserError): string {
  let content = `**${userError.title}**\n\n${userError.message}`;
  if (userError.remediation) {
    content += `\n\n**How to fix:** ${userError.remediation}`;
  }
  return content;
}

const ERROR_CATALOG: ErrorPattern[] = [
  // ═══════════════════════════════════════════════════════════
  // API provider errors (OpenAI, Gemini, Anthropic, OpenRouter)
  // ═══════════════════════════════════════════════════════════

  // ── OpenRouter guardrail / data policy 404 ──
  {
    test: (r) => {
      const l = lower(r);
      return l.includes("api error") && l.includes("404") &&
        (l.includes("guardrail") || l.includes("data policy"));
    },
    map: () => ({
      title: "Model unavailable due to privacy settings",
      message:
        "No endpoints are available for this model given your current OpenRouter guardrail and data policy restrictions.",
      remediation:
        "Go to https://openrouter.ai/settings/privacy and adjust your data policy settings, then try again. Alternatively, switch to a different model.",
      toastMessage: "Model blocked by OpenRouter privacy settings",
    }),
  },

  // ── Claude Code CLI not signed in ──
  // Must run BEFORE the generic 401 pattern below. When the Claude Code CLI
  // forwards an Anthropic 401 (subscription session expired or never logged
  // in), the result string has no third-party provider prefix. The generic
  // 401 pattern's "Settings › AI Providers" remediation is wrong for this
  // case — CodeMantis has no API-key field for Claude Code itself; auth is
  // handled by the OS-level `claude login` flow.
  {
    test: (r) => {
      const l = lower(r);
      const looksLikeAuthError =
        l.includes("api error") &&
        (l.includes("401") ||
          l.includes("unauthorized") ||
          l.includes("authentication_error") ||
          l.includes("invalid x-api-key") ||
          (l.includes("invalid") && l.includes("key")));
      return looksLikeAuthError && extractProviderName(r) === null;
    },
    map: () => ({
      title: "Claude Code isn't signed in",
      message:
        "The Claude Code CLI rejected the request because it isn't authenticated with your Anthropic account. CodeMantis uses your existing Claude Pro/Max subscription via the CLI — there is no API key to configure inside CodeMantis for this.",
      remediation:
        "Open a terminal and run `claude login`, complete the browser sign-in, then start a new session in CodeMantis. (If you recently logged out of the Claude desktop app or your session expired, this also fixes it.)",
      toastMessage: "Claude Code not signed in — run 'claude login'",
    }),
  },

  // ── 401 Unauthorized / Invalid API key (third-party providers) ──
  {
    test: (r) => {
      const l = lower(r);
      return l.includes("api error") &&
        (l.includes("401") || l.includes("unauthorized") || (l.includes("invalid") && l.includes("key")));
    },
    map: (r) => {
      const provider = extractProviderName(r) ?? "The provider";
      return {
        title: "Invalid API key",
        message: `${provider} rejected your API key. It may be incorrect, expired, or revoked.`,
        remediation: "Go to Settings \u203a AI Providers, verify your API key is correct, and save it again.",
        toastMessage: `${provider}: invalid API key`,
      };
    },
  },

  // ── 402 Payment required / insufficient credits ──
  {
    test: (r) => {
      const l = lower(r);
      return l.includes("api error") &&
        (l.includes("402") || l.includes("payment required") ||
          (l.includes("insufficient") && (l.includes("credit") || l.includes("fund") || l.includes("balance") || l.includes("quota"))));
    },
    map: (r) => {
      const provider = extractProviderName(r) ?? "The provider";
      return {
        title: "Insufficient credits",
        message: `${provider} requires payment or additional credits to process this request.`,
        remediation: "Check your account balance and billing settings on the provider's website, then try again.",
        toastMessage: `${provider}: insufficient credits`,
      };
    },
  },

  // ── 403 Forbidden ──
  {
    test: (r) => {
      const l = lower(r);
      return l.includes("api error") && (l.includes("403") || l.includes("forbidden"));
    },
    map: (r) => {
      const provider = extractProviderName(r) ?? "The provider";
      return {
        title: "Access denied",
        message: `${provider} denied access to this resource. Your API key may not have the required permissions.`,
        remediation: "Verify your API key has the correct scopes/permissions, or check if the model requires a specific plan or access tier.",
        toastMessage: `${provider}: access denied`,
      };
    },
  },

  // ── 404 Not found (generic, after guardrail-specific) ──
  {
    test: (r) => {
      const l = lower(r);
      return l.includes("api error") && l.includes("404");
    },
    map: (r) => {
      const provider = extractProviderName(r) ?? "The provider";
      const apiMsg = extractApiErrorMessage(r);
      return {
        title: "Model not found",
        message: apiMsg ?? `${provider} could not find the requested model or endpoint.`,
        remediation: "Check that you've selected a valid model. The model may have been deprecated or renamed.",
        toastMessage: `${provider}: model not found`,
      };
    },
  },

  // ── 429 Rate limit ──
  {
    test: (r) => {
      const l = lower(r);
      return l.includes("api error") &&
        (l.includes("429") || l.includes("rate limit") || l.includes("too many requests"));
    },
    map: (r) => {
      const provider = extractProviderName(r) ?? "The provider";
      return {
        title: "Rate limited",
        message: `${provider} rate-limited this request. You've sent too many requests in a short period.`,
        remediation: "Wait a moment and try again. If this persists, consider using a different model or upgrading your API plan.",
        toastMessage: `${provider}: rate limited — try again shortly`,
      };
    },
  },

  // ── 5xx Server errors ──
  {
    test: (r) => {
      const l = lower(r);
      return l.includes("api error") && /\b5\d{2}\b/.test(l);
    },
    map: (r) => {
      const provider = extractProviderName(r) ?? "The provider";
      return {
        title: `${provider} server error`,
        message: `${provider} is experiencing server issues. This is not a problem on your end.`,
        remediation: "Wait a minute and try again. Check the provider's status page if the problem persists.",
        toastMessage: `${provider}: server error — try again later`,
      };
    },
  },

  // ── Network / connection failure ──
  {
    test: (r) => {
      const l = lower(r);
      return l.includes("request failed") &&
        (l.includes("openai") || l.includes("gemini") || l.includes("anthropic") || l.includes("openrouter"));
    },
    map: (r) => {
      const provider = extractProviderName(r) ?? "The provider";
      return {
        title: "Connection failed",
        message: `Could not connect to ${provider}. The service may be down or your network may be unavailable.`,
        remediation: "Check your internet connection and try again. If the problem persists, the provider may be experiencing an outage.",
        toastMessage: `${provider}: connection failed`,
      };
    },
  },

  // ── Generic API error catch-all ──
  {
    test: (r) => lower(r).includes("api error"),
    map: (r) => {
      const provider = extractProviderName(r) ?? "The API provider";
      const apiMsg = extractApiErrorMessage(r);
      return {
        title: `${provider} error`,
        message: apiMsg ?? `An error occurred while communicating with ${provider}.`,
        remediation: "Try again. If the problem persists, check your API key and model selection in Settings.",
        toastMessage: `${provider}: request failed`,
      };
    },
  },

  // ═══════════════════════════════════════════════════════════
  // Claude CLI errors
  // ═══════════════════════════════════════════════════════════

  // ── Outdated CLI: structured ProcessError emitted by the backend
  //    (initialize handshake failed, or sustained NDJSON parse failures), or
  //    raw stderr signatures from an older CLI that doesn't recognize the
  //    stream-json args we pass at spawn. All map to one card. ──
  {
    test: (r) => {
      const l = lower(r);
      return (
        l.includes("initialize handshake failed") ||
        l.includes("the installed claude code cli is too old") ||
        l.includes("we cannot parse") ||
        l.includes("unrecognized argument") ||
        (l.includes("unknown option") &&
          (l.includes("--include-partial-messages") ||
            l.includes("--input-format") ||
            l.includes("--output-format") ||
            l.includes("stream-json"))) ||
        l.includes("does not advertise the stream-json protocol")
      );
    },
    map: () => ({
      title: "Claude Code CLI is outdated",
      message:
        "Your installed Claude Code CLI is too old to communicate with CodeMantis. Update it to continue.",
      remediation:
        "Open the CodeMantis Welcome screen and click Update Claude Code (no Terminal or npm needed), then restart CodeMantis. Advanced: run `claude update`.",
      toastMessage: "Outdated Claude Code CLI",
    }),
  },

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

  // ── Codex context-compaction failure ──
  // Codex auto-compacts when a thread nears its context limit. The
  // server-side "remote compact task" stream can drop mid-way (a transient
  // network hiccup — distinct from a genuinely-too-large context, which Codex
  // reports separately as ContextWindowExceeded). Re-running the turn
  // re-attempts the compaction and usually succeeds — that's how compaction
  // recovered transparently before. So steer toward Retry, NOT a new session.
  // Match before the generic network/stream rules so this advice wins.
  {
    test: (r) => {
      const l = lower(r);
      return l.includes("compact") && (l.includes("disconnected") || l.includes("stream") || l.includes("failed"));
    },
    map: () => ({
      title: "Context compaction failed",
      message:
        "Codex was compressing this conversation to free up context and the compaction stream dropped before it finished — usually a transient hiccup. Your conversation is intact.",
      remediation:
        "Click Retry to continue — it re-runs the turn and Codex re-attempts the compaction. If it keeps failing, use Recover session to reconnect, or Start fresh thread as a last resort. The messages above are preserved either way.",
      toastMessage: "Compaction stream dropped — Retry to continue",
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

  // ── Binary / non-UTF-8 file read ──
  // Rust's fs::read_to_string serialises FromUtf8Error as
  // "stream did not contain valid UTF-8". Surfaces when the user clicks a
  // binary file (font, archive, compiled output) in the file tree.
  {
    test: (r) => {
      const l = lower(r);
      return l.includes("stream did not contain valid utf-8") || l.includes("invalid utf-8");
    },
    map: () => ({
      title: "Can't preview this file",
      message:
        "This looks like a binary file, so it can't be shown in the text editor.",
      remediation: "Open it in another app, or use a hex/binary viewer.",
      toastMessage: "Can't preview binary file",
    }),
  },

  // ── Codex: project config (.codex/config.toml) failed to parse ──
  // When Codex's `thread/start` runs, the CLI parses a project-local
  // `<project>/.codex/config.toml` if present. A TOML syntax error there is
  // returned as JSON-RPC -32600 ("failed to load configuration: Error parsing
  // project config file <path>: TOML parse error at line N, column M …") and
  // bubbles up as "Protocol error: thread/start failed: …". Without this
  // entry the generic fallback clips the message to 80 chars, hiding the file
  // path and the parse reason — i.e. the only things that tell the user what
  // to fix. Codex is correctly refusing a bad config; this just makes the
  // failure self-explanatory.
  {
    test: (r) => lower(r).includes("failed to load configuration"),
    map: (r) => {
      const path = r.match(/config file (\S+\.toml)/)?.[1] ?? null;
      const detail =
        r.match(/failed to load configuration:\s*([^]*)$/i)?.[1]?.trim() ||
        "Codex could not load the configuration for this project.";
      // Last two path segments → ".codex/config.toml" for a tidy toast.
      const fileName = path
        ? path.split("/").slice(-2).join("/")
        : ".codex/config.toml";
      return {
        title: "Codex can't read this project's config",
        message:
          "OpenAI Codex couldn't start a session because it failed to load this project's configuration:\n\n" +
          detail,
        remediation: `Fix the TOML syntax in ${
          path ?? "the project's .codex/config.toml"
        } — or delete the file if you don't need a project-local override — then reopen the project.`,
        toastMessage: `Codex config error in ${fileName}`,
      };
    },
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
