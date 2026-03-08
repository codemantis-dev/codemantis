import { useState, useEffect, useCallback, useRef } from "react";
import {
  HelpCircle, Trash2, Minimize2, Cpu, DollarSign,
  LogIn, LogOut, Power, Activity, Bug, FileSearch,
  Settings, Shield, Brain, History, Stethoscope,
  Terminal, Wrench, MonitorSmartphone, RotateCcw,
  GitBranch,
} from "lucide-react";

interface SlashCommand {
  command: string;
  description: string;
  icon: typeof HelpCircle;
  sendImmediately?: boolean;
}

const COMMANDS: SlashCommand[] = [
  { command: "/help", description: "Show available commands", icon: HelpCircle, sendImmediately: true },
  { command: "/clear", description: "Clear conversation history", icon: Trash2, sendImmediately: true },
  { command: "/compact", description: "Compact conversation to save context", icon: Minimize2, sendImmediately: true },
  { command: "/model", description: "Switch Claude model", icon: Cpu },
  { command: "/cost", description: "Show session cost summary", icon: DollarSign, sendImmediately: true },
  { command: "/status", description: "Show session status", icon: Activity, sendImmediately: true },
  { command: "/bug", description: "Report a bug", icon: Bug, sendImmediately: true },
  { command: "/review", description: "Review code changes", icon: FileSearch, sendImmediately: true },
  { command: "/init", description: "Initialize CLAUDE.md for project", icon: Settings, sendImmediately: true },
  { command: "/config", description: "Open configuration", icon: Settings, sendImmediately: true },
  { command: "/permissions", description: "View/manage tool permissions", icon: Shield, sendImmediately: true },
  { command: "/memory", description: "View/edit CLAUDE.md memory", icon: Brain, sendImmediately: true },
  { command: "/resume", description: "Resume a previous session", icon: History },
  { command: "/doctor", description: "Health check for Claude Code", icon: Stethoscope, sendImmediately: true },
  { command: "/mcp", description: "Manage MCP servers", icon: Wrench, sendImmediately: true },
  { command: "/terminal-setup", description: "Set up terminal integration", icon: Terminal, sendImmediately: true },
  { command: "/login", description: "Log in to Claude", icon: LogIn, sendImmediately: true },
  { command: "/logout", description: "Log out of Claude", icon: LogOut, sendImmediately: true },
  { command: "/ide", description: "Connect to IDE", icon: MonitorSmartphone, sendImmediately: true },
  { command: "/allowed-tools", description: "View allowed tools", icon: Shield, sendImmediately: true },
  { command: "/quit", description: "Quit Claude session", icon: Power, sendImmediately: true },
  { command: "/undo", description: "Undo last file changes", icon: RotateCcw, sendImmediately: true },
  { command: "/pr-comments", description: "View PR comments", icon: GitBranch, sendImmediately: true },
];

interface SlashCommandPickerProps {
  filter: string;
  onSelect: (command: string, sendImmediately: boolean) => void;
  onClose: () => void;
  anchorBottom: number;
}

export default function SlashCommandPicker({
  filter,
  onSelect,
  onClose,
  anchorBottom,
}: SlashCommandPickerProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filterText = filter.startsWith("/") ? filter.slice(1).toLowerCase() : filter.toLowerCase();
  const filtered = COMMANDS.filter((cmd) =>
    cmd.command.toLowerCase().includes(filterText) ||
    cmd.description.toLowerCase().includes(filterText)
  );

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (filtered.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const cmd = filtered[selectedIndex];
        if (cmd) {
          onSelect(cmd.command, cmd.sendImmediately ?? false);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [filtered, selectedIndex, onSelect, onClose]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown]);

  if (filtered.length === 0) {
    return null;
  }

  return (
    <div
      className="absolute left-0 right-0 z-50 mx-4 rounded-xl border border-border shadow-lg overflow-hidden"
      style={{
        background: "var(--bg-primary)",
        bottom: anchorBottom,
        maxHeight: 280,
      }}
    >
      <div className="px-3 py-1.5 border-b border-border-light">
        <span className="text-label text-text-ghost uppercase tracking-wider">Slash Commands</span>
      </div>
      <div ref={listRef} className="overflow-y-auto" style={{ maxHeight: 240 }}>
        {filtered.map((cmd, i) => {
          const Icon = cmd.icon;
          return (
            <button
              key={cmd.command}
              onClick={() => onSelect(cmd.command, cmd.sendImmediately ?? false)}
              onMouseEnter={() => setSelectedIndex(i)}
              className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                i === selectedIndex
                  ? "bg-accent/10 text-text-primary"
                  : "text-text-secondary hover:bg-bg-elevated"
              }`}
            >
              <Icon size={14} className={i === selectedIndex ? "text-accent" : "text-text-dim"} />
              <div className="flex-1 min-w-0">
                <span className="text-ui font-medium font-mono">{cmd.command}</span>
                <span className="text-label text-text-dim ml-2">{cmd.description}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
