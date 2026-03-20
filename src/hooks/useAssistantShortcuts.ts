import { useState, useCallback } from "react";
import type { AssistantShortcut } from "../types/settings";

interface UseAssistantShortcutsParams {
  shortcuts: AssistantShortcut[];
  updateSettings: (settings: { assistantShortcuts: AssistantShortcut[] }) => void;
}

interface UseAssistantShortcutsReturn {
  shortcutDraft: { prompt: string } | null;
  setShortcutDraft: (v: { prompt: string } | null) => void;
  shortcutName: string;
  setShortcutName: (v: string) => void;
  handleAddShortcut: (prompt: string) => void;
  handleSaveShortcut: () => void;
}

export function useAssistantShortcuts({
  shortcuts,
  updateSettings,
}: UseAssistantShortcutsParams): UseAssistantShortcutsReturn {
  const [shortcutDraft, setShortcutDraft] = useState<{ prompt: string } | null>(null);
  const [shortcutName, setShortcutName] = useState("");

  const handleAddShortcut = useCallback((prompt: string) => {
    setShortcutDraft({ prompt });
    setShortcutName("");
  }, []);

  const handleSaveShortcut = useCallback(() => {
    if (!shortcutDraft || !shortcutName.trim()) return;
    const newShortcut: AssistantShortcut = {
      id: crypto.randomUUID(),
      name: shortcutName.trim(),
      prompt: shortcutDraft.prompt,
    };
    updateSettings({
      assistantShortcuts: [...shortcuts, newShortcut],
    });
    setShortcutDraft(null);
    setShortcutName("");
  }, [shortcutDraft, shortcutName, shortcuts, updateSettings]);

  return {
    shortcutDraft,
    setShortcutDraft,
    shortcutName,
    setShortcutName,
    handleAddShortcut,
    handleSaveShortcut,
  };
}
