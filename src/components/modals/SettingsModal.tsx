import { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Settings, Terminal, Zap, ScrollText, MessageSquare, Keyboard, X, RotateCcw, BarChart3 } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { QuickCommand, AssistantShortcut, ThemeId, ChangelogProvider, ModelPricing } from "../../types/settings";
import { THEMES, DEFAULT_CHANGELOG_PROMPT, CHANGELOG_MODELS, getDefaultModelPricing } from "../../types/settings";
import type { ApiLogEntry, ApiCostSummary } from "../../types/api-logs";
import { testChangelogApiKey, getApiLogs, getApiCostSummary, cleanupApiLogs } from "../../lib/tauri-commands";
import { SHORTCUT_CATEGORIES } from "../../data/shortcuts";

type SettingsTab = "general" | "terminal" | "quick-commands" | "changelog" | "assistant" | "shortcuts" | "api-logs";

const NAV_ITEMS: { id: SettingsTab; label: string; icon: typeof Settings }[] = [
  { id: "general", label: "General", icon: Settings },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "quick-commands", label: "Quick Commands", icon: Zap },
  { id: "changelog", label: "Changelog", icon: ScrollText },
  { id: "assistant", label: "Assistant", icon: MessageSquare },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "api-logs", label: "API Logs", icon: BarChart3 },
];

const CHANGELOG_PROVIDERS: { id: ChangelogProvider; label: string }[] = [
  { id: "gemini", label: "Google Gemini" },
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
];

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
  const [changelogApiKeys, setChangelogApiKeys] = useState<Record<string, string>>(settings.changelogApiKeys);
  const [changelogModelPricing, setChangelogModelPricing] = useState<Record<string, ModelPricing>>(settings.changelogModelPricing);
  const [changelogPrompt, setChangelogPrompt] = useState(settings.changelogPrompt);
  const [assistantShortcuts, setAssistantShortcuts] = useState<AssistantShortcut[]>(settings.assistantShortcuts);
  const [testingKey, setTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);

  useEffect(() => {
    if (showModal) {
      setTheme(settings.theme);
      setFontSize(settings.fontSize);
      setSendShortcut(settings.sendShortcut);
      setTerminalShell(settings.terminalShell ?? "");
      setTerminalFontSize(settings.terminalFontSize);
      setQuickCommands([...settings.quickCommands]);
      setChangelogEnabled(settings.changelogEnabled);
      setChangelogProvider(settings.changelogProvider);
      setChangelogModel(settings.changelogModel);
      setChangelogApiKeys({ ...settings.changelogApiKeys });
      setChangelogModelPricing({ ...getDefaultModelPricing(), ...settings.changelogModelPricing });
      setChangelogPrompt(settings.changelogPrompt);
      setAssistantShortcuts([...settings.assistantShortcuts]);
      setTestResult(null);
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
      changelogApiKeys,
      changelogModelPricing,
      changelogPrompt,
      assistantShortcuts: assistantShortcuts.filter((s) => s.name.trim() && s.prompt.trim()),
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

  const handleTestKey = async () => {
    const apiKey = changelogApiKeys[changelogProvider] ?? "";
    if (!apiKey.trim()) return;
    setTestingKey(true);
    setTestResult(null);
    try {
      const success = await testChangelogApiKey(changelogProvider, apiKey, changelogModel);
      setTestResult(success ? "success" : "error");
    } catch {
      setTestResult("error");
    } finally {
      setTestingKey(false);
    }
  };

  const handleProviderChange = (p: ChangelogProvider) => {
    setChangelogProvider(p);
    setTestResult(null);
    // Auto-select first model for the new provider
    const models = CHANGELOG_MODELS[p];
    if (models.length > 0) {
      setChangelogModel(models[0].id);
    }
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
          style={{ background: "var(--bg-primary)", width: "min(90vw, 720px)", height: "min(80vh, 560px)" }}
        >
          {/* Sidebar */}
          <nav className="w-48 shrink-0 border-r border-border flex flex-col" style={{ background: "var(--bg-secondary)" }}>
            <Dialog.Title className="text-ui text-text-primary font-semibold px-4 pt-4 pb-3">
              Settings
            </Dialog.Title>
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
          <div className="flex-1 overflow-y-auto p-6 relative">
            {/* Close button */}
            <button
              onClick={handleCancel}
              className="absolute top-4 right-4 text-text-ghost hover:text-text-primary transition-colors p-1 rounded hover:bg-bg-elevated"
            >
              <X size={15} />
            </button>

            {activeTab === "general" && (
              <GeneralTab
                theme={theme}
                fontSize={fontSize}
                sendShortcut={sendShortcut}
                onThemeChange={handleThemeChange}
                onFontSizeChange={setFontSize}
                onSendShortcutChange={setSendShortcut}
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

            {activeTab === "assistant" && (
              <AssistantShortcutsTab
                shortcuts={assistantShortcuts}
                onChange={setAssistantShortcuts}
              />
            )}

            {activeTab === "changelog" && (
              <ChangelogTab
                enabled={changelogEnabled}
                provider={changelogProvider}
                model={changelogModel}
                apiKeys={changelogApiKeys}
                modelPricing={changelogModelPricing}
                prompt={changelogPrompt}
                testingKey={testingKey}
                testResult={testResult}
                onEnabledChange={setChangelogEnabled}
                onProviderChange={handleProviderChange}
                onModelChange={(m) => { setChangelogModel(m); setTestResult(null); }}
                onApiKeyChange={(v) => { setChangelogApiKeys({ ...changelogApiKeys, [changelogProvider]: v }); setTestResult(null); }}
                onModelPricingChange={(modelId, pricing) => { setChangelogModelPricing({ ...changelogModelPricing, [modelId]: pricing }); }}
                onPromptChange={setChangelogPrompt}
                onTestKey={handleTestKey}
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

// ─── Tab Components ───────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-text-primary font-medium mb-4">{children}</h3>;
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2">
      <label className="text-ui text-text-secondary">{label}</label>
      {children}
    </div>
  );
}

function GeneralTab({
  theme, fontSize, sendShortcut,
  onThemeChange, onFontSizeChange, onSendShortcutChange,
}: {
  theme: ThemeId; fontSize: number; sendShortcut: string;
  onThemeChange: (t: ThemeId) => void; onFontSizeChange: (n: number) => void; onSendShortcutChange: (s: string) => void;
}) {
  return (
    <div>
      <SectionTitle>General</SectionTitle>

      <div className="mb-5">
        <label className="text-ui text-text-secondary mb-2 block">Theme</label>
        <div className="grid grid-cols-3 gap-2">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => onThemeChange(t.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-ui transition-colors ${
                theme === t.id
                  ? "border-accent bg-accent-dim text-text-primary"
                  : "border-border bg-bg-elevated text-text-secondary hover:border-accent/30"
              }`}
            >
              <span
                className="w-3 h-3 rounded-full shrink-0 border"
                style={{
                  background: t.isDark ? "#18181b" : "#fafafa",
                  borderColor: t.isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)",
                }}
              />
              <span className="truncate">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1 border-t border-border-light pt-4">
        <FieldRow label="Font Size">
          <input
            type="number"
            min={10}
            max={20}
            value={fontSize}
            onChange={(e) => onFontSizeChange(Number(e.target.value))}
            className="w-16 px-2 py-1 rounded bg-bg-elevated border border-border text-text-primary text-ui text-center outline-none focus:border-accent/40"
          />
        </FieldRow>

        <FieldRow label="Send Shortcut">
          <select
            value={sendShortcut}
            onChange={(e) => onSendShortcutChange(e.target.value)}
            className="px-2 py-1 rounded bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40"
          >
            <option value="cmd+enter">Cmd + Enter</option>
            <option value="enter">Enter</option>
          </select>
        </FieldRow>
      </div>
    </div>
  );
}

function TerminalTab({
  shell, fontSize, onShellChange, onFontSizeChange,
}: {
  shell: string; fontSize: number; onShellChange: (s: string) => void; onFontSizeChange: (n: number) => void;
}) {
  return (
    <div>
      <SectionTitle>Terminal</SectionTitle>
      <div className="space-y-1">
        <FieldRow label="Shell">
          <input
            type="text"
            value={shell}
            onChange={(e) => onShellChange(e.target.value)}
            placeholder="Default ($SHELL)"
            className="w-44 px-2 py-1 rounded bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40 placeholder:text-text-ghost"
          />
        </FieldRow>
        <FieldRow label="Font Size">
          <input
            type="number"
            min={10}
            max={20}
            value={fontSize}
            onChange={(e) => onFontSizeChange(Number(e.target.value))}
            className="w-16 px-2 py-1 rounded bg-bg-elevated border border-border text-text-primary text-ui text-center outline-none focus:border-accent/40"
          />
        </FieldRow>
      </div>
    </div>
  );
}

function QuickCommandsTab({
  commands, onChange,
}: {
  commands: QuickCommand[]; onChange: (cmds: QuickCommand[]) => void;
}) {
  const handleUpdate = (index: number, field: "label" | "command", value: string) => {
    const updated = [...commands];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  return (
    <div>
      <SectionTitle>Quick Commands</SectionTitle>
      <p className="text-label text-text-dim mb-3">
        Commands available in the terminal toolbar for quick execution.
      </p>
      <div className="space-y-2">
        {commands.map((cmd, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              value={cmd.label}
              onChange={(e) => handleUpdate(i, "label", e.target.value)}
              placeholder="Label"
              className="w-24 px-2 py-1.5 rounded bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40 placeholder:text-text-ghost"
            />
            <input
              type="text"
              value={cmd.command}
              onChange={(e) => handleUpdate(i, "command", e.target.value)}
              placeholder="Command"
              className="flex-1 px-2 py-1.5 rounded bg-bg-elevated border border-border text-text-primary text-ui font-mono outline-none focus:border-accent/40 placeholder:text-text-ghost"
            />
            <button
              onClick={() => onChange(commands.filter((_, j) => j !== i))}
              className="text-text-ghost hover:text-red transition-colors text-ui px-1.5 py-1"
            >
              &times;
            </button>
          </div>
        ))}
        <button
          onClick={() => onChange([...commands, { label: "", command: "" }])}
          className="text-label text-accent hover:text-accent-light transition-colors"
        >
          + Add command
        </button>
      </div>
    </div>
  );
}

function ChangelogTab({
  enabled, provider, model, apiKeys, modelPricing, prompt, testingKey, testResult,
  onEnabledChange, onProviderChange, onModelChange, onApiKeyChange, onModelPricingChange, onPromptChange, onTestKey,
}: {
  enabled: boolean; provider: ChangelogProvider; model: string; apiKeys: Record<string, string>;
  modelPricing: Record<string, ModelPricing>; prompt: string; testingKey: boolean; testResult: "success" | "error" | null;
  onEnabledChange: (v: boolean) => void; onProviderChange: (p: ChangelogProvider) => void;
  onModelChange: (m: string) => void; onApiKeyChange: (v: string) => void;
  onModelPricingChange: (modelId: string, pricing: ModelPricing) => void;
  onPromptChange: (v: string) => void; onTestKey: () => void;
}) {
  const availableModels = CHANGELOG_MODELS[provider] ?? [];
  return (
    <div>
      <SectionTitle>Changelog</SectionTitle>
      <p className="text-label text-text-dim mb-4">
        Auto-generate changelog entries after each coding turn using an LLM provider.
      </p>

      {/* Toggle */}
      <div className="flex items-center justify-between py-2 mb-3">
        <label className="text-ui text-text-secondary">Enable auto-changelog</label>
        <button
          onClick={() => onEnabledChange(!enabled)}
          className={`w-10 h-5 rounded-full transition-colors relative ${
            enabled ? "bg-accent" : "bg-bg-elevated border border-border"
          }`}
        >
          <div
            className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${
              enabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {enabled && (
        <div className="space-y-4">
          {/* Provider + API key */}
          <div className="border-t border-border-light pt-4 space-y-3">
            <FieldRow label="Provider">
              <select
                value={provider}
                onChange={(e) => onProviderChange(e.target.value as ChangelogProvider)}
                className="px-2 py-1 rounded bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40"
              >
                {CHANGELOG_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </FieldRow>

            <FieldRow label="Model">
              <select
                value={model}
                onChange={(e) => onModelChange(e.target.value)}
                className="px-2 py-1 rounded bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40"
              >
                {availableModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </FieldRow>

            {/* Token pricing per 1M tokens */}
            <div>
              <label className="text-ui text-text-secondary mb-1.5 block">Token Pricing (per 1M tokens, USD)</label>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-label text-text-dim">Input:</span>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={modelPricing[model]?.input ?? 0}
                    onChange={(e) => onModelPricingChange(model, {
                      input: parseFloat(e.target.value) || 0,
                      output: modelPricing[model]?.output ?? 0,
                    })}
                    className="w-20 px-2 py-1 rounded bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40 text-right"
                  />
                  <span className="text-label text-text-ghost">$</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-label text-text-dim">Output:</span>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={modelPricing[model]?.output ?? 0}
                    onChange={(e) => onModelPricingChange(model, {
                      input: modelPricing[model]?.input ?? 0,
                      output: parseFloat(e.target.value) || 0,
                    })}
                    className="w-20 px-2 py-1 rounded bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40 text-right"
                  />
                  <span className="text-label text-text-ghost">$</span>
                </div>
              </div>
            </div>

            <div>
              <label className="text-ui text-text-secondary mb-1.5 block">API Key</label>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={apiKeys[provider] ?? ""}
                  onChange={(e) => onApiKeyChange(e.target.value)}
                  placeholder={`Enter ${provider} API key`}
                  className="flex-1 px-2 py-1.5 rounded bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40 placeholder:text-text-ghost"
                />
                <button
                  onClick={onTestKey}
                  disabled={testingKey || !(apiKeys[provider] ?? "").trim()}
                  className={`px-3 py-1.5 rounded text-ui font-medium transition-colors shrink-0 ${
                    testingKey || !(apiKeys[provider] ?? "").trim()
                      ? "bg-bg-elevated text-text-ghost cursor-not-allowed"
                      : "bg-accent/10 text-accent hover:bg-accent/20"
                  }`}
                >
                  {testingKey ? "Testing..." : "Test"}
                </button>
              </div>
              {testResult === "success" && (
                <p className="text-green text-label mt-1">API key is valid</p>
              )}
              {testResult === "error" && (
                <p className="text-red text-label mt-1">Invalid API key or connection error</p>
              )}
            </div>
          </div>

          {/* Prompt editor */}
          <div className="border-t border-border-light pt-4">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-ui text-text-secondary">System Prompt</label>
              <button
                onClick={() => onPromptChange(DEFAULT_CHANGELOG_PROMPT)}
                className="flex items-center gap-1 text-label text-text-ghost hover:text-text-dim transition-colors"
                title="Reset to default prompt"
              >
                <RotateCcw size={11} />
                <span>Reset</span>
              </button>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => onPromptChange(e.target.value)}
              rows={5}
              className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-text-primary text-ui font-mono leading-relaxed outline-none focus:border-accent/40 resize-y"
              placeholder="System prompt for changelog generation..."
            />
            <p className="text-[11px] text-text-ghost mt-1">
              The AI receives this as a system instruction. It should ask for JSON output with headline, description, and category fields.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function AssistantShortcutsTab({
  shortcuts, onChange,
}: {
  shortcuts: AssistantShortcut[]; onChange: (shortcuts: AssistantShortcut[]) => void;
}) {
  const handleUpdate = (index: number, field: "name" | "prompt", value: string) => {
    const updated = [...shortcuts];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  return (
    <div>
      <SectionTitle>Assistant Shortcuts</SectionTitle>
      <p className="text-label text-text-dim mb-3">
        Saved prompts available as quick-access chips in the assistant panel.
      </p>
      <div className="space-y-2">
        {shortcuts.map((sc, i) => (
          <div key={sc.id} className="space-y-1">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={sc.name}
                onChange={(e) => handleUpdate(i, "name", e.target.value)}
                placeholder="Name"
                className="w-28 px-2 py-1.5 rounded bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40 placeholder:text-text-ghost"
              />
              <textarea
                value={sc.prompt}
                onChange={(e) => handleUpdate(i, "prompt", e.target.value)}
                placeholder="Prompt text"
                rows={1}
                className="flex-1 px-2 py-1.5 rounded bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40 placeholder:text-text-ghost resize-y"
              />
              <button
                onClick={() => onChange(shortcuts.filter((_, j) => j !== i))}
                className="text-text-ghost hover:text-red transition-colors text-ui px-1.5 py-1"
              >
                &times;
              </button>
            </div>
          </div>
        ))}
        <button
          onClick={() => onChange([...shortcuts, { id: crypto.randomUUID(), name: "", prompt: "" }])}
          className="text-label text-accent hover:text-accent-light transition-colors"
        >
          + Add shortcut
        </button>
      </div>
    </div>
  );
}

function ShortcutsTab() {
  return (
    <div>
      <SectionTitle>Keyboard Shortcuts</SectionTitle>
      <div className="space-y-5">
        {SHORTCUT_CATEGORIES.map((category) => (
          <div key={category.name}>
            <h4 className="text-label text-text-dim uppercase tracking-wider mb-2">
              {category.name}
            </h4>
            <div className="space-y-1">
              {category.shortcuts.map((shortcut) => (
                <div
                  key={shortcut.keys}
                  className="flex items-center justify-between py-1.5"
                >
                  <span className="text-ui text-text-secondary">
                    {shortcut.description}
                  </span>
                  <kbd className="px-2 py-0.5 rounded bg-bg-elevated border border-border text-text-faint text-label font-mono tracking-wide">
                    {shortcut.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ApiLogsTab() {
  const [logs, setLogs] = useState<ApiLogEntry[]>([]);
  const [summary, setSummary] = useState<ApiCostSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        // Auto-cleanup logs older than 5 days
        await cleanupApiLogs(5);
        const [logsData, summaryData] = await Promise.all([
          getApiLogs(),
          getApiCostSummary(),
        ]);
        if (!cancelled) {
          setLogs(logsData);
          setSummary(summaryData);
        }
      } catch (e) {
        console.error("Failed to load API logs:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const formatCost = (cost: number): string => {
    if (cost === 0) return "Free";
    if (cost < 0.01) return `$${cost.toFixed(6)}`;
    return `$${cost.toFixed(4)}`;
  };

  const formatTimestamp = (ts: string): string => {
    try {
      const d = new Date(ts);
      return d.toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      });
    } catch {
      return ts;
    }
  };

  if (loading) {
    return (
      <div>
        <SectionTitle>API Logs</SectionTitle>
        <p className="text-ui text-text-dim">Loading...</p>
      </div>
    );
  }

  return (
    <div>
      <SectionTitle>API Logs</SectionTitle>

      {/* Cost summary card */}
      {summary && summary.totalCalls > 0 && (
        <div className="rounded-lg border border-border p-4 mb-4" style={{ background: "var(--bg-elevated)" }}>
          <div className="flex items-baseline justify-between mb-3">
            <span className="text-ui text-text-secondary">Total Cost</span>
            <span className="text-lg font-semibold text-text-primary">{formatCost(summary.totalCost)}</span>
          </div>
          <div className="flex items-baseline justify-between mb-3">
            <span className="text-ui text-text-secondary">Total Calls</span>
            <span className="text-ui font-medium text-text-primary">{summary.totalCalls}</span>
          </div>
          {summary.byProvider.length > 0 && (
            <div className="border-t border-border-light pt-2 space-y-1.5">
              {summary.byProvider.map((p) => (
                <div key={p.provider} className="flex items-center justify-between">
                  <span className="text-label text-text-dim capitalize">{p.provider}</span>
                  <span className="text-label text-text-secondary">
                    {formatCost(p.cost)} ({p.calls} call{p.calls !== 1 ? "s" : ""})
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Log list */}
      {logs.length === 0 ? (
        <div className="text-center py-8">
          <BarChart3 size={24} className="mx-auto mb-2 text-text-ghost" />
          <p className="text-ui text-text-dim">No API calls logged yet</p>
          <p className="text-label text-text-ghost mt-1">Calls will appear here when changelog entries are generated</p>
        </div>
      ) : (
        <div className="space-y-1 max-h-[280px] overflow-y-auto">
          {logs.map((log) => (
            <div
              key={log.id}
              className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border-light text-label"
              style={{ background: "var(--bg-elevated)" }}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${log.success ? "bg-green" : "bg-red"}`}
              />
              <span className="text-text-ghost w-28 shrink-0">{formatTimestamp(log.timestamp)}</span>
              <span className="text-text-dim capitalize w-16 shrink-0">{log.provider}</span>
              <span className="text-text-secondary flex-1 truncate font-mono">{log.model}</span>
              <span className="text-text-ghost w-24 shrink-0 text-right">
                {log.inputTokens + log.outputTokens} tok
              </span>
              <span className="text-text-primary w-16 shrink-0 text-right font-medium">
                {formatCost(log.costUsd)}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-text-ghost mt-3">
        Logs older than 5 days are automatically deleted.
      </p>
    </div>
  );
}
