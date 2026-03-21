import type { McpServerType } from "./mcp";

export interface McpTemplate {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly icon: string;
  readonly category: "no-auth" | "api-key" | "cloud";
  readonly serverType: McpServerType;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly setupHint?: string;
  /** Maps env var / header key names → placeholder text shown in the value field */
  readonly fieldHints?: Readonly<Record<string, string>>;
  /** URL to the server's documentation or GitHub page */
  readonly docsUrl?: string;
}

export interface McpTemplateCategory {
  readonly id: "no-auth" | "api-key" | "cloud";
  readonly label: string;
  readonly description: string;
}

export const MCP_TEMPLATE_CATEGORIES: readonly McpTemplateCategory[] = [
  {
    id: "no-auth",
    label: "No Setup Required",
    description: "Ready to use immediately",
  },
  {
    id: "api-key",
    label: "Requires API Key",
    description: "Provide your credentials to connect",
  },
  {
    id: "cloud",
    label: "Cloud Services",
    description: "HTTP-based cloud integrations — auth via browser OAuth",
  },
] as const;

export const MCP_TEMPLATES: readonly McpTemplate[] = [
  // ── No Setup Required ──
  {
    id: "context7",
    displayName: "Context7",
    description: "Documentation lookup for any library",
    icon: "\u{1F4DA}",
    category: "no-auth",
    serverType: "stdio",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    setupHint: "Ready to use — no configuration needed.",
    docsUrl: "https://github.com/upstash/context7#readme",
  },
  {
    id: "playwright",
    displayName: "Playwright",
    description: "Browser automation and testing",
    icon: "\u{1F3AD}",
    category: "no-auth",
    serverType: "stdio",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
    setupHint: "Ready to use — launches a browser for automation tasks.",
    docsUrl: "https://github.com/microsoft/playwright-mcp#readme",
  },
  {
    id: "browsermcp",
    displayName: "BrowserMCP",
    description: "Browser control via Chrome extension",
    icon: "\u{1F310}",
    category: "no-auth",
    serverType: "stdio",
    command: "npx",
    args: ["-y", "@browsermcp/mcp@latest"],
    setupHint: "Requires the BrowserMCP Chrome extension installed in your browser.",
    docsUrl: "https://github.com/BrowserMCP/mcp#readme",
  },
  {
    id: "fetch",
    displayName: "Fetch",
    description: "Fetch web content as markdown",
    icon: "\u{1F4E5}",
    category: "no-auth",
    serverType: "stdio",
    command: "uvx",
    args: ["mcp-server-fetch"],
    setupHint: "Requires uv installed (curl -LsSf https://astral.sh/uv/install.sh | sh). Fetches any URL and converts it to readable markdown.",
    docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
  },
  {
    id: "filesystem",
    displayName: "Filesystem",
    description: "Read/write files in allowed directories",
    icon: "\u{1F4C1}",
    category: "no-auth",
    serverType: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    setupHint: "Add allowed directory paths to Arguments after the package name (e.g. …server-filesystem, /Users/you/Documents). Only absolute paths are allowed.",
    docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
  },
  {
    id: "memory",
    displayName: "Memory",
    description: "Persistent memory via knowledge graph",
    icon: "\u{1F9E0}",
    category: "no-auth",
    serverType: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    setupHint: "Ready to use — stores and recalls information across conversations.",
    docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
  },

  // ── Requires API Key ──
  {
    id: "brave-search",
    displayName: "Brave Search",
    description: "Web search via Brave Search API",
    icon: "\u{1F981}",
    category: "api-key",
    serverType: "stdio",
    command: "npx",
    args: ["-y", "@brave/brave-search-mcp-server"],
    env: { BRAVE_API_KEY: "" },
    fieldHints: { BRAVE_API_KEY: "BSAxxxxxxxxxxxxxxxxxxxxxxxx" },
    setupHint: "Get a free API key at brave.com/search/api — the free tier includes 2,000 queries/month.",
    docsUrl: "https://github.com/brave/brave-search-mcp-server#readme",
  },
  {
    id: "stripe",
    displayName: "Stripe",
    description: "Stripe payments and billing",
    icon: "\u{1F4B3}",
    category: "api-key",
    serverType: "stdio",
    command: "npx",
    args: ["-y", "@stripe/mcp", "--tools=all"],
    env: { STRIPE_SECRET_KEY: "" },
    fieldHints: { STRIPE_SECRET_KEY: "sk_test_... or rk_..." },
    setupHint: "Get your key at dashboard.stripe.com/apikeys. Use a restricted key (rk_*) for better security.",
    docsUrl: "https://github.com/stripe/agent-toolkit/tree/main/modelcontextprotocol",
  },

  // ── Cloud Services (HTTP, auth via browser OAuth) ──
  {
    id: "supabase",
    displayName: "Supabase",
    description: "Supabase database, auth, and storage",
    icon: "\u26A1",
    category: "cloud",
    serverType: "http",
    url: "https://mcp.supabase.com/mcp",
    headers: { Authorization: "" },
    fieldHints: { Authorization: "Bearer sbp_xxxxxxxxxxxxxxxxxxxx" },
    setupHint: "Enter your Supabase Personal Access Token in the Authorization header (Bearer sbp_…). To target a specific project, append ?project_ref=YOUR_REF to the URL. Add &read_only=true for read-only access.",
    docsUrl: "https://supabase.com/docs/guides/getting-started/mcp",
  },
  {
    id: "sentry",
    displayName: "Sentry",
    description: "Error tracking and monitoring",
    icon: "\u{1F41B}",
    category: "cloud",
    serverType: "http",
    url: "https://mcp.sentry.dev/mcp",
    setupHint: "No API key needed — authenticates via browser OAuth on first connect. You'll be prompted to sign in to Sentry.",
    docsUrl: "https://github.com/getsentry/sentry-mcp#readme",
  },
  {
    id: "neon",
    displayName: "Neon",
    description: "Serverless Postgres by Neon",
    icon: "\u{1F7E2}",
    category: "cloud",
    serverType: "http",
    url: "https://mcp.neon.tech/mcp",
    setupHint: "Authenticates via browser OAuth on first connect. Alternatively, click + Add header and add Authorization: Bearer YOUR_NEON_API_KEY.",
    docsUrl: "https://neon.tech/docs/ai/mcp",
  },
  {
    id: "cloudflare",
    displayName: "Cloudflare",
    description: "Cloudflare Workers and edge services",
    icon: "\u2601\uFE0F",
    category: "cloud",
    serverType: "http",
    url: "https://mcp.cloudflare.com/mcp",
    setupHint: "No API key needed — authenticates via browser OAuth on first connect. You'll be prompted to sign in to Cloudflare.",
    docsUrl: "https://developers.cloudflare.com/mcp/",
  },
] as const;
