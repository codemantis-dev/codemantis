import { useCallback, useRef } from "react";
import { useTaskBoardStore } from "../stores/taskBoardStore";
import { useSessionStore } from "../stores/sessionStore";
import { useSettingsStore } from "../stores/settingsStore";
import {
  createSession,
  sendMessage,
  listenChatEvents,
  gatherProjectSnapshot,
  sendAssistantChat,
  listenAssistantStream,
  closeSession as closeSessionCmd,
  listTemplates,
} from "../lib/tauri-commands";
import { invoke } from "@tauri-apps/api/core";
import type { FrontendEvent } from "../types/claude-events";
import type { CheckResult, ProgressReview, VerificationCheck, WorkPackage } from "../types/task-board";

const MAX_RETRIES = 3;
const COMPLETION_SIGNAL = "ALL TASKS COMPLETE";
const IDLE_TIMEOUT_MS = 30000;
const RATE_LIMIT_RETRY_DELAY_MS = 30000;
const MAX_RATE_LIMIT_RETRIES = 2;

/** Cap conversation messages to the last N non-system entries, stripping multimodal content. */
function trimConversationMessages(
  messages: { role: string; content: string }[],
  limit = 6
): { role: string; content: string }[] {
  return messages.slice(-limit).map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : "[multimodal content omitted]",
  }));
}

/**
 * Wait for a Claude Code session to complete work, using event-driven listening.
 * Resolves when COMPLETION_SIGNAL is received, process exits, or idle timeout fires.
 * CRITICAL: awaits listener setup before starting the timer to prevent race conditions.
 */
async function waitForSessionCompletion(
  sessionId: string,
  timeoutMs: number,
): Promise<void> {
  let unlisten: (() => void) | null = null;
  let idleTimer: ReturnType<typeof setTimeout>;
  let resolved = false;
  let resolveCompletion!: () => void;
  const completionPromise = new Promise<void>((r) => { resolveCompletion = r; });

  const cleanup = (): void => {
    if (resolved) return;
    resolved = true;
    clearTimeout(idleTimer);
    if (unlisten) unlisten();
    resolveCompletion();
  };

  const resetIdle = (): void => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(cleanup, timeoutMs);
  };

  // CRITICAL: await before starting timer to prevent race condition
  unlisten = await listenChatEvents(sessionId, (event: FrontendEvent) => {
    resetIdle();
    if (event.type === "text_delta" || event.type === "text_complete") {
      const text = "text" in event ? (event as { text?: string }).text ?? "" : "";
      if (text.includes(COMPLETION_SIGNAL)) cleanup();
    }
    if (event.type === "process_exited") cleanup();
  });

  resetIdle();
  await completionPromise;
}

function getCheckResultsForWP(
  projectPath: string,
  wpId: string
): { description: string; passed: boolean; evidence: string }[] {
  const plan = useTaskBoardStore.getState().getActivePlan(projectPath);
  if (!plan) return [];
  const wp = plan.work_packages.find((w) => w.id === wpId);
  if (!wp) return [];
  const results: { description: string; passed: boolean; evidence: string }[] = [];
  for (const task of wp.tasks) {
    for (const check of task.verification_checks) {
      if (check.result) {
        results.push({
          description: check.description,
          passed: check.result.passed,
          evidence: check.result.evidence,
        });
      }
    }
  }
  return results;
}

async function sendProgressUpdate(
  projectPath: string,
  wpName: string,
  checkResults: { description: string; passed: boolean; evidence: string }[]
): Promise<void> {
  const store = useTaskBoardStore.getState();
  const conv = store.getActiveConversation(projectPath);
  if (!conv) return;

  let snapshot = "{}";
  try {
    snapshot = await gatherProjectSnapshot(projectPath);
  } catch {
    // Continue with empty snapshot
  }

  const passCount = checkResults.filter((c) => c.passed).length;
  const totalCount = checkResults.length;

  store.addPlanningMessage(projectPath, {
    id: `progress-${Date.now()}`,
    role: "system",
    content: `📊 Work Package "${wpName}" completed. ${passCount}/${totalCount} checks passed.`,
    message_type: "progress_update",
    timestamp: new Date().toISOString(),
  });

  const settings = useSettingsStore.getState().settings;
  const apiKey = settings.apiKeys[conv.ai_provider] ?? "";
  if (!apiKey) return;

  const reviewContent = `PROGRESS_UPDATE: Work Package "${wpName}" completed.\n` +
    `Results: ${passCount}/${totalCount} checks passed.\n\n` +
    `Check Results:\n${checkResults.map((c) =>
      `${c.passed ? "✅" : "❌"} ${c.description}: ${c.evidence}`
    ).join("\n")}\n\nProject Snapshot:\n${snapshot}`;

  // Fix 4: Trim message history to prevent quadratic growth
  const recentMessages = trimConversationMessages(
    conv.messages.filter((m) => m.role !== "system").map((m) => ({
      role: m.role,
      content: m.content,
    }))
  );

  const messages = [
    ...recentMessages,
    {
      role: "user" as const,
      content: `Review this progress update and respond with JSON:\n\n${reviewContent}\n\nRespond with JSON: {"assessment":"on_track"|"needs_refinement"|"has_gaps","refined_tasks":[],"new_tasks":[],"removed_task_ids":[],"updated_checks":[],"notes":"your assessment"}`,
    },
  ];

  const assistantId = `planning-review-${Date.now()}`;
  let responseText = "";

  const unlisten = await listenAssistantStream(assistantId, (event) => {
    if (event.type === "delta" && event.text) {
      responseText += event.text;
    }
    if (event.type === "done") {
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*"assessment"[\s\S]*\}/);
        if (jsonMatch) {
          const review = JSON.parse(jsonMatch[0]) as ProgressReview;
          if (review.assessment) {
            store.applyProgressReview(projectPath, review);
            store.addPlanningMessage(projectPath, {
              id: `review-${Date.now()}`,
              role: "assistant",
              content: review.notes || `Assessment: ${review.assessment}`,
              message_type: "progress_update",
              timestamp: new Date().toISOString(),
            });
          }
        }
      } catch {
        if (responseText.trim()) {
          store.addPlanningMessage(projectPath, {
            id: `review-${Date.now()}`,
            role: "assistant",
            content: responseText,
            message_type: "conversation",
            timestamp: new Date().toISOString(),
          });
        }
      }
      unlisten();
    }
    if (event.type === "error") {
      unlisten();
    }
  });

  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
    try {
      await sendAssistantChat({
        assistantId: attempt === 0 ? assistantId : `${assistantId}-r${attempt}`,
        provider: conv.ai_provider,
        apiKey,
        model: conv.ai_model,
        systemPrompt: "You are reviewing progress on a software development task plan. Analyze the verification results and project snapshot, then provide your assessment as JSON.",
        messages,
      });
      break;
    } catch (err) {
      const errStr = String(err).toLowerCase();
      if ((errStr.includes("rate limit") || errStr.includes("429")) && attempt < MAX_RATE_LIMIT_RETRIES) {
        store.addPlanningMessage(projectPath, {
          id: `rate-limit-${Date.now()}`,
          role: "system",
          content: `Rate limited. Retrying in ${RATE_LIMIT_RETRY_DELAY_MS / 1000}s...`,
          message_type: "progress_update",
          timestamp: new Date().toISOString(),
        });
        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_RETRY_DELAY_MS));
      } else {
        break;
      }
    }
  }
}

async function sendGapReview(projectPath: string): Promise<void> {
  const store = useTaskBoardStore.getState();
  const conv = store.getActiveConversation(projectPath);
  if (!conv) return;

  const settings = useSettingsStore.getState().settings;
  const apiKey = settings.apiKeys[conv.ai_provider] ?? "";
  if (!apiKey) return;

  let snapshot = "{}";
  try {
    snapshot = await gatherProjectSnapshot(projectPath);
  } catch {
    // Continue with empty snapshot
  }

  const originalMessages = conv.messages
    .filter((m) => m.message_type === "conversation" && m.role === "user")
    .map((m) => m.content)
    .join("\n\n");

  store.addPlanningMessage(projectPath, {
    id: `gap-${Date.now()}`,
    role: "system",
    content: "🔍 All planned tasks complete. Running gap review...",
    message_type: "gap_review",
    timestamp: new Date().toISOString(),
  });

  // Fix 4: Trim message history to prevent quadratic growth
  const recentMessages = trimConversationMessages(
    conv.messages.filter((m) => m.role !== "system").map((m) => ({
      role: m.role,
      content: m.content,
    }))
  );

  const messages = [
    ...recentMessages,
    {
      role: "user" as const,
      content: `All planned tasks are complete. Review the original requirements against what was built. What is missing?\n\nOriginal requirements:\n${originalMessages}\n\nCurrent project state:\n${snapshot}\n\nRespond with JSON: {"assessment":"on_track"|"has_gaps","new_tasks":[],"notes":"what is missing or confirmation that everything is complete"}`,
    },
  ];

  const assistantId = `gap-review-${Date.now()}`;
  let responseText = "";

  const unlisten = await listenAssistantStream(assistantId, (event) => {
    if (event.type === "delta" && event.text) {
      responseText += event.text;
    }
    if (event.type === "done") {
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*"assessment"[\s\S]*\}/);
        if (jsonMatch) {
          const review = JSON.parse(jsonMatch[0]) as ProgressReview;
          if (review.new_tasks && review.new_tasks.length > 0) {
            store.applyProgressReview(projectPath, {
              ...review,
              refined_tasks: [],
              removed_task_ids: [],
              updated_checks: [],
            });
          }
          store.addPlanningMessage(projectPath, {
            id: `gap-result-${Date.now()}`,
            role: "assistant",
            content: review.notes || "No gaps found — all requirements are covered.",
            message_type: "gap_review",
            timestamp: new Date().toISOString(),
          });
        }
      } catch {
        if (responseText.trim()) {
          store.addPlanningMessage(projectPath, {
            id: `gap-result-${Date.now()}`,
            role: "assistant",
            content: responseText,
            message_type: "conversation",
            timestamp: new Date().toISOString(),
          });
        }
      }
      unlisten();
    }
    if (event.type === "error") {
      unlisten();
    }
  });

  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
    try {
      await sendAssistantChat({
        assistantId: attempt === 0 ? assistantId : `${assistantId}-r${attempt}`,
        provider: conv.ai_provider,
        apiKey,
        model: conv.ai_model,
        systemPrompt: "You are performing a final gap review on a completed software project. Compare what was built against the original requirements and identify anything missing.",
        messages,
      });
      break;
    } catch (err) {
      const errStr = String(err).toLowerCase();
      if ((errStr.includes("rate limit") || errStr.includes("429")) && attempt < MAX_RATE_LIMIT_RETRIES) {
        store.addPlanningMessage(projectPath, {
          id: `rate-limit-${Date.now()}`,
          role: "system",
          content: `Rate limited. Retrying in ${RATE_LIMIT_RETRY_DELAY_MS / 1000}s...`,
          message_type: "progress_update",
          timestamp: new Date().toISOString(),
        });
        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_RETRY_DELAY_MS));
      } else {
        break;
      }
    }
  }
}

async function sendVerificationRefinement(
  projectPath: string,
  wp: WorkPackage
): Promise<void> {
  const store = useTaskBoardStore.getState();
  const conv = store.getActiveConversation(projectPath);
  if (!conv) return;

  const settings = useSettingsStore.getState().settings;
  const apiKey = settings.apiKeys[conv.ai_provider] ?? "";
  if (!apiKey) return;

  // Collect DOM checks that consistently failed, with their location info
  const failedDomChecks: { taskId: string; checkIndex: number; taskTitle: string; description: string; selector: string; assertion: string; evidence: string; check: VerificationCheck }[] = [];
  for (const task of wp.tasks) {
    for (let ci = 0; ci < task.verification_checks.length; ci++) {
      const check = task.verification_checks[ci];
      if (check.type === "dom_check" && check.result && !check.result.passed) {
        failedDomChecks.push({
          taskId: task.id,
          checkIndex: ci,
          taskTitle: task.title,
          description: check.description,
          selector: check.selector ?? "",
          assertion: check.assertion ?? "exists",
          evidence: check.result.evidence,
          check,
        });
      }
    }
  }

  if (failedDomChecks.length === 0) return;

  // Read relevant file contents for context
  let fileContext = "";
  try {
    const snapshot = await gatherProjectSnapshot(projectPath);
    const parsed = JSON.parse(snapshot);
    if (parsed.file_contents) {
      fileContext = (parsed.file_contents as { path: string; content: string }[])
        .map((f: { path: string; content: string }) => `--- ${f.path} ---\n${f.content}`)
        .join("\n\n");
    }
  } catch {
    // Continue without file context
  }

  const refinementContent = `VERIFICATION REFINEMENT REQUEST:\n` +
    `Work package "${wp.name}" has ${failedDomChecks.length} DOM checks that failed after ${wp.retry_count} retries.\n` +
    `Claude Code reports the feature was built, but these checks still fail:\n\n` +
    failedDomChecks.map((c) =>
      `Task: ${c.taskTitle}\nCheck: ${c.description}\nSelector: ${c.selector}\nAssertion: ${c.assertion}\nEvidence: ${c.evidence}`
    ).join("\n\n") +
    (fileContext ? `\n\nRelevant source files:\n${fileContext}` : "") +
    `\n\nThe selectors or assertions may be wrong. Respond with JSON: {"updated_checks":[{"description":"...","selector":"new_selector","assertion":"exists|contains|count","expected":"..."}]}`;

  // Fix 4: Trim message history to prevent quadratic growth
  const recentMessages = trimConversationMessages(
    conv.messages.filter((m) => m.role !== "system").map((m) => ({
      role: m.role,
      content: m.content,
    }))
  );

  const messages = [
    ...recentMessages,
    { role: "user" as const, content: refinementContent },
  ];

  const assistantId = `refinement-${Date.now()}`;
  let responseText = "";

  const unlisten = await listenAssistantStream(assistantId, (event) => {
    if (event.type === "delta" && event.text) {
      responseText += event.text;
    }
    if (event.type === "done") {
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*"updated_checks"[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]) as { updated_checks: { description: string; selector: string; assertion: string; expected?: string }[] };
          if (result.updated_checks && result.updated_checks.length > 0) {
            // Map AI-provided checks back to the correct task_id + check_index
            const mappedChecks = result.updated_checks.map((uc, idx) => {
              const original = failedDomChecks[idx] ?? failedDomChecks[0];
              return {
                task_id: original.taskId,
                check_index: original.checkIndex,
                updated_check: {
                  ...original.check,
                  selector: uc.selector,
                  assertion: (uc.assertion as VerificationCheck["assertion"]) ?? original.check.assertion,
                  expected: uc.expected ?? original.check.expected,
                  description: uc.description || original.description,
                  result: undefined,
                },
              };
            });
            store.applyProgressReview(projectPath, {
              assessment: "needs_refinement",
              refined_tasks: [],
              new_tasks: [],
              removed_task_ids: [],
              updated_checks: mappedChecks,
              notes: `Refined ${mappedChecks.length} DOM check(s) after repeated failures.`,
            });
            store.addPlanningMessage(projectPath, {
              id: `refinement-${Date.now()}`,
              role: "assistant",
              content: `Refined ${result.updated_checks.length} verification check(s) for "${wp.name}".`,
              message_type: "progress_update",
              timestamp: new Date().toISOString(),
            });
          }
        }
      } catch {
        // Silently ignore parse failures
      }
      unlisten();
    }
    if (event.type === "error") {
      unlisten();
    }
  });

  try {
    await sendAssistantChat({
      assistantId,
      provider: conv.ai_provider,
      apiKey,
      model: conv.ai_model,
      systemPrompt: "You are refining verification checks for a software development task. The DOM selectors or assertions may be incorrect. Analyze the failing checks and source code, then provide corrected checks as JSON.",
      messages,
    });
  } catch {
    // Silently continue
  }
}

export function useTaskExecution(): {
  executeWorkPackage: (projectPath: string, wpId: string) => Promise<void>;
  executeAllWorkPackages: (projectPath: string) => Promise<void>;
  pauseExecution: () => void;
  resumeExecution: (projectPath: string) => void;
  cancelExecution: (projectPath: string) => Promise<void>;
  runCodeVerification: (projectPath: string, wpId: string, onlyFailed?: boolean) => Promise<void>;
} {
  const executionAbortRef = useRef(false);

  const runCodeVerification = useCallback(
    async (projectPath: string, wpId: string, onlyFailed = false): Promise<void> => {
      const store = useTaskBoardStore.getState();
      const plan = store.getActivePlan(projectPath);
      if (!plan) return;

      const wp = plan.work_packages.find((w) => w.id === wpId);
      if (!wp) return;

      store.updateWorkPackageStatus(projectPath, wpId, "verifying");

      // Collect all code checks (non-dom_check)
      for (const task of wp.tasks) {
        for (let i = 0; i < task.verification_checks.length; i++) {
          const check = task.verification_checks[i];
          if (check.type === "dom_check") continue;

          // Skip already-passed checks when retrying
          if (onlyFailed && check.result?.passed) continue;

          try {
            const result = await invoke<CheckResult>("run_code_verification", {
              projectPath,
              checkType: check.type,
              path: check.path ?? null,
              pattern: check.pattern ?? null,
              command: check.command ?? null,
            });
            store.updateCheckResult(projectPath, task.id, i, result);
          } catch (err) {
            store.updateCheckResult(projectPath, task.id, i, {
              passed: false,
              evidence: `Check failed: ${err}`,
              checked_at: new Date().toISOString(),
            });
          }
        }
      }

      // Run DOM checks if preview is available
      for (const task of wp.tasks) {
        for (let i = 0; i < task.verification_checks.length; i++) {
          const check = task.verification_checks[i];
          if (check.type !== "dom_check") continue;

          // Skip already-passed checks when retrying
          if (onlyFailed && check.result?.passed) continue;

          try {
            const result = await invoke<CheckResult>("run_dom_verification", {
              projectPath,
              route: check.route ?? "/",
              selector: check.selector ?? "",
              assertion: check.assertion ?? "exists",
              expected: check.expected != null ? String(check.expected) : null,
            });
            store.updateCheckResult(projectPath, task.id, i, result);
          } catch (err) {
            store.updateCheckResult(projectPath, task.id, i, {
              passed: false,
              evidence: `DOM check failed: ${err}`,
              checked_at: new Date().toISOString(),
            });
          }
        }
      }
    },
    []
  );

  const buildWorkPackagePrompt = useCallback(
    (wp: WorkPackage, templateContext?: string): string => {
      let prompt = '';
      if (templateContext) {
        prompt += templateContext + '\n\n';
      }
      // Only include tasks that aren't already done (e.g. user-action tasks marked done)
      const pendingTasks = wp.tasks.filter((t) => t.status !== "done");
      prompt += `You are executing work package '${wp.name}'. Complete these tasks in order:\n\n`;
      pendingTasks.forEach((task, idx) => {
        prompt += `Task ${idx + 1}: ${task.title}\n`;
        prompt += `${task.description}\n`;
        prompt += `Acceptance: ${task.acceptance_criteria}\n\n`;
      });
      prompt += `Important: Complete ALL tasks. Do not skip any.\nAfter completing all tasks, say '${COMPLETION_SIGNAL}'.`;
      return prompt;
    },
    []
  );

  const getFailedChecks = useCallback(
    (projectPath: string, wpId: string): string[] => {
      const plan = useTaskBoardStore.getState().getActivePlan(projectPath);
      if (!plan) return [];
      const wp = plan.work_packages.find((w) => w.id === wpId);
      if (!wp) return [];

      const failures: string[] = [];
      for (const task of wp.tasks) {
        for (const check of task.verification_checks) {
          if (check.result && !check.result.passed) {
            failures.push(
              `- ${check.description}\n   Evidence: ${check.result.evidence}`
            );
          }
        }
      }
      return failures;
    },
    []
  );

  const executeWorkPackage = useCallback(
    async (projectPath: string, wpId: string): Promise<void> => {
      const store = useTaskBoardStore.getState();
      const decision = store.projectTargetDecisions.get(projectPath);
      if (!decision || decision.type === 'undecided' || decision.type === 'migrated') return;

      const plan = store.getActivePlan(projectPath);
      if (!plan) return;

      const wp = plan.work_packages.find((w) => w.id === wpId);
      if (!wp) return;

      store.setExecuting(projectPath, wpId);
      store.updateWorkPackageStatus(projectPath, wpId, "in_progress");

      // Create a Claude Code session in auto-accept mode
      const session = await createSession(projectPath, `Task: ${wp.name}`);
      store.setWorkPackageSessionId(projectPath, wpId, session.id);

      // Set to auto-accept mode
      const { setSessionMode } = useSessionStore.getState();
      setSessionMode(session.id, "auto-accept");
      await invoke("set_session_mode", { sessionId: session.id, mode: "auto-accept" });

      // Wait for session to initialize
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Build template context for execution AI
      let templateContext: string | undefined;
      if (plan.template_recommendation) {
        try {
          const templates = await listTemplates();
          const tmpl = templates.find((t) => t.id === plan.template_recommendation);
          if (tmpl) {
            templateContext = `PROJECT CONTEXT: This project uses the "${tmpl.name}" template (${tmpl.id}).
${tmpl.long_description ?? tmpl.description}
Tech stack: ${tmpl.tags.join(', ')}
Dev command: ${tmpl.dev_command}

IMPORTANT: Work with the EXISTING project structure. Do NOT create files that the template already provides. Read existing files before modifying them.`;
          }
        } catch { /* continue without */ }
      }

      // Build and send the prompt
      const prompt = buildWorkPackagePrompt(wp, templateContext);
      await sendMessage(session.id, prompt);

      // Fix 2: Use event-driven waiting (no race condition)
      await waitForSessionCompletion(session.id, IDLE_TIMEOUT_MS);

      // Run verification
      await runCodeVerification(projectPath, wpId);

      // Check results
      const failures = getFailedChecks(projectPath, wpId);

      if (failures.length === 0) {
        store.updateWorkPackageStatus(projectPath, wpId, "done");
        // Mark all tasks as done
        const updatedPlan = store.getActivePlan(projectPath);
        const updatedWp = updatedPlan?.work_packages.find((w) => w.id === wpId);
        if (updatedWp) {
          for (const task of updatedWp.tasks) {
            store.updateTaskStatus(projectPath, task.id, "done");
          }
        }
      } else {
        // Retry logic
        const currentWp = store.getActivePlan(projectPath)?.work_packages.find((w) => w.id === wpId);
        const retryCount = currentWp?.retry_count ?? 0;

        if (retryCount < MAX_RETRIES) {
          store.incrementRetryCount(projectPath, wpId);
          const retryPrompt = `Verification found ${failures.length} issues with your work:\n\n${failures.join("\n\n")}\n\nPlease fix these specific issues now. Do not modify anything else.`;
          await sendMessage(session.id, retryPrompt);

          // Fix 3: Use event-driven waiting instead of hard sleep
          await waitForSessionCompletion(session.id, IDLE_TIMEOUT_MS);

          // Re-verify only previously-failed checks
          await runCodeVerification(projectPath, wpId, true);

          const newFailures = getFailedChecks(projectPath, wpId);
          if (newFailures.length === 0) {
            store.updateWorkPackageStatus(projectPath, wpId, "done");
            // Mark all tasks as done
            const doneWp = store.getActivePlan(projectPath)?.work_packages.find((w) => w.id === wpId);
            if (doneWp) {
              for (const task of doneWp.tasks) {
                store.updateTaskStatus(projectPath, task.id, "done");
              }
            }
          } else {
            store.updateWorkPackageStatus(projectPath, wpId, "needs_review");
            // Mark tasks with all-passing checks as done
            const reviewWp = store.getActivePlan(projectPath)?.work_packages.find((w) => w.id === wpId);
            if (reviewWp) {
              for (const task of reviewWp.tasks) {
                const allPassed = task.verification_checks.length > 0 &&
                  task.verification_checks.every((c) => c.result?.passed);
                if (allPassed) {
                  store.updateTaskStatus(projectPath, task.id, "done");
                }
              }
            }
          }
        } else {
          store.updateWorkPackageStatus(projectPath, wpId, "needs_review");
          // Mark tasks with all-passing checks as done
          const reviewWp = store.getActivePlan(projectPath)?.work_packages.find((w) => w.id === wpId);
          if (reviewWp) {
            for (const task of reviewWp.tasks) {
              const allPassed = task.verification_checks.length > 0 &&
                task.verification_checks.every((c) => c.result?.passed);
              if (allPassed) {
                store.updateTaskStatus(projectPath, task.id, "done");
              }
            }
          }

          // Gap 7: If DOM checks failed repeatedly, send to planning AI for refinement
          const updatedWp = store.getActivePlan(projectPath)?.work_packages.find((w) => w.id === wpId);
          if (updatedWp) {
            await sendVerificationRefinement(projectPath, updatedWp);
          }
        }
      }

      // Send progress update to planning AI
      await sendProgressUpdate(projectPath, wp.name, getCheckResultsForWP(projectPath, wpId));

      // Fix 1: Close session after work package completion to prevent orphaned processes
      try {
        await closeSessionCmd(session.id);
      } catch { /* session may already be closed */ }
      store.setWorkPackageSessionId(projectPath, wpId, null);

      store.setExecuting(projectPath, null);
    },
    [runCodeVerification, buildWorkPackagePrompt, getFailedChecks]
  );

  const executeAllWorkPackages = useCallback(
    async (projectPath: string): Promise<void> => {
      executionAbortRef.current = false;
      const store = useTaskBoardStore.getState();
      const decision = store.projectTargetDecisions.get(projectPath);
      if (!decision || decision.type === 'undecided' || decision.type === 'migrated') return;

      const plan = store.getActivePlan(projectPath);
      if (!plan) return;

      store.updatePlanStatus(projectPath, "executing");
      store.setSlideOverOpen(projectPath, true);

      for (const wp of plan.work_packages) {
        if (executionAbortRef.current) break;
        if (store.isPaused) break;
        if (wp.status === "done") continue;

        // Fix 7d: Check for tasks requiring user action before executing WP
        const userActionTasks = wp.tasks.filter(
          (t) => t.requires_user_action && t.status !== "done" && t.status !== "skipped"
        );
        if (userActionTasks.length > 0) {
          // Aggregate messages and pause
          const actionMessages = userActionTasks
            .map((t) => `- ${t.title}: ${t.requires_user_action}`)
            .join("\n");

          store.addPlanningMessage(projectPath, {
            id: `user-action-${Date.now()}`,
            role: "system",
            content: `Execution paused — manual action needed before "${wp.name}":\n\n${actionMessages}`,
            message_type: "user_action_required",
            timestamp: new Date().toISOString(),
          });

          // Set pending action (use first task's info)
          store.setPendingUserAction(projectPath, {
            wpId: wp.id,
            taskId: userActionTasks[0].id,
            message: actionMessages,
          });
          store.setPaused(true);

          // Poll until user clears pending action or execution is aborted
          await new Promise<void>((resolve) => {
            const poll = setInterval(() => {
              const s = useTaskBoardStore.getState();
              const pending = s.pendingUserAction.get(projectPath);
              if (!pending || executionAbortRef.current) {
                clearInterval(poll);
                resolve();
              }
            }, 500);
          });

          if (executionAbortRef.current) break;

          // Mark user-action tasks as done and un-pause
          for (const t of userActionTasks) {
            store.updateTaskStatus(projectPath, t.id, "done");
          }
          store.setPaused(false);
        }

        await executeWorkPackage(projectPath, wp.id);
      }

      // Clear executing state now that all WPs are done
      store.setExecuting(null, null);

      // Check if all done — trigger gap review
      const finalPlan = useTaskBoardStore.getState().getActivePlan(projectPath);
      if (finalPlan) {
        const allDone = finalPlan.work_packages.every(
          (wp) => wp.status === "done" || wp.status === "needs_review"
        );
        if (allDone) {
          await sendGapReview(projectPath);
          useTaskBoardStore.getState().updatePlanStatus(projectPath, "done");
        }
      }
    },
    [executeWorkPackage]
  );

  const pauseExecution = useCallback(() => {
    useTaskBoardStore.getState().setPaused(true);
  }, []);

  const resumeExecution = useCallback(
    (projectPath: string) => {
      useTaskBoardStore.getState().setPaused(false);
      executeAllWorkPackages(projectPath);
    },
    [executeAllWorkPackages]
  );

  const cancelExecution = useCallback(async (projectPath: string) => {
    executionAbortRef.current = true;
    const store = useTaskBoardStore.getState();
    const plan = store.getActivePlan(projectPath);
    const executingWpId = store.executingWorkPackage;

    if (plan && executingWpId) {
      const wp = plan.work_packages.find((w) => w.id === executingWpId);
      if (wp?.session_id) {
        try { await closeSessionCmd(wp.session_id); } catch { /* ignore */ }
      }
      store.updateWorkPackageStatus(projectPath, executingWpId, 'planned');
    }

    store.updatePlanStatus(projectPath, 'ready');
    store.setExecuting(null, null);
    store.setPaused(false);
    store.setPendingUserAction(projectPath, null);
  }, []);

  return {
    executeWorkPackage,
    executeAllWorkPackages,
    pauseExecution,
    resumeExecution,
    cancelExecution,
    runCodeVerification,
  };
}
