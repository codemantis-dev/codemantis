import { SectionTitle, FieldRow } from "./SettingsShared";

export default function TerminalTab({
  shell, fontSize, onShellChange, onFontSizeChange,
}: {
  shell: string; fontSize: number; onShellChange: (s: string) => void; onFontSizeChange: (n: number) => void;
}) {
  return (
    <div>
      <SectionTitle>Terminal</SectionTitle>
      <div className="space-y-1">
        <FieldRow label="Shell">
          <input
            type="text"
            value={shell}
            onChange={(e) => onShellChange(e.target.value)}
            placeholder="Default ($SHELL)"
            className="w-44 px-2 py-1 rounded bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40 placeholder:text-text-ghost"
          />
        </FieldRow>
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
      </div>
    </div>
  );
}
