import { useState, useEffect, useCallback, useRef } from "react";
import { Check, X, Loader2, AlertTriangle, Copy, Send, Square, Wrench } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  listenScaffoldProgress,
  createSession,
  sendMessage,
  interruptSession,
  closeSession,
  setSessionMode,
  initializeSession,
  listenChatEvents,
} from "../../lib/tauri-commands";
import type {
  TemplateEntry,
  ScaffoldStepName,
  ScaffoldStepStatus,
  ScaffoldProgressEvent,
} from "../../types/project-templates";
import type { FrontendEvent } from "../../types/claude-events";
import { GIT_CLONE_STEPS, CLI_SCAFFOLD_STEPS } from "../../types/project-templates";

interface StepState {
  status: ScaffoldStepStatus;
  error?: string;
  output?: string;
}

interface SetupMessage {
  role: "user" | "assistant";
  text: string;
}

interface ScaffoldProgressProps {
  template: TemplateEntry;
  projectName: string;
  projectPath: string;
  resultPath: string | null;
  warnings: string[];
  scaffoldError: string | null;
  onOpenProject: () => void;
  onRetry: () => void;
  onCancel: () => void;
}

export default function ScaffoldProgress({
  template,
  projectName,
  projectPath,
  resultPath,
  warnings,
  scaffoldError,
  onOpenProject,
  onRetry,
  onCancel,
}: ScaffoldProgressProps) {
  const steps = template.scaffold_type === "cli" ? CLI_SCAFFOLD_STEPS : GIT_CLONE_STEPS;
  const [stepStates, setStepStates] = useState<Map<ScaffoldStepName, StepState>>(new Map());
  const [complete, setComplete] = useState(false);
  const [hasError, setHasError] = useState(false);

  // Setup assistant state
  const [setupSessionId, setSetupSessionId] = useState<string | null>(null);
  const [setupMessages, setSetupMessages] = useState<SetupMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [isAssistantBusy, setIsAssistantBusy] = useState(false);
  const [setupInput, setSetupInput] = useState("");
  const [assistantTurnDone, setAssistantTurnDone] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const setupCleanupRef = useRef<(() => void) | null>(null);

  const handleProgress = useCallback((event: ScaffoldProgressEvent) => {
    if (event.step === "complete" && event.status === "done") {
      setComplete(true);
      return;
    }
    setStepStates((prev) => {
      const next = new Map(prev);
      next.set(event.step, {
        status: event.status,
        error: event.error,
        output: event.output,
      });
      return next;
    });
    if (event.status === "error") {
      setHasError(true);
    }
  }, []);

  useEffect(() => {
    const unlistenPromise = listenScaffoldProgress(handleProgress);
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [handleProgress]);

  // Also handle top-level scaffold errors (from the invoke reject)
  useEffect(() => {
    if (scaffoldError) setHasError(true);
  }, [scaffoldError]);

  // Scroll chat to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [setupMessages, streamingText]);

  // Clean up setup session on unmount
  useEffect(() => {
    return () => {
      setupCleanupRef.current?.();
    };
  }, []);

  /** Check if the validate step failed with a missing-tools error */
  const isMissingToolsError = useCallback((): boolean => {
    const validateState = stepStates.get("validate");
    if (!validateState || validateState.status !== "error") return false;
    return validateState.error?.includes("Required tools not found") ?? false;
  }, [stepStates]);

  /** Parse missing tool names from validate error */
  const parseMissingTools = useCallback((): string[] => {
    const validateState = stepStates.get("validate");
    if (!validateState?.error) return [];
    const match = validateState.error.match(/Required tools not found:\s*(.+?)\.?\s*Please/);
    if (!match) return [];
    return match[1].split(",").map((t) => t.trim()).filter(Boolean);
  }, [stepStates]);

  /** Start a Claude Code session to fix missing prerequisites */
  const handleFixWithClaude = useCallback(async () => {
    const missing = parseMissingTools();
    if (missing.length === 0) return;

    try {
      const session = await createSession(projectPath);
      const sessionId = session.id;
      setSetupSessionId(sessionId);
      setSetupMessages([]);
      setStreamingText("");
      setIsAssistantBusy(true);
      setAssistantTurnDone(false);

      await initializeSession(sessionId);
      await setSessionMode(sessionId, "auto-accept");

      // Listen to chat events
      const unlisten = await listenChatEvents(sessionId, (event: FrontendEvent) => {
        switch (event.type) {
          case "text_delta":
            setStreamingText((prev) => prev + event.text);
            break;
          case "text_complete":
            setSetupMessages((prev) => [
              ...prev,
              { role: "assistant", text: event.full_text },
            ]);
            setStreamingText("");
            break;
          case "turn_complete":
            setIsAssistantBusy(false);
            setAssistantTurnDone(true);
            break;
          case "process_error":
            setIsAssistantBusy(false);
            break;
          case "process_exited":
            setIsAssistantBusy(false);
            break;
        }
      });

      // Store cleanup function
      setupCleanupRef.current = () => {
        unlisten();
        closeSession(sessionId).catch(() => {});
      };

      // Build a rich initial prompt with full template context
      const toolList = missing.join(", ");
      const templateInfo = [
        `Template: ${template.name} (${template.id})`,
        `Category: ${template.category}`,
        `Scaffold type: ${template.scaffold_type}`,
        `Install command: ${template.install_command}`,
        `Dev command: ${template.dev_command}`,
        template.cli_command ? `CLI command: ${template.cli_command}` : null,
        template.prerequisites ? `Prerequisites note: ${template.prerequisites}` : null,
        template.post_commands?.length ? `Post-setup commands: ${template.post_commands.join("; ")}` : null,
      ].filter(Boolean).join("\n");

      const checkHints = template.prerequisite_checks
        ?.filter((c) => missing.includes(c.command) && c.install_command)
        .map((c) => `  - ${c.label} (${c.command}): suggested install → ${c.install_command}`)
        .join("\n");

      const prompt = [
        `I'm scaffolding a new project "${projectName}" and some required CLI tools are missing.`,
        "",
        `Missing tools: ${toolList}`,
        "",
        templateInfo,
        checkHints ? `\nKnown install hints:\n${checkHints}` : "",
        "",
        "Please install the missing tools on this macOS system and verify each one works (check version).",
        "Use the suggested install commands if provided, otherwise use your best judgment (Homebrew, npm, curl, etc.).",
        "Be concise — just install, verify, and confirm.",
      ].join("\n");

      setSetupMessages([{ role: "user", text: prompt }]);
      await sendMessage(sessionId, prompt);
    } catch (e) {
      console.error("Failed to start setup assistant:", e);
      setSetupSessionId(null);
      setIsAssistantBusy(false);
    }
  }, [parseMissingTools, projectPath]);

  /** Send a follow-up message in the setup assistant */
  const handleSendSetupMessage = useCallback(async () => {
    if (!setupSessionId || !setupInput.trim() || isAssistantBusy) return;
    const text = setupInput.trim();
    setSetupInput("");
    setSetupMessages((prev) => [...prev, { role: "user", text }]);
    setIsAssistantBusy(true);
    setAssistantTurnDone(false);
    try {
      await sendMessage(setupSessionId, text);
    } catch (e) {
      console.error("Failed to send message:", e);
      setIsAssistantBusy(false);
    }
  }, [setupSessionId, setupInput, isAssistantBusy]);

  /** Stop the assistant's current generation */
  const handleStopAssistant = useCallback(async () => {
    if (!setupSessionId) return;
    try {
      await interruptSession(setupSessionId);
    } catch (e) {
      console.error("Failed to interrupt:", e);
    }
  }, [setupSessionId]);

  /** Close setup session and retry scaffold */
  const handleContinueSetup = useCallback(() => {
    if (setupCleanupRef.current) {
      setupCleanupRef.current();
      setupCleanupRef.current = null;
    }
    setSetupSessionId(null);
    setSetupMessages([]);
    setStreamingText("");
    setIsAssistantBusy(false);
    setAssistantTurnDone(false);
    onRetry();
  }, [onRetry]);

  function getStepIcon(stepName: ScaffoldStepName): React.ReactNode {
    const state = stepStates.get(stepName);
    if (!state || state.status === "pending") {
      return (
        <div className="w-4 h-4 rounded-full border border-border" />
      );
    }
    if (state.status === "in_progress") {
      return <Loader2 size={16} className="text-accent animate-spin" />;
    }
    if (state.status === "done") {
      return (
        <div className="w-4 h-4 rounded-full bg-green-500/20 flex items-center justify-center">
          <Check size={10} className="text-green-400" />
        </div>
      );
    }
    // error
    return (
      <div className="w-4 h-4 rounded-full bg-red-500/20 flex items-center justify-center">
        <X size={10} className="text-red-400" />
      </div>
    );
  }

  const isFinished = complete || resultPath !== null;
  const hasWarnings = warnings.length > 0;

  function copyToClipboard(text: string): void {
    navigator.clipboard.writeText(text);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="text-center mb-3 shrink-0">
        <h3 className="text-text-primary text-base font-medium mb-0.5">
          {isFinished
            ? hasWarnings
              ? "Project ready (with warnings)"
              : "Project ready!"
            : `Setting up: ${projectName}`}
        </h3>
        <p className="text-text-dim text-label">
          Template: {template.name}
        </p>
        {!isFinished && !hasError && (
          <p className="text-text-dim text-label mt-0.5">This may take a minute...</p>
        )}
        {isFinished && !hasWarnings && (
          <p className="text-text-dim text-label mt-0.5">Your project has been scaffolded successfully.</p>
        )}
        {isFinished && hasWarnings && (
          <p className="text-text-dim text-label mt-0.5">
            Project was created but some steps had issues.
          </p>
        )}
      </div>

      {/* Step list */}
      <div className="w-full max-w-md mx-auto space-y-2.5 mb-3 shrink-0">
        {steps.map(({ step, label }) => {
          const state = stepStates.get(step);
          return (
            <div key={step}>
              <div className="flex items-start gap-3">
                <div className="mt-0.5">{getStepIcon(step)}</div>
                <div className="min-w-0 flex-1">
                  <span
                    className={`text-ui ${
                      state?.status === "in_progress"
                        ? "text-text-primary"
                        : state?.status === "done"
                          ? "text-text-secondary"
                          : state?.status === "error"
                            ? "text-red"
                            : "text-text-ghost"
                    }`}
                  >
                    {label}
                  </span>
                  {state?.error && (
                    <p className="text-label text-red/80 mt-0.5 break-words select-text">
                      {state.error}
                    </p>
                  )}
                  {/* "Fix with Claude" button for missing tools */}
                  {step === "validate" && state?.status === "error" && isMissingToolsError() && !setupSessionId && (
                    <button
                      onClick={handleFixWithClaude}
                      className="mt-2 flex items-center gap-1.5 text-label text-accent hover:text-accent-light transition-colors"
                    >
                      <Wrench size={12} />
                      Fix with Claude
                    </button>
                  )}
                </div>
              </div>
              {/* Collapsible command output for error steps */}
              {state?.output && state?.status === "error" && (
                <details className="ml-7 mt-1" open>
                  <summary className="text-label text-text-ghost cursor-pointer hover:text-text-dim select-none">
                    Show output
                  </summary>
                  <div className="relative mt-1">
                    <pre className="text-[11px] text-text-dim whitespace-pre-wrap select-text bg-bg-subtle rounded p-2 pr-8 max-h-40 overflow-y-auto font-mono">
                      {state.output}
                    </pre>
                    <button
                      onClick={() => copyToClipboard(state.output ?? "")}
                      className="absolute top-1.5 right-1.5 p-1 rounded hover:bg-bg-elevated text-text-ghost hover:text-text-dim transition-colors"
                      title="Copy output"
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </div>

      {/* Setup Assistant mini-chat — fills remaining space */}
      {setupSessionId && (
        <div className="flex-1 min-h-0 flex flex-col rounded-lg border border-border bg-bg-subtle overflow-hidden mb-3">
          {/* Chat messages */}
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
            {setupMessages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-1.5 text-label ${
                    msg.role === "user"
                      ? "bg-accent/15 text-accent"
                      : "bg-bg-elevated text-text-secondary"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                        code: ({ children }) => (
                          <code className="bg-bg-subtle px-1 rounded text-[11px] font-mono">{children}</code>
                        ),
                        pre: ({ children }) => (
                          <pre className="bg-bg-subtle rounded p-2 my-1 text-[11px] font-mono overflow-x-auto">{children}</pre>
                        ),
                      }}
                    >
                      {msg.text}
                    </ReactMarkdown>
                  ) : (
                    <span>{msg.text}</span>
                  )}
                </div>
              </div>
            ))}
            {/* Streaming text */}
            {streamingText && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-lg px-3 py-1.5 text-label bg-bg-elevated text-text-secondary">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                      code: ({ children }) => (
                        <code className="bg-bg-subtle px-1 rounded text-[11px] font-mono">{children}</code>
                      ),
                      pre: ({ children }) => (
                        <pre className="bg-bg-subtle rounded p-2 my-1 text-[11px] font-mono overflow-x-auto">{children}</pre>
                      ),
                    }}
                  >
                    {streamingText}
                  </ReactMarkdown>
                  <span className="inline-block w-1.5 h-3.5 bg-accent/60 animate-pulse ml-0.5 -mb-0.5" />
                </div>
              </div>
            )}
            {/* Thinking indicator — shows when busy but no text streamed yet */}
            {isAssistantBusy && !streamingText && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-bg-elevated">
                  <div className="flex items-center gap-1">
                    <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-accent" style={{ animationDelay: "0ms" }} />
                    <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-accent" style={{ animationDelay: "150ms" }} />
                    <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-accent" style={{ animationDelay: "300ms" }} />
                  </div>
                  <span className="text-label text-text-dim">Working...</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input row */}
          <div className="flex items-center gap-2 px-3 py-2 border-t border-border shrink-0">
            <input
              type="text"
              value={setupInput}
              onChange={(e) => setSetupInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendSetupMessage();
                }
              }}
              placeholder="Ask Claude..."
              disabled={isAssistantBusy}
              className="flex-1 bg-transparent text-text-primary text-label placeholder:text-text-ghost outline-none disabled:opacity-50"
            />
            {isAssistantBusy ? (
              <button
                onClick={handleStopAssistant}
                className="p-1 rounded hover:bg-bg-elevated text-text-dim hover:text-red transition-colors"
                title="Stop"
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                onClick={handleSendSetupMessage}
                disabled={!setupInput.trim()}
                className="p-1 rounded hover:bg-bg-elevated text-text-dim hover:text-accent disabled:opacity-30 transition-colors"
                title="Send"
              >
                <Send size={14} />
              </button>
            )}
          </div>

          {/* Continue Setup button */}
          {assistantTurnDone && !isAssistantBusy && (
            <div className="px-3 py-2 border-t border-border shrink-0">
              <button
                onClick={handleContinueSetup}
                className="w-full py-1.5 rounded-md bg-accent text-white text-label font-medium hover:bg-accent-light transition-colors"
              >
                Continue Setup
              </button>
            </div>
          )}
        </div>
      )}

      {/* Warnings summary */}
      {isFinished && hasWarnings && (
        <div className="w-full max-w-md mx-auto mb-3 rounded-lg bg-bg-subtle border border-border overflow-hidden shrink-0">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <AlertTriangle size={13} className="text-accent shrink-0" />
            <span className="text-text-secondary text-ui font-medium">
              {warnings.length} warning{warnings.length > 1 ? "s" : ""}
            </span>
          </div>
          <ul className="px-3 py-2 space-y-1">
            {warnings.map((w, i) => (
              <li key={`${w}-${i}`} className="text-text-dim text-label break-words select-text">{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Top-level error */}
      {scaffoldError && !stepStates.size && (
        <p className="text-label text-red mb-3 text-center select-text shrink-0">{scaffoldError}</p>
      )}

      {/* Actions */}
      <div className="flex items-center justify-center gap-3 shrink-0 pb-2">
        {isFinished ? (
          <button
            onClick={onOpenProject}
            className="px-6 py-2.5 rounded-lg bg-accent text-white text-ui font-medium hover:bg-accent-light transition-colors"
          >
            Open in CodeMantis
          </button>
        ) : hasError ? (
          <>
            {resultPath && (
              <button
                onClick={onOpenProject}
                className="px-4 py-2 rounded-lg border border-border text-text-secondary text-ui hover:bg-bg-elevated transition-colors"
              >
                Open Anyway
              </button>
            )}
            <button
              onClick={onRetry}
              className="px-4 py-2 rounded-lg bg-accent text-white text-ui font-medium hover:bg-accent-light transition-colors"
            >
              Retry
            </button>
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-lg text-text-dim text-ui hover:text-text-secondary transition-colors"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-text-dim text-ui hover:text-text-secondary transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
