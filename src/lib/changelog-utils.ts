import { Bug, Wrench, FileText, Settings, TestTube, Sparkles, Map } from "lucide-react";
import type { ChangelogCategory } from "../types/changelog";

export const CATEGORY_CONFIG: Record<ChangelogCategory, { icon: typeof Bug; color: string; label: string }> = {
  feature: { icon: Sparkles, color: "text-green", label: "Feature" },
  bugfix: { icon: Bug, color: "text-red", label: "Bug Fix" },
  refactor: { icon: Wrench, color: "text-yellow", label: "Refactor" },
  docs: { icon: FileText, color: "text-blue", label: "Docs" },
  config: { icon: Settings, color: "text-purple", label: "Config" },
  test: { icon: TestTube, color: "text-accent", label: "Test" },
  plan: { icon: Map, color: "text-blue", label: "Plan" },
};
