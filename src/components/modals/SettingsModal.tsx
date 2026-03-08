import { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useUiStore } from "../../stores/uiStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { QuickCommand } from "../../types/settings";

export default function SettingsModal() {
  const showModal = useUiStore((s) => s.showSettingsModal);
  const setShowModal = useUiStore((s) => s.setShowSettingsModal);
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  const [fontSize, setFontSize] = useState(settings.fontSize);
  const [sendShortcut, setSendShortcut] = useState(settings.sendShortcut);
  const [terminalShell, setTerminalShell] = useState(settings.terminalShell ?? "");
  const [terminalFontSize, setTerminalFontSize] = useState(settings.terminalFontSize);
  const [quickCommands, setQuickCommands] = useState<QuickCommand[]>(settings.quickCommands);

  useEffect(() => {
    if (showModal) {
      setFontSize(settings.fontSize);
      setSendShortcut(settings.sendShortcut);
      setTerminalShell(settings.terminalShell ?? "");
      setTerminalFontSize(settings.terminalFontSize);
      setQuickCommands([...settings.quickCommands]);
    }
  }, [showModal, settings]);

  const handleSave = () => {
    updateSettings({
      fontSize,
      sendShortcut,
      terminalShell: terminalShell.trim() || null,
      terminalFontSize,
      quickCommands: quickCommands.filter((c) => c.label.trim() && c.command.trim()),
    });
    setShowModal(false);
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

  return (
    <Dialog.Root open={showModal} onOpenChange={setShowModal}>
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

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowModal(false)}
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
