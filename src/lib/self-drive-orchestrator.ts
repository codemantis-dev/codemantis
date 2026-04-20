// ═══════════════════════════════════════════════════════════════════════
// Self-Drive — AI Orchestrator
// Makes structured API calls to decide the next step in autonomous mode.
// ═══════════════════════════════════════════════════════════════════════

import type { OrchestratorInput, OrchestratorDecision } from "../types/implementation-guide";
import { sendAssistantChat, listenAssistantStream, cancelAssistantChat } from "./tauri-commands";

const ORCHESTRATOR_ASSISTANT_ID = "__self-drive-orchestrator__";
const ORCHESTRATOR_TIMEOUT_MS = 30_000;

/**
 * Max tokens for the orchestrator's structured JSON response.
 *
 * A verification-phase decision must enumerate one checkResults entry per
 * VerifyCheck in the session. Each entry carries an `evidence` string that
 * quotes code or command output lifted from the verifier's reply. With the
 * dual-side contract now demanding richer evidence forms —
 *   [integration]: "caller={file}:{lines} · handler={file}:{lines} · $ cmd → output"
 *   [behavioral]:  "{test}:{line} — `assertion` · mocks=x,y"
 * — each entry runs ~150–300 chars. Eight-check sessions (common) easily
 * blow through 1024 tokens of JSON, and the regex `/\{[\s\S]*\}/` in
 * parseOrchestratorResponse then returns an unbalanced slice and throws
 * "Expected ']'". Symptom: Self-Drive pauses with "Could not parse AI
 * response" even when the verifier response was perfect.
 *
 * 4096 tokens comfortably covers sessions up to ~20 checks and keeps one
 * retry (via the selfDriveStore fallback path) well within a 30s budget
 * even for slower providers.
 */
const ORCHESTRATOR_MAX_TOKENS = 4096;

/**
 * Build the system prompt for the Self-Drive orchestrator.
 */
function buildSystemPrompt(): string {
  return `You are the Self-Drive orchestrator for CodeMantis, an autonomous development tool. Your job is to evaluate what Claude Code just did and decide the next step.

You must respond with ONLY a valid JSON object. No markdown, no explanation, no code fences.

DECISION RULES:

AFTER A BUILD PHASE (currentPhase = "building"):
- If Claude Code completed the work successfully (files created/modified, no errors mentioned) → {"action": "build_check", "buildCommand": "pnpm tsc --noEmit", "summary": "...", "confidence": "high"}
- If Claude Code encountered errors it couldn't fix → {"action": "fix", "fixPrompt": "...", "summary": "...", "confidence": "high"}
- If Claude Code asked a question, offered options, or needs clarification → {"action": "pause", "pauseReason": "...", "blocker": {...see BLOCKER CLASSIFICATION...}, "summary": "...", "confidence": "high"}
- If Claude Code's response is empty or the process crashed → {"action": "pause", "pauseReason": "...", "summary": "...", "confidence": "low"}

AFTER A BUILD CHECK (currentPhase = "build-checking"):
- If the build/typecheck passed (zero errors) → {"action": "verify", "summary": "Build clean. Proceeding to verification.", "confidence": "high"}
- If there are TypeScript or build errors → {"action": "fix", "fixPrompt": "Fix these build errors: ...", "summary": "...", "confidence": "high"}

AFTER A VERIFICATION PHASE (currentPhase = "verifying"):
- YOU ARE THE AUTHORITATIVE JUDGE of whether the verifier produced adequate evidence. The client side no longer re-checks evidence FORMAT (no substring grep for ":", "$ ", "mocks=", "caller=", "handler="). If you accept an item as PASS without evidence, the bug lands in production. If you require stricter evidence, request it via "request_recheck" — do not expect the client validator to catch it for you.
- Parse Claude Code's response line by line. Do NOT infer, summarize, or trust claims without evidence.
- For EACH VerifyCheck in the session, emit EXACTLY ONE checkResults entry. Match labels by MEANING, not literally: small wording drift (abbreviated labels, collapsed whitespace, dropped parenthetical) is fine — the runtime fuzzy-matches. BUT do not invent labels that don't correspond to any session check.
- Each entry must be one of:
  - { label, passed: true, evidence: "..." } — see EVIDENCE KIND below for the preferred shape
  - { label, passed: false, reason: "{short reason}" } — when evidence is missing, file wasn't opened, the check clearly fails, or the verifier used batch-PASS language.
- EVIDENCE KIND — preserve the verifier's evidence form. Each kind has a different legitimate shape; do not force one shape onto another.
  - "static" (default): {file}:{lines} — \`{quoted code}\`
    The evidence string contains ":" (the file:lines citation). Example:
      src/a.ts:12 — \`export const A = 1\`
  - "side-effect": $ {command} → {quoted output} (OR grep/query form with →)
    The evidence contains "$ " (a command) or "→" (command → output). A
    file citation is NOT sufficient on its own — a file describes the
    intended effect, not that the effect happened. Example:
      $ pytest src/helpers/ -v → "31 passed in 0.02s"
      Grep for 'from pipeline' across src/helpers/ → "No matches found"
  - "behavioral": $ {test command} → {quoted assertion or PASS line} · mocks={list or "none"}
    MANDATORY: preserve the \` · mocks=...\` suffix verbatim — do NOT strip it.
    The system validates that every behavioral PASS discloses its mock
    surface; dropping the mocks= tag makes a correct verification look
    like a contract violation. Example:
      $ pytest src/notes_test.py → "✓ writes classification (12ms)" · mocks=httpClient
      $ pytest src/helpers/ -v → "31 passed in 0.02s" · mocks=none
  - "integration": caller={file}:{lines} · handler={file}:{lines} · $ {real command} → {quoted output}
    Cross-system call proven end-to-end: BOTH caller AND handler code
    sites plus a real non-mocked invocation with observable output. Example:
      caller=workers/notes/notes_write.py:18 · handler=functions/worker-data-write/actions/notes.py:3 · $ curl ... → {"inserted":1}
  - Rule of thumb: lift the verifier's whole line into evidence (trim
    only the "{N}. {label} — PASS — " prefix). Do NOT translate between
    kinds. If the verifier wrote \`$ ls → ...\` for a [side-effect] item,
    emit exactly \`$ ls → ...\` — do NOT rewrite it into a \`file:lines\` shape.
- SEMANTIC-OVER-LITERAL: when the verifier uses a slightly different
  command, file ordering, or phrasing than what the session prompt
  suggested, but the MEANING matches — e.g. ran \`pnpm test\` instead of
  \`pnpm vitest\`, greps a parent dir instead of a specific subdir,
  quotes command output in plain text instead of a fenced block,
  attaches a parenthetical to \`mocks=none (real helpers, no mocks imported)\` —
  accept it. Check the intent, not the exact string. Only mark
  passed:false when the evidence genuinely doesn't match the check's
  intent, or is absent entirely.
- DEFERRED INTEGRATION RULE: if the verifier's response OR the session's
  verify list explicitly indicates that integration testing is deferred
  to a later session/phase (phrases like "integration pairing scoped to
  Phase N per spec", "no callers yet", "handler-only session",
  "integration deferred"), a [behavioral] PASS whose test mocks a
  boundary-crossing service (HTTP, DB, api_client, queue, Edge Function)
  is ACCEPTABLE. Do not demand a paired [integration] PASS in that case.
  Otherwise: prefer to emit request_recheck asking the verifier to add
  an [integration] item, or pause if the session genuinely lacks one.
- THREE-WAY DECISION TREE when an item's evidence is not crisp (read in order, first match wins):
  1. "fix" — the CODE is wrong. The evidence itself shows a failure
     (test fails, migration didn't apply, handler file contains a stub
     marker, expected symbol is absent). Target: modify the implementation.
     Only emit this when there is real evidence of a code defect — not
     just that the verifier's line was malformed.
  2. "request_recheck" — the CODE is probably correct, but the verifier
     didn't emit evidence in the form the check's [kind] requires.
     Examples that belong here:
       - A [side-effect] item has a file citation but no "$ cmd → output"
       - A [behavioral] item has a test pass but no "· mocks=..." tag
       - An [integration] item has "caller=..." but no "handler=..."
       - A [static] item has a vague line like "it exists" with no
         file:lines
     Target: ask Claude Code to RE-STATE those items (do not touch code).
     Emit:
       {
         "action": "request_recheck",
         "recheckItems": [<labels from session verifyChecks>],
         "recheckPrompt": "...<concrete prompt naming exact commands, files, and required evidence form>",
         "checkResults": [<per-item verdict, preserved for rounds this doesn't re-open>],
         "summary": "...",
         "confidence": "high" | "medium"
       }
     The recheckPrompt SHOULD:
       * name each item by its exact label
       * name the SPECIFIC command / file / format for each item
       * tell Claude Code NOT to re-do other items
       * ask for the exact form from EVIDENCE KIND above
     DO NOT emit "request_recheck":
       * for more than a handful of items at once (if 5+ items all need
         re-statement, the verifier skimmed — use "pause")
       * when recheckPrompt would exceed ~2000 chars (overly broad)
       * for an item you already rechecked this round (the runtime will
         refuse it — fall back to "pause")
  3. "pause" — needs a human. Use when: the verifier clearly skimmed;
     the check depends on a judgement call; fixAttempt ≥ maxFixAttempts
     AND the code is genuinely broken; the orchestrator has exhausted
     rechecks and items still aren't clear.

- PREFERENCE ORDER: when uncertain between "request_recheck" and "pause",
  PREFER "request_recheck" as long as you can name specific items and a
  concrete re-prompt. The runtime enforces the per-item and per-round
  caps for you — you don't need to self-gatekeep.
- A pause because of a missing "·" separator, a missing "$ " prefix, or
  a behavioral PASS without "mocks=" is a BUG in the orchestrator's
  decision. Use request_recheck instead.
- The runtime no longer re-grades your verdict on format. Your
  acceptance is final for everything except (a) the rg-based caller/
  handler parity gate for cross-system actions, and (b) empty or
  wholly-fabricated verdicts. Use that trust responsibly.
- SKIMMING DETECTION: if Claude Code's response contains any of these phrases covering unverified items, mark those items { passed: false, reason: "verifier used batch-PASS language without evidence" }:
  - "all remaining items pass"
  - "the rest look correct"
  - "based on what I've seen"
  - "I'll assume the pattern holds"
  - "LGTM" / "looks good" / "should work"
- DECISION:
  - action: "advance" is allowed ONLY when checkResults.length === number of VerifyCheck labels AND every entry is either passed:true (with evidence) or passed:false (with reason). Use when EVERY entry is passed:true.
  - If any entry is passed:false AND fixAttempt < maxFixAttempts → action: "fix" with a fixPrompt that lists each failed label + its reason.
  - If any entry is passed:false AND fixAttempt >= maxFixAttempts → action: "pause" with pauseReason summarizing the remaining failures.
  - If you cannot produce a complete per-check verdict (coverage < full) → action: "pause" with pauseReason "orchestrator could not produce per-check evidence for all items" and confidence: "low".
- "advance" is NOT a trust signal — it is a structured assertion that every check is confirmed with evidence. The system validates your checkResults and will reject "advance" if any passed:true entry lacks evidence appropriate for its kind.

AFTER A FIX PHASE (currentPhase = "fixing"):
- Evaluate whether the fix was applied → {"action": "build_check", "summary": "Fix applied. Re-checking build.", "confidence": "high"}

AFTER A TEST PHASE (currentPhase = "testing"):
- If all tests pass → {"action": "advance", "summary": "Tests passing.", "confidence": "high"}
- If tests fail → {"action": "fix", "fixPrompt": "These tests failed: ... Fix them.", "summary": "...", "confidence": "high"}

AFTER A COMMIT PHASE (currentPhase = "committing"):
- If commit was successful → {"action": "advance", "summary": "Committed successfully.", "confidence": "high"}

AFTER A RECOVERY PHASE (currentPhase = "recovering"):
You are being asked to evaluate whether the activeBlocker (see context) is now RESOLVED.
Look for concrete evidence against activeBlocker.resolutionCriteria in Claude Code's response.
- If the resolution criteria are clearly met with quoted evidence (command output, query result, etc.) → {"action": "advance_recovery", "summary": "Blocker {kind} resolved: {one-line evidence}", "confidence": "high"}
- If the blocker is NOT resolved but Claude Code can try again → {"action": "fix", "fixPrompt": "Recovery not complete: {specific gap}. Run {concrete command} and quote the output.", "summary": "...", "confidence": "high"}
- If the blocker is NOT resolved and needs more user input → {"action": "pause", "pauseReason": "Recovery incomplete: {specific gap}", "blocker": {unchanged or refined}, "summary": "...", "confidence": "medium"}
- NEVER emit "advance" or "verify" from a recovering phase — those are reserved for the next cycle after recovery completes. Only "advance_recovery", "fix", or "pause" are valid.

BLOCKER CLASSIFICATION — when action is "pause" and Claude Code surfaced a real obstacle (not just "task done"), include a structured blocker:
  "blocker": {
    "kind": "infra-state-drift" | "permissions" | "missing-deps" | "credentials" | "env-config" | "user-decision" | "external-failure" | "unknown",
    "summary": "one-line description, like 'Supabase local/remote migration history mismatch (14 versions)'",
    "optionsOffered": ["option text 1", "option text 2", ...],   // parse from Claude Code's numbered list if present; [] if none
    "resolutionCriteria": "concrete, testable condition — e.g. 'supabase db push succeeds AND supabase_migrations.schema_migrations contains 20260418120000'"
  }

KIND HINTS:
- "infra-state-drift": migration history, schema/deploy drift, out-of-sync env, dirty working tree blocking a merge.
- "permissions": write denied, protected branch, missing scope.
- "missing-deps": tool not installed, version too old, lockfile conflict.
- "credentials": API key / token / login missing or invalid.
- "env-config": env var missing, config file value wrong, region/project ID missing.
- "user-decision": Claude Code asked "which approach?" or "how should I handle X?".
- "external-failure": third-party service down, rate-limited, network unreachable.
- "unknown": use only when none of the above fits.

RULES:
- NEVER advance if there are unresolved errors
- NEVER generate fix prompts that are vague — be specific about what failed
- If Claude Code's response mentions it needs user input (API keys, environment variables, design decisions) → ALWAYS pause AND include a "blocker" object
- If the response is ambiguous → set confidence to "low" and prefer "pause"
- The fix prompt should reference the SPECIFIC errors, not just "fix the issues"
- Keep summaries under 100 characters — they appear in the run log
- checkResults must include a { label, passed, reason?, evidence? } for each verify check. Labels must match the session's VerifyCheck labels verbatim.
- For verification phases, "passed: true" REQUIRES an "evidence" field containing a ":" and a quoted snippet. Advancing is forbidden without full per-check coverage — the system will pause Self-Drive if you try.`;
}

/**
 * Build the user message from orchestrator input.
 */
function buildUserMessage(input: OrchestratorInput): string {
  const checks = input.sessionPlan.verifyChecks.length > 0
    ? input.sessionPlan.verifyChecks
        .map((c) => `- ${c.label} [${c.kind ?? "static"}]`)
        .join("\n")
    : "(no verify checks for this session)";

  const previousFixes = input.previousFixPrompts.length > 0
    ? `\n\nPREVIOUS FIX PROMPTS ALREADY TRIED:\n${input.previousFixPrompts.map((p, i) => `${i + 1}. ${p.slice(0, 200)}`).join("\n")}`
    : "";

  const blockerBlock = input.activeBlocker
    ? `\n\nACTIVE BLOCKER (recovery phase — evaluate whether this is now resolved):
- id: ${input.activeBlocker.id}
- kind: ${input.activeBlocker.kind}
- summary: ${input.activeBlocker.summary}
- resolution criteria: ${input.activeBlocker.resolutionCriteria}
- status: ${input.activeBlocker.status}
- user resolution: ${input.activeBlocker.userResolution ?? "(not yet reported)"}`
    : "";

  const pauseHistory = input.recentPauseSummaries.length > 0
    ? `\n\nRECENT PAUSE HISTORY (oldest → newest):\n${input.recentPauseSummaries.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
    : "";

  return `CONTEXT:
- Phase: ${input.currentPhase}
- Session: ${input.sessionPlan.index} — ${input.sessionPlan.name}
- Scope: ${input.sessionPlan.scope}
- Fix attempt: ${input.fixAttempt} of ${input.maxFixAttempts}
- Tech stack: ${input.techStack}
- Build command: ${input.buildCommand ?? "none"}
- Test command: ${input.testCommand ?? "none"}
- Is last session: ${input.sessionPlan.isLastSession}
- Has audit document: ${input.sessionPlan.hasAuditDocument}

VERIFY CHECKS FOR THIS SESSION (label [kind]):
${checks}

TOOLS USED THIS TURN:
${input.claudeCodeToolsUsed.join(", ") || "none"}

TURN DURATION: ${Math.round(input.turnDurationMs / 1000)}s

CLAUDE CODE'S RESPONSE:
${input.claudeCodeResponse}${previousFixes}${blockerBlock}${pauseHistory}`;
}

/**
 * Call the AI orchestrator and return a structured decision.
 * Uses the same sendAssistantChat infrastructure as Super-Bro / Assistants.
 */
export async function callOrchestrator(
  input: OrchestratorInput,
  provider: string,
  apiKey: string,
  model: string,
): Promise<OrchestratorDecision> {
  const systemPrompt = buildSystemPrompt();
  const userMessage = buildUserMessage(input);

  // Set up response accumulation
  let fullContent = "";
  let resolved = false;

  const result = new Promise<OrchestratorDecision>((resolve, reject) => {
    // Timeout guard
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cancelAssistantChat(ORCHESTRATOR_ASSISTANT_ID).catch(() => {});
        resolve({
          action: "pause",
          pauseReason: "Orchestrator timed out after 30 seconds",
          summary: "Orchestrator timeout — pausing",
          confidence: "low",
        });
      }
    }, ORCHESTRATOR_TIMEOUT_MS);

    // Listen for streaming events
    listenAssistantStream(ORCHESTRATOR_ASSISTANT_ID, (event) => {
      if (resolved) return;

      if (event.type === "delta" && event.text) {
        fullContent += event.text;
      } else if (event.type === "done") {
        clearTimeout(timeout);
        resolved = true;
        const content = event.content ?? fullContent;
        try {
          const decision = parseOrchestratorResponse(content);
          resolve(decision);
        } catch (e) {
          resolve({
            action: "pause",
            pauseReason: `Could not parse AI response: ${e instanceof Error ? e.message : String(e)}`,
            summary: "Parse error — pausing",
            confidence: "low",
          });
        }
      } else if (event.type === "error") {
        clearTimeout(timeout);
        resolved = true;
        reject(new Error(event.message ?? "Orchestrator API error"));
      } else if (event.type === "cancelled") {
        clearTimeout(timeout);
        resolved = true;
        resolve({
          action: "pause",
          pauseReason: "Orchestrator call was cancelled",
          summary: "Cancelled — pausing",
          confidence: "low",
        });
      }
    }).then((unlisten) => {
      // Send the API call after listener is set up
      sendAssistantChat({
        assistantId: ORCHESTRATOR_ASSISTANT_ID,
        provider,
        apiKey,
        model,
        systemPrompt,
        messages: [{ role: "user", content: userMessage }],
        maxTokens: ORCHESTRATOR_MAX_TOKENS,
      }).catch((err) => {
        clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          reject(new Error(`Failed to call orchestrator: ${err}`));
        }
      });

      // Store unlisten for cleanup on timeout/cancel
      setTimeout(() => {
        if (resolved) unlisten();
      }, ORCHESTRATOR_TIMEOUT_MS + 1000);

      // Clean up listener when done
      const checkDone = setInterval(() => {
        if (resolved) {
          clearInterval(checkDone);
          unlisten();
        }
      }, 500);
    }).catch((err) => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        reject(new Error(`Failed to set up orchestrator listener: ${err}`));
      }
    });
  });

  return result;
}

/**
 * Parse the orchestrator's JSON response with robust error handling.
 *
 * The response may arrive truncated when the model runs into its
 * maxTokens budget mid-array — e.g. a verification decision with 8
 * checkResults that got cut off after the 6th. In that case the greedy
 * `\{[\s\S]*\}` regex returned a slice with more `{` than `}` and
 * JSON.parse failed with "Expected ']'". We now attempt a balanced-brace
 * extraction (finds the outermost fully-closed JSON object), and on
 * failure surface a diagnostic message that lets the caller (and the
 * retry path in selfDriveStore) act intelligently.
 */
function parseOrchestratorResponse(content: string): OrchestratorDecision {
  // Strip any markdown code fences that the model might add despite instructions
  let cleaned = content.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  const jsonSlice = extractBalancedJsonObject(cleaned);
  if (!jsonSlice) {
    // Differentiate truly-empty from truncated-mid-object — the retry
    // path logs the reason, and a truncation reason is a strong signal
    // to raise maxTokens for the next call.
    if (cleaned.includes("{")) {
      throw new Error(
        "Response appears truncated — no balanced JSON object found (likely hit maxTokens mid-response)",
      );
    }
    throw new Error("No JSON object found in response");
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonSlice);
  } catch (e) {
    const wrapped = new Error(
      `Response JSON invalid (${e instanceof Error ? e.message : String(e)}) — likely truncated mid-field`,
    );
    (wrapped as Error & { cause?: unknown }).cause = e;
    throw wrapped;
  }

  // Validate required fields
  if (!parsed.action || typeof parsed.action !== "string") {
    throw new Error("Missing or invalid 'action' field");
  }

  const validActions = [
    "advance",
    "verify",
    "fix",
    "build_check",
    "test",
    "commit",
    "pause",
    "abort",
    "advance_recovery",
    "request_recheck",
  ];
  if (!validActions.includes(parsed.action)) {
    throw new Error(`Invalid action: ${parsed.action}`);
  }

  if (!parsed.summary || typeof parsed.summary !== "string") {
    parsed.summary = `${parsed.action} (no summary provided)`;
  }

  if (!parsed.confidence || !["high", "medium", "low"].includes(parsed.confidence)) {
    parsed.confidence = "medium";
  }

  // Sanitize request_recheck decisions. An orchestrator can emit this
  // action but miss one of the required fields (recheckItems or
  // recheckPrompt) — in that case the recheck loop can't run, so demote
  // the decision to a targeted fix or a pause rather than letting
  // Self-Drive proceed with an empty re-prompt.
  //
  // Rules (demoting rather than throwing so a valid summary/checkResults
  // payload isn't lost):
  //   - recheckItems must be a non-empty array of strings
  //   - recheckPrompt must be a non-empty string; capped at 2000 chars
  //   - if either fails, drop the two fields and flip action=pause with a
  //     reason that names the specific defect
  if (parsed.action === "request_recheck") {
    const items = Array.isArray(parsed.recheckItems)
      ? (parsed.recheckItems as unknown[]).filter(
          (s): s is string => typeof s === "string" && s.trim() !== "",
        )
      : [];
    const promptRaw = typeof parsed.recheckPrompt === "string" ? parsed.recheckPrompt : "";
    const prompt = promptRaw.length > 2000 ? promptRaw.slice(0, 2000) : promptRaw;

    if (items.length === 0 || prompt.trim() === "") {
      parsed.action = "pause";
      parsed.pauseReason =
        parsed.pauseReason ??
        `Orchestrator emitted request_recheck but ${
          items.length === 0 ? "recheckItems is empty" : "recheckPrompt is empty"
        }; falling back to pause.`;
      delete parsed.recheckItems;
      delete parsed.recheckPrompt;
    } else {
      parsed.recheckItems = items;
      parsed.recheckPrompt = prompt;
    }
  } else {
    // Non-recheck actions should never carry these fields.
    delete parsed.recheckItems;
    delete parsed.recheckPrompt;
  }

  // Sanitize the optional blocker object: wrong shapes are dropped rather
  // than thrown — a malformed blocker shouldn't turn a valid pause into an
  // orchestrator parse error.
  if (parsed.blocker && typeof parsed.blocker === "object") {
    const b = parsed.blocker;
    const validKinds = [
      "infra-state-drift", "permissions", "missing-deps", "credentials",
      "env-config", "user-decision", "external-failure", "unknown",
    ];
    if (
      typeof b.kind === "string" && validKinds.includes(b.kind) &&
      typeof b.summary === "string" &&
      typeof b.resolutionCriteria === "string"
    ) {
      parsed.blocker = {
        kind: b.kind,
        summary: b.summary,
        optionsOffered: Array.isArray(b.optionsOffered)
          ? b.optionsOffered.filter((o: unknown): o is string => typeof o === "string")
          : [],
        resolutionCriteria: b.resolutionCriteria,
      };
    } else {
      delete parsed.blocker;
    }
  } else {
    delete parsed.blocker;
  }

  return parsed as OrchestratorDecision;
}

/**
 * Find the outermost JSON object with balanced braces in `s` and return
 * its exact substring. Returns null when no balanced object exists —
 * including the truncation case where the response opens `{…` and runs
 * out of tokens before closing.
 *
 * Correctly skips braces inside string literals (handles escaped quotes
 * like `"\\""`) so `{"evidence":"a\\"}"` doesn't confuse the counter.
 *
 * Not a full JSON grammar — it's only brace-balanced extraction, which
 * is enough because the subsequent JSON.parse catches every syntactic
 * problem that isn't a bracket-mismatch from truncation.
 */
function extractBalancedJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return s.slice(start, i + 1);
      }
    }
  }
  return null; // truncated — opening `{` never closed
}
