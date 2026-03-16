import { SHORTCUT_CATEGORIES } from "../../../data/shortcuts";
import { SectionTitle } from "./SettingsShared";

export default function ShortcutsTab() {
  return (
    <div>
      <SectionTitle>Keyboard Shortcuts</SectionTitle>
      <div className="space-y-5">
        {SHORTCUT_CATEGORIES.map((category) => (
          <div key={category.name}>
            <h4 className="text-label text-text-dim uppercase tracking-wider mb-2">
              {category.name}
            </h4>
            <div className="space-y-1">
              {category.shortcuts.map((shortcut) => (
                <div
                  key={shortcut.keys}
                  className="flex items-center justify-between py-1.5"
                >
                  <span className="text-ui text-text-secondary">
                    {shortcut.description}
                  </span>
                  <kbd className="px-2 py-0.5 rounded bg-bg-elevated border border-border text-text-faint text-label font-mono tracking-wide">
                    {shortcut.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
