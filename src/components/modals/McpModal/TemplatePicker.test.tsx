import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TemplatePicker from "./TemplatePicker";

vi.mock("../../../types/mcp-templates", () => ({
  MCP_TEMPLATE_CATEGORIES: [
    { id: "no-auth", label: "No Setup Required", description: "Ready to use" },
    { id: "api-key", label: "Requires API Key", description: "Provide credentials" },
  ],
  MCP_TEMPLATES: [
    {
      id: "context7",
      displayName: "Context7",
      description: "Up-to-date docs",
      icon: "📚",
      category: "no-auth",
      serverType: "stdio",
    },
    {
      id: "brave-search",
      displayName: "Brave Search",
      description: "Web search",
      icon: "🦁",
      category: "api-key",
      serverType: "stdio",
    },
  ],
}));

describe("TemplatePicker", () => {
  const defaultProps = {
    onSelect: vi.fn(),
    onManual: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the title and description", () => {
    render(<TemplatePicker {...defaultProps} />);
    expect(screen.getByText("Add MCP Server")).toBeInTheDocument();
    expect(screen.getByText("Choose a template or configure manually")).toBeInTheDocument();
  });

  it("renders category headers", () => {
    render(<TemplatePicker {...defaultProps} />);
    expect(screen.getByText("No Setup Required")).toBeInTheDocument();
    expect(screen.getByText("Requires API Key")).toBeInTheDocument();
  });

  it("renders template buttons", () => {
    render(<TemplatePicker {...defaultProps} />);
    expect(screen.getByText("Context7")).toBeInTheDocument();
    expect(screen.getByText("Brave Search")).toBeInTheDocument();
  });

  it("calls onSelect when a template is clicked", () => {
    render(<TemplatePicker {...defaultProps} />);
    fireEvent.click(screen.getByText("Context7"));
    expect(defaultProps.onSelect).toHaveBeenCalledTimes(1);
    expect(defaultProps.onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "context7", displayName: "Context7" })
    );
  });

  it("renders manual configuration button", () => {
    render(<TemplatePicker {...defaultProps} />);
    expect(screen.getByText("Manual Configuration")).toBeInTheDocument();
  });

  it("calls onManual when manual configuration is clicked", () => {
    render(<TemplatePicker {...defaultProps} />);
    fireEvent.click(screen.getByText("Manual Configuration"));
    expect(defaultProps.onManual).toHaveBeenCalledTimes(1);
  });
});
