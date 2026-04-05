import { useState } from "react";
import { Eye, EyeOff, X } from "lucide-react";

export default function KeyValueRow({
  label,
  helpText,
  pairs,
  onChange,
  maskValues,
  valuePlaceholders,
}: {
  label: string;
  helpText?: string;
  pairs: { key: string; value: string }[];
  onChange: (pairs: { key: string; value: string }[]) => void;
  maskValues?: boolean;
  valuePlaceholders?: Record<string, string>;
}): React.JSX.Element {
  const [revealed, setRevealed] = useState<Set<number>>(new Set());

  const toggle = (idx: number): void => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <div>
      <label className="text-ui text-text-secondary mb-1.5 block">{label}</label>
      {helpText && (
        <p className="text-label text-text-ghost mb-1.5 -mt-0.5">{helpText}</p>
      )}
      <div className="space-y-1.5">
        {pairs.map((pair, i) => (
          <div key={`env-${i}-${pair.key}`} className="flex items-center gap-1.5">
            <input
              type="text"
              value={pair.key}
              title={pair.key || undefined}
              onChange={(e) => {
                const updated = [...pairs];
                updated[i] = { ...updated[i], key: e.target.value };
                onChange(updated);
              }}
              placeholder="Key"
              className="w-48 shrink-0 px-2 py-1.5 rounded bg-bg-elevated border border-border text-text-primary text-ui font-mono outline-none focus:border-accent/40 placeholder:text-text-ghost"
            />
            <input
              type={maskValues && !revealed.has(i) ? "password" : "text"}
              value={pair.value}
              title={maskValues ? undefined : pair.value || undefined}
              onChange={(e) => {
                const updated = [...pairs];
                updated[i] = { ...updated[i], value: e.target.value };
                onChange(updated);
              }}
              placeholder={valuePlaceholders?.[pair.key] || "Value"}
              className="flex-1 px-2 py-1.5 rounded bg-bg-elevated border border-border text-text-primary text-ui font-mono outline-none focus:border-accent/40 placeholder:text-text-ghost"
            />
            {maskValues && (
              <button
                type="button"
                onClick={() => toggle(i)}
                className="p-1 text-text-ghost hover:text-text-secondary transition-colors"
              >
                {revealed.has(i) ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            )}
            <button
              type="button"
              onClick={() => onChange(pairs.filter((_, j) => j !== i))}
              className="p-1 text-text-ghost hover:text-red transition-colors"
            >
              <X size={13} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...pairs, { key: "", value: "" }])}
          className="text-label text-accent hover:text-accent-light transition-colors"
        >
          + Add {label.toLowerCase().replace(/s$/, "")}
        </button>
      </div>
    </div>
  );
}
