import { useState } from "react";
import type { ThemeId } from "../../../types/settings";
import { THEMES } from "../../../types/settings";
import { SectionTitle, FieldRow } from "./SettingsShared";
import { showToast } from "../../../stores/toastStore";
import { useUiStore } from "../../../stores/uiStore";
import { checkForUpdate } from "../../../lib/update-checker";

export default function GeneralTab({
  theme, fontSize, sendShortcut, triviaEnabled, autoOpenFiles, defaultContextWindow, showWelcomeScreen,
  onThemeChange, onFontSizeChange, onSendShortcutChange, onTriviaEnabledChange, onAutoOpenFilesChange, onDefaultContextWindowChange, onShowWelcomeScreenChange,
}: {
  theme: ThemeId; fontSize: number; sendShortcut: string; triviaEnabled: boolean; autoOpenFiles: boolean; defaultContextWindow: number; showWelcomeScreen: boolean;
  onThemeChange: (t: ThemeId) => void; onFontSizeChange: (n: number) => void; onSendShortcutChange: (s: string) => void; onTriviaEnabledChange: (v: boolean) => void; onAutoOpenFilesChange: (v: boolean) => void; onDefaultContextWindowChange: (n: number) => void; onShowWelcomeScreenChange: (v: boolean) => void;
}) {
  return (
    <div>
      <SectionTitle>General</SectionTitle>

      <div className="mb-5">
        <label className="text-ui text-text-secondary mb-2 block">Theme</label>
        <div className="grid grid-cols-3 gap-2">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => onThemeChange(t.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-ui transition-colors ${
                theme === t.id
                  ? "border-accent bg-accent-dim text-text-primary"
                  : "border-border bg-bg-elevated text-text-secondary hover:border-accent/30"
              }`}
            >
              <span
                className="w-3 h-3 rounded-full shrink-0 border"
                style={{
                  background: t.isDark ? "#18181b" : "#fafafa",
                  borderColor: t.isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)",
                }}
              />
              <span className="truncate">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1 border-t border-border-light pt-4">
        <FieldRow label="Font Size">
          <input
            type="number"
            min={10}
            max={20}
            value={fontSize}
            onChange={(e) => onFontSizeChange(Number(e.target.value))}
            className="w-16 px-2 py-1 rounded bg-bg-elevated border border-border text-text-primary text-ui text-center outline-none focus:border-accent/40"
          />
        </FieldRow>

        <FieldRow label="Send Shortcut">
          <select
            value={sendShortcut}
            onChange={(e) => onSendShortcutChange(e.target.value)}
            className="px-2 py-1 rounded bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40"
          >
            <option value="cmd+enter">Cmd + Enter</option>
            <option value="enter">Enter</option>
          </select>
        </FieldRow>

        <div className="flex items-center justify-between py-2">
          <div>
            <label className="text-ui text-text-secondary">Show trivia while waiting</label>
            <p className="text-label text-text-ghost">Display fun facts while Claude is working</p>
          </div>
          <button
            onClick={() => onTriviaEnabledChange(!triviaEnabled)}
            className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${
              triviaEnabled ? "bg-accent" : "bg-bg-elevated border border-border"
            }`}
          >
            <div
              className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${
                triviaEnabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        <div className="flex items-center justify-between py-2">
          <div>
            <label className="text-ui text-text-secondary">Auto-open edited files</label>
            <p className="text-label text-text-ghost">Open files in the viewer when Claude edits them</p>
          </div>
          <button
            onClick={() => onAutoOpenFilesChange(!autoOpenFiles)}
            className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${
              autoOpenFiles ? "bg-accent" : "bg-bg-elevated border border-border"
            }`}
          >
            <div
              className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${
                autoOpenFiles ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        <div className="py-2">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-ui text-text-secondary">Default context window</label>
              <p className="text-label text-text-ghost">Fallback context size when CLI doesn't report it</p>
            </div>
            <div className="flex items-center gap-1.5">
              {[
                { label: "200K", value: 200_000 },
                { label: "1M", value: 1_000_000 },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => onDefaultContextWindowChange(opt.value)}
                  className={`px-2.5 py-1 rounded text-label transition-colors ${
                    defaultContextWindow === opt.value
                      ? "bg-accent text-white"
                      : "bg-bg-elevated text-text-secondary hover:text-text-primary border border-border"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between py-2">
          <div>
            <label className="text-ui text-text-secondary">Show welcome screen on launch</label>
            <p className="text-label text-text-ghost">Display the getting-started screen when the app opens</p>
          </div>
          <button
            onClick={() => onShowWelcomeScreenChange(!showWelcomeScreen)}
            className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${
              showWelcomeScreen ? "bg-accent" : "bg-bg-elevated border border-border"
            }`}
          >
            <div
              className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${
                showWelcomeScreen ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
        <UpdateSection />
      </div>
    </div>
  );
}

// LegacyClaudePathNotice removed in v1.3.0 / Phase 2 S8 — the v1.2.0
// soak passed with zero adapter regressions, so the rollback indicator
// and its IPC wrapper are gone.

function UpdateSection(): React.ReactElement {
  const [checking, setChecking] = useState(false);
  const openUpdateModal = useUiStore((s) => s.openUpdateModal);
  const setShowSettingsModal = useUiStore((s) => s.setShowSettingsModal);
  const updateAvailable = useUiStore((s) => s.updateAvailable);
  const availableVersion = useUiStore((s) => s.availableVersion);
  const availableNotes = useUiStore((s) => s.availableNotes);

  const handleCheck = async (): Promise<void> => {
    setChecking(true);
    try {
      const info = await checkForUpdate();
      if (info) {
        setShowSettingsModal(false);
        openUpdateModal(info.version, info.body);
      } else {
        showToast("You're on the latest version", "success");
      }
    } catch {
      showToast("Failed to check for updates", "error");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex items-center justify-between py-2 border-t border-border-light pt-4 mt-2">
      <div>
        <label className="text-ui text-text-secondary">Check for updates</label>
        <p className="text-label text-text-ghost">
          {updateAvailable && availableVersion
            ? `v${availableVersion} available \u2014 current: v${__APP_VERSION__}`
            : `Current version: v${__APP_VERSION__}`}
        </p>
      </div>
      {updateAvailable && availableVersion ? (
        <div className="flex items-center gap-2">
          <span className="text-label font-medium" style={{ color: "var(--accent)" }}>
            v{availableVersion}
          </span>
          <button
            onClick={() => {
              setShowSettingsModal(false);
              openUpdateModal(availableVersion, availableNotes);
            }}
            className="px-3 py-1.5 rounded-lg text-ui font-medium transition-colors"
            style={{ background: "var(--accent)", color: "white" }}
          >
            Update
          </button>
        </div>
      ) : (
        <button
          onClick={handleCheck}
          disabled={checking}
          className="px-3 py-1.5 rounded-lg text-ui font-medium transition-colors disabled:opacity-50"
          style={{ background: "var(--accent)", color: "white" }}
        >
          {checking ? "Checking..." : "Check Now"}
        </button>
      )}
    </div>
  );
}
