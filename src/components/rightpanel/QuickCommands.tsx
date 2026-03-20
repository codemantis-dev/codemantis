import { useSettingsStore } from "../../stores/settingsStore";
import { sendTerminalInput } from "../../lib/tauri-commands";

interface QuickCommandsProps {
  terminalId: string | null;
}

export default function QuickCommands({ terminalId }: QuickCommandsProps) {
  const quickCommands = useSettingsStore((s) => s.settings.quickCommands);

  if (!terminalId || quickCommands.length === 0) return null;

  const handleClick = (command: string) => {
    sendTerminalInput(terminalId, command + "\r").catch((e) =>
      console.error("Failed to send quick command:", e)
    );
  };

  return (
    <div className="flex flex-wrap gap-1 px-2 py-2 border-t shrink-0" style={{ borderColor: "var(--border-light)" }}>
      {quickCommands.map((cmd) => (
        <button
          key={`${cmd.label}-${cmd.command}`}
          onClick={() => handleClick(cmd.command)}
          className="px-2 py-0.5 rounded-full text-label text-text-dim hover:text-text-primary bg-bg-elevated hover:bg-accent/10 border border-border-light hover:border-accent/30 transition-colors"
          title={cmd.command}
        >
          {cmd.label}
        </button>
      ))}
    </div>
  );
}
