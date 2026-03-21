import { useState } from "react";
import { X, KeyRound } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";

export default function ApiKeyBanner() {
  const loaded = useSettingsStore((s) => s.loaded);
  const apiKeys = useSettingsStore((s) => s.settings.apiKeys);
  const dismissed = useSettingsStore((s) => s.settings.apiKeyBannerDismissed);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  const [sessionDismissed, setSessionDismissed] = useState(false);
  const [doNotShowAgain, setDoNotShowAgain] = useState(false);

  if (!loaded) return null;

  const hasAnyKey = Object.values(apiKeys).some((v) => !!v?.trim());
  if (hasAnyKey || dismissed || sessionDismissed) return null;

  const handleDismiss = (): void => {
    if (doNotShowAgain) {
      updateSettings({ apiKeyBannerDismissed: true });
    }
    setSessionDismissed(true);
  };

  const handleOpenSettings = (): void => {
    useUiStore.getState().openSettingsToTab("ai-providers");
  };

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded-md mr-1 shrink-0"
      style={{ background: "var(--accent-dim)", color: "var(--accent)" }}
    >
      <KeyRound size={12} className="shrink-0" />
      <button
        onClick={handleOpenSettings}
        className="text-label whitespace-nowrap hover:underline"
        style={{ color: "var(--accent)" }}
      >
        Add API keys for full features
      </button>

      <label className="flex items-center gap-1 ml-1 shrink-0 cursor-pointer">
        <input
          type="checkbox"
          checked={doNotShowAgain}
          onChange={(e) => setDoNotShowAgain(e.target.checked)}
          className="w-3 h-3 accent-current"
        />
        <span className="text-label whitespace-nowrap" style={{ color: "var(--text-dim)" }}>
          Don't show again
        </span>
      </label>

      <button
        onClick={handleDismiss}
        className="p-0.5 rounded hover:bg-bg-elevated shrink-0 transition-colors"
        style={{ color: "var(--text-dim)" }}
        title="Dismiss"
      >
        <X size={10} />
      </button>
    </div>
  );
}
