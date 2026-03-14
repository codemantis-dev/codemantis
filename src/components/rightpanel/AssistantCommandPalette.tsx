import type { SlashCommand } from "../../types/slash-commands";

interface AssistantCommandPaletteProps {
  commands: SlashCommand[];
  commandIndex: number;
  onSelect: (command: SlashCommand) => void;
  onHover: (index: number) => void;
  commandPaletteRef: React.RefObject<HTMLDivElement | null>;
}

export default function AssistantCommandPalette({
  commands,
  commandIndex,
  onSelect,
  onHover,
  commandPaletteRef,
}: AssistantCommandPaletteProps) {
  if (commands.length === 0) return null;

  return (
    <div
      ref={commandPaletteRef}
      className="absolute bottom-full left-2 right-2 mb-1 rounded-lg border border-border shadow-xl overflow-hidden z-30"
      style={{ background: "var(--bg-elevated)", maxHeight: 240 }}
    >
      <div className="overflow-y-auto" style={{ maxHeight: 240 }}>
        {commands.map((cmd, i) => (
          <button
            key={`${cmd.category}-${cmd.name}`}
            className={`w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors ${
              i === commandIndex ? "bg-bg-subtle" : "hover:bg-bg-subtle/50"
            }`}
            onClick={() => onSelect(cmd)}
            onMouseEnter={() => onHover(i)}
          >
            <span className="font-mono text-label text-accent shrink-0">/{cmd.name}</span>
            <span className="text-label text-text-dim truncate flex-1">{cmd.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
