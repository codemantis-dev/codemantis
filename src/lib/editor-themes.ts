import type { ThemeId } from "../types/settings";
import { THEMES } from "../types/settings";

export interface MonacoThemeColors {
  base: "vs-dark" | "vs";
  editorBackground: string;
  lineHighlightBackground: string;
  lineNumberForeground: string;
  lineNumberActiveForeground: string;
  selectionBackground: string;
  widgetBackground: string;
  widgetBorder: string;
  diffInsertedText: string;
  diffRemovedText: string;
  diffInsertedLine: string;
  diffRemovedLine: string;
}

export interface XtermThemeColors {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

const darkMonaco: MonacoThemeColors = {
  base: "vs-dark",
  editorBackground: "#09090b",
  lineHighlightBackground: "#ffffff08",
  lineNumberForeground: "#52525b",
  lineNumberActiveForeground: "#a1a1aa",
  selectionBackground: "#7c3aed40",
  widgetBackground: "#18181b",
  widgetBorder: "#ffffff12",
  diffInsertedText: "#4ade8018",
  diffRemovedText: "#f8717118",
  diffInsertedLine: "#4ade800a",
  diffRemovedLine: "#f871710a",
};

const lightMonaco: MonacoThemeColors = {
  base: "vs",
  editorBackground: "#fafaf9",
  lineHighlightBackground: "#00000006",
  lineNumberForeground: "#a8a29e",
  lineNumberActiveForeground: "#57534e",
  selectionBackground: "#7c3aed30",
  widgetBackground: "#f5f5f4",
  widgetBorder: "#00000015",
  diffInsertedText: "#16a34a20",
  diffRemovedText: "#dc262620",
  diffInsertedLine: "#16a34a0a",
  diffRemovedLine: "#dc26260a",
};

const MONACO_THEMES: Record<ThemeId, MonacoThemeColors> = {
  midnight: darkMonaco,
  ocean: {
    ...darkMonaco,
    editorBackground: "#0a0e1a",
    lineNumberForeground: "#3d4d67",
    lineNumberActiveForeground: "#8c9bb5",
    selectionBackground: "#3b82f640",
    widgetBackground: "#111827",
    widgetBorder: "#64a0ff12",
  },
  ember: {
    ...darkMonaco,
    editorBackground: "#12100e",
    lineNumberForeground: "#5c5244",
    lineNumberActiveForeground: "#b5a68c",
    selectionBackground: "#e67e2240",
    widgetBackground: "#1c1916",
    widgetBorder: "#ffb46412",
  },
  dawn: {
    ...lightMonaco,
    editorBackground: "#fafaf9",
    selectionBackground: "#7c3aed25",
  },
  sand: {
    ...lightMonaco,
    editorBackground: "#fdf8f0",
    lineHighlightBackground: "#8c643008",
    lineNumberForeground: "#958878",
    lineNumberActiveForeground: "#5e5345",
    selectionBackground: "#b5650a25",
    widgetBackground: "#f7f0e4",
    widgetBorder: "#78592818",
  },
  arctic: {
    ...lightMonaco,
    editorBackground: "#f4f7fb",
    lineHighlightBackground: "#32508c08",
    lineNumberForeground: "#7e8ea0",
    lineNumberActiveForeground: "#475569",
    selectionBackground: "#2563eb25",
    widgetBackground: "#edf1f8",
    widgetBorder: "#32648c15",
  },
};

const darkXterm: XtermThemeColors = {
  background: "#09090b",
  foreground: "#e4e4e7",
  cursor: "#a78bfa",
  selectionBackground: "rgba(124, 58, 237, 0.3)",
  black: "#09090b",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#fbbf24",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#e4e4e7",
  brightBlack: "#52525b",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde68a",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#fafafa",
};

const lightXterm: XtermThemeColors = {
  background: "#fafaf9",
  foreground: "#1c1917",
  cursor: "#7c3aed",
  selectionBackground: "rgba(124, 58, 237, 0.2)",
  black: "#1c1917",
  red: "#dc2626",
  green: "#16a34a",
  yellow: "#ca8a04",
  blue: "#2563eb",
  magenta: "#9333ea",
  cyan: "#0891b2",
  white: "#fafaf9",
  brightBlack: "#78716c",
  brightRed: "#ef4444",
  brightGreen: "#22c55e",
  brightYellow: "#eab308",
  brightBlue: "#3b82f6",
  brightMagenta: "#a855f7",
  brightCyan: "#06b6d4",
  brightWhite: "#ffffff",
};

const XTERM_THEMES: Record<ThemeId, XtermThemeColors> = {
  midnight: darkXterm,
  ocean: {
    ...darkXterm,
    background: "#0a0e1a",
    cursor: "#60a5fa",
    selectionBackground: "rgba(59, 130, 246, 0.3)",
    black: "#0a0e1a",
  },
  ember: {
    ...darkXterm,
    background: "#12100e",
    cursor: "#f0a050",
    selectionBackground: "rgba(230, 126, 34, 0.3)",
    black: "#12100e",
  },
  dawn: {
    ...lightXterm,
  },
  sand: {
    ...lightXterm,
    background: "#fdf8f0",
    foreground: "#1f1a13",
    cursor: "#b5650a",
    selectionBackground: "rgba(181, 101, 10, 0.2)",
    black: "#1f1a13",
    white: "#fdf8f0",
  },
  arctic: {
    ...lightXterm,
    background: "#f4f7fb",
    foreground: "#0f172a",
    cursor: "#2563eb",
    selectionBackground: "rgba(37, 99, 235, 0.2)",
    black: "#0f172a",
    blue: "#2563eb",
    white: "#f4f7fb",
  },
};

export function getMonacoTheme(themeId: ThemeId): MonacoThemeColors {
  return MONACO_THEMES[themeId] ?? MONACO_THEMES.midnight;
}

export function getXtermTheme(themeId: ThemeId): XtermThemeColors {
  return XTERM_THEMES[themeId] ?? XTERM_THEMES.midnight;
}

export function isLightTheme(themeId: ThemeId): boolean {
  const theme = THEMES.find((t) => t.id === themeId);
  return theme ? !theme.isDark : false;
}
