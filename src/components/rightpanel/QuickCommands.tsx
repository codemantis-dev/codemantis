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
    <div className="flex items-center gap-1 px-2 py-1 border-t border-border-light shrink-0">
      {quickCommands.map((cmd, i) => (
        <button
          key={i}
          onClick={() => handleClick(cmd.command)}
          className="px-2 py-0.5 rounded text-label text-text-dim hover:text-text-secondary hover:bg-bg-elevated transition-colors"
          title={cmd.command}
        >
          {cmd.label}
        </button>
      ))}
    </div>
  );
}
