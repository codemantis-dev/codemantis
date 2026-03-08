import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CodeBlock from "./CodeBlock";

// Mock navigator.clipboard
const mockWriteText = vi.fn(() => Promise.resolve());
Object.assign(navigator, {
  clipboard: { writeText: mockWriteText },
});

describe("CodeBlock", () => {
  beforeEach(() => {
    mockWriteText.mockClear();
  });

  it("renders inline code without copy button", () => {
    render(<CodeBlock>const x = 1</CodeBlock>);
    expect(screen.getByText("const x = 1")).toBeInTheDocument();
    expect(screen.queryByText("Copy")).not.toBeInTheDocument();
  });

  it("renders block code with language label", () => {
    render(<CodeBlock className="language-typescript">const x = 1</CodeBlock>);
    expect(screen.getByText("typescript")).toBeInTheDocument();
    expect(screen.getByText("const x = 1")).toBeInTheDocument();
  });

  it("renders block code with copy button", () => {
    render(<CodeBlock className="language-rust">fn main() {"{}"}</CodeBlock>);
    expect(screen.getByText("Copy")).toBeInTheDocument();
  });

  it("copies code to clipboard on click", async () => {
    render(<CodeBlock className="language-python">print("hello")</CodeBlock>);

    const copyButton = screen.getByText("Copy").closest("button")!;
    fireEvent.click(copyButton);

    expect(mockWriteText).toHaveBeenCalledWith('print("hello")');
  });

  it("shows 'Copied' feedback after copy", async () => {
    render(<CodeBlock className="language-js">code</CodeBlock>);

    fireEvent.click(screen.getByText("Copy").closest("button")!);
    // writeText returns a resolved promise, so state updates synchronously after microtask
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByText("Copied")).toBeInTheDocument();
  });

  it("strips trailing newline from copied text", async () => {
    render(<CodeBlock className="language-go">{"package main\n"}</CodeBlock>);
    fireEvent.click(screen.getByText("Copy").closest("button")!);
    expect(mockWriteText).toHaveBeenCalledWith("package main");
  });

  it("renders without language when className has no language prefix", () => {
    render(<CodeBlock className="language-">code</CodeBlock>);
    expect(screen.queryByText("language-")).not.toBeInTheDocument();
  });

  it("inline code renders as <code> element", () => {
    const { container } = render(<CodeBlock>inline</CodeBlock>);
    const code = container.querySelector("code");
    expect(code).toBeTruthy();
    expect(code?.textContent).toBe("inline");
  });

  it("block code wraps in a div with group class", () => {
    const { container } = render(
      <CodeBlock className="language-css">body {"{}"}</CodeBlock>
    );
    const wrapper = container.querySelector(".group");
    expect(wrapper).toBeTruthy();
  });
});
