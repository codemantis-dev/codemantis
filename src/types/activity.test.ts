import { describe, it, expect } from "vitest";
import { getActivityType } from "./activity";

describe("getActivityType", () => {
  it("classifies Read as read", () => {
    expect(getActivityType("Read")).toBe("read");
  });

  it("classifies Glob as read", () => {
    expect(getActivityType("Glob")).toBe("read");
  });

  it("classifies Grep as read", () => {
    expect(getActivityType("Grep")).toBe("read");
  });

  it("classifies Write as write", () => {
    expect(getActivityType("Write")).toBe("write");
  });

  it("classifies Edit as edit", () => {
    expect(getActivityType("Edit")).toBe("edit");
  });

  it("classifies Bash as bash", () => {
    expect(getActivityType("Bash")).toBe("bash");
  });

  it("classifies NotebookEdit as write", () => {
    expect(getActivityType("NotebookEdit")).toBe("write");
  });

  it("classifies TodoWrite as task", () => {
    expect(getActivityType("TodoWrite")).toBe("task");
  });

  it("classifies TodoRead as task", () => {
    expect(getActivityType("TodoRead")).toBe("task");
  });

  it("classifies ToolSearch as search", () => {
    expect(getActivityType("ToolSearch")).toBe("search");
  });

  it("classifies WebSearch as search", () => {
    expect(getActivityType("WebSearch")).toBe("search");
  });

  it("classifies Agent as agent", () => {
    expect(getActivityType("Agent")).toBe("agent");
  });

  it("classifies unknown tools as other", () => {
    expect(getActivityType("SomeNewTool")).toBe("other");
    expect(getActivityType("MCP_tool")).toBe("other");
    expect(getActivityType("")).toBe("other");
  });

  // v1.4.0 — Codex ThreadItem types that previously fell through to "other"
  // and rendered as an unhelpful "EX" badge in the approval modal and
  // activity feed. Each gets a semantically appropriate bucket so users
  // see a readable tool name.

  it("classifies ImageGeneration as write (creates a file)", () => {
    expect(getActivityType("ImageGeneration")).toBe("write");
  });

  it("classifies ExitPlanMode as question (drives the PlanCompleteModal)", () => {
    // Regression: ExitPlanMode used to render as "EX" in the approval
    // modal because it wasn't in any of the activity-type lists. It's
    // a control tool that prompts the user, so "question" fits.
    expect(getActivityType("ExitPlanMode")).toBe("question");
  });

  it("classifies EnterPlanMode as question", () => {
    expect(getActivityType("EnterPlanMode")).toBe("question");
  });

  it("classifies dyn__namespace__tool as mcp (dynamic tool registration)", () => {
    // Mirrors the mcp__ convention — Codex `dynamicToolCall` is the
    // same shape of dynamic-tool surfacing, just outside the MCP server
    // umbrella.
    expect(getActivityType("dyn__mathkit__calculate")).toBe("mcp");
    expect(getActivityType("dyn__ping")).toBe("mcp");
  });

  it("classifies PermissionRequest as question (Codex item/permissions/requestApproval)", () => {
    // v1.4.1 Phase A.2 regression: Codex permission requests used to
    // emit tool_name "AskUserQuestion" which misrouted to QuestionModal
    // → submit_question_answer (Claude-only path). They now emit
    // "PermissionRequest" → ToolApprovalModal → respond_to_approval.
    // The Q? badge stays correct for the user's mental model.
    expect(getActivityType("PermissionRequest")).toBe("question");
  });
});
