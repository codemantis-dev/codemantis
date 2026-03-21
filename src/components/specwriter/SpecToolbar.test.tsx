import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useSpecWriterStore } from "../../stores/specWriterStore";

const mockWriteSpec = vi.fn();
const mockGenerateAudit = vi.fn();
vi.mock("../../hooks/useSpecConversation", () => ({
  useSpecConversation: () => ({
    sendMessage: vi.fn(),
    writeSpec: mockWriteSpec,
    generateAudit: mockGenerateAudit,
    loadContext: vi.fn(),
  }),
}));

import SpecToolbar from "./SpecToolbar";

const PROJECT = "/tmp/test";

beforeEach(() => {
  useSpecWriterStore.setState({
    conversations: new Map(),
    uiState: new Map(),
    planningStreaming: new Map(),
    currentSpecContent: new Map(),
    currentAuditContent: new Map(),
    savedSpecs: new Map(),
  });
  vi.clearAllMocks();
});

describe("SpecToolbar", () => {
  const onReset = vi.fn();
  const onSave = vi.fn();
  const onSaveAudit = vi.fn();

  it("renders Generate Spec button", () => {
    render(<SpecToolbar projectPath={PROJECT} onReset={onReset} onSave={onSave} onSaveAudit={onSaveAudit} />);
    expect(screen.getByText("Generate Spec")).toBeTruthy();
  });

  it("shows Save to Project when spec content exists", () => {
    useSpecWriterStore.getState().setCurrentSpecContent(PROJECT, "# My Spec");
    render(<SpecToolbar projectPath={PROJECT} onReset={onReset} onSave={onSave} onSaveAudit={onSaveAudit} />);
    expect(screen.getByText("Save to Project")).toBeTruthy();
  });

  it("shows Generate Audit button when spec exists but no audit", () => {
    useSpecWriterStore.getState().setCurrentSpecContent(PROJECT, "# My Spec");
    render(<SpecToolbar projectPath={PROJECT} onReset={onReset} onSave={onSave} onSaveAudit={onSaveAudit} />);
    expect(screen.getByText("Generate Audit")).toBeTruthy();
  });

  it("hides Generate Audit when audit already exists", () => {
    useSpecWriterStore.getState().setCurrentSpecContent(PROJECT, "# My Spec");
    useSpecWriterStore.getState().setCurrentAuditContent(PROJECT, "# My Audit");
    render(<SpecToolbar projectPath={PROJECT} onReset={onReset} onSave={onSave} onSaveAudit={onSaveAudit} />);
    expect(screen.queryByText("Generate Audit")).toBeNull();
  });

  it("hides Generate Audit when no spec exists", () => {
    render(<SpecToolbar projectPath={PROJECT} onReset={onReset} onSave={onSave} onSaveAudit={onSaveAudit} />);
    expect(screen.queryByText("Generate Audit")).toBeNull();
  });

  it("shows Save Audit when audit content exists", () => {
    useSpecWriterStore.getState().setCurrentSpecContent(PROJECT, "# Spec");
    useSpecWriterStore.getState().setCurrentAuditContent(PROJECT, "# Audit");
    render(<SpecToolbar projectPath={PROJECT} onReset={onReset} onSave={onSave} onSaveAudit={onSaveAudit} />);
    expect(screen.getByText("Save Audit")).toBeTruthy();
  });

  it("hides Save Audit when no audit content exists", () => {
    useSpecWriterStore.getState().setCurrentSpecContent(PROJECT, "# Spec");
    render(<SpecToolbar projectPath={PROJECT} onReset={onReset} onSave={onSave} onSaveAudit={onSaveAudit} />);
    expect(screen.queryByText("Save Audit")).toBeNull();
  });

  it("calls generateAudit when Generate Audit button is clicked", () => {
    useSpecWriterStore.getState().setCurrentSpecContent(PROJECT, "# Spec");
    render(<SpecToolbar projectPath={PROJECT} onReset={onReset} onSave={onSave} onSaveAudit={onSaveAudit} />);
    fireEvent.click(screen.getByText("Generate Audit"));
    expect(mockGenerateAudit).toHaveBeenCalledWith(PROJECT);
  });

  it("calls onSaveAudit when Save Audit button is clicked", () => {
    useSpecWriterStore.getState().setCurrentSpecContent(PROJECT, "# Spec");
    useSpecWriterStore.getState().setCurrentAuditContent(PROJECT, "# Audit");
    render(<SpecToolbar projectPath={PROJECT} onReset={onReset} onSave={onSave} onSaveAudit={onSaveAudit} />);
    fireEvent.click(screen.getByText("Save Audit"));
    expect(onSaveAudit).toHaveBeenCalled();
  });

  it("disables Generate Audit during streaming", () => {
    useSpecWriterStore.getState().setCurrentSpecContent(PROJECT, "# Spec");
    useSpecWriterStore.setState({
      planningStreaming: new Map([[PROJECT, true]]),
    });
    render(<SpecToolbar projectPath={PROJECT} onReset={onReset} onSave={onSave} onSaveAudit={onSaveAudit} />);
    // Generate Audit should not appear when streaming (canGenerateAudit is false because isStreaming)
    expect(screen.queryByText("Generate Audit")).toBeNull();
  });
});
