import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useSettingsFormState } from "../../hooks/useSettingsFormState";
import { SPEC_WRITING_MODELS } from "../../types/assistant-provider";

import { NAV_ITEMS } from "./settings/SettingsShared";
import GeneralTab from "./settings/GeneralTab";
import TerminalTab from "./settings/TerminalTab";
import QuickCommandsTab from "./settings/QuickCommandsTab";
import AIProvidersTab from "./settings/AIProvidersTab";
import ChangelogSettingsTab from "./settings/ChangelogSettingsTab";
import AssistantSettingsTab from "./settings/AssistantSettingsTab";
import ShortcutsTab from "./settings/ShortcutsTab";
import ApiLogsTab from "./settings/ApiLogsTab";
import { SectionTitle, FieldRow } from "./settings/SettingsShared";

export default function SettingsModal() {
  const state = useSettingsFormState();

  return (
    <Dialog.Root open={state.showModal} onOpenChange={(open) => {
      if (!open) {
        document.documentElement.setAttribute("data-theme", state.settings.theme);
      }
      state.setShowModal(open);
    }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 rounded-xl border border-border overflow-hidden flex"
          style={{ background: "var(--bg-primary)", width: "min(92vw, 940px)", height: "min(88vh, 730px)" }}
        >
          {/* Sidebar */}
          <nav className="w-48 shrink-0 border-r border-border flex flex-col" style={{ background: "var(--bg-secondary)" }}>
            <Dialog.Title className="text-ui text-text-primary font-semibold px-4 pt-4 pb-3">
              Settings
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              Application settings and preferences
            </Dialog.Description>
            <div className="flex-1 px-2 space-y-0.5">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = state.activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => state.setActiveTab(item.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-ui transition-colors text-left ${
                      isActive
                        ? "bg-accent/15 text-accent font-medium"
                        : "text-text-secondary hover:text-text-primary hover:bg-bg-elevated"
                    }`}
                  >
                    <Icon size={14} className={isActive ? "text-accent" : "text-text-faint"} />
                    {item.label}
                  </button>
                );
              })}
            </div>
            {/* Footer buttons */}
            <div className="p-3 border-t border-border flex gap-2">
              <button
                onClick={state.handleCancel}
                className="flex-1 px-3 py-1.5 rounded-lg text-ui text-text-secondary border border-border hover:bg-bg-elevated transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={state.handleSave}
                className="flex-1 px-3 py-1.5 rounded-lg text-ui text-white bg-accent hover:bg-accent-light transition-colors font-medium"
              >
                Save
              </button>
            </div>
          </nav>

          {/* Content */}
          <div className={`flex-1 p-6 relative ${state.activeTab === "api-logs" ? "flex flex-col overflow-hidden" : "overflow-y-auto"}`}>
            {/* Close button */}
            <button
              onClick={state.handleCancel}
              aria-label="Close settings"
              className="absolute top-4 right-4 text-text-ghost hover:text-text-primary transition-colors p-1 rounded hover:bg-bg-elevated"
            >
              <X size={15} />
            </button>

            {state.activeTab === "general" && (
              <GeneralTab
                theme={state.theme}
                fontSize={state.fontSize}
                sendShortcut={state.sendShortcut}
                triviaEnabled={state.triviaEnabled}
                autoOpenFiles={state.autoOpenFiles}
                defaultContextWindow={state.defaultContextWindow}
                showWelcomeScreen={state.showWelcomeScreen}
                onThemeChange={state.handleThemeChange}
                onFontSizeChange={state.setFontSize}
                onSendShortcutChange={state.setSendShortcut}
                onTriviaEnabledChange={state.setTriviaEnabled}
                onAutoOpenFilesChange={state.setAutoOpenFiles}
                onDefaultContextWindowChange={state.setDefaultContextWindow}
                onShowWelcomeScreenChange={state.setShowWelcomeScreen}
              />
            )}

            {state.activeTab === "terminal" && (
              <TerminalTab
                shell={state.terminalShell}
                fontSize={state.terminalFontSize}
                onShellChange={state.setTerminalShell}
                onFontSizeChange={state.setTerminalFontSize}
              />
            )}

            {state.activeTab === "quick-commands" && (
              <QuickCommandsTab
                commands={state.quickCommands}
                onChange={state.setQuickCommands}
              />
            )}

            {state.activeTab === "ai-providers" && (
              <AIProvidersTab
                apiKeys={state.apiKeys}
                modelPricing={state.modelPricing}
                testingKey={state.testingKey}
                testResults={state.testResults}
                onApiKeyChange={state.handleApiKeyChange}
                onModelPricingChange={state.handleModelPricingChange}
                onTestKey={state.handleTestKey}
              />
            )}

            {state.activeTab === "changelog" && (
              <ChangelogSettingsTab
                enabled={state.changelogEnabled}
                provider={state.changelogProvider}
                model={state.changelogModel}
                prompt={state.changelogPrompt}
                onEnabledChange={state.setChangelogEnabled}
                onProviderChange={state.handleChangelogProviderChange}
                onModelChange={state.setChangelogModel}
                onPromptChange={state.setChangelogPrompt}
              />
            )}

            {state.activeTab === "assistant" && (
              <AssistantSettingsTab
                defaultProvider={state.assistantDefaultProvider}
                defaultModel={state.assistantDefaultModel}
                shortcuts={state.assistantShortcuts}
                apiKeys={state.apiKeys}
                onProviderChange={state.handleAssistantProviderChange}
                onModelChange={state.handleAssistantModelChange}
                onShortcutsChange={state.setAssistantShortcuts}
              />
            )}

            {state.activeTab === "preview" && (
              <PreviewSettingsContent
                defaultWidth={state.previewDefaultWidth}
                defaultHeight={state.previewDefaultHeight}
                autoStart={state.previewAutoStart}
                customDevCommand={state.previewCustomDevCommand}
                consoleAutoOpen={state.previewConsoleAutoOpen}
                onDefaultWidthChange={state.setPreviewDefaultWidth}
                onDefaultHeightChange={state.setPreviewDefaultHeight}
                onAutoStartChange={state.setPreviewAutoStart}
                onCustomDevCommandChange={state.setPreviewCustomDevCommand}
                onConsoleAutoOpenChange={state.setPreviewConsoleAutoOpen}
              />
            )}

            {state.activeTab === "task-board" && (
              <SpecWriterSettingsContent
                planningModel={state.taskBoardPlanningModel}
                maxTokens={state.taskBoardMaxTokens}
                apiKeys={state.apiKeys}
                onPlanningModelChange={state.setTaskBoardPlanningModel}
                onMaxTokensChange={state.setTaskBoardMaxTokens}
              />
            )}

            {state.activeTab === "shortcuts" && <ShortcutsTab />}

            {state.activeTab === "api-logs" && <ApiLogsTab />}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// --- Preview Settings ---

function PreviewSettingsContent({
  defaultWidth,
  defaultHeight,
  autoStart,
  customDevCommand,
  consoleAutoOpen,
  onDefaultWidthChange,
  onDefaultHeightChange,
  onAutoStartChange,
  onCustomDevCommandChange,
  onConsoleAutoOpenChange,
}: {
  defaultWidth: number;
  defaultHeight: number;
  autoStart: boolean;
  customDevCommand: string;
  consoleAutoOpen: boolean;
  onDefaultWidthChange: (v: number) => void;
  onDefaultHeightChange: (v: number) => void;
  onAutoStartChange: (v: boolean) => void;
  onCustomDevCommandChange: (v: string) => void;
  onConsoleAutoOpenChange: (v: boolean) => void;
}) {
  return (
    <div>
      <SectionTitle>Preview Window</SectionTitle>
      <FieldRow label="Default width (px)">
        <input
          type="number"
          value={defaultWidth}
          onChange={(e) => onDefaultWidthChange(Number(e.target.value) || 1024)}
          className="w-24 px-2 py-1 rounded text-ui bg-bg-elevated text-text-primary border border-border text-right"
        />
      </FieldRow>
      <FieldRow label="Default height (px)">
        <input
          type="number"
          value={defaultHeight}
          onChange={(e) => onDefaultHeightChange(Number(e.target.value) || 768)}
          className="w-24 px-2 py-1 rounded text-ui bg-bg-elevated text-text-primary border border-border text-right"
        />
      </FieldRow>
      <FieldRow label="Auto-start dev server on project open">
        <input
          type="checkbox"
          checked={autoStart}
          onChange={(e) => onAutoStartChange(e.target.checked)}
          className="accent-accent"
        />
      </FieldRow>
      <FieldRow label="Custom dev command override">
        <input
          type="text"
          value={customDevCommand}
          onChange={(e) => onCustomDevCommandChange(e.target.value)}
          placeholder="npm run dev"
          className="w-48 px-2 py-1 rounded text-ui bg-bg-elevated text-text-primary border border-border"
        />
      </FieldRow>
      <FieldRow label="Auto-open console on errors">
        <input
          type="checkbox"
          checked={consoleAutoOpen}
          onChange={(e) => onConsoleAutoOpenChange(e.target.checked)}
          className="accent-accent"
        />
      </FieldRow>
    </div>
  );
}

// --- SpecWriter Settings ---

function SpecWriterSettingsContent({
  planningModel,
  maxTokens,
  apiKeys,
  onPlanningModelChange,
  onMaxTokensChange,
}: {
  planningModel: string;
  maxTokens: number;
  apiKeys: Record<string, string>;
  onPlanningModelChange: (v: string) => void;
  onMaxTokensChange: (v: number) => void;
}) {
  return (
    <div>
      <SectionTitle>SpecWriter</SectionTitle>
      <FieldRow label="Spec writing AI model">
        <select
          value={planningModel}
          onChange={(e) => onPlanningModelChange(e.target.value)}
          className="w-64 px-2 py-1 rounded text-ui bg-bg-elevated text-text-primary border border-border"
        >
          {SPEC_WRITING_MODELS.map((m) => {
            const hasKey = !!apiKeys[m.provider]?.trim();
            return (
              <option key={m.id} value={m.id} disabled={!hasKey}>
                {m.label}{!hasKey ? " (no API key)" : ""}
              </option>
            );
          })}
        </select>
      </FieldRow>
      <FieldRow label="Max output tokens">
        <input
          type="number"
          value={maxTokens}
          onChange={(e) => onMaxTokensChange(Math.max(1024, Math.min(200000, Number(e.target.value) || 64000)))}
          min={1024}
          max={200000}
          step={1024}
          className="w-24 px-2 py-1 rounded text-ui bg-bg-elevated text-text-primary border border-border text-right"
        />
      </FieldRow>
    </div>
  );
}

// --- (SavedPlansSection removed — now managed in SpecWriter slide-over) ---
