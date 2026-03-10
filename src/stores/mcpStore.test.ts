import { describe, it, expect, beforeEach, vi } from "vitest";
import { useMcpStore } from "./mcpStore";
import type { McpServerConfig } from "../types/mcp";

// Mock tauri-commands
const mockGetMcpServers = vi.fn();
const mockSaveMcpServer = vi.fn();
const mockDeleteMcpServer = vi.fn();
const mockRenameMcpServer = vi.fn();

vi.mock("../lib/tauri-commands", () => ({
  getMcpServers: (...args: unknown[]) => mockGetMcpServers(...args),
  saveMcpServer: (...args: unknown[]) => mockSaveMcpServer(...args),
  deleteMcpServer: (...args: unknown[]) => mockDeleteMcpServer(...args),
  renameMcpServer: (...args: unknown[]) => mockRenameMcpServer(...args),
}));

const STDIO_SERVER: McpServerConfig = {
  name: "context7",
  scope: "global",
  serverType: "stdio",
  command: "npx",
  args: ["-y", "@upstash/context7-mcp"],
};

const HTTP_SERVER: McpServerConfig = {
  name: "remote-api",
  scope: "project",
  serverType: "http",
  url: "https://api.example.com/mcp/",
  headers: { Authorization: "Bearer tok123" },
};

describe("mcpStore", () => {
  beforeEach(() => {
    useMcpStore.setState({
      servers: [],
      loading: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  // ────── loadServers ──────

  describe("loadServers", () => {
    it("sets loading true while fetching", async () => {
      mockGetMcpServers.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 10))
      );
      const promise = useMcpStore.getState().loadServers("/project");
      expect(useMcpStore.getState().loading).toBe(true);
      await promise;
      expect(useMcpStore.getState().loading).toBe(false);
    });

    it("populates servers on success", async () => {
      mockGetMcpServers.mockResolvedValue([STDIO_SERVER, HTTP_SERVER]);
      await useMcpStore.getState().loadServers("/project");

      const { servers, loading, error } = useMcpStore.getState();
      expect(servers).toHaveLength(2);
      expect(servers[0].name).toBe("context7");
      expect(servers[1].name).toBe("remote-api");
      expect(loading).toBe(false);
      expect(error).toBeNull();
    });

    it("passes projectPath to getMcpServers", async () => {
      mockGetMcpServers.mockResolvedValue([]);
      await useMcpStore.getState().loadServers("/my/project");
      expect(mockGetMcpServers).toHaveBeenCalledWith("/my/project");
    });

    it("calls getMcpServers with undefined when no projectPath", async () => {
      mockGetMcpServers.mockResolvedValue([]);
      await useMcpStore.getState().loadServers();
      expect(mockGetMcpServers).toHaveBeenCalledWith(undefined);
    });

    it("sets error on failure", async () => {
      mockGetMcpServers.mockRejectedValue(new Error("File not found"));
      await useMcpStore.getState().loadServers();

      const { servers, loading, error } = useMcpStore.getState();
      expect(servers).toHaveLength(0);
      expect(loading).toBe(false);
      expect(error).toContain("File not found");
    });

    it("clears previous error on new load", async () => {
      useMcpStore.setState({ error: "previous error" });
      mockGetMcpServers.mockResolvedValue([STDIO_SERVER]);
      await useMcpStore.getState().loadServers();
      expect(useMcpStore.getState().error).toBeNull();
    });

    it("returns empty array for no servers", async () => {
      mockGetMcpServers.mockResolvedValue([]);
      await useMcpStore.getState().loadServers();
      expect(useMcpStore.getState().servers).toHaveLength(0);
    });
  });

  // ────── addServer ──────

  describe("addServer", () => {
    it("calls saveMcpServer then reloads", async () => {
      mockSaveMcpServer.mockResolvedValue(undefined);
      mockGetMcpServers.mockResolvedValue([STDIO_SERVER]);

      await useMcpStore.getState().addServer("/project", STDIO_SERVER);

      expect(mockSaveMcpServer).toHaveBeenCalledWith("/project", STDIO_SERVER);
      expect(mockGetMcpServers).toHaveBeenCalled();
      expect(useMcpStore.getState().servers).toHaveLength(1);
    });

    it("passes null projectPath for global servers", async () => {
      mockSaveMcpServer.mockResolvedValue(undefined);
      mockGetMcpServers.mockResolvedValue([STDIO_SERVER]);

      await useMcpStore.getState().addServer(null, STDIO_SERVER);

      expect(mockSaveMcpServer).toHaveBeenCalledWith(null, STDIO_SERVER);
    });

    it("sets error and throws on failure", async () => {
      mockSaveMcpServer.mockRejectedValue(new Error("Write failed"));

      await expect(
        useMcpStore.getState().addServer(null, STDIO_SERVER)
      ).rejects.toThrow("Write failed");
      expect(useMcpStore.getState().error).toContain("Write failed");
    });

    it("clears error before attempting save", async () => {
      useMcpStore.setState({ error: "old error" });
      mockSaveMcpServer.mockResolvedValue(undefined);
      mockGetMcpServers.mockResolvedValue([]);

      await useMcpStore.getState().addServer(null, STDIO_SERVER);
      expect(useMcpStore.getState().error).toBeNull();
    });
  });

  // ────── updateServer ──────

  describe("updateServer", () => {
    it("saves without rename when name unchanged", async () => {
      mockSaveMcpServer.mockResolvedValue(undefined);
      mockGetMcpServers.mockResolvedValue([STDIO_SERVER]);

      await useMcpStore.getState().updateServer("/project", "context7", STDIO_SERVER);

      expect(mockRenameMcpServer).not.toHaveBeenCalled();
      expect(mockSaveMcpServer).toHaveBeenCalledWith("/project", STDIO_SERVER);
      expect(mockGetMcpServers).toHaveBeenCalled();
    });

    it("renames then saves when name changed", async () => {
      const renamedServer = { ...STDIO_SERVER, name: "context7-v2" };
      mockRenameMcpServer.mockResolvedValue(undefined);
      mockSaveMcpServer.mockResolvedValue(undefined);
      mockGetMcpServers.mockResolvedValue([renamedServer]);

      await useMcpStore.getState().updateServer("/project", "context7", renamedServer);

      expect(mockRenameMcpServer).toHaveBeenCalledWith(
        "/project", "context7", "context7-v2", "global"
      );
      expect(mockSaveMcpServer).toHaveBeenCalledWith("/project", renamedServer);
    });

    it("sets error and throws on failure", async () => {
      mockSaveMcpServer.mockRejectedValue(new Error("Update failed"));

      await expect(
        useMcpStore.getState().updateServer(null, "context7", STDIO_SERVER)
      ).rejects.toThrow("Update failed");
      expect(useMcpStore.getState().error).toContain("Update failed");
    });

    it("sets error when rename fails", async () => {
      const renamedServer = { ...STDIO_SERVER, name: "new-name" };
      mockRenameMcpServer.mockRejectedValue(new Error("Rename failed"));

      await expect(
        useMcpStore.getState().updateServer(null, "context7", renamedServer)
      ).rejects.toThrow("Rename failed");
      expect(useMcpStore.getState().error).toContain("Rename failed");
    });
  });

  // ────── removeServer ──────

  describe("removeServer", () => {
    it("calls deleteMcpServer then reloads", async () => {
      mockDeleteMcpServer.mockResolvedValue(undefined);
      mockGetMcpServers.mockResolvedValue([]);

      await useMcpStore.getState().removeServer("/project", "context7", "global");

      expect(mockDeleteMcpServer).toHaveBeenCalledWith("/project", "context7", "global");
      expect(mockGetMcpServers).toHaveBeenCalled();
      expect(useMcpStore.getState().servers).toHaveLength(0);
    });

    it("handles project scope deletion", async () => {
      mockDeleteMcpServer.mockResolvedValue(undefined);
      mockGetMcpServers.mockResolvedValue([]);

      await useMcpStore.getState().removeServer("/project", "remote-api", "project");

      expect(mockDeleteMcpServer).toHaveBeenCalledWith("/project", "remote-api", "project");
    });

    it("sets error and throws on failure", async () => {
      mockDeleteMcpServer.mockRejectedValue(new Error("Delete failed"));

      await expect(
        useMcpStore.getState().removeServer(null, "ctx", "global")
      ).rejects.toThrow("Delete failed");
      expect(useMcpStore.getState().error).toContain("Delete failed");
    });
  });
});
