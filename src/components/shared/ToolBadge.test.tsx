import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ToolBadge from "./ToolBadge";

describe("ToolBadge", () => {
  it("renders RE for Read tool", () => {
    render(<ToolBadge toolName="Read" />);
    expect(screen.getByText("RE")).toBeInTheDocument();
  });

  it("renders RE for Glob tool", () => {
    render(<ToolBadge toolName="Glob" />);
    expect(screen.getByText("RE")).toBeInTheDocument();
  });

  it("renders RE for Grep tool", () => {
    render(<ToolBadge toolName="Grep" />);
    expect(screen.getByText("RE")).toBeInTheDocument();
  });

  it("renders WR for Write tool", () => {
    render(<ToolBadge toolName="Write" />);
    expect(screen.getByText("WR")).toBeInTheDocument();
  });

  it("renders ED for Edit tool", () => {
    render(<ToolBadge toolName="Edit" />);
    expect(screen.getByText("ED")).toBeInTheDocument();
  });

  it("renders BA for Bash tool", () => {
    render(<ToolBadge toolName="Bash" />);
    expect(screen.getByText("BA")).toBeInTheDocument();
  });

  it("renders ?? for unknown tools", () => {
    render(<ToolBadge toolName="SomeMCPTool" />);
    expect(screen.getByText("??")).toBeInTheDocument();
  });
});
