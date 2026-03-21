import { useEffect, useCallback, useState } from "react";
import { FileText, Trash2, Upload } from "lucide-react";
import { useSpecWriterStore } from "../../stores/specWriterStore";
import { listSpecDocuments, readSpecDocument, deleteSpecDocument } from "../../lib/tauri-commands";
import { showToast } from "../../stores/toastStore";
import type { SpecDocumentInfo } from "../../types/spec-writer";

const EMPTY_SPECS: SpecDocumentInfo[] = [];

interface Props {
  projectPath: string;
  onLoadSpec: (content: string, filename: string) => void;
}

export default function SavedSpecsList({ projectPath, onLoadSpec }: Props) {
  const savedSpecs = useSpecWriterStore((s) => s.savedSpecs.get(projectPath));
  const setSavedSpecs = useSpecWriterStore((s) => s.setSavedSpecs);
  const selectedSpec = useSpecWriterStore((s) => {
    const ui = s.uiState.get(projectPath);
    return ui?.selected_saved_spec ?? null;
  });
  const setSelectedSavedSpec = useSpecWriterStore((s) => s.setSelectedSavedSpec);
  const setCurrentSpecContent = useSpecWriterStore((s) => s.setCurrentSpecContent);
  const specsList = savedSpecs ?? EMPTY_SPECS;
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const loadSpecs = useCallback(async () => {
    try {
      const specs = await listSpecDocuments(projectPath);
      setSavedSpecs(projectPath, specs);
    } catch (e) {
      console.warn("[SavedSpecsList] Failed to list specs:", e);
    }
  }, [projectPath, setSavedSpecs]);

  useEffect(() => {
    loadSpecs();
  }, [loadSpecs]);

  const handleClick = useCallback(async (spec: SpecDocumentInfo) => {
    try {
      const content = await readSpecDocument(projectPath, spec.filename);
      setSelectedSavedSpec(projectPath, spec.filename);
      setCurrentSpecContent(projectPath, content);
    } catch (e) {
      showToast(`Failed to read spec: ${e}`, "error");
    }
  }, [projectPath, setSelectedSavedSpec, setCurrentSpecContent]);

  const handleDelete = useCallback(async (filename: string) => {
    try {
      await deleteSpecDocument(projectPath, filename);
      showToast("Spec deleted", "success");
      if (selectedSpec === filename) {
        setSelectedSavedSpec(projectPath, null);
        setCurrentSpecContent(projectPath, null);
      }
      loadSpecs();
    } catch (e) {
      showToast(`Failed to delete: ${e}`, "error");
    }
    setPendingDelete(null);
  }, [projectPath, selectedSpec, setSelectedSavedSpec, setCurrentSpecContent, loadSpecs]);

  const handleLoadIntoConversation = useCallback(async (spec: SpecDocumentInfo) => {
    try {
      const content = await readSpecDocument(projectPath, spec.filename);
      onLoadSpec(content, spec.filename);
      showToast(`Loaded ${spec.filename} into conversation`, "success");
    } catch (e) {
      showToast(`Failed to load spec: ${e}`, "error");
    }
  }, [projectPath, onLoadSpec]);

  return (
    <div className="border-t" style={{ borderColor: "var(--border)" }}>
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full px-3 py-2 text-xs font-medium flex items-center justify-between hover:bg-bg-elevated transition-colors"
        style={{ color: "var(--text-secondary)" }}
      >
        <span>Saved Specs ({specsList.length})</span>
        <span className="text-[10px]">{isCollapsed ? "▸" : "▾"}</span>
      </button>

      {!isCollapsed && (
        <div className="px-2 pb-2">
          {specsList.length === 0 ? (
            <div className="text-xs px-2 py-3 text-center" style={{ color: "var(--text-dim)" }}>
              No specifications yet.
            </div>
          ) : (
            <div className="space-y-1">
              {specsList.map((spec) => (
                <div
                  key={spec.filename}
                  className="group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors text-xs"
                  style={{
                    background: selectedSpec === spec.filename ? "var(--accent-bg)" : undefined,
                    color: selectedSpec === spec.filename ? "var(--accent)" : "var(--text-secondary)",
                  }}
                  onClick={() => handleClick(spec)}
                >
                  <FileText size={12} className="shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{spec.title}</div>
                    <div className="text-[10px] opacity-60">
                      {spec.filename}
                      {spec.modified_at && (
                        <span className="ml-1.5">
                          &middot; {new Date(spec.modified_at).toLocaleDateString(undefined, {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleLoadIntoConversation(spec); }}
                      title="Load into conversation"
                      className="p-1 rounded hover:bg-bg-elevated"
                      style={{ color: "var(--text-ghost)" }}
                    >
                      <Upload size={11} />
                    </button>
                    {pendingDelete === spec.filename ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(spec.filename); }}
                        className="px-1.5 py-0.5 rounded text-[10px]"
                        style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}
                      >
                        Confirm
                      </button>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); setPendingDelete(spec.filename); }}
                        title="Delete spec"
                        className="p-1 rounded hover:bg-bg-elevated"
                        style={{ color: "var(--text-ghost)" }}
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
