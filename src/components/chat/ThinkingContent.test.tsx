import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ThinkingContent from "./ThinkingContent";

vi.mock("./StreamingCursor", () => ({
  default: () => <span data-testid="streaming-cursor" />,
}));

describe("ThinkingContent", () => {
  it("renders nothing when content is empty", () => {
    const { container } = render(<ThinkingContent content="" isStreaming={false} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders 'Reasoning' header with content", () => {
    render(<ThinkingContent content="Some reasoning text" isStreaming={false} />);
    expect(screen.getByText("Reasoning")).toBeInTheDocument();
  });

  it("is collapsed by default when not streaming", () => {
    render(<ThinkingContent content="Hidden reasoning" isStreaming={false} />);
    // Content should not be visible when collapsed
    expect(screen.queryByText("Hidden reasoning")).not.toBeInTheDocument();
  });

  it("shows word count when collapsed", () => {
    render(<ThinkingContent content="one two three four five" isStreaming={false} />);
    expect(screen.getByText("5 words")).toBeInTheDocument();
  });

  it("expands when header is clicked", () => {
    render(<ThinkingContent content="Visible after click" isStreaming={false} />);
    fireEvent.click(screen.getByText("Reasoning"));
    expect(screen.getByText("Visible after click")).toBeInTheDocument();
  });

  it("collapses when header is clicked again", () => {
    render(<ThinkingContent content="Toggle me" isStreaming={false} />);
    const header = screen.getByText("Reasoning");
    // Expand
    fireEvent.click(header);
    expect(screen.getByText("Toggle me")).toBeInTheDocument();
    // Collapse
    fireEvent.click(header);
    expect(screen.queryByText("Toggle me")).not.toBeInTheDocument();
  });

  it("auto-expands when streaming", () => {
    render(<ThinkingContent content="Streaming content" isStreaming={true} />);
    expect(screen.getByText("Streaming content")).toBeInTheDocument();
  });

  it("shows streaming cursor when streaming", () => {
    render(<ThinkingContent content="Active thinking" isStreaming={true} />);
    expect(screen.getByTestId("streaming-cursor")).toBeInTheDocument();
  });

  it("does not show streaming cursor when not streaming", () => {
    render(<ThinkingContent content="Done thinking" isStreaming={false} />);
    // Expand to see content
    fireEvent.click(screen.getByText("Reasoning"));
    expect(screen.queryByTestId("streaming-cursor")).not.toBeInTheDocument();
  });

  it("shows 'streaming...' label during active streaming", () => {
    render(<ThinkingContent content="Active" isStreaming={true} />);
    expect(screen.getByText("streaming...")).toBeInTheDocument();
  });

  it("does not show 'streaming...' when not streaming", () => {
    render(<ThinkingContent content="Done" isStreaming={false} />);
    expect(screen.queryByText("streaming...")).not.toBeInTheDocument();
  });

  it("handles long content without overflow errors", () => {
    const longContent = "word ".repeat(5000).trim();
    render(<ThinkingContent content={longContent} isStreaming={false} />);
    fireEvent.click(screen.getByText("Reasoning"));
    // Should render the content in a scrollable pre element
    const pre = screen.getByText((_content, element) => element?.tagName === "PRE" && element.textContent?.includes("word word") === true);
    expect(pre).toBeInTheDocument();
  });

  it("renders multiline content preserving whitespace", () => {
    const multiline = "Line 1\nLine 2\nLine 3";
    render(<ThinkingContent content={multiline} isStreaming={false} />);
    fireEvent.click(screen.getByText("Reasoning"));
    // Pre element preserves whitespace; check for individual lines
    expect(screen.getByText((_content, element) => element?.tagName === "PRE" && element.textContent?.includes("Line 1") === true)).toBeInTheDocument();
  });
});
