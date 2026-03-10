export type McpServerType = "stdio" | "http" | "sse";
export type McpScope = "global" | "project";

export interface McpServerConfig {
  name: string;
  scope: McpScope;
  serverType: McpServerType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}
