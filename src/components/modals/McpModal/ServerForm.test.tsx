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

  it("shows scope radio buttons with Project option when hasProject is true", () => {
    render(<ServerForm {...defaultProps} />);
    expect(screen.getByText("Global")).toBeInTheDocument();
    expect(screen.getByText("Project")).toBeInTheDocument();
  });

  it("shows type description for http", () => {
    const httpForm = { ...defaultForm, serverType: "http" as const };
    render(<ServerForm {...defaultProps} form={httpForm} />);
    expect(screen.getByText(/Connects to a remote HTTP endpoint/)).toBeInTheDocument();
  });

  it("shows type description for sse", () => {
    const sseForm = { ...defaultForm, serverType: "sse" as const };
    render(<ServerForm {...defaultProps} form={sseForm} />);
    expect(screen.getByText(/Server-Sent Events \(legacy\)/)).toBeInTheDocument();
  });

  it("shows validation error for name with invalid characters", () => {
    const badForm = { ...defaultForm, name: "bad name!" };
    render(<ServerForm {...defaultProps} form={badForm} />);
    expect(screen.getByText("Only letters, numbers, hyphens, underscores")).toBeInTheDocument();
  });

  it("shows validation error for duplicate name", () => {
    render(<ServerForm {...defaultProps} existingNames={new Set(["test-server"])} />);
    expect(
      screen.getByText("A server with this name already exists in this scope"),
    ).toBeInTheDocument();
  });

  it("shows hint text for valid name", () => {
    render(<ServerForm {...defaultProps} />);
    expect(
      screen.getByText("Unique identifier used as the key in your config file"),
    ).toBeInTheDocument();
  });

  it("shows docs link when docsUrl is provided without templateDisplayName", () => {
    render(<ServerForm {...defaultProps} docsUrl="https://example.com" />);
    expect(screen.getByText("Docs")).toBeInTheDocument();
  });

  it("shows headers section for http type", () => {
    const httpForm = { ...defaultForm, serverType: "http" as const };
    render(<ServerForm {...defaultProps} form={httpForm} />);
    expect(screen.getByText("Headers")).toBeInTheDocument();
    expect(screen.getByText("+ Add header")).toBeInTheDocument();
  });

  it("shows headers section for sse type", () => {
    const sseForm = { ...defaultForm, serverType: "sse" as const };
    render(<ServerForm {...defaultProps} form={sseForm} />);
    expect(screen.getByText("Headers")).toBeInTheDocument();
    expect(screen.getByText("+ Add header")).toBeInTheDocument();
  });

  it("calls onChange with new env entry when add env button is clicked", () => {
    const onChange = vi.fn();
    render(<ServerForm {...defaultProps} onChange={onChange} />);
    fireEvent.click(screen.getByText("+ Add environment variable"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        env: [{ key: "", value: "" }],
      }),
    );
  });

  it("calls onChange with updated scope when Global radio is clicked", () => {
    const onChange = vi.fn();
    const projectForm = { ...defaultForm, scope: "project" as const };
    render(<ServerForm {...defaultProps} form={projectForm} onChange={onChange} />);
    fireEvent.click(screen.getByText("Global"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "global" }),
    );
  });

  it("calls onChange with updated serverType when type is changed to http", () => {
    const onChange = vi.fn();
    render(<ServerForm {...defaultProps} onChange={onChange} />);
    const select = screen.getByDisplayValue("stdio");
    fireEvent.change(select, { target: { value: "http" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ serverType: "http" }),
    );
  });

  it("hides Project scope when hasProject is false", () => {
    render(<ServerForm {...defaultProps} hasProject={false} />);
    expect(screen.getByText("Global")).toBeInTheDocument();
    expect(screen.queryByText("Project")).not.toBeInTheDocument();
  });
});
