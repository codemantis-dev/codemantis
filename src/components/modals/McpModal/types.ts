import type { McpScope, McpServerType } from "../../../types/mcp";

export type ScopeFilter = "all" | "global" | "project";

export interface FormState {
  name: string;
  scope: McpScope;
  serverType: McpServerType;
  command: string;
  args: string;
  env: { key: string; value: string }[];
  url: string;
  headers: { key: string; value: string }[];
}

export const EMPTY_FORM: FormState = {
  name: "",
  scope: "global",
  serverType: "stdio",
  command: "",
  args: "",
  env: [],
  url: "",
  headers: [],
};

export const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
