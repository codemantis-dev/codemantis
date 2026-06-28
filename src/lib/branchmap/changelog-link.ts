// Cross-reference commits to plain-language Project Log (changelog) entries, so
// a commit dot can show "Added Google sign-in" instead of a raw SHA.
//
// The backend git graph carries no changelog id (the git command stays DB-free),
// so the link is heuristic: a changelog entry is written when an agent turn does
// work, and the commit lands around the same time. We match by timestamp
// proximity within a bounded window. Approximate by design — see the deferred
// `git_commit_changelog` xref table in the plan if this proves too fuzzy.

import type { GraphCommit } from "../../types/branch-graph";
import type { ProjectChangelogEntry } from "../../types/changelog";

/** Default match window: a changelog entry within 15 min of a commit. */
export const DEFAULT_MATCH_WINDOW_MS = 15 * 60 * 1000;

function toMs(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? NaN : t;
}

/**
 * Build a `commitHash → ProjectChangelogEntry` map by nearest-timestamp match
 * within `windowMs`. A commit with no entry in range is simply absent from the
 * map (the renderer falls back to the raw git message).
 */
export function linkCommitsToChangelog(
  commits: GraphCommit[],
  entries: ProjectChangelogEntry[],
  windowMs: number = DEFAULT_MATCH_WINDOW_MS,
): Map<string, ProjectChangelogEntry> {
  const result = new Map<string, ProjectChangelogEntry>();
  if (entries.length === 0) return result;

  // Pre-parse entry timestamps once.
  const parsed = entries
    .map((entry) => ({ entry, ms: toMs(entry.timestamp) }))
    .filter((e) => !Number.isNaN(e.ms));
  if (parsed.length === 0) return result;

  for (const commit of commits) {
    const cms = toMs(commit.timestamp);
    if (Number.isNaN(cms)) continue;
    let best: ProjectChangelogEntry | null = null;
    let bestDelta = Infinity;
    for (const { entry, ms } of parsed) {
      const delta = Math.abs(ms - cms);
      if (delta <= windowMs && delta < bestDelta) {
        best = entry;
        bestDelta = delta;
      }
    }
    if (best) result.set(commit.hash, best);
  }
  return result;
}

/**
 * Humanize a git branch name for the friendly primary label, e.g.
 * `feature/login-redesign` → `Login redesign`. The raw ref stays available as
 * the secondary git-term subtitle.
 */
export function humanizeBranchName(ref: string): string {
  if (!ref) return ref;
  // Drop a leading type prefix (feature/, fix/, bugfix/, chore/, hotfix/…).
  const withoutPrefix = ref.replace(/^[a-z]+\//i, "");
  const words = withoutPrefix.replace(/[-_/]+/g, " ").trim();
  if (!words) return ref;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
