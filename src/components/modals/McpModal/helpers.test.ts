import { describe, it, expect } from "vitest";
import { formToServer, serverToForm } from "./helpers";
import type { FormState } from "./types";

describe("formToServer", () => {
  it("preserves headers for SSE type", () => {
    const form: FormState = {
      name: "sse-test",
      scope: "global",
      serverType: "sse",
      command: "",
      args: "",
      env: [],
      url: "https://sse.example.com",
      headers: [
        { key: "Authorization", value: "Bearer tok" },
        { key: "X-Custom", value: "val" },
      ],
    };
    const server = formToServer(form);
    expect(server.headers).toEqual({
      Authorization: "Bearer tok",
      "X-Custom": "val",
    });
  });

  it("omits empty headers for SSE type", () => {
    const form: FormState = {
      name: "sse-test",
      scope: "global",
      serverType: "sse",
      command: "",
      args: "",
      env: [],
      url: "https://sse.example.com",
      headers: [],
    };
    const server = formToServer(form);
    expect(server.headers).toBeUndefined();
  });
});

describe("serverToForm", () => {
  it("converts SSE server with headers to form", () => {
    const form = serverToForm({
      name: "sse-auth",
      scope: "global",
      serverType: "sse",
      url: "https://sse.example.com",
      headers: { Authorization: "Bearer tok" },
    });
    expect(form.headers).toEqual([
      { key: "Authorization", value: "Bearer tok" },
    ]);
  });
});
