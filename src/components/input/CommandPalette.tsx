import { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from "react";
import type { SlashCommand } from "../../types/slash-commands";
import { useSessionStore } from "../../stores/sessionStore";
import { discoverCommands } from "../../lib/tauri-commands";

export interface CommandPaletteHandle {
  handleKeyDown: (key: string) => boolean;
}

interface CommandPaletteProps {
  query: string;
  onSelect: (command: SlashCommand, args: string) => void;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  skill: { label: "Skill", color: "var(--accent)" },
  "built-in": { label: "Built-in", color: "var(--text-dim)" },
  "cli-only": { label: "Opens CLI", color: "var(--yellow, #e5a50a)" },
};

const CommandPalette = forwardRef<CommandPaletteHandle, CommandPaletteProps>(
  function CommandPalette({ query, onSelect, onClose }, ref) {
    const [commands, setCommands] = useState<SlashCommand[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const listRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

    const session = useSessionStore((s) => {
      const id = s.activeSessionId;
      return id ? s.sessions.get(id) ?? null : null;
    });

    // Fetch commands on mount
    useEffect(() => {
      if (!session) return;
      let cancelled = false;

      discoverCommands(session.project_path)
        .then((cmds) => {
          if (!cancelled) {
            setCommands(cmds);
            setLoading(false);
          }
        })
        .catch((e) => {
          console.error("[command-palette] Failed to discover commands:", e);
          if (!cancelled) setLoading(false);
        });

      return () => {
        cancelled = true;
      };
    }, [session?.project_path]);

    // Filter commands by query
    const filtered = commands.filter((cmd) => {
      if (!query) return true;
      // Split query into command name and potential args
      const queryLower = query.toLowerCase();
      const cmdName = queryLower.split(/\s/)[0];
      return (
        cmd.name.toLowerCase().includes(cmdName) ||
        cmd.description.toLowerCase().includes(cmdName)
      );
    });

    // Reset selection when filter changes
    useEffect(() => {
      setSelectedIndex(0);
    }, [query]);

    // Scroll selected item into view
    useEffect(() => {
      const el = itemRefs.current.get(selectedIndex);
      if (el) {
        el.scrollIntoView({ block: "nearest" });
      }
    }, [selectedIndex]);

    const selectCurrent = useCallback(() => {
      const cmd = filtered[selectedIndex];
      if (!cmd) return;

      // Extract args: everything after the command name in query
      const parts = query.split(/\s+/);
      const args = parts.length > 1 ? parts.slice(1).join(" ") : "";
      onSelect(cmd, args);
    }, [filtered, selectedIndex, query, onSelect]);

    // Expose keyboard handler to parent
    useImperativeHandle(
      ref,
      () => ({
        handleKeyDown: (key: string): boolean => {
          switch (key) {
            case "ArrowDown":
              setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
              return true;
            case "ArrowUp":
              setSelectedIndex((i) => Math.max(i - 1, 0));
              return true;
            case "Enter":
              selectCurrent();
              return true;
            case "Escape":
              onClose();
              return true;
            case "Tab":
              // Tab to autocomplete command name
              if (filtered.length > 0) {
                const cmd = filtered[selectedIndex];
                if (cmd) {
                  onSelect(cmd, "");
                  return true;
                }
              }
              return true;
            default:
              return false;
          }
        },
      }),
      [filtered, selectedIndex, selectCurrent, onClose, onSelect]
    );

    // Close on click outside
    useEffect(() => {
      const handler = (e: MouseEvent) => {
        if (listRef.current && !listRef.current.contains(e.target as Node)) {
          onClose();
        }
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, [onClose]);

    if (loading) {
      return (
        <div
          ref={listRef}
          className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-border shadow-lg overflow-hidden z-10"
          style={{ background: "var(--bg-primary)" }}
        >
          <div className="px-4 py-3 text-ui text-text-dim">Loading commands...</div>
        </div>
      );
    }

    if (filtered.length === 0) {
      return (
        <div
          ref={listRef}
          className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-border shadow-lg overflow-hidden z-10"
          style={{ background: "var(--bg-primary)" }}
        >
          <div className="px-4 py-3 text-ui text-text-dim">
            No commands matching &ldquo;/{query}&rdquo;
          </div>
        </div>
      );
    }

    return (
      <div
        ref={listRef}
        className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-border shadow-lg overflow-hidden z-10"
        style={{ background: "var(--bg-primary)", maxHeight: 300 }}
      >
        <div className="overflow-y-auto" style={{ maxHeight: 300 }}>
          {filtered.map((cmd, i) => {
            const cat = CATEGORY_LABELS[cmd.category];
            const isSelected = i === selectedIndex;
            return (
              <button
                key={`${cmd.category}-${cmd.name}`}
                ref={(el) => {
                  if (el) itemRefs.current.set(i, el);
                  else itemRefs.current.delete(i);
                }}
                className={`w-full text-left px-4 py-2 flex items-center gap-3 transition-colors ${
                  isSelected ? "bg-bg-subtle" : "hover:bg-bg-subtle/50"
                }`}
                onClick={() => {
                  const parts = query.split(/\s+/);
                  const args = parts.length > 1 ? parts.slice(1).join(" ") : "";
                  onSelect(cmd, args);
                }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span className="font-mono text-ui text-accent shrink-0">
                  /{cmd.name}
                </span>
                <span className="text-label text-text-dim truncate flex-1">
                  {cmd.description}
                </span>
                {cmd.argument_hint && isSelected && (
                  <span className="text-label text-text-ghost italic shrink-0">
                    {cmd.argument_hint}
                  </span>
                )}
                {cat && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                    style={{
                      color: cat.color,
                      border: `1px solid ${cat.color}33`,
                      background: `${cat.color}0d`,
                    }}
                  >
                    {cat.label}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
);

export default CommandPalette;
