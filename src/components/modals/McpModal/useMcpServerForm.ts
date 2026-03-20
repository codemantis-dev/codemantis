import { useState, useEffect, useCallback } from "react";
import { useUiStore } from "../../../stores/uiStore";
import { useMcpStore } from "../../../stores/mcpStore";
import { useSessionStore } from "../../../stores/sessionStore";
import { getMcpConfigPath, readFileContent, writeFileContent } from "../../../lib/tauri-commands";
import { showToast } from "../../../stores/toastStore";
import type { McpServerConfig, McpScope } from "../../../types/mcp";
import type { McpTemplate } from "../../../types/mcp-templates";
import type { FormState, ScopeFilter } from "./types";
import { EMPTY_FORM } from "./types";
import { serverToForm, templateToForm, formToServer } from "./helpers";

interface ConfigEditorState {
  filePath: string;
  originalContent: string;
  editedContent: string;
  scope: McpScope;
}

interface UseMcpServerFormReturn {
  showModal: boolean;
  setShowModal: (show: boolean) => void;
  activeProjectPath: string | null;
  servers: McpServerConfig[];
  loading: boolean;
  error: string | null;
  scopeFilter: ScopeFilter;
  setScopeFilter: (filter: ScopeFilter) => void;
  filteredServers: McpServerConfig[];
  editingServer: string | null;
  form: FormState;
  setForm: (form: FormState) => void;
  confirmDelete: string | null;
  setConfirmDelete: (name: string | null) => void;
  revealedEnv: Set<string>;
  setupHint: string;
  fieldHints: Record<string, string>;
  configEditor: ConfigEditorState | null;
  setConfigEditor: (state: ConfigEditorState | null) => void;
  hasProject: boolean;
  existingNames: Set<string>;
  handleAdd: () => void;
  handleSelectTemplate: (template: McpTemplate) => void;
  handleManualAdd: () => void;
  handleEdit: (server: McpServerConfig) => void;
  handleSave: () => Promise<void>;
  handleCancelEdit: () => void;
  handleDelete: (name: string, scope: McpScope) => Promise<void>;
  handleShowConfigFile: (scope: McpScope) => Promise<void>;
  handleSaveConfigFile: () => Promise<void>;
  toggleEnvReveal: (name: string) => void;
  serverSummary: (server: McpServerConfig) => string;
}

export function useMcpServerForm(): UseMcpServerFormReturn {
  const showModal = useUiStore((s) => s.showMcpModal);
  const setShowModal = useUiStore((s) => s.setShowMcpModal);
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const { servers, loading, error, loadServers, addServer, updateServer, removeServer } =
    useMcpStore();

  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [editingServer, setEditingServer] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [revealedEnv, setRevealedEnv] = useState<Set<string>>(new Set());
  const [setupHint, setSetupHint] = useState("");
  const [fieldHints, setFieldHints] = useState<Record<string, string>>({});
  const [configEditor, setConfigEditor] = useState<ConfigEditorState | null>(null);

  const hasProject = Boolean(activeProjectPath);

  useEffect(() => {
    if (showModal) {
      loadServers(activeProjectPath ?? undefined);
      setEditingServer(null);
      setConfirmDelete(null);
      setRevealedEnv(new Set());
      setConfigEditor(null);
    }
  }, [showModal, activeProjectPath, loadServers]);

  const filteredServers = servers.filter((s) => {
    if (scopeFilter === "all") return true;
    return s.scope === scopeFilter;
  });

  const existingNames = new Set(
    servers
      .filter((s) => s.scope === form.scope)
      .map((s) => s.name)
  );

  const handleAdd = (): void => {
    setEditingServer("__picking__");
  };

  const handleSelectTemplate = (template: McpTemplate): void => {
    const scope = hasProject ? "project" : "global";
    setForm(templateToForm(template, scope));
    setSetupHint(template.setupHint ?? "");
    setFieldHints(template.fieldHints ? { ...template.fieldHints } : {});
    setEditingServer("__new__");
  };

  const handleManualAdd = (): void => {
    setForm({ ...EMPTY_FORM, scope: hasProject ? "project" : "global" });
    setSetupHint("");
    setFieldHints({});
    setEditingServer("__new__");
  };

  const handleEdit = (server: McpServerConfig): void => {
    setForm(serverToForm(server));
    setSetupHint("");
    setFieldHints({});
    setEditingServer(server.name);
  };

  const handleSave = async (): Promise<void> => {
    const server = formToServer(form);
    try {
      if (editingServer === "__new__") {
        await addServer(activeProjectPath ?? null, server);
      } else {
        await updateServer(activeProjectPath ?? null, editingServer!, server);
      }
      setEditingServer(null);
    } catch {
      // error is set in store
    }
  };

  const handleCancelEdit = (): void => {
    setEditingServer(
      editingServer === "__new__" ? "__picking__" : null
    );
  };

  const handleShowConfigFile = useCallback(async (scope: McpScope): Promise<void> => {
    try {
      const filePath = await getMcpConfigPath(scope, activeProjectPath ?? undefined);
      const content = await readFileContent(filePath);
      setConfigEditor({
        filePath,
        originalContent: content,
        editedContent: content,
        scope,
      });
    } catch (err) {
      showToast(`Failed to open config file: ${err}`, "error");
    }
  }, [activeProjectPath]);

  const handleSaveConfigFile = useCallback(async (): Promise<void> => {
    if (!configEditor) return;
    try {
      JSON.parse(configEditor.editedContent);
    } catch {
      showToast("Invalid JSON — please fix syntax errors before saving", "error");
      return;
    }
    try {
      await writeFileContent(configEditor.filePath, configEditor.editedContent);
      await loadServers(activeProjectPath ?? undefined);
      setConfigEditor(null);
      setEditingServer(null);
      showToast("Config file saved", "success");
    } catch (err) {
      showToast(`Failed to save config file: ${err}`, "error");
    }
  }, [configEditor, activeProjectPath, loadServers]);

  const handleDelete = async (name: string, scope: McpScope): Promise<void> => {
    try {
      await removeServer(activeProjectPath ?? null, name, scope);
      setConfirmDelete(null);
    } catch {
      // error is set in store
    }
  };

  const toggleEnvReveal = (name: string): void => {
    setRevealedEnv((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const serverSummary = (server: McpServerConfig): string => {
    if (server.serverType === "stdio") {
      const parts = [server.command, ...(server.args ?? [])].filter(Boolean);
      return parts.join(" ");
    }
    return server.url ?? "";
  };

  return {
    showModal,
    setShowModal,
    activeProjectPath,
    servers,
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
    configEditor,
    setConfigEditor,
    hasProject,
    existingNames,
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
  };
}
