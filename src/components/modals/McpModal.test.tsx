import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import McpModal from "./McpModal";
import { useUiStore } from "../../stores/uiStore";
import { useMcpStore } from "../../stores/mcpStore";
import { useSessionStore } from "../../stores/sessionStore";
import type { McpServerConfig } from "../../types/mcp";

// Keep reference to mock for per-test configuration
const mockGetMcpServers = vi.fn<(projectPath?: string) => Promise<McpServerConfig[]>>(() => Promise.resolve([]));

const mockGetMcpConfigPath = vi.fn<() => Promise<string>>(() => Promise.resolve("/project/.mcp.json"));
const mockReadFileContent = vi.fn<() => Promise<string>>(() => Promise.resolve('{"mcpServers":{}}'));

vi.mock("../../lib/tauri-commands", () => ({
  getMcpServers: (...args: [string?]) => mockGetMcpServers(...args),
  saveMcpServer: vi.fn(() => Promise.resolve()),
  deleteMcpServer: vi.fn(() => Promise.resolve()),
  renameMcpServer: vi.fn(() => Promise.resolve()),
  getMcpConfigPath: () => mockGetMcpConfigPath(),
  readFileContent: () => mockReadFileContent(),
  writeFileContent: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
  revealItemInDir: vi.fn(() => Promise.resolve()),
}));

import { revealItemInDir } from "@tauri-apps/plugin-opener";

const STDIO_SERVER: McpServerConfig = {
  name: "context7",
  scope: "global",
  serverType: "stdio",
  command: "npx",
  args: ["-y", "@upstash/context7-mcp"],
  env: { API_KEY: "secret123" },
};

const HTTP_SERVER: McpServerConfig = {
  name: "supabase",
  scope: "project",
  serverType: "http",
  url: "https://mcp.supabase.com/mcp",
  headers: { Authorization: "Bearer tok" },
};

const SSE_SERVER: McpServerConfig = {
  name: "events",
  scope: "global",
  serverType: "sse",
  url: "https://sse.example.com",
};

function openModal(
  servers: McpServerConfig[] = [],
  activeProjectPath: string | null = "/project"
): void {
  // Configure mock to return these servers when loadServers fires via useEffect
  mockGetMcpServers.mockResolvedValue(servers);
  useUiStore.setState({ showMcpModal: true });
  useSessionStore.setState({
    activeProjectPath,
    sessions: new Map(),
    sessionMessages: new Map(),
    sessionStreaming: new Map(),
    sessionContext: new Map(),
    tabOrder: [],
  });
}

/** Navigate Add Server → Manual Configuration to reach the blank form */
function clickAddManual(): void {
  fireEvent.click(screen.getByText("Add Server"));
  fireEvent.click(screen.getByText("Manual Configuration"));
}

describe("McpModal", () => {
  beforeEach(() => {
    useUiStore.setState({ showMcpModal: false });
    useMcpStore.setState({ servers: [], loading: false, error: null });
    mockGetMcpServers.mockReset().mockResolvedValue([]);
  });

  // ────── Visibility ──────

  it("does not render when showMcpModal is false", () => {
    render(<McpModal />);
    expect(screen.queryByText("MCP Servers")).not.toBeInTheDocument();
  });

  it("renders when showMcpModal is true", async () => {
    openModal();
    render(<McpModal />);
    expect(await screen.findByText("MCP Servers")).toBeInTheDocument();
  });

  // ────── Empty / Loading States ──────

  it("shows loading text when loading", () => {
    // Use a never-resolving promise so loading stays true
    mockGetMcpServers.mockReturnValue(new Promise(() => {}));
    useUiStore.setState({ showMcpModal: true });
    render(<McpModal />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows empty message when no servers", async () => {
    openModal([]);
    render(<McpModal />);
    expect(await screen.findByText("No MCP servers configured")).toBeInTheDocument();
  });

  it("shows error message when error is set", async () => {
    // Make getMcpServers reject so the error stays in state
    mockGetMcpServers.mockRejectedValue(new Error("File not found"));
    useUiStore.setState({ showMcpModal: true });
    render(<McpModal />);
    expect(await screen.findByText(/File not found/)).toBeInTheDocument();
  });

  // ────── Server List Rendering ──────

  it("renders server names", async () => {
    openModal([STDIO_SERVER, HTTP_SERVER]);
    render(<McpModal />);
    expect(await screen.findByText("context7")).toBeInTheDocument();
    expect(screen.getByText("supabase")).toBeInTheDocument();
  });

  it("renders type badges", async () => {
    openModal([STDIO_SERVER, HTTP_SERVER, SSE_SERVER]);
    render(<McpModal />);
    expect(await screen.findByText("stdio")).toBeInTheDocument();
    expect(screen.getByText("http")).toBeInTheDocument();
    expect(screen.getByText("sse")).toBeInTheDocument();
  });

  it("renders scope badges on server rows", async () => {
    openModal([STDIO_SERVER, HTTP_SERVER]);
    render(<McpModal />);
    await screen.findByText("context7");
    // Scope badges are inside server row containers (rounded-lg border)
    // Filter buttons also say "Global"/"Project", so find badges within server rows
    const serverRows = document.querySelectorAll("[class*='rounded-lg border border-border']");
    expect(serverRows.length).toBe(2);
    // Check that the badges exist within rows
    const firstRowText = serverRows[0].textContent ?? "";
    const secondRowText = serverRows[1].textContent ?? "";
    const allRowText = firstRowText + secondRowText;
    expect(allRowText).toContain("Global");
    expect(allRowText).toContain("Project");
  });

  it("renders command + args for stdio servers", async () => {
    openModal([STDIO_SERVER]);
    render(<McpModal />);
    expect(await screen.findByText("npx -y @upstash/context7-mcp")).toBeInTheDocument();
  });

  it("renders url for http servers", async () => {
    openModal([HTTP_SERVER]);
    render(<McpModal />);
    expect(await screen.findByText("https://mcp.supabase.com/mcp")).toBeInTheDocument();
  });

  it("renders url for sse servers", async () => {
    openModal([SSE_SERVER]);
    render(<McpModal />);
    expect(await screen.findByText("https://sse.example.com")).toBeInTheDocument();
  });

  // ────── Env Var Masking ──────

  it("masks env var values by default", async () => {
    openModal([STDIO_SERVER]);
    render(<McpModal />);
    // Wait for load
    await screen.findByText("context7");
    // Should show the key
    expect(screen.getByText("API_KEY=")).toBeInTheDocument();
    // Should show masked value
    expect(screen.getByText("••••••")).toBeInTheDocument();
    // Should NOT show the actual value
    expect(screen.queryByText("secret123")).not.toBeInTheDocument();
  });

  // ────── Scope Filter ──────

  it("renders scope filter buttons", async () => {
    openModal([STDIO_SERVER, HTTP_SERVER]);
    render(<McpModal />);
    await screen.findByText("context7");
    expect(screen.getByText("All")).toBeInTheDocument();
    expect(screen.getByText("Global", { selector: "button" })).toBeInTheDocument();
  });

  it("shows project filter when project is active", async () => {
    openModal([STDIO_SERVER, HTTP_SERVER], "/my/project");
    render(<McpModal />);
    await screen.findByText("context7");
    const filterButtons = screen.getAllByRole("button");
    const projectFilterBtn = filterButtons.find(
      (btn) => btn.textContent === "Project" && !btn.closest("[class*='rounded-lg border']")
    );
    expect(projectFilterBtn).toBeTruthy();
  });

  it("filters to only global servers when Global filter clicked", async () => {
    openModal([STDIO_SERVER, HTTP_SERVER]);
    render(<McpModal />);
    await screen.findByText("context7");

    // Click "Global" filter button (not the scope badge in a server row)
    const filterButtons = screen.getAllByRole("button");
    const globalFilter = filterButtons.find(
      (btn) => btn.textContent === "Global" && !btn.closest("[class*='rounded-lg border']")
    );
    fireEvent.click(globalFilter!);

    expect(screen.getByText("context7")).toBeInTheDocument();
    expect(screen.queryByText("supabase")).not.toBeInTheDocument();
  });

  // ────── Template Picker ──────

  it("shows template picker when Add Server clicked", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    fireEvent.click(screen.getByText("Add Server"));

    expect(screen.getByText("Choose a template or configure manually")).toBeInTheDocument();
  });

  it("shows all three category headings in picker", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    fireEvent.click(screen.getByText("Add Server"));

    expect(screen.getByText("No Setup Required")).toBeInTheDocument();
    expect(screen.getByText("Requires API Key")).toBeInTheDocument();
    expect(screen.getByText("Cloud Services")).toBeInTheDocument();
  });

  it("shows template cards for each category", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    fireEvent.click(screen.getByText("Add Server"));

    // No-auth
    expect(screen.getByText("Context7")).toBeInTheDocument();
    expect(screen.getByText("Playwright")).toBeInTheDocument();
    // API key
    expect(screen.getByText("Brave Search")).toBeInTheDocument();
    expect(screen.getByText("Stripe")).toBeInTheDocument();
    // Cloud
    expect(screen.getByText("Sentry")).toBeInTheDocument();
    expect(screen.getByText("Neon")).toBeInTheDocument();
  });

  it("shows Manual Configuration option in picker", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    fireEvent.click(screen.getByText("Add Server"));

    expect(screen.getByText("Manual Configuration")).toBeInTheDocument();
    expect(screen.getByText("Start with a blank form")).toBeInTheDocument();
  });

  it("selecting template pre-fills form name and command", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    fireEvent.click(screen.getByText("Add Server"));
    fireEvent.click(screen.getByText("Context7"));

    const nameInput = screen.getByPlaceholderText("my-server") as HTMLInputElement;
    expect(nameInput.value).toBe("context7");

    const cmdInput = screen.getByPlaceholderText("npx") as HTMLInputElement;
    expect(cmdInput.value).toBe("npx");

    const argsInput = screen.getByPlaceholderText("-y, @package/name") as HTMLInputElement;
    expect(argsInput.value).toBe("-y, @upstash/context7-mcp");
  });

  it("selecting template with env vars shows them pre-filled with hints", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    fireEvent.click(screen.getByText("Add Server"));
    fireEvent.click(screen.getByText("Brave Search"));

    // Should show an env var row with the key pre-filled
    const keyInputs = screen.getAllByPlaceholderText("Key");
    expect(keyInputs.length).toBeGreaterThanOrEqual(1);
    expect((keyInputs[0] as HTMLInputElement).value).toBe("BRAVE_API_KEY");

    // Value field should have the fieldHint as placeholder, not generic "Value"
    expect(screen.getByPlaceholderText("BSAxxxxxxxxxxxxxxxxxxxxxxxx")).toBeInTheDocument();
  });

  it("selecting HTTP template shows URL field pre-filled", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    fireEvent.click(screen.getByText("Add Server"));
    fireEvent.click(screen.getByText("Sentry"));

    const urlInput = screen.getByPlaceholderText("https://api.example.com/mcp/") as HTMLInputElement;
    expect(urlInput.value).toBe("https://mcp.sentry.dev/mcp");
  });

  it("selecting Supabase template shows HTTP type with URL and auth header hint", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    fireEvent.click(screen.getByText("Add Server"));
    fireEvent.click(screen.getByText("Supabase"));

    const urlInput = screen.getByPlaceholderText("https://api.example.com/mcp/") as HTMLInputElement;
    expect(urlInput.value).toBe("https://mcp.supabase.com/mcp");
    // Should not show stdio fields
    expect(screen.queryByPlaceholderText("npx")).not.toBeInTheDocument();
    // Authorization header should be pre-filled with hint placeholder
    const keyInputs = screen.getAllByPlaceholderText("Key");
    expect((keyInputs[0] as HTMLInputElement).value).toBe("Authorization");
    expect(screen.getByPlaceholderText("Bearer sbp_xxxxxxxxxxxxxxxxxxxx")).toBeInTheDocument();
  });

  it("shows setup hint when template has one", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    fireEvent.click(screen.getByText("Add Server"));
    fireEvent.click(screen.getByText("Brave Search"));

    expect(screen.getByText(/free API key at brave\.com/)).toBeInTheDocument();
  });

  it("does not show setup hint for manual config", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();

    // No hint boxes should be shown
    expect(screen.queryByText(/Personal Access Token/)).not.toBeInTheDocument();
  });

  it("shows type description text", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();

    expect(screen.getByText(/Runs a local process on your machine/)).toBeInTheDocument();
  });

  it("Manual Configuration opens blank form", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();

    const nameInput = screen.getByPlaceholderText("my-server") as HTMLInputElement;
    expect(nameInput.value).toBe("");

    const cmdInput = screen.getByPlaceholderText("npx") as HTMLInputElement;
    expect(cmdInput.value).toBe("");
  });

  it("cancel from pre-filled form returns to picker", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    fireEvent.click(screen.getByText("Add Server"));
    fireEvent.click(screen.getByText("Context7"));

    // Now on the form — click Cancel
    fireEvent.click(screen.getByText("Cancel"));

    // Should be back at picker, not at server list
    expect(screen.getByText("Choose a template or configure manually")).toBeInTheDocument();
    expect(screen.getByText("Manual Configuration")).toBeInTheDocument();
  });

  it("cancel from edit form returns to server list", async () => {
    openModal([STDIO_SERVER]);
    render(<McpModal />);
    await screen.findByText("context7");

    fireEvent.click(screen.getByTitle("Edit"));
    expect(screen.getByText("Edit MCP Server")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.getByText("context7")).toBeInTheDocument();
    expect(screen.queryByText("Edit MCP Server")).not.toBeInTheDocument();
  });

  // ────── Add Server Form (via Manual) ──────

  it("add form shows name, scope, type fields", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();

    expect(screen.getByPlaceholderText("my-server")).toBeInTheDocument();
    expect(screen.getByText("Scope")).toBeInTheDocument();
    expect(screen.getByText("Type")).toBeInTheDocument();
  });

  it("shows stdio fields by default", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();

    expect(screen.getByPlaceholderText("npx")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("-y, @package/name")).toBeInTheDocument();
  });

  it("save button disabled with empty name", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();

    const addBtn = screen.getByRole("button", { name: "Add Server" });
    expect(addBtn).toBeDisabled();
  });

  it("shows validation error for invalid name characters", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();

    const nameInput = screen.getByPlaceholderText("my-server");
    fireEvent.change(nameInput, { target: { value: "invalid name!" } });

    expect(
      screen.getByText("Only letters, numbers, hyphens, underscores")
    ).toBeInTheDocument();
  });

  it("accepts valid name characters", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();

    const nameInput = screen.getByPlaceholderText("my-server");
    fireEvent.change(nameInput, { target: { value: "my-server_v2" } });

    expect(
      screen.queryByText("Only letters, numbers, hyphens, underscores")
    ).not.toBeInTheDocument();
  });

  it("shows duplicate name error", async () => {
    openModal([STDIO_SERVER]);
    render(<McpModal />);
    await screen.findByText("context7");
    clickAddManual();

    const nameInput = screen.getByPlaceholderText("my-server");
    fireEvent.change(nameInput, { target: { value: "context7" } });

    const globalRadio = screen.getByLabelText("Global");
    fireEvent.click(globalRadio);

    expect(
      screen.getByText("A server with this name already exists in this scope")
    ).toBeInTheDocument();
  });

  // ────── Edit Server Form ──────

  it("opens edit form when pencil clicked", async () => {
    openModal([STDIO_SERVER]);
    render(<McpModal />);
    await screen.findByText("context7");

    const editBtn = screen.getByTitle("Edit");
    fireEvent.click(editBtn);

    expect(screen.getByText("Edit MCP Server")).toBeInTheDocument();
  });

  it("edit form populates with server data", async () => {
    openModal([STDIO_SERVER]);
    render(<McpModal />);
    await screen.findByText("context7");

    const editBtn = screen.getByTitle("Edit");
    fireEvent.click(editBtn);

    const nameInput = screen.getByPlaceholderText("my-server") as HTMLInputElement;
    expect(nameInput.value).toBe("context7");
    expect(nameInput).toBeDisabled();

    const cmdInput = screen.getByPlaceholderText("npx") as HTMLInputElement;
    expect(cmdInput.value).toBe("npx");
  });

  // ────── Delete Confirmation ──────

  it("shows inline delete confirmation when trash clicked", async () => {
    openModal([STDIO_SERVER]);
    render(<McpModal />);
    await screen.findByText("context7");

    const deleteBtn = screen.getByTitle("Delete");
    fireEvent.click(deleteBtn);

    expect(screen.getByText("Delete")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("cancels delete on Cancel click", async () => {
    openModal([STDIO_SERVER]);
    render(<McpModal />);
    await screen.findByText("context7");

    fireEvent.click(screen.getByTitle("Delete"));
    fireEvent.click(screen.getByText("Cancel"));

    expect(screen.getByText("context7")).toBeInTheDocument();
    expect(screen.getByTitle("Delete")).toBeInTheDocument();
  });

  // ────── Footer ──────

  it("shows config file paths in footer", async () => {
    openModal([STDIO_SERVER], "/my/project");
    await act(async () => {
      render(<McpModal />);
    });
    expect(screen.getByText(/~\/\.claude\.json/)).toBeInTheDocument();
    expect(screen.getByText(/\/my\/project\/\.mcp\.json/)).toBeInTheDocument();
  });

  it("hides project path in footer when no project", async () => {
    openModal([STDIO_SERVER], null);
    await act(async () => {
      render(<McpModal />);
    });
    expect(screen.getByText(/~\/\.claude\.json/)).toBeInTheDocument();
    expect(screen.queryByText(/\.mcp\.json/)).not.toBeInTheDocument();
  });

  it("hides footer when in picker", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    fireEvent.click(screen.getByText("Add Server"));
    expect(screen.queryByText(/~\/\.claude\.json/)).not.toBeInTheDocument();
  });

  // ────── Type switching ──────

  it("shows URL field when type changed to http", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();

    const typeSelect = screen.getByDisplayValue("stdio");
    fireEvent.change(typeSelect, { target: { value: "http" } });

    expect(screen.getByPlaceholderText("https://api.example.com/mcp/")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("npx")).not.toBeInTheDocument();
  });

  it("shows URL field when type changed to sse", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();

    const typeSelect = screen.getByDisplayValue("stdio");
    fireEvent.change(typeSelect, { target: { value: "sse" } });

    expect(screen.getByPlaceholderText("https://mcp.example.com/sse")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("npx")).not.toBeInTheDocument();
  });

  // ────── Multiple Servers ──────

  it("renders all three server types together", async () => {
    openModal([STDIO_SERVER, HTTP_SERVER, SSE_SERVER]);
    render(<McpModal />);
    expect(await screen.findByText("context7")).toBeInTheDocument();
    expect(screen.getByText("supabase")).toBeInTheDocument();
    expect(screen.getByText("events")).toBeInTheDocument();
  });

  it("filter shows no match message when filter excludes all", async () => {
    // Only global servers, filter to project
    openModal([STDIO_SERVER, SSE_SERVER], "/project");
    render(<McpModal />);
    await screen.findByText("context7");

    // Find and click the Project filter button (not scope badge)
    const allButtons = screen.getAllByRole("button");
    const projectFilter = allButtons.find(
      (btn) => btn.textContent === "Project" && !btn.closest("[class*='rounded-lg border']")
    );
    fireEvent.click(projectFilter!);

    expect(screen.getByText("No servers match this filter")).toBeInTheDocument();
  });

  // ────── Scope radio ──────

  it("defaults scope to project when project is active on add", async () => {
    openModal([], "/my/project");
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();

    const projectRadio = screen.getByLabelText("Project") as HTMLInputElement;
    expect(projectRadio.checked).toBe(true);
  });

  it("defaults scope to global when no project on add", async () => {
    openModal([], null);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();

    const globalRadio = screen.getByLabelText("Global") as HTMLInputElement;
    expect(globalRadio.checked).toBe(true);
  });

  it("hides project radio when no project is active", async () => {
    openModal([], null);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();

    expect(screen.queryByLabelText("Project")).not.toBeInTheDocument();
  });

  // ────── Env var rows ──────

  it("shows add variable button for stdio type", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();

    expect(screen.getByText("+ Add environment variable")).toBeInTheDocument();
  });

  it("adds env var row when button clicked", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();
    fireEvent.click(screen.getByText("+ Add environment variable"));

    expect(screen.getAllByPlaceholderText("Key")).toHaveLength(1);
    expect(screen.getAllByPlaceholderText("Value")).toHaveLength(1);
  });

  // ────── Headers for http type ──────

  it("shows add header button for http type", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();

    const typeSelect = screen.getByDisplayValue("stdio");
    fireEvent.change(typeSelect, { target: { value: "http" } });

    expect(screen.getByText("+ Add header")).toBeInTheDocument();
  });

  // ────── Headers for sse type ──────

  it("shows add header button for sse type", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();

    const typeSelect = screen.getByDisplayValue("stdio");
    fireEvent.change(typeSelect, { target: { value: "sse" } });

    expect(screen.getByText("+ Add header")).toBeInTheDocument();
  });

  it("edit form shows headers for SSE server with existing headers", async () => {
    const sseWithHeaders: McpServerConfig = {
      name: "sse-auth",
      scope: "global",
      serverType: "sse",
      url: "https://sse.example.com",
      headers: { Authorization: "Bearer tok" },
    };
    openModal([sseWithHeaders]);
    render(<McpModal />);
    await screen.findByText("sse-auth");

    fireEvent.click(screen.getByTitle("Edit"));

    const keyInputs = screen.getAllByPlaceholderText("Key");
    expect(keyInputs.length).toBeGreaterThanOrEqual(1);
    expect((keyInputs[0] as HTMLInputElement).value).toBe("Authorization");
  });

  // ────── Bug 1: Template displayName in title ──────

  it("shows template displayName in form when template selected", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    fireEvent.click(screen.getByText("Add Server"));
    fireEvent.click(screen.getByText("Fetch"));

    expect(screen.getByText("Add MCP Server")).toBeInTheDocument();
    expect(screen.getByText(/Template: Fetch/)).toBeInTheDocument();
  });

  it("shows generic title for manual configuration", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();

    expect(screen.getByText("Add MCP Server")).toBeInTheDocument();
    expect(screen.queryByText(/Template:/)).not.toBeInTheDocument();
  });

  // ────── Bug 2: Show config file with missing file ──────

  it("does not show error toast when config file does not exist", async () => {
    mockReadFileContent.mockRejectedValueOnce(new Error("File not found"));
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();

    fireEvent.click(screen.getByText("Show config file"));

    // Wait for async handling to complete
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Should NOT show the error toast — gracefully falls back to empty template
    expect(screen.queryByText(/Failed to open config file/)).not.toBeInTheDocument();
  });

  // ────── Bug 3: Text selection in modal ──────

  it("modal body has select-text class for text selection", async () => {
    openModal([]);
    await act(async () => {
      render(<McpModal />);
    });

    const body = document.querySelector(".select-text");
    expect(body).not.toBeNull();
  });

  // ────── Bug 4: Docs link ──────

  it("shows docs link when template with docsUrl selected", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    fireEvent.click(screen.getByText("Add Server"));
    fireEvent.click(screen.getByText("Context7"));

    expect(screen.getByText("Docs")).toBeInTheDocument();
  });

  it("does not show docs link for manual configuration", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();

    expect(screen.queryByText("Docs")).not.toBeInTheDocument();
  });

  // ────── Back Arrow Navigation ──────

  it("does not show back arrow on server list view", async () => {
    openModal([STDIO_SERVER]);
    render(<McpModal />);
    await screen.findByText("context7");

    expect(screen.queryByLabelText("Go back")).not.toBeInTheDocument();
  });

  it("shows back arrow on template picker", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    fireEvent.click(screen.getByText("Add Server"));

    expect(screen.getByLabelText("Go back")).toBeInTheDocument();
  });

  it("shows back arrow on add form", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();

    expect(screen.getByLabelText("Go back")).toBeInTheDocument();
  });

  it("shows back arrow on edit form", async () => {
    openModal([STDIO_SERVER]);
    render(<McpModal />);
    await screen.findByText("context7");

    fireEvent.click(screen.getByTitle("Edit"));

    expect(screen.getByLabelText("Go back")).toBeInTheDocument();
  });

  it("back arrow from template picker returns to server list", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    fireEvent.click(screen.getByText("Add Server"));

    expect(screen.getByText("Choose a template or configure manually")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Go back"));

    expect(screen.queryByText("Choose a template or configure manually")).not.toBeInTheDocument();
    expect(screen.getByText("No MCP servers configured")).toBeInTheDocument();
  });

  it("back arrow from add form returns to template picker", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();

    expect(screen.getByPlaceholderText("my-server")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Go back"));

    expect(screen.getByText("Choose a template or configure manually")).toBeInTheDocument();
  });

  it("back arrow from edit form returns to server list", async () => {
    openModal([STDIO_SERVER]);
    render(<McpModal />);
    await screen.findByText("context7");

    fireEvent.click(screen.getByTitle("Edit"));
    expect(screen.getByText("Edit MCP Server")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Go back"));

    expect(screen.queryByText("Edit MCP Server")).not.toBeInTheDocument();
    expect(screen.getByText("context7")).toBeInTheDocument();
  });

  // ────── Header Title ──────

  it("shows 'Add MCP Server' title on template picker", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    fireEvent.click(screen.getByText("Add Server"));

    expect(screen.getByText("Add MCP Server")).toBeInTheDocument();
  });

  // ────── X Close Button ──────

  it("X close button is always visible on template picker", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    fireEvent.click(screen.getByText("Add Server"));

    expect(screen.getByLabelText("Close MCP servers dialog")).toBeInTheDocument();
  });

  it("X close button is always visible on form view", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();

    expect(screen.getByLabelText("Close MCP servers dialog")).toBeInTheDocument();
  });

  // ────── Footer Pinned Action Bars ──────

  it("shows pinned Cancel and Save in footer for add form", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();

    expect(screen.getByText("Cancel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Server" })).toBeInTheDocument();
    expect(screen.getByText("Show config file")).toBeInTheDocument();
  });

  it("shows pinned Cancel and Save Changes in footer for edit form", async () => {
    openModal([STDIO_SERVER]);
    render(<McpModal />);
    await screen.findByText("context7");

    fireEvent.click(screen.getByTitle("Edit"));

    expect(screen.getByText("Cancel")).toBeInTheDocument();
    expect(screen.getByText("Save Changes")).toBeInTheDocument();
  });

  it("Add Server button is disabled when form is empty", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();

    const addBtn = screen.getByRole("button", { name: "Add Server" });
    expect(addBtn).toBeDisabled();
  });

  it("Add Server button enabled when form is valid", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();

    const nameInput = screen.getByPlaceholderText("my-server");
    fireEvent.change(nameInput, { target: { value: "test-server" } });

    const cmdInput = screen.getByPlaceholderText("npx");
    fireEvent.change(cmdInput, { target: { value: "node" } });

    const addBtn = screen.getByRole("button", { name: "Add Server" });
    expect(addBtn).not.toBeDisabled();
  });

  it("clicking Cancel in form footer returns to template picker", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();

    fireEvent.click(screen.getByText("Cancel"));

    expect(screen.getByText("Choose a template or configure manually")).toBeInTheDocument();
  });

  // ────── Config Editor Footer ──────

  it("config editor shows Cancel and Save in footer", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();

    await act(async () => {
      fireEvent.click(screen.getByText("Show config file"));
    });

    // Wait for the config editor to load
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(screen.getByText("Cancel")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeInTheDocument();
  });

  it("config editor Cancel returns to form", async () => {
    openModal([]);
    render(<McpModal />);
    await screen.findByText("No MCP servers configured");
    clickAddManual();

    await act(async () => {
      fireEvent.click(screen.getByText("Show config file"));
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Click Cancel in the config editor footer
    fireEvent.click(screen.getByText("Cancel"));

    // Should be back on the form — Name field should be visible
    expect(screen.getByPlaceholderText("my-server")).toBeInTheDocument();
  });

  // ────── Reveal in Finder ──────

  it("clicking global reveal button calls revealItemInDir", async () => {
    openModal([STDIO_SERVER], "/project");
    await act(async () => {
      render(<McpModal />);
    });
    await screen.findByText("context7");

    const revealButtons = screen.getAllByTitle("Reveal in Finder");
    await act(async () => {
      fireEvent.click(revealButtons[0]);
    });

    expect(vi.mocked(revealItemInDir)).toHaveBeenCalled();
  });

  it("shows error toast when reveal fails", async () => {
    vi.mocked(revealItemInDir).mockRejectedValueOnce(new Error("No such file"));
    openModal([STDIO_SERVER], "/project");
    await act(async () => {
      render(<McpModal />);
    });
    await screen.findByText("context7");

    const revealButtons = screen.getAllByTitle("Reveal in Finder");
    await act(async () => {
      fireEvent.click(revealButtons[0]);
    });

    // The toast store should contain the error
    const { useToastStore } = await import("../../stores/toastStore");
    const toasts = useToastStore.getState().toasts;
    expect(toasts.some((t) => t.message.includes("Failed to open folder"))).toBe(true);
  });

  // ────── Env Var Reveal Toggle ──────

  it("toggles env var visibility on click", async () => {
    openModal([STDIO_SERVER]);
    render(<McpModal />);
    await screen.findByText("context7");

    // Should show masked value by default
    expect(screen.getByText("••••••")).toBeInTheDocument();
    expect(screen.queryByText("secret123")).not.toBeInTheDocument();

    // Find the eye toggle button — it's a sibling of "API_KEY=" inside the outer env var span
    const keySpan = screen.getByText("API_KEY=");
    const outerSpan = keySpan.parentElement!;
    const toggleButton = outerSpan.querySelector("button")!;
    fireEvent.click(toggleButton);

    // Now the value should be revealed
    expect(screen.getByText("secret123")).toBeInTheDocument();
    expect(screen.queryByText("••••••")).not.toBeInTheDocument();
  });
});
