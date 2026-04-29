export const SESSION_ICONS = [
  "⬡",
  "◈",
  "△",
  "○",
  "□",
  "◇",
  "⬢",
  "▽",
  "◎",
  "⬟",
];

export function sessionIconFor(iconIndex: number): string {
  return SESSION_ICONS[iconIndex % SESSION_ICONS.length];
}

export function formatRelativeTime(isoDate: string, now: number = Date.now()): string {
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(isoDate).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function projectBasename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}
