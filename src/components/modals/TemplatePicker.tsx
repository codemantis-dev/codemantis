import { useState, useEffect, useMemo, useCallback } from "react";
import { Search } from "lucide-react";
import { listTemplates, scaffoldFromTemplate, scaffoldFromCli } from "../../lib/tauri-commands";
import { TEMPLATE_CATEGORIES } from "../../types/project-templates";
import type { TemplateEntry, TemplateCategory, ScaffoldResult } from "../../types/project-templates";
import TemplateCard from "./TemplateCard";
import TemplateDetail from "./TemplateDetail";
import ScaffoldProgress from "./ScaffoldProgress";

type View = "grid" | "detail" | "progress";

interface TemplatePickerProps {
  onProjectCreated: (projectPath: string) => void;
  preselectedTemplateId?: string;
}

export default function TemplatePicker({ onProjectCreated, preselectedTemplateId }: TemplatePickerProps) {
  const [templates, setTemplates] = useState<TemplateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<TemplateCategory | "all">("all");

  // Navigation state
  const [view, setView] = useState<View>("grid");
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateEntry | null>(null);

  // Scaffold state
  const [scaffoldProjectName, setScaffoldProjectName] = useState("");
  const [scaffoldParentDir, setScaffoldParentDir] = useState("");
  const [scaffoldResult, setScaffoldResult] = useState<ScaffoldResult | null>(null);
  const [scaffoldError, setScaffoldError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    listTemplates()
      .then((loaded) => {
        setTemplates(loaded);
        // Auto-navigate to preselected template if provided
        if (preselectedTemplateId) {
          const match = loaded.find((t) => t.id === preselectedTemplateId);
          if (match) {
            setSelectedTemplate(match);
            setView("detail");
          }
        }
      })
      .catch((e) => console.error("Failed to load templates:", e))
      .finally(() => setLoading(false));
  }, [preselectedTemplateId]);

  const filtered = useMemo(() => {
    let result = templates;
    if (categoryFilter !== "all") {
      result = result.filter((t) => t.category === categoryFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    }
    return result;
  }, [templates, categoryFilter, search]);

  const handleSelectTemplate = useCallback((template: TemplateEntry) => {
    setSelectedTemplate(template);
    setView("detail");
  }, []);

  const handleBack = useCallback(() => {
    setView("grid");
    setSelectedTemplate(null);
    setScaffoldResult(null);
    setScaffoldError(null);
  }, []);

  const handleUseTemplate = useCallback(
    async (template: TemplateEntry, parentDir: string, projectName: string) => {
      setScaffoldProjectName(projectName);
      setScaffoldParentDir(parentDir);
      setScaffoldResult(null);
      setScaffoldError(null);
      setView("progress");

      try {
        let result: ScaffoldResult;
        if (template.scaffold_type === "cli" && template.cli_command) {
          result = await scaffoldFromCli(
            template.id,
            template.cli_command,
            parentDir,
            projectName,
            [...(template.post_commands ?? [])]
          );
        } else {
          result = await scaffoldFromTemplate(template.id, parentDir, projectName);
        }
        setScaffoldResult(result);
      } catch (e) {
        setScaffoldError(String(e));
      }
    },
    []
  );

  const handleOpenProject = useCallback(() => {
    if (scaffoldResult) {
      onProjectCreated(scaffoldResult.project_path);
    }
  }, [scaffoldResult, onProjectCreated]);

  const handleRetry = useCallback(() => {
    if (selectedTemplate && scaffoldParentDir && scaffoldProjectName) {
      setRetryCount((c) => c + 1);
      handleUseTemplate(selectedTemplate, scaffoldParentDir, scaffoldProjectName);
    }
  }, [selectedTemplate, scaffoldParentDir, scaffoldProjectName, handleUseTemplate]);

  // ── Render: Progress ──
  if (view === "progress" && selectedTemplate) {
    return (
      <div className="flex flex-col h-full pt-4">
        <ScaffoldProgress
          key={retryCount}
          template={selectedTemplate}
          projectName={scaffoldProjectName}
          projectPath={scaffoldParentDir}
          resultPath={scaffoldResult?.project_path ?? null}
          warnings={scaffoldResult?.warnings ?? []}
          scaffoldError={scaffoldError}
          onOpenProject={handleOpenProject}
          onRetry={handleRetry}
          onCancel={handleBack}
        />
      </div>
    );
  }

  // ── Render: Detail ──
  if (view === "detail" && selectedTemplate) {
    return (
      <div className="h-full overflow-y-auto">
        <TemplateDetail
          template={selectedTemplate}
          onBack={handleBack}
          onUseTemplate={handleUseTemplate}
        />
      </div>
    );
  }

  // ── Render: Grid ──
  return (
    <div className="flex flex-col h-full gap-3">
      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-ghost" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search templates..."
          className="w-full pl-8 pr-3 py-2 rounded-lg border border-border bg-bg-subtle text-text-primary text-ui placeholder:text-text-ghost focus:border-accent/50 focus:outline-none transition-colors"
          autoFocus
        />
      </div>

      {/* Category pills */}
      <div className="flex gap-1.5 flex-wrap">
        {TEMPLATE_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setCategoryFilter(cat.id)}
            className={`px-2.5 py-1 rounded-md text-label transition-colors ${
              categoryFilter === cat.id
                ? "bg-accent/15 text-accent"
                : "text-text-dim hover:text-text-secondary hover:bg-bg-elevated"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Template grid */}
      <div className="flex-1 overflow-y-auto -mr-2 pr-2">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <p className="text-text-dim text-label">Loading templates...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <p className="text-text-dim text-label">
              {search ? "No templates match your search" : "No templates available"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onSelect={handleSelectTemplate}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
