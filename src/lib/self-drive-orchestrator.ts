// ═══════════════════════════════════════════════════════════════════════
// Self-Drive — AI Orchestrator
// Makes structured API calls to decide the next step in autonomous mode.
// ═══════════════════════════════════════════════════════════════════════

import type { OrchestratorInput, OrchestratorDecision } from "../types/implementation-guide";
import { sendAssistantChat, listenAssistantStream, cancelAssistantChat } from "./tauri-commands";

const ORCHESTRATOR_ASSISTANT_ID = "__self-drive-orchestrator__";
const ORCHESTRATOR_TIMEOUT_MS = 30_000;

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
- Parse Claude Code's response line by line. Do NOT infer, summarize, or trust claims without evidence.
- For EACH VerifyCheck in the session, emit EXACTLY ONE checkResults entry matching by "label" verbatim.
- Each entry must be one of:
  - { label, passed: true, evidence: "{file}:{lines} — {quoted code}" } — requires a file:lines citation AND a quoted code snippet lifted from Claude Code's response. The evidence string MUST contain a ":" between file and line range. No citation or no quoted code → NOT passed.
  - { label, passed: false, reason: "{short reason}" } — including when evidence is missing, file wasn't opened, the check clearly fails, or the verifier used batch-PASS language.
- EVIDENCE KIND DEPENDS ON VerifyCheck.kind (see session plan):
  - "static" (default): cite {file}:{lines} AND quote code. File reads are required.
  - "side-effect": cite the COMMAND RUN AND quote its OUTPUT (stdout, query result, HTTP status). A file citation alone is INSUFFICIENT — the file merely requests the effect; you need evidence the effect happened. Evidence form: "$ {command} → {quoted output snippet}". Still contains ":" (after the $ or the command).
  - "behavioral": cite a TEST NAME and quote the PASSING ASSERTION line. Evidence form: "{test-file}:{lines} — {quoted assertion or "PASS" line from runner}".
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
- "advance" is NOT a trust signal — it is a structured assertion that every check is confirmed with evidence. The system validates your checkResults and will reject "advance" if any passed:true entry lacks evidence.

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
        maxTokens: 1024,
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
 */
function parseOrchestratorResponse(content: string): OrchestratorDecision {
  // Strip any markdown code fences that the model might add despite instructions
  let cleaned = content.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  // Try to find JSON object in the response
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON object found in response");
  }

  const parsed = JSON.parse(jsonMatch[0]);

  // Validate required fields
  if (!parsed.action || typeof parsed.action !== "string") {
    throw new Error("Missing or invalid 'action' field");
  }

  const validActions = ["advance", "verify", "fix", "build_check", "test", "commit", "pause", "abort", "advance_recovery"];
  if (!validActions.includes(parsed.action)) {
    throw new Error(`Invalid action: ${parsed.action}`);
  }

  if (!parsed.summary || typeof parsed.summary !== "string") {
    parsed.summary = `${parsed.action} (no summary provided)`;
  }

  if (!parsed.confidence || !["high", "medium", "low"].includes(parsed.confidence)) {
    parsed.confidence = "medium";
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
