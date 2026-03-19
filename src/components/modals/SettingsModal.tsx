import { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { useSettingsStore } from "../../stores/settingsStore";

import type { QuickCommand, AssistantShortcut, ThemeId, ChangelogProvider, ModelPricing } from "../../types/settings";
import { AI_MODELS, getDefaultModelPricing } from "../../types/assistant-provider";
import type { AIProvider, APIProvider } from "../../types/assistant-provider";
import { testChangelogApiKey } from "../../lib/tauri-commands";
import type { SettingsTab } from "./settings/SettingsShared";
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
  const showModal = useUiStore((s) => s.showSettingsModal);
  const setShowModal = useUiStore((s) => s.setShowSettingsModal);
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [theme, setTheme] = useState<ThemeId>(settings.theme);
  const [fontSize, setFontSize] = useState(settings.fontSize);
  const [sendShortcut, setSendShortcut] = useState(settings.sendShortcut);
  const [terminalShell, setTerminalShell] = useState(settings.terminalShell ?? "");
  const [terminalFontSize, setTerminalFontSize] = useState(settings.terminalFontSize);
  const [quickCommands, setQuickCommands] = useState<QuickCommand[]>(settings.quickCommands);
  const [changelogEnabled, setChangelogEnabled] = useState(settings.changelogEnabled);
  const [changelogProvider, setChangelogProvider] = useState<ChangelogProvider>(settings.changelogProvider);
  const [changelogModel, setChangelogModel] = useState(settings.changelogModel);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>(settings.apiKeys);
  const [modelPricing, setModelPricing] = useState<Record<string, ModelPricing>>(settings.modelPricing);
  const [changelogPrompt, setChangelogPrompt] = useState(settings.changelogPrompt);
  const [assistantShortcuts, setAssistantShortcuts] = useState<AssistantShortcut[]>(settings.assistantShortcuts);
  const [assistantDefaultProvider, setAssistantDefaultProvider] = useState<AIProvider>(settings.assistantDefaultProvider);
  const [assistantDefaultModel, setAssistantDefaultModel] = useState<Record<string, string>>(settings.assistantDefaultModel);
  const [triviaEnabled, setTriviaEnabled] = useState(settings.triviaEnabled);
  const [autoOpenFiles, setAutoOpenFiles] = useState(settings.autoOpenFiles);
  const [defaultContextWindow, setDefaultContextWindow] = useState(settings.defaultContextWindow);
  const [showWelcomeScreen, setShowWelcomeScreen] = useState(!settings.onboardingCompleted);
  const [previewDefaultWidth, setPreviewDefaultWidth] = useState(settings.previewDefaultWidth);
  const [previewDefaultHeight, setPreviewDefaultHeight] = useState(settings.previewDefaultHeight);
  const [previewAutoStart, setPreviewAutoStart] = useState(settings.previewAutoStart);
  const [previewCustomDevCommand, setPreviewCustomDevCommand] = useState(settings.previewCustomDevCommand ?? "");
  const [previewConsoleAutoOpen, setPreviewConsoleAutoOpen] = useState(settings.previewConsoleAutoOpen);
  const [taskBoardPlanningModel, setTaskBoardPlanningModel] = useState(settings.taskBoardPlanningModel ?? "gemini-2.5-flash");
  const [taskBoardMaxTokens, setTaskBoardMaxTokens] = useState(settings.taskBoardMaxTokens ?? 32768);
  const [taskBoardMaxRetries] = useState(settings.taskBoardMaxRetries ?? 3);
  const [taskBoardAutoStartNext] = useState(settings.taskBoardAutoStartNext ?? true);
  const [taskBoardAutoOpenSlideOver] = useState(settings.taskBoardAutoOpenSlideOver ?? true);
  const [testingKey, setTestingKey] = useState<string | false>(false);
  const [testResults, setTestResults] = useState<Record<string, "success" | "error">>({});

  useEffect(() => {
    if (showModal) {
      const initialTab = useUiStore.getState().initialSettingsTab;
      if (initialTab) {
        setActiveTab(initialTab);
        useUiStore.setState({ initialSettingsTab: null });
      } else {
        setActiveTab("general");
      }
      setTheme(settings.theme);
      setFontSize(settings.fontSize);
      setSendShortcut(settings.sendShortcut);
      setTerminalShell(settings.terminalShell ?? "");
      setTerminalFontSize(settings.terminalFontSize);
      setQuickCommands([...settings.quickCommands]);
      setChangelogEnabled(settings.changelogEnabled);
      setChangelogProvider(settings.changelogProvider);
      setChangelogModel(settings.changelogModel);
      setApiKeys({ ...settings.apiKeys });
      setModelPricing({ ...getDefaultModelPricing(), ...settings.modelPricing });
      setChangelogPrompt(settings.changelogPrompt);
      setAssistantShortcuts([...settings.assistantShortcuts]);
      setAssistantDefaultProvider(settings.assistantDefaultProvider);
      setAssistantDefaultModel({ ...settings.assistantDefaultModel });
      setTriviaEnabled(settings.triviaEnabled);
      setAutoOpenFiles(settings.autoOpenFiles);
      setDefaultContextWindow(settings.defaultContextWindow);
      setShowWelcomeScreen(!settings.onboardingCompleted);
      setPreviewDefaultWidth(settings.previewDefaultWidth);
      setPreviewDefaultHeight(settings.previewDefaultHeight);
      setPreviewAutoStart(settings.previewAutoStart);
      setPreviewCustomDevCommand(settings.previewCustomDevCommand ?? "");
      setPreviewConsoleAutoOpen(settings.previewConsoleAutoOpen);
      setTaskBoardPlanningModel(settings.taskBoardPlanningModel ?? "gemini-2.5-flash");
      setTaskBoardMaxTokens(settings.taskBoardMaxTokens ?? 32768);
      // taskBoardMaxRetries, taskBoardAutoStartNext, taskBoardAutoOpenSlideOver retained for settings compat
      setTestingKey(false);
      setTestResults({});
    }
  }, [showModal, settings]);

  const handleSave = () => {
    updateSettings({
      theme,
      fontSize,
      sendShortcut,
      terminalShell: terminalShell.trim() || null,
      terminalFontSize,
      quickCommands: quickCommands.filter((c) => c.label.trim() && c.command.trim()),
      changelogEnabled,
      changelogProvider,
      changelogModel,
      apiKeys,
      modelPricing,
      changelogPrompt,
      assistantShortcuts: assistantShortcuts.filter((s) => s.name.trim() && s.prompt.trim()),
      assistantDefaultProvider,
      assistantDefaultModel,
      triviaEnabled,
      autoOpenFiles,
      defaultContextWindow,
      onboardingCompleted: !showWelcomeScreen,
      previewDefaultWidth,
      previewDefaultHeight,
      previewAutoStart,
      previewCustomDevCommand: previewCustomDevCommand.trim() || null,
      previewConsoleAutoOpen,
      taskBoardPlanningModel,
      taskBoardMaxTokens,
      taskBoardMaxRetries,
      taskBoardAutoStartNext,
      taskBoardAutoOpenSlideOver,
    });
    setShowModal(false);
  };

  const handleCancel = () => {
    document.documentElement.setAttribute("data-theme", settings.theme);
    setShowModal(false);
  };

  const handleThemeChange = (id: ThemeId) => {
    setTheme(id);
    document.documentElement.setAttribute("data-theme", id);
  };

  const handleTestKey = async (provider: string) => {
    const apiKey = apiKeys[provider] ?? "";
    if (!apiKey.trim()) return;
    setTestingKey(provider);
    setTestResults((prev) => { const next = { ...prev }; delete next[provider]; return next; });
    try {
      const models = AI_MODELS[provider as APIProvider] ?? [];
      const testModel = models[0]?.id ?? "";
      const success = await testChangelogApiKey(provider as ChangelogProvider, apiKey, testModel);
      setTestResults((prev) => ({ ...prev, [provider]: success ? "success" : "error" }));
    } catch {
      setTestResults((prev) => ({ ...prev, [provider]: "error" }));
    } finally {
      setTestingKey(false);
    }
  };

  const handleChangelogProviderChange = (p: ChangelogProvider) => {
    setChangelogProvider(p);
    const models = AI_MODELS[p as APIProvider];
    if (models.length > 0) {
      setChangelogModel(models[0].id);
    }
  };

  const handleAssistantProviderChange = (p: AIProvider) => {
    setAssistantDefaultProvider(p);
  };

  const handleAssistantModelChange = (provider: string, modelId: string) => {
    setAssistantDefaultModel((prev) => ({ ...prev, [provider]: modelId }));
  };

  return (
    <Dialog.Root open={showModal} onOpenChange={(open) => {
      if (!open) {
        document.documentElement.setAttribute("data-theme", settings.theme);
      }
      setShowModal(open);
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
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
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
                onClick={handleCancel}
                className="flex-1 px-3 py-1.5 rounded-lg text-ui text-text-secondary border border-border hover:bg-bg-elevated transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="flex-1 px-3 py-1.5 rounded-lg text-ui text-white bg-accent hover:bg-accent-light transition-colors font-medium"
              >
                Save
              </button>
            </div>
          </nav>

          {/* Content */}
          <div className={`flex-1 p-6 relative ${activeTab === "api-logs" ? "flex flex-col overflow-hidden" : "overflow-y-auto"}`}>
            {/* Close button */}
            <button
              onClick={handleCancel}
              aria-label="Close settings"
              className="absolute top-4 right-4 text-text-ghost hover:text-text-primary transition-colors p-1 rounded hover:bg-bg-elevated"
            >
              <X size={15} />
            </button>

            {activeTab === "general" && (
              <GeneralTab
                theme={theme}
                fontSize={fontSize}
                sendShortcut={sendShortcut}
                triviaEnabled={triviaEnabled}
                autoOpenFiles={autoOpenFiles}
                defaultContextWindow={defaultContextWindow}
                showWelcomeScreen={showWelcomeScreen}
                onThemeChange={handleThemeChange}
                onFontSizeChange={setFontSize}
                onSendShortcutChange={setSendShortcut}
                onTriviaEnabledChange={setTriviaEnabled}
                onAutoOpenFilesChange={setAutoOpenFiles}
                onDefaultContextWindowChange={setDefaultContextWindow}
                onShowWelcomeScreenChange={setShowWelcomeScreen}
              />
            )}

            {activeTab === "terminal" && (
              <TerminalTab
                shell={terminalShell}
                fontSize={terminalFontSize}
                onShellChange={setTerminalShell}
                onFontSizeChange={setTerminalFontSize}
              />
            )}

            {activeTab === "quick-commands" && (
              <QuickCommandsTab
                commands={quickCommands}
                onChange={setQuickCommands}
              />
            )}

            {activeTab === "ai-providers" && (
              <AIProvidersTab
                apiKeys={apiKeys}
                modelPricing={modelPricing}
                testingKey={testingKey}
                testResults={testResults}
                onApiKeyChange={(provider, value) => {
                  setApiKeys({ ...apiKeys, [provider]: value });
                  setTestResults((prev) => { const next = { ...prev }; delete next[provider]; return next; });
                }}
                onModelPricingChange={(modelId, pricing) => { setModelPricing({ ...modelPricing, [modelId]: pricing }); }}
                onTestKey={handleTestKey}
              />
            )}

            {activeTab === "changelog" && (
              <ChangelogSettingsTab
                enabled={changelogEnabled}
                provider={changelogProvider}
                model={changelogModel}
                prompt={changelogPrompt}
                onEnabledChange={setChangelogEnabled}
                onProviderChange={handleChangelogProviderChange}
                onModelChange={setChangelogModel}
                onPromptChange={setChangelogPrompt}
              />
            )}

            {activeTab === "assistant" && (
              <AssistantSettingsTab
                defaultProvider={assistantDefaultProvider}
                defaultModel={assistantDefaultModel}
                shortcuts={assistantShortcuts}
                onProviderChange={handleAssistantProviderChange}
                onModelChange={handleAssistantModelChange}
                onShortcutsChange={setAssistantShortcuts}
              />
            )}

            {activeTab === "preview" && (
              <PreviewSettingsContent
                defaultWidth={previewDefaultWidth}
                defaultHeight={previewDefaultHeight}
                autoStart={previewAutoStart}
                customDevCommand={previewCustomDevCommand}
                consoleAutoOpen={previewConsoleAutoOpen}
                onDefaultWidthChange={setPreviewDefaultWidth}
                onDefaultHeightChange={setPreviewDefaultHeight}
                onAutoStartChange={setPreviewAutoStart}
                onCustomDevCommandChange={setPreviewCustomDevCommand}
                onConsoleAutoOpenChange={setPreviewConsoleAutoOpen}
              />
            )}

            {activeTab === "task-board" && (
              <SpecWriterSettingsContent
                planningModel={taskBoardPlanningModel}
                maxTokens={taskBoardMaxTokens}
                onPlanningModelChange={setTaskBoardPlanningModel}
                onMaxTokensChange={setTaskBoardMaxTokens}
              />
            )}

            {activeTab === "shortcuts" && <ShortcutsTab />}

            {activeTab === "api-logs" && <ApiLogsTab />}
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
  onPlanningModelChange,
  onMaxTokensChange,
}: {
  planningModel: string;
  maxTokens: number;
  onPlanningModelChange: (v: string) => void;
  onMaxTokensChange: (v: number) => void;
}) {
  const PLANNING_MODELS = [
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (recommended)" },
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite (free)" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-5-mini", label: "GPT-5 Mini" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  ];

  return (
    <div>
      <SectionTitle>SpecWriter</SectionTitle>
      <FieldRow label="Spec writing AI model">
        <select
          value={planningModel}
          onChange={(e) => onPlanningModelChange(e.target.value)}
          className="w-56 px-2 py-1 rounded text-ui bg-bg-elevated text-text-primary border border-border"
        >
          {PLANNING_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </FieldRow>
      <FieldRow label="Max output tokens">
        <input
          type="number"
          value={maxTokens}
          onChange={(e) => onMaxTokensChange(Math.max(1024, Math.min(200000, Number(e.target.value) || 32768)))}
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

