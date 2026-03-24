import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { MessageSquare } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { useAssistantStore } from "../../stores/assistantStore";
import type { AssistantInstance } from "../../stores/assistantStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { EMPTY_ARRAY } from "../../lib/empty-refs";
import { useUiStore } from "../../stores/uiStore";
import { useAssistantSession } from "../../hooks/useAssistantSession";
import { useClickOutside } from "../../hooks/useClickOutside";
import { useProviderMenu } from "../../hooks/useProviderMenu";
import { useAssistantShortcuts } from "../../hooks/useAssistantShortcuts";
import { useAssistantAttachments } from "../../hooks/useAssistantAttachments";
import AssistantProviderMenu from "./AssistantProviderMenu";
import AssistantMessageMenu from "./AssistantMessageMenu";
import AssistantHeader from "./AssistantHeader";
import AssistantMessageList from "./AssistantMessageList";
import AssistantInputArea from "./AssistantInputArea";
import { assistantInputDrafts } from "../../lib/input-drafts";

export default function AssistantPanel() {
  const [input, setInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const prevAssistantRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);

  const allProjectAssistants = useAssistantStore((s) => activeProjectPath ? s.projectAssistants.get(activeProjectPath) ?? EMPTY_ARRAY : EMPTY_ARRAY) as AssistantInstance[];
  const assistants = useMemo(() => {
    if (!activeSessionId) return EMPTY_ARRAY as AssistantInstance[];
    const filtered = allProjectAssistants.filter((a) => a.parentSessionId === activeSessionId);
    return filtered.length > 0 ? filtered : EMPTY_ARRAY as AssistantInstance[];
  }, [allProjectAssistants, activeSessionId]);
  const activeAssistantId = useAssistantStore((s) => activeSessionId ? s.activeAssistantId.get(activeSessionId) ?? null : null);
  const messages = useAssistantStore((s) => activeAssistantId ? s.messages.get(activeAssistantId) ?? EMPTY_ARRAY : EMPTY_ARRAY);
  const streaming = useAssistantStore((s) => activeAssistantId ? s.streaming.get(activeAssistantId) : undefined);
  const busy = useAssistantStore((s) => activeAssistantId ? s.busy.get(activeAssistantId) ?? false : false);
  const allBusy = useAssistantStore((s) => s.busy);
  const allCost = useAssistantStore((s) => s.sessionCost);
  const setActiveAssistant = useAssistantStore((s) => s.setActiveAssistant);

  const shortcuts = useSettingsStore((s) => s.settings.assistantShortcuts);
  const apiKeys = useSettingsStore((s) => s.settings.apiKeys);
  const defaultModels = useSettingsStore((s) => s.settings.assistantDefaultModel);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  const { createAssistant, sendMessage, retryLastMessage, cancelAssistant, closeAssistant } = useAssistantSession();

  const {
    showProviderMenu, setShowProviderMenu,
    expandedProvider, setExpandedProvider,
    handleCreate,
  } = useProviderMenu({
    activeProjectPath,
    activeSessionId,
    creating,
    setCreating,
    apiKeys,
    defaultModels,
    createAssistant,
  });

  const {
    shortcutDraft, setShortcutDraft,
    shortcutName, setShortcutName,
    handleAddShortcut, handleSaveShortcut,
  } = useAssistantShortcuts({ shortcuts, updateSettings });

  const {
    currentAttachments,
    removeAssistantAttachment,
    clearAssistantAttachments,
    inputContainerRef,
    dragOver,
    handlePaste,
    handleFileDialog,
  } = useAssistantAttachments({
    activeAssistantId,
    activeProjectPath,
  });

  const { activeInstance, isClaudeCode, isApiProvider, showThinking } = useMemo(() => {
    const activeInstance = activeAssistantId ? assistants.find((a) => a.id === activeAssistantId) : undefined;
    const isClaudeCode = activeInstance?.provider === "claude-code";
    const isApiProvider = activeInstance && activeInstance.provider !== "claude-code";
    const showThinking = busy && !streaming?.isStreaming;
    return { activeInstance, isClaudeCode, isApiProvider, showThinking };
  }, [activeAssistantId, assistants, busy, streaming]);

  const closeProviderMenu = useCallback(() => setShowProviderMenu(false), [setShowProviderMenu]);
  const providerMenuRef = useClickOutside<HTMLDivElement>(showProviderMenu, closeProviderMenu);

  // Save/restore input drafts per assistant tab
  useEffect(() => {
    if (prevAssistantRef.current) {
      const currentInput = textareaRef.current?.value ?? "";
      if (currentInput) {
        assistantInputDrafts.set(prevAssistantRef.current, currentInput);
      } else {
        assistantInputDrafts.delete(prevAssistantRef.current);
      }
    }
    const restored = activeAssistantId ? assistantInputDrafts.get(activeAssistantId) ?? "" : "";
    setInput(restored);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    setShowProviderMenu(false);
    setExpandedProvider(null);
    setContextMenu(null);
    prevAssistantRef.current = activeAssistantId;
  }, [activeAssistantId, setShowProviderMenu, setExpandedProvider]);

  // Escape key to cancel assistant generation
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || !activeAssistantId || !busy) return;
      const ui = useUiStore.getState();
      if (ui.showSettingsModal || ui.showClaudeHistory) return;
      e.preventDefault();
      cancelAssistant(activeAssistantId);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeAssistantId, busy, cancelAssistant]);

  const handleClose = useCallback(async (sessionId: string) => {
    if (!activeProjectPath) return;
    await closeAssistant(activeProjectPath, sessionId);
  }, [activeProjectPath, closeAssistant]);

  const handleSelect = useCallback((sessionId: string) => {
    if (!activeSessionId) return;
    setActiveAssistant(activeSessionId, sessionId);
  }, [activeSessionId, setActiveAssistant]);

  const handleContextMenu = useCallback((e: React.MouseEvent, text: string) => {
    setContextMenu({ x: e.clientX, y: e.clientY, text });
  }, []);

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
  }, []);

  // No project open
  if (!activeProjectPath) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <p className="text-text-faint text-ui text-center">
          Open a project to use the assistant
        </p>
      </div>
    );
  }

  // No assistants yet — show empty state with provider selection
  if (assistants.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-4">
        <MessageSquare size={24} className="text-text-faint" />
        <p className="text-text-faint text-ui text-center">
          Ask questions about your project, get help with code, or chat with AI.
        </p>
        <AssistantProviderMenu
          variant="empty"
          apiKeys={apiKeys}
          expandedProvider={expandedProvider}
          creating={creating}
          onExpandProvider={setExpandedProvider}
          onCreate={handleCreate}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <AssistantHeader
        assistants={assistants}
        activeAssistantId={activeAssistantId}
        allBusy={allBusy}
        allCost={allCost}
        onSelect={handleSelect}
        onClose={handleClose}
        onOpenProviderMenu={() => setShowProviderMenu(true)}
        showProviderMenu={showProviderMenu}
        providerMenuRef={providerMenuRef}
        apiKeys={apiKeys}
        expandedProvider={expandedProvider}
        creating={creating}
        onExpandProvider={setExpandedProvider}
        onCreate={handleCreate}
        isApiProvider={isApiProvider}
        activeInstance={activeInstance}
        messages={messages}
        streaming={streaming}
      />

      <AssistantMessageList
        messages={messages}
        streaming={streaming}
        showThinking={showThinking}
        activeAssistantId={activeAssistantId}
        isClaudeCode={isClaudeCode}
        onContextMenu={handleContextMenu}
        onRetry={retryLastMessage}
      />

      <AssistantInputArea
        activeAssistantId={activeAssistantId}
        activeProjectPath={activeProjectPath}
        busy={busy}
        isClaudeCode={isClaudeCode}
        currentAttachments={currentAttachments}
        removeAssistantAttachment={removeAssistantAttachment}
        clearAssistantAttachments={clearAssistantAttachments}
        sendMessage={sendMessage}
        cancelAssistant={cancelAssistant}
        closeAssistant={closeAssistant}
        shortcuts={shortcuts}
        inputContainerRef={inputContainerRef}
        dragOver={dragOver}
        handlePaste={handlePaste}
        handleFileDialog={handleFileDialog}
        onInputChange={handleInputChange}
        input={input}
        textareaRef={textareaRef}
      />

      {contextMenu && (
        <AssistantMessageMenu
          x={contextMenu.x}
          y={contextMenu.y}
          messageText={contextMenu.text}
          onClose={() => setContextMenu(null)}
          onAddShortcut={handleAddShortcut}
        />
      )}

      <Dialog.Root
        open={shortcutDraft !== null}
        onOpenChange={(open) => {
          if (!open) {
            setShortcutDraft(null);
            setShortcutName("");
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 rounded-xl border border-border p-5 w-[360px]"
            style={{ background: "var(--bg-primary)" }}
          >
            <Dialog.Title className="text-ui text-text-primary font-semibold mb-3">
              Save as Shortcut
            </Dialog.Title>
            <div className="space-y-3">
              <div>
                <label className="text-label text-text-dim block mb-1">Name</label>
                <input
                  type="text"
                  value={shortcutName}
                  onChange={(e) => setShortcutName(e.target.value)}
                  placeholder="e.g. Code Review"
                  autoFocus
                  className="w-full px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40 placeholder:text-text-ghost"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveShortcut();
                  }}
                />
              </div>
              <div>
                <label className="text-label text-text-dim block mb-1">Prompt</label>
                <p className="text-label text-text-faint bg-bg-elevated rounded-lg px-3 py-2 max-h-24 overflow-y-auto border border-border-light">
                  {shortcutDraft?.prompt.slice(0, 200)}
                  {(shortcutDraft?.prompt.length ?? 0) > 200 && "..."}
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => { setShortcutDraft(null); setShortcutName(""); }}
                  className="px-3 py-1.5 rounded-lg text-ui text-text-secondary border border-border hover:bg-bg-elevated transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveShortcut}
                  disabled={!shortcutName.trim()}
                  className="px-3 py-1.5 rounded-lg text-ui text-white bg-accent hover:bg-accent-light transition-colors font-medium disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
