import { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useUiStore } from "../../stores/uiStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { QuickCommand, ThemeId, ChangelogProvider } from "../../types/settings";
import { THEMES } from "../../types/settings";
import { testChangelogApiKey } from "../../lib/tauri-commands";

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

  const [theme, setTheme] = useState<ThemeId>(settings.theme);
  const [fontSize, setFontSize] = useState(settings.fontSize);
  const [sendShortcut, setSendShortcut] = useState(settings.sendShortcut);
  const [terminalShell, setTerminalShell] = useState(settings.terminalShell ?? "");
  const [terminalFontSize, setTerminalFontSize] = useState(settings.terminalFontSize);
  const [quickCommands, setQuickCommands] = useState<QuickCommand[]>(settings.quickCommands);
  const [changelogEnabled, setChangelogEnabled] = useState(settings.changelogEnabled);
  const [changelogProvider, setChangelogProvider] = useState<ChangelogProvider>(settings.changelogProvider);
  const [changelogApiKeys, setChangelogApiKeys] = useState<Record<string, string>>(settings.changelogApiKeys);
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
    });
    setShowModal(false);
  };

  const handleThemeChange = (id: ThemeId) => {
    setTheme(id);
    // Live preview: apply immediately
    document.documentElement.setAttribute("data-theme", id);
  };

  const handleAddQuickCommand = () => {
    setQuickCommands([...quickCommands, { label: "", command: "" }]);
  };

  const handleRemoveQuickCommand = (index: number) => {
    setQuickCommands(quickCommands.filter((_, i) => i !== index));
  };

  const handleUpdateQuickCommand = (index: number, field: "label" | "command", value: string) => {
    const updated = [...quickCommands];
    updated[index] = { ...updated[index], [field]: value };
    setQuickCommands(updated);
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

  const handleApiKeyChange = (value: string) => {
    setChangelogApiKeys({ ...changelogApiKeys, [changelogProvider]: value });
    setTestResult(null);
  };

  return (
    <Dialog.Root open={showModal} onOpenChange={(open) => {
      if (!open) {
        // Revert live preview on dismiss
        document.documentElement.setAttribute("data-theme", settings.theme);
      }
      setShowModal(open);
    }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[480px] max-h-[80vh] overflow-y-auto rounded-xl border border-border p-6" style={{ background: "var(--bg-primary)" }}>
          <Dialog.Title className="text-lg text-text-primary font-medium mb-4">
            Settings
          </Dialog.Title>

          {/* General section */}
          <div className="mb-6">
            <h3 className="text-ui text-text-secondary font-medium mb-3 uppercase tracking-wider">
              General
            </h3>

            <div className="space-y-3">
              {/* Theme picker */}
              <div>
                <label className="text-ui text-text-secondary mb-2 block">Theme</label>
                <div className="grid grid-cols-3 gap-2">
                  {THEMES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => handleThemeChange(t.id)}
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

              <div className="flex items-center justify-between">
                <label className="text-ui text-text-secondary">Font Size</label>
                <input
                  type="number"
                  min={10}
                  max={20}
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  className="w-16 px-2 py-1 rounded bg-bg-elevated border border-border text-text-primary text-ui text-center outline-none focus:border-accent/40"
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="text-ui text-text-secondary">Send Shortcut</label>
                <select
                  value={sendShortcut}
                  onChange={(e) => setSendShortcut(e.target.value)}
                  className="px-2 py-1 rounded bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40"
                >
                  <option value="cmd+enter">Cmd + Enter</option>
                  <option value="enter">Enter</option>
                </select>
              </div>
            </div>
          </div>

          {/* Terminal section */}
          <div className="mb-6">
            <h3 className="text-ui text-text-secondary font-medium mb-3 uppercase tracking-wider">
              Terminal
            </h3>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-ui text-text-secondary">Shell</label>
                <input
                  type="text"
                  value={terminalShell}
                  onChange={(e) => setTerminalShell(e.target.value)}
                  placeholder="Default ($SHELL)"
                  className="w-40 px-2 py-1 rounded bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40 placeholder:text-text-ghost"
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="text-ui text-text-secondary">Terminal Font Size</label>
                <input
                  type="number"
                  min={10}
                  max={20}
                  value={terminalFontSize}
                  onChange={(e) => setTerminalFontSize(Number(e.target.value))}
                  className="w-16 px-2 py-1 rounded bg-bg-elevated border border-border text-text-primary text-ui text-center outline-none focus:border-accent/40"
                />
              </div>
            </div>
          </div>

          {/* Quick Commands section */}
          <div className="mb-6">
            <h3 className="text-ui text-text-secondary font-medium mb-3 uppercase tracking-wider">
              Quick Commands
            </h3>

            <div className="space-y-2">
              {quickCommands.map((cmd, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={cmd.label}
                    onChange={(e) => handleUpdateQuickCommand(i, "label", e.target.value)}
                    placeholder="Label"
                    className="w-20 px-2 py-1 rounded bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40 placeholder:text-text-ghost"
                  />
                  <input
                    type="text"
                    value={cmd.command}
                    onChange={(e) => handleUpdateQuickCommand(i, "command", e.target.value)}
                    placeholder="Command"
                    className="flex-1 px-2 py-1 rounded bg-bg-elevated border border-border text-text-primary text-ui font-mono outline-none focus:border-accent/40 placeholder:text-text-ghost"
                  />
                  <button
                    onClick={() => handleRemoveQuickCommand(i)}
                    className="text-text-ghost hover:text-red transition-colors text-ui px-1"
                  >
                    &times;
                  </button>
                </div>
              ))}
              <button
                onClick={handleAddQuickCommand}
                className="text-label text-accent hover:text-accent-light transition-colors"
              >
                + Add command
              </button>
            </div>
          </div>

          {/* Changelog section */}
          <div className="mb-6">
            <h3 className="text-ui text-text-secondary font-medium mb-3 uppercase tracking-wider">
              Changelog
            </h3>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-ui text-text-secondary">Auto-generate changelog entries</label>
                <button
                  onClick={() => setChangelogEnabled(!changelogEnabled)}
                  className={`w-10 h-5 rounded-full transition-colors relative ${
                    changelogEnabled ? "bg-accent" : "bg-bg-elevated border border-border"
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${
                      changelogEnabled ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>

              {changelogEnabled && (
                <>
                  <div className="flex items-center justify-between">
                    <label className="text-ui text-text-secondary">Provider</label>
                    <select
                      value={changelogProvider}
                      onChange={(e) => {
                        setChangelogProvider(e.target.value as ChangelogProvider);
                        setTestResult(null);
                      }}
                      className="px-2 py-1 rounded bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40"
                    >
                      {CHANGELOG_PROVIDERS.map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-ui text-text-secondary mb-1.5 block">API Key</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="password"
                        value={changelogApiKeys[changelogProvider] ?? ""}
                        onChange={(e) => handleApiKeyChange(e.target.value)}
                        placeholder={`Enter ${changelogProvider} API key`}
                        className="flex-1 px-2 py-1 rounded bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40 placeholder:text-text-ghost"
                      />
                      <button
                        onClick={handleTestKey}
                        disabled={testingKey || !(changelogApiKeys[changelogProvider] ?? "").trim()}
                        className={`px-3 py-1 rounded text-ui font-medium transition-colors shrink-0 ${
                          testingKey || !(changelogApiKeys[changelogProvider] ?? "").trim()
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
                </>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                document.documentElement.setAttribute("data-theme", settings.theme);
                setShowModal(false);
              }}
              className="px-4 py-2 rounded-lg text-ui text-text-secondary border border-border hover:bg-bg-elevated transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 rounded-lg text-ui text-white bg-accent hover:bg-accent-light transition-colors"
            >
              Save
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
