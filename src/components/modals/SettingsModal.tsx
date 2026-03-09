import { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Settings, Terminal, Zap, ScrollText, MessageSquare, X, RotateCcw } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { QuickCommand, AssistantShortcut, ThemeId, ChangelogProvider } from "../../types/settings";
import { THEMES, DEFAULT_CHANGELOG_PROMPT } from "../../types/settings";
import { testChangelogApiKey } from "../../lib/tauri-commands";

type SettingsTab = "general" | "terminal" | "quick-commands" | "changelog" | "assistant";

const NAV_ITEMS: { id: SettingsTab; label: string; icon: typeof Settings }[] = [
  { id: "general", label: "General", icon: Settings },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "quick-commands", label: "Quick Commands", icon: Zap },
  { id: "changelog", label: "Changelog", icon: ScrollText },
  { id: "assistant", label: "Assistant", icon: MessageSquare },
];

const CHANGELOG_PROVIDERS: { id: ChangelogProvider; label: string }[] = [
  { id: "gemini", label: "Gemini Flash" },
  { id: "openai", label: "GPT-4.1-mini" },
  { id: "anthropic", label: "Claude Haiku" },
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
  const [changelogApiKeys, setChangelogApiKeys] = useState<Record<string, string>>(settings.changelogApiKeys);
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
      setChangelogApiKeys({ ...settings.changelogApiKeys });
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
      changelogApiKeys,
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
      const success = await testChangelogApiKey(changelogProvider, apiKey);
      setTestResult(success ? "success" : "error");
    } catch {
      setTestResult("error");
    } finally {
      setTestingKey(false);
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
                apiKeys={changelogApiKeys}
                prompt={changelogPrompt}
                testingKey={testingKey}
                testResult={testResult}
                onEnabledChange={setChangelogEnabled}
                onProviderChange={(p) => { setChangelogProvider(p); setTestResult(null); }}
                onApiKeyChange={(v) => { setChangelogApiKeys({ ...changelogApiKeys, [changelogProvider]: v }); setTestResult(null); }}
                onPromptChange={setChangelogPrompt}
                onTestKey={handleTestKey}
              />
            )}
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
  enabled, provider, apiKeys, prompt, testingKey, testResult,
  onEnabledChange, onProviderChange, onApiKeyChange, onPromptChange, onTestKey,
}: {
  enabled: boolean; provider: ChangelogProvider; apiKeys: Record<string, string>;
  prompt: string; testingKey: boolean; testResult: "success" | "error" | null;
  onEnabledChange: (v: boolean) => void; onProviderChange: (p: ChangelogProvider) => void;
  onApiKeyChange: (v: string) => void; onPromptChange: (v: string) => void; onTestKey: () => void;
}) {
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
