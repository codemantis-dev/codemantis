export interface ShortcutEntry {
  keys: string;  // e.g., "⌘ ⇧ N"
  description: string;
}

export interface ShortcutCategory {
  name: string;
  shortcuts: ShortcutEntry[];
}

export const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    name: "Global",
    shortcuts: [
      { keys: "⌘ ⇧ N", description: "New project from template" },
      { keys: "⌘ O", description: "Open existing project" },
      { keys: "⌘ ,", description: "Settings" },
      { keys: "⌘ ⇧ M", description: "MCP Servers" },
      { keys: "⌘ /", description: "CLI Overlay" },
      { keys: "⌘ .", description: "Toggle mode (Normal/Auto/Plan)" },
      { keys: "⌘ =", description: "Zoom in (increase font size)" },
      { keys: "⌘ -", description: "Zoom out (decrease font size)" },
      { keys: "⌘ 0", description: "Reset zoom" },
    ],
  },
  {
    name: "Sessions",
    shortcuts: [
      { keys: "⌘ N", description: "New session in current project" },
      { keys: "⌘ W", description: "Close current session" },
      { keys: "⌘ ⇧ [", description: "Previous session" },
      { keys: "⌘ ⇧ ]", description: "Next session" },
      { keys: "⌘ 1-9", description: "Switch to session by number" },
    ],
  },
  {
    name: "Panels",
    shortcuts: [
      { keys: "⌘ B", description: "Toggle sidebar" },
      { keys: "⌘ ⇧ A", description: "Focus activity feed" },
      { keys: "⌘ ⇧ F", description: "Focus file viewer" },
      { keys: "⌘ ⇧ T", description: "Focus terminal" },
      { keys: "⌘ ⇧ C", description: "Focus changelog" },
    ],
  },
  {
    name: "Preview",
    shortcuts: [
      { keys: "⌘ ⇧ P", description: "Toggle Preview Window" },
    ],
  },
  {
    name: "Editor",
    shortcuts: [
      { keys: "⌘ S", description: "Save file" },
    ],
  },
];
