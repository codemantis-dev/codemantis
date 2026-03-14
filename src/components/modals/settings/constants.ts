import { Settings, Terminal, Zap, Layers, ScrollText, MessageSquare, Keyboard, BarChart3 } from "lucide-react";
import type { ChangelogProvider } from "../../../types/settings";

export type SettingsTab = "general" | "terminal" | "quick-commands" | "ai-providers" | "changelog" | "assistant" | "shortcuts" | "api-logs";

export const NAV_ITEMS: { id: SettingsTab; label: string; icon: typeof Settings }[] = [
  { id: "general", label: "General", icon: Settings },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "quick-commands", label: "Quick Commands", icon: Zap },
  { id: "ai-providers", label: "AI Providers", icon: Layers },
  { id: "changelog", label: "Changelog", icon: ScrollText },
  { id: "assistant", label: "Assistant", icon: MessageSquare },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "api-logs", label: "API Logs", icon: BarChart3 },
];

export const CHANGELOG_PROVIDERS: { id: ChangelogProvider; label: string }[] = [
  { id: "gemini", label: "Google Gemini" },
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
];
