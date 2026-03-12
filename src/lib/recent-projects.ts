const RECENT_PROJECTS_KEY = "codemantis-recent-projects";
const LEGACY_PROJECTS_KEY = "claudeforge-recent-projects";
const MAX_RECENT = 5;

export function getRecentProjects(): string[] {
  try {
    let stored = localStorage.getItem(RECENT_PROJECTS_KEY);
    // Migrate from legacy key on first run
    if (!stored) {
      const legacy = localStorage.getItem(LEGACY_PROJECTS_KEY);
      if (legacy) {
        localStorage.setItem(RECENT_PROJECTS_KEY, legacy);
        localStorage.removeItem(LEGACY_PROJECTS_KEY);
        stored = legacy;
      }
    }
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function addRecentProject(path: string): void {
  const recent = getRecentProjects().filter((p) => p !== path);
  recent.unshift(path);
  localStorage.setItem(
    RECENT_PROJECTS_KEY,
    JSON.stringify(recent.slice(0, MAX_RECENT))
  );
}
