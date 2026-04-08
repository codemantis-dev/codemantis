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
- If Claude Code asked a question or needs clarification → {"action": "pause", "pauseReason": "Claude Code needs input: ...", "summary": "...", "confidence": "high"}
- If Claude Code's response is empty or the process crashed → {"action": "pause", "pauseReason": "...", "summary": "...", "confidence": "low"}

AFTER A BUILD CHECK (currentPhase = "build-checking"):
- If the build/typecheck passed (zero errors) → {"action": "verify", "summary": "Build clean. Proceeding to verification.", "confidence": "high"}
- If there are TypeScript or build errors → {"action": "fix", "fixPrompt": "Fix these build errors: ...", "summary": "...", "confidence": "high"}

AFTER A VERIFICATION PHASE (currentPhase = "verifying"):
- Evaluate Claude Code's response against each verify check
- If ALL checks pass → {"action": "advance", "checkResults": [...], "summary": "All checks passed.", "confidence": "high"}
- "advance" means YOU are confirming all checks are satisfied — this is your go/no-go decision. The system trusts your verdict.
- If SOME checks fail AND fixAttempt < maxFixAttempts → {"action": "fix", "fixPrompt": "The verification found these failures: ... Fix them.", "checkResults": [...], "summary": "...", "confidence": "high"}
- If SOME checks fail AND fixAttempt >= maxFixAttempts → {"action": "pause", "pauseReason": "Max fix attempts reached. Remaining failures: ...", "checkResults": [...], "summary": "...", "confidence": "high"}
- checkResults are informational (shown in the run log for human review) — include { label, passed, reason? } for each check

AFTER A FIX PHASE (currentPhase = "fixing"):
- Evaluate whether the fix was applied → {"action": "build_check", "summary": "Fix applied. Re-checking build.", "confidence": "high"}

AFTER A TEST PHASE (currentPhase = "testing"):
- If all tests pass → {"action": "advance", "summary": "Tests passing.", "confidence": "high"}
- If tests fail → {"action": "fix", "fixPrompt": "These tests failed: ... Fix them.", "summary": "...", "confidence": "high"}

AFTER A COMMIT PHASE (currentPhase = "committing"):
- If commit was successful → {"action": "advance", "summary": "Committed successfully.", "confidence": "high"}

RULES:
- NEVER advance if there are unresolved errors
- NEVER generate fix prompts that are vague — be specific about what failed
- If Claude Code's response mentions it needs user input (API keys, environment variables, design decisions) → ALWAYS pause
- If the response is ambiguous → set confidence to "low" and prefer "pause"
- The fix prompt should reference the SPECIFIC errors, not just "fix the issues"
- Keep summaries under 100 characters — they appear in the run log
- checkResults must include a { label, passed, reason? } for each verify check`;
}

/**
 * Build the user message from orchestrator input.
 */
function buildUserMessage(input: OrchestratorInput): string {
  const checks = input.sessionPlan.verifyChecks.length > 0
    ? input.sessionPlan.verifyChecks.map((c) => `- ${c}`).join("\n")
    : "(no verify checks for this session)";

  const previousFixes = input.previousFixPrompts.length > 0
    ? `\n\nPREVIOUS FIX PROMPTS ALREADY TRIED:\n${input.previousFixPrompts.map((p, i) => `${i + 1}. ${p.slice(0, 200)}`).join("\n")}`
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

VERIFY CHECKS FOR THIS SESSION:
${checks}

TOOLS USED THIS TURN:
${input.claudeCodeToolsUsed.join(", ") || "none"}

TURN DURATION: ${Math.round(input.turnDurationMs / 1000)}s

CLAUDE CODE'S RESPONSE:
${input.claudeCodeResponse}${previousFixes}`;
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

  const validActions = ["advance", "verify", "fix", "build_check", "test", "commit", "pause", "abort"];
  if (!validActions.includes(parsed.action)) {
    throw new Error(`Invalid action: ${parsed.action}`);
  }

  if (!parsed.summary || typeof parsed.summary !== "string") {
    parsed.summary = `${parsed.action} (no summary provided)`;
  }

  if (!parsed.confidence || !["high", "medium", "low"].includes(parsed.confidence)) {
    parsed.confidence = "medium";
  }

  return parsed as OrchestratorDecision;
}
