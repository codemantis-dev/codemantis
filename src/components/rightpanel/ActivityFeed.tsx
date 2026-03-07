import { useEffect, useRef } from "react";
import { useActivityStore } from "../../stores/activityStore";
import { getActivityType } from "../../types/activity";
import ToolBadge from "../shared/ToolBadge";
import StatusDot from "../shared/StatusDot";

const typeColors: Record<string, "blue" | "green" | "yellow" | "purple" | "accent"> = {
  read: "blue",
  write: "green",
  edit: "yellow",
  bash: "purple",
  other: "accent",
};

function formatToolInput(_toolName: string, input: Record<string, unknown>): string {
  if (input.file_path) return String(input.file_path);
  if (input.pattern) return String(input.pattern);
  if (input.command) return String(input.command);
  if (input.regex) return `"${input.regex}" in ${input.path ?? "."}`;
  const keys = Object.keys(input);
  if (keys.length === 0) return "";
  return JSON.stringify(input).slice(0, 80);
}

export default function ActivityFeed() {
  const entries = useActivityStore((s) => s.entries);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length]);

  if (entries.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-text-faint text-ui">No activity yet</p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto px-3 py-2">
      {entries.map((entry, i) => {
        const activityType = getActivityType(entry.toolName);
        const color = typeColors[activityType] ?? "accent";
        const inputStr = formatToolInput(entry.toolName, entry.toolInput);

        return (
          <div key={entry.id} className="flex gap-2 mb-0.5">
            {/* Timeline dot + line */}
            <div className="flex flex-col items-center pt-2 w-4 shrink-0">
              <StatusDot
                color={color}
                pulse={entry.status === "running"}
                size={6}
              />
              {i < entries.length - 1 && (
                <div className="w-px flex-1 mt-1 bg-border-light" />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 py-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <ToolBadge toolName={entry.toolName} />
                <span className="text-ui text-text-secondary font-medium truncate">
                  {entry.toolName}
                </span>
                <span className="text-label text-text-ghost ml-auto shrink-0">
                  {new Date(entry.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
              </div>
              {inputStr && (
                <p className="text-label text-text-dim font-mono truncate mt-0.5">
                  {inputStr}
                </p>
              )}
              {entry.status === "done" && entry.result && (
                <p className="text-label text-text-faint truncate mt-0.5">
                  {entry.result.slice(0, 100)}
                </p>
              )}
              {entry.status === "error" && (
                <p className="text-label text-red truncate mt-0.5">
                  Error{entry.result ? `: ${entry.result.slice(0, 80)}` : ""}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
