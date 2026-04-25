/**
 * Detects Claude Code 2.1.x's silent carve-out for writes/edits to files that
 * could escalate the agent's privileges (`.claude/settings*.json` and anything
 * under `~/.claude/`). Even with `--dangerously-skip-permissions`, the CLI
 * refuses these writes and returns a "you haven't granted it yet" error to the
 * model — the PreToolUse hook is never called, so CodeMantis can't intercept
 * the request and Auto-Accept doesn't apply. The user sees a confusing red
 * Activity entry with no explanation.
 *
 * This detector recognizes that exact pattern so the UI can append a friendly
 * hint pointing the user at the Bash heredoc workaround.
 */

const PROTECTED_PATH_PATTERNS: readonly RegExp[] = [
  // Project-scoped Claude settings (any depth — handles repos that nest the
  // .claude folder under a subdirectory).
  /(^|\/)\.claude\/settings(\.local)?\.json$/,
  // User-scope Claude config — anything under ~/.claude/, including settings,
  // hooks, plugins. Match both literal "~" and an absolute home path.
  /(^|\/)\.claude\/(settings|hooks|plugins)(\.local)?\.json$/,
];

const ERROR_SIGNATURE = /requested permissions to (write|edit).*haven't granted it yet/i;

const GUARDED_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

const HINT_MESSAGE =
  "Claude Code blocks edits to .claude/settings*.json even when permissions are skipped, " +
  "as a sandbox-escape guard. Use a Bash heredoc (cat > .claude/settings.json <<EOF …) " +
  "or edit the file from the host instead.";

/**
 * Returns a help hint when the tool result matches the protected-paths
 * carve-out, otherwise null. Inputs come straight from `ToolResultEvent`
 * and the originating activity entry — no normalization required.
 */
export function detectSettingsCarveout(args: {
  toolName: string;
  toolInput: Record<string, unknown> | undefined;
  errorContent: string | undefined | null;
  isError: boolean;
}): { hint: string } | null {
  if (!args.isError) return null;
  if (!GUARDED_TOOLS.has(args.toolName)) return null;

  const content = args.errorContent ?? "";
  if (!ERROR_SIGNATURE.test(content)) return null;

  const filePath =
    typeof args.toolInput?.file_path === "string"
      ? (args.toolInput.file_path as string)
      : typeof args.toolInput?.notebook_path === "string"
        ? (args.toolInput.notebook_path as string)
        : "";

  if (!filePath) return null;
  if (!PROTECTED_PATH_PATTERNS.some((re) => re.test(filePath))) return null;

  return { hint: HINT_MESSAGE };
}
