import { useState, useRef, useMemo, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { useOpenRouterStore } from "../../stores/openRouterStore";

interface Props {
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export default function OpenRouterModelSelect({
  value,
  onChange,
  disabled = false,
  placeholder = "Select model...",
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const models = useOpenRouterStore((s) => s.models);
  const loading = useOpenRouterStore((s) => s.loading);

  const selectedModel = useMemo(
    () => models.find((m) => m.id === value),
    [models, value],
  );

  const filtered = useMemo(() => {
    let list = models;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
      );
    }
    // Sort: free first, then alphabetical within each group
    return [...list].sort((a, b) => {
      if (a.isFree !== b.isFree) return a.isFree ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [models, search]);

  const freeCount = useMemo(() => filtered.filter((m) => m.isFree).length, [filtered]);
  const paidCount = useMemo(() => filtered.filter((m) => !m.isFree).length, [filtered]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus search input when opened
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  // Scroll selected item into view on open
  useEffect(() => {
    if (open && value && listRef.current) {
      requestAnimationFrame(() => {
        const el = listRef.current?.querySelector(`[data-model-id="${CSS.escape(value)}"]`);
        el?.scrollIntoView({ block: "center" });
      });
    }
  }, [open, value]);

  const handleSelect = (modelId: string) => {
    onChange(modelId);
    setOpen(false);
    setSearch("");
  };

  const displayName = selectedModel
    ? `${selectedModel.isFree ? "[FREE] " : ""}${selectedModel.name}`
    : value || placeholder;

  return (
    <div ref={containerRef} className="relative">
      {/* Collapsed trigger */}
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-left text-ui transition-colors ${
          disabled
            ? "bg-bg-elevated border border-border text-text-ghost cursor-not-allowed opacity-40"
            : "bg-bg-elevated border border-border text-text-primary hover:border-accent/40"
        }`}
      >
        <span className="truncate min-w-0" title={selectedModel?.id ?? value}>
          {loading ? "Loading models..." : displayName}
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-text-ghost transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* Expanded dropdown */}
      {open && (
        <div
          className="absolute z-50 mt-1 w-full rounded-lg border shadow-lg overflow-hidden"
          style={{ background: "var(--bg-primary)", borderColor: "var(--border)" }}
        >
          {/* Search input */}
          <div className="p-1.5 border-b" style={{ borderColor: "var(--border-light)" }}>
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search models..."
              className="w-full px-2 py-1 rounded text-label bg-bg-elevated border border-border text-text-primary outline-none focus:border-accent/40 placeholder:text-text-ghost"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setOpen(false);
                  setSearch("");
                }
              }}
            />
          </div>

          {/* Model list */}
          <div ref={listRef} className="max-h-[280px] overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-3 py-3 text-label text-text-ghost text-center">
                {models.length === 0
                  ? "No models loaded. Test your API key first."
                  : `No models match "${search}"`}
              </div>
            )}

            {freeCount > 0 && (
              <div
                className="px-2 py-1 text-[9px] uppercase tracking-wider sticky top-0"
                style={{ color: "var(--text-ghost)", background: "var(--bg-secondary)" }}
              >
                Free Models ({freeCount})
              </div>
            )}
            {filtered
              .filter((m) => m.isFree)
              .map((m) => (
                <ModelItem
                  key={m.id}
                  id={m.id}
                  name={m.name}
                  isFree
                  isSelected={m.id === value}
                  onSelect={handleSelect}
                />
              ))}

            {paidCount > 0 && (
              <div
                className="px-2 py-1 text-[9px] uppercase tracking-wider sticky top-0"
                style={{ color: "var(--text-ghost)", background: "var(--bg-secondary)" }}
              >
                Paid Models ({paidCount})
              </div>
            )}
            {filtered
              .filter((m) => !m.isFree)
              .map((m) => (
                <ModelItem
                  key={m.id}
                  id={m.id}
                  name={m.name}
                  isFree={false}
                  isSelected={m.id === value}
                  onSelect={handleSelect}
                />
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ModelItem({
  id,
  name,
  isFree,
  isSelected,
  onSelect,
}: {
  id: string;
  name: string;
  isFree: boolean;
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      data-model-id={id}
      onClick={() => onSelect(id)}
      className={`w-full text-left px-2 py-1.5 text-label flex items-center gap-1.5 transition-colors ${
        isSelected
          ? "bg-accent/12 text-accent"
          : "text-text-primary hover:bg-bg-subtle"
      }`}
      title={id}
    >
      <span className="w-3.5 shrink-0">
        {isSelected && <Check size={12} style={{ color: "var(--accent)" }} />}
      </span>
      <span className="truncate min-w-0">
        {isFree && (
          <span
            className="text-[9px] font-medium mr-1 px-1 py-px rounded"
            style={{
              background: "color-mix(in srgb, var(--accent) 15%, transparent)",
              color: "var(--accent)",
            }}
          >
            FREE
          </span>
        )}
        {name}
      </span>
    </button>
  );
}
