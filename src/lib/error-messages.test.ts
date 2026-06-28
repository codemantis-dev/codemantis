import { describe, it, expect } from "vitest";
import {
  translateError,
  translateErrorForToast,
  formatErrorAsMarkdown,
} from "./error-messages";

describe("translateError — API provider errors", () => {
  // ── OpenRouter guardrail 404 ──

  it("translates OpenRouter guardrail 404 into friendly message", () => {
    const raw =
      'OpenRouter API error 404 Not Found: {"error":{"message":"No endpoints available matching your guardrail restrictions and data policy. Configure: https://openrouter.ai/settings/privacy","code":404}}';
    const result = translateError(raw);
    expect(result.title).toBe("Model unavailable due to privacy settings");
    expect(result.remediation).toContain("openrouter.ai/settings/privacy");
    expect(result.toastMessage).not.toContain("{");
  });

  it("matches guardrail error with 'data policy' keyword", () => {
    const raw = 'OpenRouter API error 404: data policy restriction';
    const result = translateError(raw);
    expect(result.title).toBe("Model unavailable due to privacy settings");
  });

  // ── 401 Unauthorized ──

  it("translates 401 for OpenRouter", () => {
    const raw = 'OpenRouter API error 401 Unauthorized: {"error":{"message":"Invalid API key"}}';
    const result = translateError(raw);
    expect(result.title).toBe("Invalid API key");
    expect(result.message).toContain("OpenRouter");
    expect(result.toastMessage).toBe("OpenRouter: invalid API key");
  });

  it("translates 401 for OpenAI", () => {
    const raw = "OpenAI API error 401: Invalid API key";
    const result = translateError(raw);
    expect(result.title).toBe("Invalid API key");
    expect(result.message).toContain("OpenAI");
  });

  it("translates 401 for Anthropic", () => {
    const raw = "Anthropic API error 401: Unauthorized";
    const result = translateError(raw);
    expect(result.title).toBe("Invalid API key");
    expect(result.message).toContain("Anthropic");
  });

  it("translates 401 for Gemini", () => {
    const raw = "Gemini API error 401: Invalid key";
    const result = translateError(raw);
    expect(result.title).toBe("Invalid API key");
  });

  // ── Claude Code CLI not signed in (no provider prefix) ──
  // The Claude Code CLI proxies Anthropic 401 responses verbatim, with no
  // provider prefix. Must NOT route to "Settings › AI Providers" — there is
  // no API-key field for Claude Code in CodeMantis settings.

  it("translates a Claude Code CLI auth error to a 'claude login' message", () => {
    const raw =
      'API Error: 401 {"error":{"type":"authentication_error","message":"invalid x-api-key"}}';
    const result = translateError(raw);
    expect(result.title).toBe("Claude Code isn't signed in");
    expect(result.remediation).toContain("claude login");
    expect(result.remediation).not.toContain("Settings");
    expect(result.message).toContain("Pro/Max subscription");
    expect(result.toastMessage).toContain("claude login");
  });

  it("translates a bare 'API Error: 401 Unauthorized' (no provider, no body) to the CLI auth message", () => {
    const raw = "API Error: 401 Unauthorized";
    const result = translateError(raw);
    expect(result.title).toBe("Claude Code isn't signed in");
    expect(result.remediation).toContain("claude login");
  });

  it("translates 'API Error: invalid x-api-key' (no status code) to the CLI auth message", () => {
    const raw =
      'API Error: {"error":{"type":"authentication_error","message":"invalid x-api-key"}}';
    const result = translateError(raw);
    expect(result.title).toBe("Claude Code isn't signed in");
  });

  it("does NOT hijack a third-party Anthropic 401 — that still routes to Settings", () => {
    const raw = "Anthropic API error 401: Unauthorized";
    const result = translateError(raw);
    expect(result.title).toBe("Invalid API key");
    expect(result.remediation).toContain("Settings");
  });

  it("does NOT hijack a third-party OpenRouter 401 — that still routes to Settings", () => {
    const raw =
      'OpenRouter API error 401 Unauthorized: {"error":{"message":"Invalid API key"}}';
    const result = translateError(raw);
    expect(result.title).toBe("Invalid API key");
    expect(result.remediation).toContain("Settings");
  });

  // ── 402 Payment required ──

  it("translates 402 payment required", () => {
    const raw = "OpenRouter API error 402: Payment required";
    const result = translateError(raw);
    expect(result.title).toBe("Insufficient credits");
    expect(result.toastMessage).toBe("OpenRouter: insufficient credits");
  });

  // ── 403 Forbidden ──

  it("translates 403 forbidden", () => {
    const raw = "OpenAI API error 403 Forbidden: Access denied";
    const result = translateError(raw);
    expect(result.title).toBe("Access denied");
    expect(result.message).toContain("OpenAI");
  });

  // ── 404 generic (not guardrail) ──

  it("translates generic 404 with extracted JSON message", () => {
    const raw = 'OpenRouter API error 404: {"error":{"message":"Model not found: foo/bar"}}';
    const result = translateError(raw);
    expect(result.title).toBe("Model not found");
    expect(result.message).toBe("Model not found: foo/bar");
  });

  it("translates generic 404 without JSON body", () => {
    const raw = "Gemini API error 404: Not found";
    const result = translateError(raw);
    expect(result.title).toBe("Model not found");
    expect(result.message).toContain("Gemini");
  });

  // ── 429 Rate limit ──

  it("translates 429 rate limit", () => {
    const raw = "OpenAI API error 429 Too Many Requests: Rate limit exceeded";
    const result = translateError(raw);
    expect(result.title).toBe("Rate limited");
    expect(result.message).toContain("OpenAI");
    expect(result.remediation).toContain("Wait");
  });

  // ── 5xx Server errors ──

  it("translates 500 server error", () => {
    const raw = "Anthropic API error 500 Internal Server Error: Something went wrong";
    const result = translateError(raw);
    expect(result.title).toBe("Anthropic server error");
    expect(result.message).toContain("not a problem on your end");
  });

  it("translates 502 bad gateway", () => {
    const raw = "OpenRouter API error 502 Bad Gateway: upstream error";
    const result = translateError(raw);
    expect(result.title).toBe("OpenRouter server error");
  });

  it("translates 503 service unavailable", () => {
    const raw = "Gemini API error 503 Service Unavailable";
    const result = translateError(raw);
    expect(result.title).toBe("Gemini server error");
  });

  // ── Network / connection failure ──

  it("translates connection failure for OpenRouter", () => {
    const raw = "OpenRouter request failed: Connection timeout";
    const result = translateError(raw);
    expect(result.title).toBe("Connection failed");
    expect(result.message).toContain("OpenRouter");
  });

  it("translates connection failure for OpenAI", () => {
    const raw = "OpenAI request failed: dns resolution error";
    const result = translateError(raw);
    expect(result.title).toBe("Connection failed");
  });

  // ── Generic API error catch-all ──

  it("catches unrecognized API error codes with extracted message", () => {
    const raw = 'OpenRouter API error 418: {"error":{"message":"I am a teapot"}}';
    const result = translateError(raw);
    expect(result.title).toBe("OpenRouter error");
    expect(result.message).toBe("I am a teapot");
  });

  it("catches unrecognized API error codes without JSON", () => {
    const raw = "Anthropic API error 422: Unprocessable entity";
    const result = translateError(raw);
    expect(result.title).toBe("Anthropic error");
  });
});

describe("translateError — CLI errors (regression)", () => {
  it("still matches Claude CLI not found", () => {
    const raw = "Claude Code CLI not found at /usr/local/bin/claude";
    const result = translateError(raw);
    expect(result.title).toBe("Claude Code not found");
  });

  it("still matches session not found", () => {
    const raw = "Session not found: abc-123";
    const result = translateError(raw);
    expect(result.title).toBe("Session expired");
  });

  it("still matches database error", () => {
    const raw = "Database error: table locked";
    const result = translateError(raw);
    expect(result.title).toBe("Database error");
  });

  it("falls back for unknown errors", () => {
    const raw = "Something completely unrelated happened";
    const result = translateError(raw);
    expect(result.title).toBe("Something went wrong");
  });
});

describe("translateError — file read errors", () => {
  it("translates Rust UTF-8 read failure into a friendly toast", () => {
    const raw = "stream did not contain valid UTF-8";
    const result = translateError(raw);
    expect(result.title).toBe("Can't preview this file");
    expect(result.toastMessage).toBe("Can't preview binary file");
    expect(result.toastMessage).not.toContain("UTF-8");
  });

  it("also matches FromUtf8Error variants with byte index", () => {
    const raw = "invalid utf-8 sequence of 1 bytes from index 0";
    const result = translateError(raw);
    expect(result.toastMessage).toBe("Can't preview binary file");
  });
});

describe("translateError — outdated Claude CLI", () => {
  it("matches the structured ProcessError emitted by the backend on initialize failure", () => {
    const raw =
      "Initialize handshake failed: missing field. This usually means the installed Claude Code CLI is too old. Update it from the CodeMantis Welcome screen (Re-check → Update), or run `claude update`, then restart CodeMantis.";
    const result = translateError(raw);
    expect(result.title).toBe("Claude Code CLI is outdated");
    expect(result.remediation).toContain("Update Claude Code");
  });

  it("matches the protocol-failure message from sustained NDJSON parse errors", () => {
    const raw =
      "The Claude Code CLI is producing output we cannot parse (5 consecutive un-parseable lines from the CLI before any valid event).";
    const result = translateError(raw);
    expect(result.title).toBe("Claude Code CLI is outdated");
  });

  it("matches stderr 'unrecognized argument' from old CLIs that don't know stream-json", () => {
    const raw =
      "claude: error: unrecognized argument: --include-partial-messages";
    const result = translateError(raw);
    expect(result.title).toBe("Claude Code CLI is outdated");
    expect(result.toastMessage).toBe("Outdated Claude Code CLI");
  });

  it("matches the probe's 'does not advertise the stream-json protocol' phrase", () => {
    const raw =
      "The installed CLI does not advertise the stream-json protocol that CodeMantis requires (missing: stream-json).";
    const result = translateError(raw);
    expect(result.title).toBe("Claude Code CLI is outdated");
  });
});

describe("translateError — Codex context compaction failure", () => {
  it("maps the 'remote compact task: stream disconnected' error to Retry-first guidance", () => {
    const raw =
      "Error running remote compact task: stream disconnected before completion: error decoding response body";
    const result = translateError(raw);
    expect(result.title).toBe("Context compaction failed");
    // The transient compaction-stream drop is recoverable by re-running the
    // turn (the pre-v1.7.0 behavior). Guidance must steer toward Retry, NOT a
    // terminal "start a new session" dead-end, and not the generic restart.
    expect(result.remediation).toContain("Retry");
    expect(result.remediation).not.toContain("restart CodeMantis");
  });

  it("wins over the generic fallback for a bare compaction-failed string", () => {
    const result = translateError("context compaction failed");
    expect(result.title).toBe("Context compaction failed");
  });
});

describe("translateError — Codex project config (.codex/config.toml) parse failure", () => {
  // The real, full string the backend produces (Codex CLI -32600 wrapped by
  // AgentError::ProtocolError). The screenshot showed only "…failed to load
  // configurat…" because the generic fallback clipped it to 80 chars.
  const raw =
    "Protocol error: thread/start failed: rpc error -32600: failed to load configuration: " +
    "Error parsing project config file /Users/x/proj/.codex/config.toml: " +
    "TOML parse error at line 1, column 17\n  |\n1 | model = \"gpt-5.5\n  |                 ^\ninvalid basic string, expected `\"`\n";

  it("surfaces the file path and parse detail instead of the clipped fallback", () => {
    const result = translateError(raw);
    expect(result.title).toBe("Codex can't read this project's config");
    // The actionable details — full path + parse reason — must survive.
    expect(result.message).toContain("/Users/x/proj/.codex/config.toml");
    expect(result.message).toContain("TOML parse error");
    expect(result.remediation).toBeTruthy();
    expect(result.remediation).toContain("/Users/x/proj/.codex/config.toml");
    // Must NOT fall through to the generic 80-char-clipped fallback.
    expect(result.title).not.toBe("Something went wrong");
  });

  it("produces a short, file-identifying toast (not mid-word truncated)", () => {
    const toast = translateErrorForToast(raw);
    expect(toast).toBe("Codex config error in .codex/config.toml");
    expect(toast).not.toContain("…");
    expect(toast).not.toContain("...");
  });

  it("degrades gracefully when the path can't be parsed", () => {
    const result = translateError(
      "Protocol error: thread/start failed: rpc error -32600: failed to load configuration: something odd",
    );
    expect(result.title).toBe("Codex can't read this project's config");
    expect(result.toastMessage).toBe("Codex config error in .codex/config.toml");
    expect(result.message).toContain("something odd");
  });

  it("does not over-match unrelated errors (guards against greedy test)", () => {
    const result = translateError("Some unrelated failure with no config involved");
    expect(result.title).toBe("Something went wrong");
  });
});

describe("formatErrorAsMarkdown", () => {
  it("formats with title, message, and remediation", () => {
    const md = formatErrorAsMarkdown({
      title: "Test Title",
      message: "Test message.",
      remediation: "Do this to fix it.",
      toastMessage: "toast",
    });
    expect(md).toBe("**Test Title**\n\nTest message.\n\n**How to fix:** Do this to fix it.");
  });

  it("omits remediation line when undefined", () => {
    const md = formatErrorAsMarkdown({
      title: "Title",
      message: "Message.",
      toastMessage: "toast",
    });
    expect(md).toBe("**Title**\n\nMessage.");
    expect(md).not.toContain("How to fix");
  });
});
