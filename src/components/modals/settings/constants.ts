import { Settings, Terminal, Zap, Layers, ScrollText, MessageSquare, Keyboard, BarChart3, Globe, PenTool, Database, Shield, Rocket } from "lucide-react";
import type { ChangelogProvider } from "../../../types/settings";

export type SettingsTab = "general" | "terminal" | "quick-commands" | "ai-providers" | "changelog" | "assistant" | "shortcuts" | "api-logs" | "preview" | "task-board" | "session-logs" | "super-bro" | "self-drive";

export const NAV_ITEMS: { id: SettingsTab; label: string; icon: typeof Settings }[] = [
  { id: "general", label: "General", icon: Settings },
  { id: "super-bro", label: "Super-Bro", icon: Shield },
  { id: "self-drive", label: "Self-Drive", icon: Rocket },
  { id: "session-logs", label: "Session Logs", icon: Database },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "quick-commands", label: "Quick Commands", icon: Zap },
  { id: "ai-providers", label: "AI Providers", icon: Layers },
  { id: "preview", label: "Preview", icon: Globe },
  { id: "task-board", label: "SpecWriter", icon: PenTool },
  { id: "changelog", label: "Changelog", icon: ScrollText },
  { id: "assistant", label: "Assistant", icon: MessageSquare },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "api-logs", label: "API Logs", icon: BarChart3 },
];

export const CHANGELOG_PROVIDERS: { id: ChangelogProvider; label: string }[] = [
  { id: "gemini", label: "Google Gemini" },
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "openrouter", label: "OpenRouter" },
];
