export type ChangelogCategory = "feature" | "bugfix" | "refactor" | "docs" | "config" | "test" | "plan";

export interface ChangelogEntry {
  id: string;
  session_id: string;
  timestamp: string;
  headline: string;
  description: string;
  category: ChangelogCategory;
  files_changed: string[];
  turn_index: number;
}

export interface ProjectChangelogEntry extends ChangelogEntry {
  session_name: string;
}
