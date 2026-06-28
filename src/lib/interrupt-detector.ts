/**
 * Detects the Claude Code CLI's generic "user rejected / interrupted" artifact.
 *
 * When a tool call is cancelled by an interrupt (e.g. the user sends a new
 * message while a tool is still running — the exact case where a slow MCP tool
 * like the stable-browser-gateway hangs), the CLI synthesises a tool_result
 * with this fixed, reason-less text and an accompanying
 * `[Request interrupted by user for tool use]` user message. See the
 * transcript-forensics writeup in docs/internal/cli-2.1.126-protocol-report.md
 * (S21) and memory project_mcp_tool_interrupt_mislabel.
 *
 * CodeMantis must NOT render this as a tool *error* / rejection: in CodeMantis's
 * hook architecture a real host deny ALWAYS carries a specific reason (e.g.
 * "Approval timed out", "CodeMantis approval server unavailable"), so this
 * reason-less canned string is never a CodeMantis decision. Treating it as an
 * error makes the agent claim it is "waiting for approval" the user was never
 * shown — the reported confusion.
 *
 * NOTE: a CLI-side permission deny (no host prompt) produces the same canned
 * string, but those also carry a `permission_denials` entry in the `result`
 * event and are surfaced separately by the CliDeniedNoPrompt cross-check
 * (message_router.rs). At the tool_result level we classify the canned string
 * as an interruption, which is the dominant real-world case.
 */

/** The CLI's fixed, reason-less rejection/interruption prologue. */
export const CLI_INTERRUPT_REJECTION_PREFIX =
  "The user doesn't want to proceed with this tool use.";

/** The synthetic user message the CLI injects for an interrupted tool call. */
export const CLI_INTERRUPT_USER_MARKER =
  "[Request interrupted by user for tool use]";

/**
 * Prepended to the CLI payload of the message that follows an interrupt-cancelled
 * tool (display copy stays unprefixed). Counters the CLI's "wait for the user to
 * tell you how to proceed" text so the model doesn't falsely claim it's blocked
 * on an approval the user was never shown.
 */
export const INTERRUPT_CLARIFICATION_NOTE =
  "<system-reminder>Your previous tool call was interrupted because it was stopped " +
  "or a new message arrived while it was still running (e.g. a slow MCP tool). It " +
  "was NOT rejected by the user, and there is no approval pending or required — the " +
  "user was never shown an approval prompt. Do not say you are waiting for approval; " +
  "just proceed with the request below.</system-reminder>";

/**
 * True when a tool_result's content is the CLI's generic interrupt/rejection
 * artifact (cancelled tool, no host-supplied reason).
 */
export function isInterruptCancellation(content: string | null | undefined): boolean {
  if (!content) return false;
  return content.trimStart().startsWith(CLI_INTERRUPT_REJECTION_PREFIX);
}
