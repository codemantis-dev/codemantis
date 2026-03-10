import { create } from "zustand";
import type { McpServerConfig, McpScope } from "../types/mcp";
import {
  getMcpServers,
  saveMcpServer,
  deleteMcpServer as deleteMcpServerCmd,
  renameMcpServer as renameMcpServerCmd,
} from "../lib/tauri-commands";

interface McpState {
  servers: McpServerConfig[];
  loading: boolean;
  error: string | null;

  loadServers: (projectPath?: string) => Promise<void>;
  addServer: (projectPath: string | null, server: McpServerConfig) => Promise<void>;
  updateServer: (
    projectPath: string | null,
    originalName: string,
    server: McpServerConfig
  ) => Promise<void>;
  removeServer: (
    projectPath: string | null,
    name: string,
    scope: McpScope
  ) => Promise<void>;
}

export const useMcpStore = create<McpState>((set, get) => ({
  servers: [],
  loading: false,
  error: null,

  loadServers: async (projectPath?: string) => {
    set({ loading: true, error: null });
    try {
      const servers = await getMcpServers(projectPath);
      set({ servers, loading: false });
    } catch (e) {
      console.error("Failed to load MCP servers:", e);
      set({ error: String(e), loading: false });
    }
  },

  addServer: async (projectPath, server) => {
    set({ error: null });
    try {
      await saveMcpServer(projectPath, server);
      await get().loadServers(projectPath ?? undefined);
    } catch (e) {
      console.error("Failed to add MCP server:", e);
      set({ error: String(e) });
      throw e;
    }
  },

  updateServer: async (projectPath, originalName, server) => {
    set({ error: null });
    try {
      if (originalName !== server.name) {
        await renameMcpServerCmd(projectPath, originalName, server.name, server.scope);
      }
      await saveMcpServer(projectPath, server);
      await get().loadServers(projectPath ?? undefined);
    } catch (e) {
      console.error("Failed to update MCP server:", e);
      set({ error: String(e) });
      throw e;
    }
  },

  removeServer: async (projectPath, name, scope) => {
    set({ error: null });
    try {
      await deleteMcpServerCmd(projectPath, name, scope);
      await get().loadServers(projectPath ?? undefined);
    } catch (e) {
      console.error("Failed to delete MCP server:", e);
      set({ error: String(e) });
      throw e;
    }
  },
}));
