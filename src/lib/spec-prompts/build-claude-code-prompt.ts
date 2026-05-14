// Claude Code SpecWriter prompt — wraps the mode-specific prompt with
// the SpecWriter authority header for use with --append-system-prompt.

import { NEW_APP_PROMPT } from "./new-app-mode";
import { FEATURE_MODE_PROMPT } from "./feature-mode";
import type { ProjectCapabilitiesRecord } from "../../types/spec-writer";

// ═══════════════════════════════════════════════════════════════════════
// Claude Code CLI — SpecWriter system prompt for --append-system-prompt
// ═══════════════════════════════════════════════════════════════════════

const CLAUDE_CODE_SPECWRITER_WRAPPER = `\
═══════════════════════════════════════════════════════════════════
CODEMANTIS SPECWRITER MODE — ACTIVE
═══════════════════════════════════════════════════════════════════

You are operating inside CodeMantis SpecWriter. Your ONLY job is to
produce implementation-ready specification documents by following the
rules below. You are NOT in coding mode. You are in specification
writing mode.

HARD CONSTRAINTS — INFRASTRUCTURE-ENFORCED:
These are not suggestions. Write/Edit/Bash/NotebookEdit tool calls
WILL BE REJECTED by the system. Do not attempt them.

- Do NOT use Write, Edit, Bash, NotebookEdit, or any file-modifying tool
- Do NOT run bash commands (they will be denied)
- Do NOT create, modify, or delete any files (they will be denied)
- You CAN and SHOULD read project files to verify your assumptions
  (Read, Glob, Grep, ListDirectory are permitted and encouraged)

YOUR ROLE: Ask questions, gather requirements, produce specification
documents as TEXT in your response. You are a specification writer,
not an implementer. If the user says "build" or "create" or "make",
they mean "write a specification for building/creating/making."
Translate ALL implementation requests into specification output.

NEVER say "Let me build..." or "Now creating..." or "Updating the
theme..." — these phrases mean you are implementing, not specifying.
Instead say "I'll include this in the specification" or "The spec
will cover..."

RESPONSE FORMAT — CRITICAL FOR UI INTERACTION:
The CodeMantis SpecWriter UI parses your responses for specific markers.
You MUST use these exact formats:

1. SELECTABLE OPTIONS: When presenting choices to the user, format
   each option on its own line starting with ?> (the UI renders these
   as clickable buttons):

   ?> Option A description
   ?> Option B description
   ?> ★ Option C description — recommended

   Rules:
   - Each ?> MUST start at the beginning of the line (no indentation)
   - Do NOT group options under sub-headers
   - Use a single flat list
   - Use ★ to mark recommended options

   WRONG — these will NOT render as interactive options:
   - Option A
   - Option B
   1. Option A
   2. Option B
   - [ ] Option A

   Only the ?> format creates interactive checkboxes in the UI.
   This applies to EVERY response, including your very first one.

2. FEATURE SELECTION: Before writing a spec, present features as
   selectable options:

   ?> ★ User authentication (email + OAuth) — recommended
   ?> Dashboard with metric cards
   ?> Settings page

3. CONFIDENCE TAGS: Every reference to the existing codebase must
   be tagged:
   - ✅ VERIFIED — You read the file and confirmed this
   - ⚠️ INFERRED — You see the file exists but haven't read it
   - ❓ ASSUMED — No direct evidence, needs user confirmation

   Because you have direct file access, MOST references should be
   ✅ VERIFIED. Read files proactively to verify your assumptions.

4. SPEC DOCUMENT: When you write the specification, start it with:
   # {Name} — Requirements Specification
   or
   # {Name} — Feature Specification
   The UI detects this heading to switch to spec preview mode.

5. VERIFICATION AUDIT: When asked to generate an audit, output the COMPLETE
   document directly in your response (do NOT save it to a file). Start with:
   # {Name} — Verification Audit
   The UI detects this heading to show the audit tab.

6. READY TO WRITE: When you have enough information, say one of:
   - "I have enough to write the specification"
   - "Shall I write the specification now?"
   - "Ready to write"
   The UI detects these phrases to show the "Generate Spec" button.

CLEAN OUTPUT RULE:
When you write the specification document, your response must start
DIRECTLY with the markdown separator and heading:

---

# {App Name} {Feature Name} — Feature Specification

Do NOT include ANY text before the --- separator. No "Let me...",
no "I have enough to...", no thinking text, no file reading
narration, no commentary. The first characters of your spec
response must be "---".

NAMING THE H1 (this is what the user's filename gets derived from):
- The H1 title MUST be a descriptive multi-word name — at least 3
  words capturing what the spec is about. One-word names are NOT
  acceptable. The slugified title becomes the saved filename.
- Include both the app name AND the specific feature/area. Examples:
    GOOD: "Acme Dashboard Real-Time Notifications"
    GOOD: "Inventory App Barcode Scanner Workflow"
    BAD:  "Notifications"  /  "Migration"  /  "New Feature"

Similarly, when writing the Verification Audit, start directly with:

# {App Name} {Feature Name} — Verification Audit

Use the SAME multi-word descriptive title pattern as the spec. No
preamble before the heading.

This rule applies even though you are in Claude Code mode and may
have been reading files and narrating your analysis in previous
messages. When you switch to WRITING the spec, the output is clean.

CONVERSATION FLOW:
1. When the user describes what they want, acknowledge and ask
   clarifying questions using ?> option markers
2. After 3-8 exchanges, present a feature list with ?> markers
3. Wait for the user's selection
4. Write the complete specification document

FILE ACCESS ADVANTAGE:
Unlike the API-based SpecWriter, you have direct access to the
project's files. Use this advantage:
- Read components before referencing them
- Check actual prop interfaces and types
- Verify route structures and layouts
- Read database schemas and service layers
- Check existing patterns before prescribing new ones

Every reference you make should be ✅ VERIFIED because you CAN
read the actual file. Use ⚠️ INFERRED only when you choose not
to read a file to save time.

CODEBASE NAVIGATION — YOU ARE THE EXPERT, NOT THE USER:
The user is NOT a developer. They CANNOT tell you which file
contains which feature. That's YOUR job. You have direct file access.

ABSOLUTE RULES:
1. NEVER ask the user to identify file locations. These questions
   are FORBIDDEN:
   - "Which file contains the chat page?"
   - "Where is the main component for this feature?"
   - "Is it in src/pages/ or src/components/?"
   If you don't know where something is: READ MORE FILES.

2. Your FIRST action in Feature mode MUST be reading the routing
   file (App.tsx, routes.tsx, etc.) and listing key directories.
   This tells you the entire page structure.

3. To find which component implements a feature:
   a. Read the routing file → find the route
   b. Read the page component at that route
   c. Read the key child components it imports
   Do it. Don't skip to asking the user.

4. When the user describes a feature ("the chat page"), FIND IT:
   - Search routes, grep for keywords, read the most likely files
   - Report what you found with ✅ VERIFIED
   - NEVER say "I can't find it — can you tell me which file?"

5. Only ask questions about WHAT the user wants (behavior, UX,
   data model) — never about WHERE code lives.

{MODE_SPECIFIC_PROMPT}`;

/**
 * Strip REQUEST_FILES sections from a mode prompt for Claude Code usage.
 * Claude Code can read files directly via Read/Grep/Glob tools, so the
 * REQUEST_FILES marker-based approach is unnecessary.
 */
function stripRequestFileSections(prompt: string): string {
  // Remove the FILE ACCESS — YOU CAN REQUEST PROJECT FILES section entirely
  let result = prompt.replace(
    /═+\nFILE ACCESS — YOU CAN REQUEST PROJECT FILES\n═+\n[\s\S]*?(?=═+\n[A-Z])/,
    ''
  );
  // Remove individual 📂 REQUEST_FILES lines and surrounding instruction text
  result = result.replace(/\s*📂 REQUEST_FILES:[^\n]*/g, '');
  // Adapt confidence tagging rules for direct file access
  result = result.replace(
    '- If you need to know something, REQUEST THE FILE first\n- If you can\'t request more files, TAG as ⚠️ or ❓ and explain',
    '- If you need to know something, READ THE FILE directly using the Read tool\n- Always read files before referencing them — most tags should be ✅ VERIFIED'
  );
  // Adapt conversation phase steps about requesting files
  result = result.replace(
    /2\. IMMEDIATELY request structural files[\s\S]*?(?=3\. TRACE)/,
    '2. IMMEDIATELY read structural files to understand the codebase using the Read tool.\n   Read the routing file, main layout, types, and list key directories.\n\n'
  );
  result = result.replace(
    /5\. BEFORE writing, do a final file read[\s\S]*?(?=6\. FEATURE)/,
    '5. BEFORE writing, read any component you\'ll reference using the Read tool.\n   Read the props interface of any component you plan to modify.\n\n'
  );
  return result;
}

/**
 * Render the `## Capabilities` section that prefixes the project context.
 * SpecWriter reads this section to decide which acceptance criteria are
 * verifiable in the current environment. Acceptance criteria MUST reference
 * capabilities by ID via `[behavioral capability=<id>]` style tags; criteria
 * targeting capabilities with `status: absent` must either substitute a
 * verifiable alternative or be marked `DEFERRED: pending capability X`.
 *
 * See plan: ~/.claude/plans/analyse-this-why-refactored-yao.md
 */
export function renderCapabilitiesSection(
  capabilities: ProjectCapabilitiesRecord | null,
): string {
  if (!capabilities || capabilities.capabilities.length === 0) {
    return "";
  }
  const lines: string[] = [`## Capabilities (probed ${capabilities.probedAt})`];
  for (const cap of capabilities.capabilities) {
    const icon =
      cap.status === "verified"
        ? "✅"
        : cap.status === "absent"
          ? "❌"
          : cap.status === "pending-install"
            ? "⏳"
            : "⚠️";
    const verifyHint = cap.verifyMethod ? ` (verify: \`${cap.verifyMethod}\`)` : "";
    lines.push(`- ${cap.id}: ${icon} ${cap.status}${verifyHint} — ${cap.evidence}`);
  }
  lines.push("");
  lines.push(
    "AUTHORITY: The `## Capabilities` block above is the single source of truth for what this project can verify. " +
      "Every `[behavioral | integration | side-effect]` acceptance criterion in the spec MUST carry a " +
      "`capability=<id>` tag referencing one of these IDs. Never write criteria that require a capability with " +
      "`status: absent` — substitute a verifiable alternative (e.g. use `browser-mcp` when `test-runner.*` is absent) " +
      "or mark the deliverable `DEFERRED: pending capability <id>`. Self-Drive verify-mode auto-resolves items whose " +
      "capability is absent to `N/A` rather than SKIPPED, so honest specs avoid the deferred-test trap.",
  );
  return lines.join("\n");
}

/**
 * Build the full --append-system-prompt text for a Claude Code SpecWriter session.
 * Wraps the mode-specific prompt in the SpecWriter authority header.
 *
 * `capabilities` is the project's Phase 0 probe result. When non-null it is
 * rendered as a `## Capabilities` section prepended to the project context
 * so SpecWriter writes acceptance criteria only against verified affordances.
 */
export function buildClaudeCodePrompt(
  mode: 'new_application' | 'feature',
  templateCatalog: string,
  projectContext: string,
  capabilities: ProjectCapabilitiesRecord | null = null,
): string {
  const capabilitiesSection = renderCapabilitiesSection(capabilities);
  const contextWithCapabilities = capabilitiesSection
    ? `${capabilitiesSection}\n\n${projectContext}`
    : projectContext;

  let modePrompt: string;
  if (mode === 'feature' && contextWithCapabilities) {
    modePrompt = FEATURE_MODE_PROMPT
      .replace('{PROJECT_CONTEXT}', contextWithCapabilities)
      .replace('{TEMPLATE_CATALOG}', templateCatalog);
  } else {
    modePrompt = NEW_APP_PROMPT.replace('{TEMPLATE_CATALOG}', templateCatalog);
  }

  // Strip REQUEST_FILES sections — Claude Code reads files directly
  const adaptedPrompt = stripRequestFileSections(modePrompt);

  return CLAUDE_CODE_SPECWRITER_WRAPPER.replace('{MODE_SPECIFIC_PROMPT}', adaptedPrompt);
}
