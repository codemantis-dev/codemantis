import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AppShell from "./AppShell";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";

describe("AppShell", () => {
  beforeEach(() => {
    useSessionStore.setState({
      session: {
        id: "s1",
        name: "Test Session",
        project_path: "/tmp/test",
        status: "connected",
        created_at: "",
        model: "sonnet",
      },
      messages: [],
      isStreaming: false,
      streamingContent: "",
      currentMessageId: null,
    });
    useUiStore.setState({
      sidebarWidth: 220,
      rightPanelWidth: 360,
      rightTab: "activity",
      showApprovalModal: false,
    });
  });

  it("renders three-panel layout", () => {
    render(<AppShell />);
    // Title bar with session name
    expect(screen.getByText("Test Session")).toBeInTheDocument();
    // Sidebar with Files tab
    expect(screen.getByText("Files")).toBeInTheDocument();
    // Right panel with Activity tab
    expect(screen.getByText("Activity")).toBeInTheDocument();
    // Context meter
    expect(screen.getByText("Context")).toBeInTheDocument();
  });

  it("renders input area", () => {
    render(<AppShell />);
    expect(screen.getByText("Send")).toBeInTheDocument();
  });

  it("shows model info in title bar", () => {
    render(<AppShell />);
    expect(screen.getByText("sonnet")).toBeInTheDocument();
  });
});
