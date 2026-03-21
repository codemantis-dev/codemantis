import { useState, useEffect, useRef } from "react";
import { useUiStore } from "../stores/uiStore";
import { useSettingsStore } from "../stores/settingsStore";

import type { QuickCommand, AssistantShortcut, ThemeId, ChangelogProvider, ModelPricing } from "../types/settings";
import { AI_MODELS, getDefaultModelPricing } from "../types/assistant-provider";
import type { AIProvider, APIProvider } from "../types/assistant-provider";
import { testChangelogApiKey } from "../lib/tauri-commands";
import type { SettingsTab } from "../components/modals/settings/SettingsShared";

/**
 * Encapsulates all form state for SettingsModal.
 *
 * On modal open the local state is synced from the persisted settings store;
 * on save the local state is flushed back.  This keeps the modal component
 * itself free of the 30+ useState calls it previously held.
 */
export function useSettingsFormState() {
  const showModal = useUiStore((s) => s.showSettingsModal);
  const setShowModal = useUiStore((s) => s.setShowSettingsModal);
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  // --- Active tab ---
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  // --- General ---
  const [theme, setTheme] = useState<ThemeId>(settings.theme);
  const [fontSize, setFontSize] = useState(settings.fontSize);
  const [sendShortcut, setSendShortcut] = useState(settings.sendShortcut);
  const [triviaEnabled, setTriviaEnabled] = useState(settings.triviaEnabled);
  const [autoOpenFiles, setAutoOpenFiles] = useState(settings.autoOpenFiles);
  const [defaultContextWindow, setDefaultContextWindow] = useState(settings.defaultContextWindow);
  const [showWelcomeScreen, setShowWelcomeScreen] = useState(!settings.onboardingCompleted);

  // --- Terminal ---
  const [terminalShell, setTerminalShell] = useState(settings.terminalShell ?? "");
  const [terminalFontSize, setTerminalFontSize] = useState(settings.terminalFontSize);

  // --- Quick commands ---
  const [quickCommands, setQuickCommands] = useState<QuickCommand[]>(settings.quickCommands);

  // --- AI providers (shared across tabs) ---
  const [apiKeys, setApiKeys] = useState<Record<string, string>>(settings.apiKeys);
  const [modelPricing, setModelPricing] = useState<Record<string, ModelPricing>>(settings.modelPricing);
  const [testingKey, setTestingKey] = useState<string | false>(false);
  const [testResults, setTestResults] = useState<Record<string, "success" | "error">>({});

  // --- Changelog ---
  const [changelogEnabled, setChangelogEnabled] = useState(settings.changelogEnabled);
  const [changelogProvider, setChangelogProvider] = useState<ChangelogProvider>(settings.changelogProvider);
  const [changelogModel, setChangelogModel] = useState(settings.changelogModel);
  const [changelogPrompt, setChangelogPrompt] = useState(settings.changelogPrompt);

  // --- Assistant ---
  const [assistantShortcuts, setAssistantShortcuts] = useState<AssistantShortcut[]>(settings.assistantShortcuts);
  const [assistantDefaultProvider, setAssistantDefaultProvider] = useState<AIProvider>(settings.assistantDefaultProvider);
  const [assistantDefaultModel, setAssistantDefaultModel] = useState<Record<string, string>>(settings.assistantDefaultModel);

  // --- Preview ---
  const [previewDefaultWidth, setPreviewDefaultWidth] = useState(settings.previewDefaultWidth);
  const [previewDefaultHeight, setPreviewDefaultHeight] = useState(settings.previewDefaultHeight);
  const [previewAutoStart, setPreviewAutoStart] = useState(settings.previewAutoStart);
  const [previewCustomDevCommand, setPreviewCustomDevCommand] = useState(settings.previewCustomDevCommand ?? "");
  const [previewConsoleAutoOpen, setPreviewConsoleAutoOpen] = useState(settings.previewConsoleAutoOpen);

  // --- Task Board ---
  const [taskBoardPlanningModel, setTaskBoardPlanningModel] = useState(settings.taskBoardPlanningModel ?? "gemini-3.1-flash-lite-preview");
  const [taskBoardMaxTokens, setTaskBoardMaxTokens] = useState(settings.taskBoardMaxTokens ?? 64000);
  const [taskBoardMaxRetries] = useState(settings.taskBoardMaxRetries ?? 3);
  const [taskBoardAutoStartNext] = useState(settings.taskBoardAutoStartNext ?? true);
  const [taskBoardAutoOpenSlideOver] = useState(settings.taskBoardAutoOpenSlideOver ?? true);

  // --- Sync local state from persisted settings on modal open ---
  const prevShowModal = useRef(false);

  useEffect(() => {
    if (showModal && !prevShowModal.current) {
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
      setTaskBoardPlanningModel(settings.taskBoardPlanningModel ?? "gemini-3.1-flash-lite-preview");
      setTaskBoardMaxTokens(settings.taskBoardMaxTokens ?? 64000);
      // taskBoardMaxRetries, taskBoardAutoStartNext, taskBoardAutoOpenSlideOver retained for settings compat
      setTestingKey(false);
      setTestResults({});
    }
    prevShowModal.current = showModal;
  }, [showModal, settings]);

  // --- Handlers ---

  const handleSave = (): void => {
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

  const handleCancel = (): void => {
    document.documentElement.setAttribute("data-theme", settings.theme);
    setShowModal(false);
  };

  const handleThemeChange = (id: ThemeId): void => {
    setTheme(id);
    document.documentElement.setAttribute("data-theme", id);
  };

  const handleTestKey = async (provider: string): Promise<void> => {
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

  const handleChangelogProviderChange = (p: ChangelogProvider): void => {
    setChangelogProvider(p);
    const models = AI_MODELS[p as APIProvider];
    if (models.length > 0) {
      setChangelogModel(models[0].id);
    }
  };

  const handleAssistantProviderChange = (p: AIProvider): void => {
    setAssistantDefaultProvider(p);
  };

  const handleAssistantModelChange = (provider: string, modelId: string): void => {
    setAssistantDefaultModel((prev) => ({ ...prev, [provider]: modelId }));
  };

  const handleApiKeyChange = (provider: string, value: string): void => {
    setApiKeys({ ...apiKeys, [provider]: value });
    setTestResults((prev) => { const next = { ...prev }; delete next[provider]; return next; });
  };

  const handleModelPricingChange = (modelId: string, pricing: ModelPricing): void => {
    setModelPricing({ ...modelPricing, [modelId]: pricing });
  };

  return {
    // Modal
    showModal,
    setShowModal,
    settings,
    activeTab,
    setActiveTab,

    // Handlers
    handleSave,
    handleCancel,
    handleThemeChange,
    handleTestKey,
    handleChangelogProviderChange,
    handleAssistantProviderChange,
    handleAssistantModelChange,
    handleApiKeyChange,
    handleModelPricingChange,

    // General tab
    theme,
    fontSize,
    setFontSize,
    sendShortcut,
    setSendShortcut,
    triviaEnabled,
    setTriviaEnabled,
    autoOpenFiles,
    setAutoOpenFiles,
    defaultContextWindow,
    setDefaultContextWindow,
    showWelcomeScreen,
    setShowWelcomeScreen,

    // Terminal tab
    terminalShell,
    setTerminalShell,
    terminalFontSize,
    setTerminalFontSize,

    // Quick commands tab
    quickCommands,
    setQuickCommands,

    // AI providers tab
    apiKeys,
    modelPricing,
    testingKey,
    testResults,

    // Changelog tab
    changelogEnabled,
    setChangelogEnabled,
    changelogProvider,
    changelogModel,
    setChangelogModel,
    changelogPrompt,
    setChangelogPrompt,

    // Assistant tab
    assistantShortcuts,
    setAssistantShortcuts,
    assistantDefaultProvider,
    assistantDefaultModel,

    // Preview tab
    previewDefaultWidth,
    setPreviewDefaultWidth,
    previewDefaultHeight,
    setPreviewDefaultHeight,
    previewAutoStart,
    setPreviewAutoStart,
    previewCustomDevCommand,
    setPreviewCustomDevCommand,
    previewConsoleAutoOpen,
    setPreviewConsoleAutoOpen,

    // Task Board tab
    taskBoardPlanningModel,
    setTaskBoardPlanningModel,
    taskBoardMaxTokens,
    setTaskBoardMaxTokens,
  };
}
