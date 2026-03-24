import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ShortcutsTab from "./ShortcutsTab";

vi.mock("../../../data/shortcuts", () => ({
  SHORTCUT_CATEGORIES: [
    {
      name: "Global",
      shortcuts: [
        { keys: "⌘ N", description: "New session" },
        { keys: "⌘ ,", description: "Settings" },
      ],
    },
    {
      name: "Editor",
      shortcuts: [
        { keys: "⌘ S", description: "Save file" },
      ],
    },
  ],
}));

describe("ShortcutsTab", () => {
  it("renders the title", () => {
    render(<ShortcutsTab />);
    expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
  });

  it("renders category headers", () => {
    render(<ShortcutsTab />);
    expect(screen.getByText("Global")).toBeInTheDocument();
    expect(screen.getByText("Editor")).toBeInTheDocument();
  });

  it("renders shortcut descriptions", () => {
    render(<ShortcutsTab />);
    expect(screen.getByText("New session")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Save file")).toBeInTheDocument();
  });

  it("renders shortcut key bindings", () => {
    render(<ShortcutsTab />);
    expect(screen.getByText("⌘ N")).toBeInTheDocument();
    expect(screen.getByText("⌘ ,")).toBeInTheDocument();
    expect(screen.getByText("⌘ S")).toBeInTheDocument();
  });

  it("renders key bindings as kbd elements", () => {
    const { container } = render(<ShortcutsTab />);
    const kbds = container.querySelectorAll("kbd");
    expect(kbds.length).toBe(3);
  });
});
