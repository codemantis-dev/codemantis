import type { McpServerConfig, McpScope } from "../../../types/mcp";
import type { McpTemplate } from "../../../types/mcp-templates";
import type { FormState } from "./types";

export function serverToForm(server: McpServerConfig): FormState {
  return {
    name: server.name,
    scope: server.scope,
    serverType: server.serverType,
    command: server.command ?? "",
    args: server.args?.join(", ") ?? "",
    env: Object.entries(server.env ?? {}).map(([key, value]) => ({ key, value })),
    url: server.url ?? "",
    headers: Object.entries(server.headers ?? {}).map(([key, value]) => ({ key, value })),
  };
}

export function templateToForm(template: McpTemplate, scope: McpScope): FormState {
  return {
    name: template.id,
    scope,
    serverType: template.serverType,
    command: template.command ?? "",
    args: template.args?.join(", ") ?? "",
    env: Object.entries(template.env ?? {}).map(([key, value]) => ({ key, value })),
    url: template.url ?? "",
    headers: Object.entries(template.headers ?? {}).map(([key, value]) => ({ key, value })),
  };
}

export function formToServer(form: FormState): McpServerConfig {
  const server: McpServerConfig = {
    name: form.name.trim(),
    scope: form.scope,
    serverType: form.serverType,
  };

  if (form.serverType === "stdio") {
    server.command = form.command.trim();
    const args = form.args
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (args.length > 0) server.args = args;
    const env: Record<string, string> = {};
    for (const { key, value } of form.env) {
      if (key.trim()) env[key.trim()] = value;
    }
    if (Object.keys(env).length > 0) server.env = env;
  } else if (form.serverType === "http") {
    server.url = form.url.trim();
    const headers: Record<string, string> = {};
    for (const { key, value } of form.headers) {
      if (key.trim()) headers[key.trim()] = value;
    }
    if (Object.keys(headers).length > 0) server.headers = headers;
  } else {
    server.url = form.url.trim();
  }

  return server;
}
