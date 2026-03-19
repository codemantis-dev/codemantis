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
} from "../lib/tauri-commands";
import { invoke } from "@tauri-apps/api/core";
import type { FrontendEvent } from "../types/claude-events";
import type { CheckResult, ProgressReview, VerificationCheck, WorkPackage } from "../types/task-board";

const MAX_RETRIES = 3;
const COMPLETION_SIGNAL = "ALL TASKS COMPLETE";
const IDLE_TIMEOUT_MS = 30000;
const RATE_LIMIT_RETRY_DELAY_MS = 30000;
const MAX_RATE_LIMIT_RETRIES = 2;

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

  const messages = [
    ...conv.messages.filter((m) => m.role !== "system").map((m) => ({
      role: m.role,
      content: m.content,
    })),
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

  const messages = [
    ...conv.messages.filter((m) => m.role !== "system").map((m) => ({
      role: m.role,
      content: m.content,
    })),
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

  const messages = [
    ...conv.messages.filter((m) => m.role !== "system").map((m) => ({
      role: m.role,
      content: m.content,
    })),
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
    (wp: WorkPackage): string => {
      let prompt = `You are executing work package '${wp.name}'. Complete these tasks in order:\n\n`;
      wp.tasks.forEach((task, idx) => {
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

      // Build and send the prompt
      const prompt = buildWorkPackagePrompt(wp);
      await sendMessage(session.id, prompt);

      // Wait for completion signal or idle timeout
      await new Promise<void>((resolve) => {
        let idleTimer: ReturnType<typeof setTimeout>;
        let unlisten: (() => void) | null = null;

        const cleanup = (): void => {
          clearTimeout(idleTimer);
          if (unlisten) unlisten();
          resolve();
        };

        const resetIdle = (): void => {
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            cleanup();
          }, IDLE_TIMEOUT_MS);
        };

        resetIdle();

        listenChatEvents(session.id, (event: FrontendEvent) => {
          resetIdle();

          if (event.type === "text_delta" || event.type === "text_complete") {
            const text = "text" in event ? (event as { text?: string }).text ?? "" : "";
            if (text.includes(COMPLETION_SIGNAL)) {
              cleanup();
            }
          }

          if (event.type === "process_exited") {
            cleanup();
          }
        }).then((fn) => {
          unlisten = fn;
        });
      });

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

          // Wait for completion again
          await new Promise<void>((resolve) => setTimeout(resolve, IDLE_TIMEOUT_MS));

          // Re-verify only previously-failed checks
          await runCodeVerification(projectPath, wpId, true);

          const newFailures = getFailedChecks(projectPath, wpId);
          if (newFailures.length === 0) {
            store.updateWorkPackageStatus(projectPath, wpId, "done");
          } else {
            store.updateWorkPackageStatus(projectPath, wpId, "needs_review");
          }
        } else {
          store.updateWorkPackageStatus(projectPath, wpId, "needs_review");

          // Gap 7: If DOM checks failed repeatedly, send to planning AI for refinement
          const updatedWp = store.getActivePlan(projectPath)?.work_packages.find((w) => w.id === wpId);
          if (updatedWp) {
            await sendVerificationRefinement(projectPath, updatedWp);
          }
        }
      }

      // Send progress update to planning AI
      await sendProgressUpdate(projectPath, wp.name, getCheckResultsForWP(projectPath, wpId));

      store.setExecuting(null, null);
    },
    [runCodeVerification, buildWorkPackagePrompt, getFailedChecks]
  );

  const executeAllWorkPackages = useCallback(
    async (projectPath: string): Promise<void> => {
      executionAbortRef.current = false;
      const store = useTaskBoardStore.getState();
      const plan = store.getActivePlan(projectPath);
      if (!plan) return;

      store.updatePlanStatus(projectPath, "executing");
      store.setSlideOverOpen(projectPath, true);

      for (const wp of plan.work_packages) {
        if (executionAbortRef.current) break;
        if (store.isPaused) break;
        if (wp.status === "done") continue;

        await executeWorkPackage(projectPath, wp.id);
      }

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

  return {
    executeWorkPackage,
    executeAllWorkPackages,
    pauseExecution,
    resumeExecution,
    runCodeVerification,
  };
}
