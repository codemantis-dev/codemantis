import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import CodexPlanModeBanner from "./CodexPlanModeBanner";
import { useSessionStore } from "../../stores/sessionStore";
import { resetAllStores } from "../../test/helpers/store-reset";
import type { Session } from "../../types/session";

const CODEX_SESSION: Session = {
  id: "s1",
  agent_id: "codex",
  name: "Test",
  project_path: "/tmp/test",
  status: "connected",
  created_at: "2026-01-01T00:00:00Z",
  model: null,
  icon_index: 0,
};

function activate(session: Session, mode?: "plan" | "normal"): void {
  const store = useSessionStore.getState();
  store.addSession(session);
  store.setActiveSession(session.id);
  if (mode) store.setSessionMode(session.id, mode);
}

describe("CodexPlanModeBanner", () => {
  beforeEach(() => {
    resetAllStores();
  });

  it("renders when an active Codex session is in plan mode", () => {
    activate(CODEX_SESSION, "plan");
    render(<CodexPlanModeBanner />);
    expect(screen.getByText("Plan mode")).toBeInTheDocument();
  });

  it("renders nothing when the Codex session is not in plan mode", () => {
    activate(CODEX_SESSION, "normal");
    const { container } = render(<CodexPlanModeBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a Claude session in plan mode", () => {
    activate({ ...CODEX_SESSION, agent_id: "claude_code" }, "plan");
    const { container } = render(<CodexPlanModeBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there is no active session", () => {
    const { container } = render(<CodexPlanModeBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});
