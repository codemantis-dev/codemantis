import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ServerForm from "./ServerForm";
import type { FormState } from "./types";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

describe("ServerForm", () => {
  const defaultForm: FormState = {
    name: "test-server",
    scope: "global",
    serverType: "stdio",
    command: "npx",
    args: "-y, @package/name",
    env: [],
    url: "",
    headers: [],
  };

  const defaultProps = {
    form: defaultForm,
    onChange: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    isEdit: false,
    existingNames: new Set<string>(),
    hasProject: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render a title for new server (title is in modal header)", () => {
    render(<ServerForm {...defaultProps} />);
    expect(screen.queryByText("Add MCP Server")).not.toBeInTheDocument();
  });

  it("shows template name when templateDisplayName is set", () => {
    render(<ServerForm {...defaultProps} templateDisplayName="Fetch" />);
    expect(screen.getByText(/Template: Fetch/)).toBeInTheDocument();
  });

  it("renders name, scope, and type fields", () => {
    render(<ServerForm {...defaultProps} />);
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Scope")).toBeInTheDocument();
    expect(screen.getByText("Type")).toBeInTheDocument();
  });

  it("shows command and arguments fields for stdio type", () => {
    render(<ServerForm {...defaultProps} />);
    expect(screen.getByText("Command")).toBeInTheDocument();
    expect(screen.getByText("Arguments")).toBeInTheDocument();
  });

  it("shows URL field for http type", () => {
    const httpForm = { ...defaultForm, serverType: "http" as const };
    render(<ServerForm {...defaultProps} form={httpForm} />);
    expect(screen.getByText("URL")).toBeInTheDocument();
  });

  it("shows URL field for sse type", () => {
    const sseForm = { ...defaultForm, serverType: "sse" as const };
    render(<ServerForm {...defaultProps} form={sseForm} />);
    expect(screen.getByText("URL")).toBeInTheDocument();
  });

  it("disables Save when name is empty", () => {
    const emptyNameForm = { ...defaultForm, name: "" };
    render(<ServerForm {...defaultProps} form={emptyNameForm} />);
    const saveBtn = screen.getByText("Add Server");
    expect(saveBtn).toBeDisabled();
  });

  it("disables Save when name already exists", () => {
    render(<ServerForm {...defaultProps} existingNames={new Set(["test-server"])} />);
    const saveBtn = screen.getByText("Add Server");
    expect(saveBtn).toBeDisabled();
  });

  it("calls onSave when Save button is clicked with valid form", () => {
    render(<ServerForm {...defaultProps} />);
    fireEvent.click(screen.getByText("Add Server"));
    expect(defaultProps.onSave).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when Cancel button is clicked", () => {
    render(<ServerForm {...defaultProps} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows 'Save Changes' button when editing", () => {
    render(<ServerForm {...defaultProps} isEdit={true} />);
    expect(screen.getByText("Save Changes")).toBeInTheDocument();
  });

  it("disables name input when editing", () => {
    render(<ServerForm {...defaultProps} isEdit={true} />);
    const nameInput = screen.getByDisplayValue("test-server");
    expect(nameInput).toBeDisabled();
  });

  it("shows setup hint when provided", () => {
    render(<ServerForm {...defaultProps} setupHint="Run 'npm install' first" />);
    expect(screen.getByText("Run 'npm install' first")).toBeInTheDocument();
  });

  it("shows docs link when docsUrl is provided", () => {
    render(<ServerForm {...defaultProps} docsUrl="https://docs.example.com" />);
    expect(screen.getByText("Docs")).toBeInTheDocument();
  });

  it("shows 'Show config file' button when onShowConfigFile is provided", () => {
    render(<ServerForm {...defaultProps} onShowConfigFile={vi.fn()} />);
    expect(screen.getByText("Show config file")).toBeInTheDocument();
  });

  it("shows scope radio buttons with Project option when hasProject is true", () => {
    render(<ServerForm {...defaultProps} />);
    expect(screen.getByText("Global")).toBeInTheDocument();
    expect(screen.getByText("Project")).toBeInTheDocument();
  });
});
