import { useState, useRef, useCallback, useEffect, useMemo, type KeyboardEvent } from "react";
import { Send, Square, Plus, AtSign } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import { useAttachmentStore } from "../../stores/attachmentStore";
import { useClaudeSession } from "../../hooks/useClaudeSession";
import { useUiStore } from "../../stores/uiStore";
import { saveClipboardImage, getFileInfo } from "../../lib/tauri-commands";
import { useStopSession, STOPPING_LABEL, FORCE_STOPPING_LABEL } from "../../hooks/useStopSession";
import { open } from "@tauri-apps/plugin-dialog";
import AttachmentBar from "./AttachmentBar";
import ModeSelector from "./ModeSelector";
import PolicyPill from "./PolicyPill";
import CodexPlanToggle from "./CodexPlanToggle";
import AgentBadge from "./AgentBadge";
import ModelSelector from "./ModelSelector";
import EffortSelector from "./EffortSelector";
import type { Attachment } from "../../types/attachment";
import { handleError } from "../../lib/error-handler";
import { useFileDrop } from "../../hooks/useFileDrop";
import { useSettingsStore } from "../../stores/settingsStore";
import SuperBroToggle from "../chat/SuperBroToggle";
import { shouldSend, sendShortcutLabel, sendShortcutHint } from "../../lib/keyboard";
import { createPreviewUrl, processDroppedPaths } from "../../lib/file-utils";
import { useSelfDriveStore, useSelfDriveRunningForActiveProject } from "../../stores/selfDriveStore";

const EMPTY_ATTACHMENTS: Attachment[] = [];
const EMPTY_MESSAGES: import("../../types/session").Message[] = [];
import { inputDrafts } from "../../lib/input-drafts";
import CommandPalette, { type CommandPaletteHandle } from "./CommandPalette";
import MessageHistory, { type MessageHistoryHandle } from "./MessageHistory";
import PlanPendingBanner from "./PlanPendingBanner";
import { getUserMessageHistory } from "../../lib/message-history";
import { useCommandExecution } from "../../hooks/useCommandExecution";

export default function InputArea() {
  const [input, setInput] = useState("");
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [showMessageHistory, setShowMessageHistory] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const paletteRef = useRef<CommandPaletteHandle>(null);
  const historyRef = useRef<MessageHistoryHandle>(null);
  const prevSessionRef = useRef<string | null>(null);
  const { executeCommand } = useCommandExecution();
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const session = useSessionStore((s) => s.activeSessionId ? s.sessions.get(s.activeSessionId) ?? null : null);
  const isStreaming = useSessionStore((s) => s.activeSessionId ? s.sessionStreaming.get(s.activeSessionId)?.isStreaming ?? false : false);
  const isBusy = useSessionStore((s) => s.activeSessionId ? s.sessionBusy.get(s.activeSessionId) ?? false : false);
  // While a stop is escalating, the session activity carries the phase label
  // (Stopping… → Force-stopping…); reflect it on the Stop button.
  const stopProgressLabel = useSessionStore((s) => {
    if (!s.activeSessionId) return null;
    const label = s.sessionActivity.get(s.activeSessionId)?.label;
    return label === STOPPING_LABEL || label === FORCE_STOPPING_LABEL ? label : null;
  });
  const { stopSession } = useStopSession();
  const sendShortcut = useSettingsStore((s) => s.settings.sendShortcut);

  const sessionMessages = useSessionStore((s) =>
    s.activeSessionId ? s.sessionMessages.get(s.activeSessionId) ?? EMPTY_MESSAGES : EMPTY_MESSAGES
  );
  const historyItems = useMemo(
    () => getUserMessageHistory(sessionMessages, 10),
    [sessionMessages]
  );

  // Save/restore input drafts per session
  useEffect(() => {
    if (prevSessionRef.current) {
      const currentInput = textareaRef.current?.value ?? "";
      if (currentInput) {
        inputDrafts.set(prevSessionRef.current, currentInput);
      } else {
        inputDrafts.delete(prevSessionRef.current);
      }
    }
    const restored = activeSessionId ? inputDrafts.get(activeSessionId) ?? "" : "";
    setInput(restored);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    setShowCommandPalette(false);
    setShowMessageHistory(false);
    setCommandQuery("");
    prevSessionRef.current = activeSessionId;
    // Auto-focus chat input when switching sessions/projects
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [activeSessionId]);

  const draftInput = useUiStore((s) => s.draftInput);
  const setDraftInput = useUiStore((s) => s.setDraftInput);

  // Consume draftInput from assistant "Use in Chat"
  useEffect(() => {
    if (draftInput !== null) {
      setInput(draftInput);
      setDraftInput(null);
      setTimeout(() => {
        const el = textareaRef.current;
        if (el) {
          el.style.height = "auto";
          const maxHeight = 8 * 24;
          el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
          el.focus();
        }
      }, 0);
    }
  }, [draftInput, setDraftInput]);

  // Consume pendingInputInsert — append path text to current input
  const pendingInputInsert = useUiStore((s) => s.pendingInputInsert);
  const setPendingInputInsert = useUiStore((s) => s.setPendingInputInsert);

  useEffect(() => {
    if (pendingInputInsert !== null) {
      setInput((prev) => {
        const separator = prev && !prev.endsWith(" ") && !prev.endsWith("\n") ? " " : "";
        return prev + separator + pendingInputInsert;
      });
      setPendingInputInsert(null);
      setTimeout(() => {
        const el = textareaRef.current;
        if (el) {
          el.style.height = "auto";
          const maxHeight = 8 * 24;
          el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
          el.focus();
        }
      }, 0);
    }
  }, [pendingInputInsert, setPendingInputInsert]);

  // Global Escape key to interrupt generation (or pause Self-Drive)
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Don't intercept if a modal is open
      const ui = useUiStore.getState();
      if (ui.showSettingsModal || ui.showClaudeHistory) return;

      // If Self-Drive is running for the active project, Escape pauses it
      const sdState = useSelfDriveStore.getState();
      const activeProject = useSessionStore.getState().activeProjectPath;
      if (sdState.status === "running" && sdState.projectPath === activeProject) {
        e.preventDefault();
        sdState.pause();
        return;
      }

      if (!activeSessionId || !isBusy) return;
      e.preventDefault();
      stopSession(activeSessionId);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeSessionId, isBusy, stopSession]);

  // Listen for Cmd+/ to open command palette
  useEffect(() => {
    const handler = () => {
      setInput("/");
      setShowCommandPalette(true);
      setCommandQuery("");
      textareaRef.current?.focus();
    };
    window.addEventListener("open-command-palette", handler);
    return () => window.removeEventListener("open-command-palette", handler);
  }, []);

  const attachments = useAttachmentStore((s) => activeSessionId ? s.attachments.get(activeSessionId) ?? EMPTY_ATTACHMENTS : EMPTY_ATTACHMENTS);
  const addAttachment = useAttachmentStore((s) => s.addAttachment);
  const clearAttachments = useAttachmentStore((s) => s.clearAttachments);

  const { sendMessage } = useClaudeSession();

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    const hasAttachments = attachments.length > 0;
    if ((!trimmed && !hasAttachments) || !activeSessionId || isStreaming) return;

    // Build prompt with attachment references
    let prompt = trimmed;
    if (hasAttachments) {
      const attachmentRefs = attachments
        .map((a) => `[Attached file: ${a.filePath}]`)
        .join("\n");
      prompt = attachmentRefs + (trimmed ? "\n\n" + trimmed : "");
    }

    setInput("");
    if (activeSessionId) inputDrafts.delete(activeSessionId);
    clearAttachments(activeSessionId!);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    await sendMessage(activeSessionId, prompt);
  }, [input, activeSessionId, isStreaming, sendMessage, attachments, clearAttachments]);

  const handleStop = useCallback(() => {
    if (!activeSessionId) return;
    stopSession(activeSessionId);
  }, [activeSessionId, stopSession]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // When command palette is open, intercept navigation keys
      if (showCommandPalette && paletteRef.current) {
        const handled = paletteRef.current.handleKeyDown(e.key);
        if (handled) {
          e.preventDefault();
          return;
        }
      }
      // When message history is open, delegate navigation
      if (showMessageHistory && historyRef.current) {
        const handled = historyRef.current.handleKeyDown(e.key);
        if (handled) {
          e.preventDefault();
          return;
        }
      }
      // Open message history on ArrowUp when input is empty
      if (
        e.key === "ArrowUp" &&
        input.trim() === "" &&
        !showCommandPalette &&
        !showMessageHistory &&
        historyItems.length > 0
      ) {
        e.preventDefault();
        setShowMessageHistory(true);
        return;
      }
      if (shouldSend(e, sendShortcut)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, showCommandPalette, showMessageHistory, sendShortcut, input, historyItems.length]
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = 8 * 24; // 8 rows
    el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
  }, []);

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      if (!session) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;

          const now = new Date();
          const timeStr = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
          const filename = `clipboard_${timeStr}.png`;

          const arrayBuffer = await blob.arrayBuffer();
          const imageData = Array.from(new Uint8Array(arrayBuffer));

          try {
            const info = await saveClipboardImage(
              session.project_path,
              imageData,
              filename
            );
            const thumbnailUrl = info.is_image
              ? await createPreviewUrl(info.file_path, info.mime_type)
              : undefined;
            addAttachment(activeSessionId!, {
              id: `att-${Date.now()}`,
              fileName: info.file_name,
              filePath: info.file_path,
              fileSize: info.file_size,
              mimeType: info.mime_type,
              isImage: info.is_image,
              thumbnailUrl,
            });
          } catch (err) {
            handleError("InputArea.paste", err);
          }
          return; // Only handle one image
        }
      }
    },
    [session, activeSessionId, addAttachment]
  );

  // Tauri native file drop
  const containerRef = useRef<HTMLDivElement>(null);
  const handleFileDrop = useCallback(async (paths: string[]) => {
    if (!activeSessionId) return;
    const atts = await processDroppedPaths(paths);
    for (const att of atts) addAttachment(activeSessionId, att);
  }, [activeSessionId, addAttachment]);
  const { isDragOver: dragOver } = useFileDrop({
    id: "input-area",
    containerRef,
    onDrop: handleFileDrop,
    priority: 1,
    enabled: !!session,
  });

  const handleFileDialog = useCallback(async () => {
    if (!session) return;

    try {
      const result = await open({
        multiple: true,
        filters: [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
          { name: "Documents", extensions: ["pdf", "txt", "md"] },
          { name: "Code", extensions: ["ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "rb"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (!result) return;

      const paths = Array.isArray(result) ? result : [result];
      for (const filePath of paths) {
        try {
          const info = await getFileInfo(filePath);
          const previewUrl = info.is_image
            ? await createPreviewUrl(info.file_path, info.mime_type)
            : undefined;
          addAttachment(activeSessionId!, {
            id: `att-${Date.now()}-${info.file_name}`,
            fileName: info.file_name,
            filePath: info.file_path,
            fileSize: info.file_size,
            mimeType: info.mime_type,
            isImage: info.is_image,
            thumbnailUrl: previewUrl,
          });
        } catch (err) {
          handleError("InputArea.fileDialog.attach", err);
        }
      }
    } catch (err) {
      handleError("InputArea.fileDialog", err);
    }
  }, [session, activeSessionId, addAttachment]);

  const selfDriveRunning = useSelfDriveRunningForActiveProject();

  const isActive = (input.trim().length > 0 || attachments.length > 0) && !!session && !isStreaming && !selfDriveRunning;

  return (
    <div
      ref={containerRef}
      className={`relative border-t border-border px-4 py-3 ${dragOver ? "bg-accent/5" : ""}`}
    >
      <div className="max-w-[1080px] mx-auto relative">
        {/* Self-Drive lockout overlay */}
        {selfDriveRunning && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center rounded-xl"
            style={{ background: "color-mix(in srgb, var(--bg-elevated) 90%, transparent)" }}
          >
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg" style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
              <span className="text-label" style={{ color: "var(--text-secondary)" }}>
                Self-Drive is active. Click <span className="font-medium">Pause</span> in the Guide panel to send manual messages.
              </span>
            </div>
          </div>
        )}
        {/* Command palette dropdown */}
        {showCommandPalette && session && (
          <CommandPalette
            ref={paletteRef}
            query={commandQuery}
            onSelect={(cmd, args) => {
              setShowCommandPalette(false);
              setInput("");
              executeCommand(cmd, args);
            }}
            onClose={() => {
              setShowCommandPalette(false);
              setInput("");
            }}
          />
        )}

        {/* Message history dropdown */}
        {showMessageHistory && historyItems.length > 0 && (
          <MessageHistory
            ref={historyRef}
            items={historyItems}
            onSelect={(text) => {
              setShowMessageHistory(false);
              setInput(text);
              setTimeout(() => {
                const el = textareaRef.current;
                if (el) {
                  el.style.height = "auto";
                  const maxHeight = 8 * 24;
                  el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
                  el.focus();
                }
              }, 0);
            }}
            onClose={() => setShowMessageHistory(false)}
          />
        )}

        {/* Banner shown when a plan is pending but the approval modal is closed.
            Renders nothing when no plan is pending or the modal is open. */}
        <PlanPendingBanner />

        <div
          className={`rounded-xl border transition-colors focus-within:border-accent/40 ${
            dragOver ? "border-accent/60 bg-accent/5" : "border-border bg-bg-elevated"
          }`}
          style={!dragOver ? { background: "var(--bg-elevated)" } : undefined}
        >
          {/* Attachment bar */}
          <AttachmentBar sessionId={activeSessionId ?? ""} />

          {/* Drop zone overlay text */}
          {dragOver && (
            <div className="px-4 py-2 text-center text-accent text-ui">
              Drop files to attach
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              const newValue = e.target.value;
              if (showMessageHistory) {
                setShowMessageHistory(false);
              }
              if (newValue.startsWith("/") && !newValue.includes("\n")) {
                setShowCommandPalette(true);
                setCommandQuery(newValue.slice(1));
                setInput(newValue);
                handleInput();
                return;
              }
              if (showCommandPalette && !newValue.startsWith("/")) {
                setShowCommandPalette(false);
              }
              setInput(newValue);
              handleInput();
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              session
                ? (() => {
                    const agent =
                      (session.agent_id ?? "claude_code") === "codex"
                        ? "Codex"
                        : "Claude";
                    return isBusy
                      ? `Ask ${agent} anything... even while ${agent} is busy! (${sendShortcutHint(sendShortcut)})`
                      : `Ask ${agent} anything... (${sendShortcutHint(sendShortcut)})`;
                  })()
                : "Open a project to start..."
            }
            disabled={!session}
            rows={3}
            className="w-full resize-none bg-transparent px-4 py-3 text-chat text-text-primary placeholder:text-text-ghost outline-none"
          />

          {/* Action bar */}
          <div className="flex flex-wrap items-center gap-y-1 px-3 pb-2">
            <div className="flex flex-wrap items-center gap-1">
              <button
                onClick={handleFileDialog}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-label text-text-faint hover:text-text-dim hover:bg-bg-subtle transition-colors"
                disabled={!session}
              >
                <Plus size={13} />
                <span>File</span>
              </button>
              <button
                className="flex items-center gap-1 px-2 py-1 rounded-md text-label text-text-faint hover:text-text-dim hover:bg-bg-subtle transition-colors"
                disabled={!session}
              >
                <AtSign size={13} />
                <span>Agent</span>
              </button>
              <button
                onClick={() => {
                  setInput("/");
                  setShowCommandPalette(true);
                  setCommandQuery("");
                  textareaRef.current?.focus();
                }}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-label text-text-faint hover:text-text-dim hover:bg-bg-subtle transition-colors"
                disabled={!session}
                title="Command palette (type / or Cmd+/)"
              >
                <span className="font-mono text-xs leading-none">/</span>
                <span>Cmd</span>
              </button>
              <SuperBroToggle />
            </div>

            <div className="flex flex-wrap items-center gap-2 ml-auto">
              {session && (
                <div className="flex flex-wrap items-center gap-2 select-none">
                  <AgentBadgeForActive />
                  <div className="w-px h-4 bg-border-light" />
                  {session.agent_id === "codex" ? (
                    <CodexPolicyControl sessionId={session.id} />
                  ) : (
                    <ModeSelector />
                  )}
                  <div className="w-px h-4 bg-border-light" />
                  <ModelSelector />
                  <EffortSelector />
                </div>
              )}
              {isBusy ? (
                <button
                  onClick={handleStop}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-ui font-medium transition-all shrink-0 text-red hover:brightness-90"
                  style={{ background: "color-mix(in srgb, var(--red) 15%, transparent)" }}
                >
                  <Square size={12} />
                  <span>{stopProgressLabel ?? "Stop"}</span>
                  <span className="text-label opacity-60">Esc</span>
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!isActive}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-ui font-medium transition-all shrink-0 ${
                    isActive
                      ? "bg-accent text-white hover:bg-accent-light"
                      : "bg-bg-subtle text-text-ghost cursor-not-allowed"
                  }`}
                >
                  <Send size={13} />
                  <span>Send</span>
                  <span className="text-label opacity-60">{sendShortcutLabel(sendShortcut)}</span>
                </button>
              )}
            </div>
          </div>

          {/* Keyboard shortcut hints — both agents support Shift+Tab now.
              For Codex it cycles the (sandbox, approval) presets the same
              way it cycles Claude's permission modes; see
              useKeyboardShortcuts.ts::CODEX_POLICY_CYCLE. */}
          {session && (
            <div className="flex items-center justify-center gap-4 pb-1.5 -mt-0.5 text-label text-text-ghost select-none">
              {(session.agent_id ?? "claude_code") === "codex" ? (
                <span>Shift+Tab to cycle Policy</span>
              ) : (
                <span>Shift+Tab to switch mode</span>
              )}
              <span>⌘+/⌘− to adjust font size</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Visible agent indicator that reads the active session and offers a
 * one-click path to open a new session with the other agent in the
 * same project (v1.3.1: addresses "where do I select Codex from the
 * chat interface?").
 */
function AgentBadgeForActive(): React.ReactElement | null {
  const session = useSessionStore((s) => s.getActiveSession());
  const { addSessionToProject } = useClaudeSession();
  if (!session) return null;
  const activeAgent = session.agent_id ?? "claude_code";
  return (
    <AgentBadge
      activeAgent={activeAgent}
      onOpenNewSessionWith={async () => {
        // The hook reads uiStore.selectedAgentId on every call; the
        // badge updates it before invoking us, so the new session
        // uses the requested agent.
        await addSessionToProject();
      }}
    />
  );
}

/**
 * Phase 2 §6.1: per-Codex-session PolicyPill wrapper. Mounted in place
 * of ModeSelector when the active session's agent_id is `codex`. Reads
 * + writes the per-session policy through uiStore so tab switches
 * preserve the user's selection.
 */
// Spec §2.3 "Auto" preset — used when the user hasn't picked a
// policy yet for this session. Defined at module scope so the
// reference is stable across renders (returning a fresh object from a
// zustand selector triggers an infinite re-render loop because
// Object.is comparison always fails).
const DEFAULT_CODEX_POLICY = {
  sandbox: "workspace-write" as const,
  approval: "on-request" as const,
  network_access: false,
};

function CodexPolicyControl({ sessionId }: { sessionId: string }): React.ReactElement {
  // Selector returns the actual stored reference (or undefined) — never
  // a fresh literal. The `??` fallback to a module-scope constant
  // happens *outside* the selector so both branches yield a stable
  // identity. This is the fix for "Maximum update depth exceeded" the
  // user saw when switching to Codex.
  const stored = useUiStore((s) => s.codexPolicies[sessionId]);
  const updateLocal = useUiStore((s) => s.updateCodexPolicyLocal);
  const policy = stored ?? DEFAULT_CODEX_POLICY;
  return (
    <div className="flex items-center gap-1.5">
      <CodexPlanToggle sessionId={sessionId} />
      <PolicyPill
        sessionId={sessionId}
        value={policy}
        onChange={(next) => updateLocal(sessionId, next)}
      />
    </div>
  );
}
