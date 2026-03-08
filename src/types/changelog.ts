export type ChangelogCategory = "feature" | "bugfix" | "refactor" | "docs" | "config" | "test";

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
