import { useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Blocks, Pencil, Trash2, Eye, EyeOff, Plus, X, ArrowLeft, FolderOpen, FileCode } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { ScopeFilter } from "./types";
import { NAME_PATTERN } from "./types";
import { useMcpServerForm } from "./useMcpServerForm";
import { showToast } from "../../../stores/toastStore";
import { getMcpConfigPath } from "../../../lib/tauri-commands";
import TypeBadge from "./TypeBadge";
import ScopeBadge from "./ScopeBadge";
import TemplatePicker from "./TemplatePicker";
import ConfigFileEditor from "./ConfigFileEditor";
import ServerForm from "./ServerForm";

export default function McpModal(): React.JSX.Element {
  const {
    showModal,
    setShowModal,
    activeProjectPath,
    loading,
    error,
    scopeFilter,
    setScopeFilter,
    filteredServers,
    editingServer,
    form,
    setForm,
    confirmDelete,
    setConfirmDelete,
    revealedEnv,
    setupHint,
    fieldHints,
    templateDisplayName,
    templateDocsUrl,
    configEditor,
    setConfigEditor,
    hasProject,
    existingNames,
    servers,
    handleAdd,
    handleSelectTemplate,
    handleManualAdd,
    handleEdit,
    handleSave,
    handleCancelEdit,
    handleDelete,
    handleShowConfigFile,
    handleSaveConfigFile,
    toggleEnvReveal,
    serverSummary,
  } = useMcpServerForm();

  const handleConfigEditorChange = useCallback(
    (content: string) =>
      setConfigEditor(configEditor ? { ...configEditor, editedContent: content } : null),
    [configEditor, setConfigEditor],
  );

  const handleConfigEditorCancel = useCallback(
    () => setConfigEditor(null),
    [setConfigEditor],
  );

  const handleShowConfigFileForScope = useCallback(
    () => handleShowConfigFile(form.scope),
    [handleShowConfigFile, form.scope],
  );

  const isOnSubView = editingServer !== null || configEditor !== null;
  const hasUnsavedWork = (editingServer !== null && editingServer !== "__picking__") || configEditor !== null;

  const handleBack = useCallback((): void => {
    if (configEditor) {
      setConfigEditor(null);
      return;
    }
    handleCancelEdit();
  }, [configEditor, setConfigEditor, handleCancelEdit]);

  const handleClose = useCallback((): void => {
    if (hasUnsavedWork) {
      showToast("Save or discard your changes first", "info");
      return;
    }
    setShowModal(false);
  }, [hasUnsavedWork, setShowModal]);

  const headerTitle = configEditor
    ? "Edit Config File"
    : editingServer === "__picking__"
      ? "Add MCP Server"
      : editingServer === "__new__"
        ? "Add MCP Server"
        : editingServer
          ? "Edit MCP Server"
          : "MCP Servers";

  const isFormView = editingServer !== null && editingServer !== "__picking__";
  const nameValid = form.name.trim().length > 0 && NAME_PATTERN.test(form.name.trim());
  const nameUnique = editingServer === "__new__" ? !existingNames.has(form.name.trim()) : true;
  const hasRequired = form.serverType === "stdio" ? form.command.trim().length > 0 : form.url.trim().length > 0;
  const canSave = nameValid && nameUnique && hasRequired;

  const handleRevealConfig = useCallback(async (scope: "global" | "project"): Promise<void> => {
    try {
      const path = await getMcpConfigPath(scope, activeProjectPath ?? undefined);
      await revealItemInDir(path);
    } catch (e) {
      showToast(`Failed to open folder: ${e}`, "error");
    }
  }, [activeProjectPath]);

  return (
    <Dialog.Root open={showModal} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 rounded-xl border border-border overflow-hidden flex flex-col"
          style={{
            background: "var(--bg-primary)",
            width: "min(90vw, 780px)",
            height: "min(85vh, 720px)",
          }}
          onInteractOutside={(e) => { if (hasUnsavedWork) e.preventDefault(); }}
          onEscapeKeyDown={(e) => { if (hasUnsavedWork) e.preventDefault(); }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border shrink-0">
            <Dialog.Title className="flex items-center gap-2 text-text-primary font-semibold">
              {isOnSubView && (
                <button
                  onClick={handleBack}
                  className="text-text-ghost hover:text-text-primary transition-colors p-1 rounded hover:bg-bg-elevated -ml-1"
                  aria-label="Go back"
                >
                  <ArrowLeft size={15} />
                </button>
              )}
              <Blocks size={16} className="text-accent" />
              {headerTitle}
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close MCP servers dialog"
              className="text-text-ghost hover:text-text-primary transition-colors p-1 rounded hover:bg-bg-elevated"
            >
              <X size={15} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Manage MCP server configurations
          </Dialog.Description>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 select-text">
            {configEditor ? (
              <ConfigFileEditor
                filePath={configEditor.filePath}
                content={configEditor.editedContent}
                onChange={handleConfigEditorChange}
              />
            ) : editingServer === "__picking__" ? (
              <TemplatePicker
                onSelect={handleSelectTemplate}
                onManual={handleManualAdd}
              />
            ) : editingServer ? (
              <ServerForm
                form={form}
                onChange={setForm}
                isEdit={editingServer !== "__new__"}
                existingNames={existingNames}
                hasProject={hasProject}
                setupHint={setupHint}
                fieldHints={fieldHints}
                templateDisplayName={templateDisplayName}
                docsUrl={templateDocsUrl}
              />
            ) : (
              <>
                {/* Toolbar */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex gap-1">
                    {(["all", "global", ...(hasProject ? ["project"] : [])] as ScopeFilter[]).map(
                      (f) => (
                        <button
                          key={f}
                          onClick={() => setScopeFilter(f)}
                          className={`px-2.5 py-1 rounded text-ui transition-colors ${
                            scopeFilter === f
                              ? "bg-accent/15 text-accent font-medium"
                              : "text-text-dim hover:text-text-secondary hover:bg-bg-elevated"
                          }`}
                        >
                          {f.charAt(0).toUpperCase() + f.slice(1)}
                        </button>
                      )
                    )}
                  </div>
                  <button
                    onClick={handleAdd}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-ui text-accent hover:bg-accent/10 transition-colors font-medium"
                  >
                    <Plus size={14} />
                    Add Server
                  </button>
                </div>

                {/* Error */}
                {error && (
                  <div className="mb-3 px-3 py-2 rounded-lg bg-red/10 border border-red/20 text-red text-ui">
                    {error}
                  </div>
                )}

                {/* Server list */}
                {loading ? (
                  <p className="text-text-dim text-ui py-8 text-center">Loading...</p>
                ) : filteredServers.length === 0 ? (
                  <p className="text-text-dim text-ui py-8 text-center">
                    {servers.length === 0
                      ? "No MCP servers configured"
                      : "No servers match this filter"}
                  </p>
                ) : (
                  <div className="space-y-1">
                    {filteredServers.map((server) => (
                      <div
                        key={`${server.scope}-${server.name}`}
                        className="rounded-lg border border-border hover:border-border-light transition-colors"
                      >
                        <div className="flex items-center justify-between px-3 py-2.5">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className="font-mono text-ui text-text-primary font-medium truncate">
                              {server.name}
                            </span>
                            <TypeBadge type={server.serverType} />
                            <ScopeBadge scope={server.scope} />
                          </div>
                          <div className="flex items-center gap-1 shrink-0 ml-2">
                            <button
                              onClick={() => handleEdit(server)}
                              className="p-1.5 rounded text-text-ghost hover:text-text-secondary hover:bg-bg-elevated transition-colors"
                              title="Edit"
                            >
                              <Pencil size={13} />
                            </button>
                            {confirmDelete === server.name ? (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => handleDelete(server.name, server.scope)}
                                  className="px-2 py-0.5 rounded text-label text-red bg-red/10 hover:bg-red/20 transition-colors font-medium"
                                >
                                  Delete
                                </button>
                                <button
                                  onClick={() => setConfirmDelete(null)}
                                  className="px-2 py-0.5 rounded text-label text-text-dim hover:bg-bg-elevated transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setConfirmDelete(server.name)}
                                className="p-1.5 rounded text-text-ghost hover:text-red hover:bg-red/10 transition-colors"
                                title="Delete"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Summary line */}
                        <div className="px-3 pb-2 -mt-1">
                          <p className="text-ui text-text-dim font-mono truncate">
                            {serverSummary(server)}
                          </p>
                        </div>

                        {/* Env vars (if any) */}
                        {server.env && Object.keys(server.env).length > 0 && (
                          <div className="px-3 pb-2.5 flex flex-wrap gap-1">
                            {Object.entries(server.env).map(([key, value]) => (
                              <span
                                key={key}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-elevated text-label font-mono"
                              >
                                <span className="text-text-dim">{key}=</span>
                                <span className="text-text-ghost">
                                  {revealedEnv.has(server.name) ? value : "••••••"}
                                </span>
                                <button
                                  onClick={() => toggleEnvReveal(server.name)}
                                  className="text-text-ghost hover:text-text-dim transition-colors"
                                >
                                  {revealedEnv.has(server.name) ? (
                                    <EyeOff size={10} />
                                  ) : (
                                    <Eye size={10} />
                                  )}
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer — pinned at bottom for all views */}
          {configEditor ? (
            <div className="px-5 py-3 border-t border-border shrink-0 flex justify-end gap-2">
              <button
                onClick={handleConfigEditorCancel}
                className="px-3 py-1.5 rounded-lg text-ui text-text-secondary border border-border hover:bg-bg-elevated transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveConfigFile}
                className="px-4 py-1.5 rounded-lg text-ui font-medium text-white bg-accent hover:bg-accent-light transition-colors"
              >
                Save
              </button>
            </div>
          ) : isFormView ? (
            <div className="px-5 py-3 border-t border-border shrink-0 flex items-center gap-2">
              <button
                onClick={handleShowConfigFileForScope}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-ui text-text-secondary border border-border hover:bg-bg-elevated transition-colors mr-auto"
              >
                <FileCode size={13} />
                Show config file
              </button>
              <button
                onClick={handleCancelEdit}
                className="px-3 py-1.5 rounded-lg text-ui text-text-secondary border border-border hover:bg-bg-elevated transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!canSave}
                className={`px-4 py-1.5 rounded-lg text-ui font-medium transition-colors ${
                  canSave
                    ? "text-white bg-accent hover:bg-accent-light"
                    : "bg-bg-elevated text-text-ghost cursor-not-allowed"
                }`}
              >
                {editingServer !== "__new__" ? "Save Changes" : "Add Server"}
              </button>
            </div>
          ) : !editingServer && (
            <div className="px-5 py-3 border-t border-border text-label text-text-ghost shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1">
                Global: ~/.claude.json
                <button
                  onClick={() => handleRevealConfig("global")}
                  className="text-text-ghost hover:text-text-secondary transition-colors p-0.5 rounded hover:bg-bg-elevated"
                  title="Reveal in Finder"
                >
                  <FolderOpen size={11} />
                </button>
              </span>
              {hasProject && activeProjectPath && (
                <span className="inline-flex items-center gap-1">
                  Project: {activeProjectPath}/.mcp.json
                  <button
                    onClick={() => handleRevealConfig("project")}
                    className="text-text-ghost hover:text-text-secondary transition-colors p-0.5 rounded hover:bg-bg-elevated"
                    title="Reveal in Finder"
                  >
                    <FolderOpen size={11} />
                  </button>
                </span>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
