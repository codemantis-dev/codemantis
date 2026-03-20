import { useState, useCallback } from "react";
import { handleError } from "../lib/error-handler";
import { AI_MODELS } from "../types/assistant-provider";
import type { AIProvider, APIProvider } from "../types/assistant-provider";

interface UseProviderMenuParams {
  activeProjectPath: string | null;
  activeSessionId: string | null;
  creating: boolean;
  setCreating: (v: boolean) => void;
  apiKeys: Record<string, string>;
  defaultModels: Record<string, string>;
  createAssistant: (
    projectPath: string,
    parentSessionId: string,
    provider: AIProvider,
    model?: string,
  ) => Promise<string>;
}

interface UseProviderMenuReturn {
  showProviderMenu: boolean;
  setShowProviderMenu: (v: boolean) => void;
  expandedProvider: string | null;
  setExpandedProvider: (v: string | null) => void;
  handleCreate: (provider?: AIProvider, model?: string) => Promise<void>;
}

export function useProviderMenu({
  activeProjectPath,
  activeSessionId,
  creating,
  setCreating,
  apiKeys,
  defaultModels,
  createAssistant,
}: UseProviderMenuParams): UseProviderMenuReturn {
  const [showProviderMenu, setShowProviderMenu] = useState(false);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);

  const handleCreate = useCallback(async (provider: AIProvider = "claude-code", model?: string) => {
    if (!activeProjectPath || !activeSessionId || creating) return;

    // Check API key for non-claude-code providers
    if (provider !== "claude-code" && !(apiKeys[provider] ?? "").trim()) {
      return; // shouldn't happen since button is disabled, but guard
    }

    // Use settings default model if none provided
    const resolvedModel = model ?? (
      provider !== "claude-code"
        ? (defaultModels[provider] ?? AI_MODELS[provider as APIProvider]?.[0]?.id)
        : undefined
    );

    setCreating(true);
    setShowProviderMenu(false);
    try {
      await createAssistant(activeProjectPath, activeSessionId, provider, resolvedModel);
    } catch (e) {
      handleError("Failed to create assistant", e);
    } finally {
      setCreating(false);
    }
  }, [activeProjectPath, activeSessionId, creating, createAssistant, apiKeys, defaultModels, setCreating]);

  return {
    showProviderMenu,
    setShowProviderMenu,
    expandedProvider,
    setExpandedProvider,
    handleCreate,
  };
}
