import type { QuickCommand } from "../../../types/settings";
import { SectionTitle } from "./shared";

export default function QuickCommandsTab({
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
