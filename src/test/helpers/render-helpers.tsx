/**
 * Component rendering helpers for integration tests.
 * These render components with real Zustand stores pre-seeded with test data.
 */
import React from "react";
import { render, type RenderResult } from "@testing-library/react";
import { useSessionStore } from "../../stores/sessionStore";
import type { Session } from "../../types/session";
import type { Message } from "../../types/session";

/**
 * Seed stores with provided state, then render the component.
 * Use this when you need a component mounted with specific store state.
 *
 * @example
 * const result = renderWithStores(<ChatPanel />, {
 *   session: { sessionId: "s1", project: "/tmp/project" },
 *   messages: [{ role: "user", content: "hello" }],
 * });
 */
export function renderWithSession(
  component: React.ReactElement,
  options: {
    sessionId?: string;
    projectPath?: string;
    messages?: Message[];
  } = {}
): RenderResult {
  const sessionId = options.sessionId ?? "test-session-1";
  const projectPath = options.projectPath ?? "/tmp/test-project";

  // Seed session store with a test session
  const sessions = new Map(useSessionStore.getState().sessions);
  sessions.set(sessionId, {
    id: sessionId,
    name: "Test Session",
    project_path: projectPath,
    status: "connected",
    created_at: new Date().toISOString(),
    model: "claude-sonnet-4-20250514",
    icon_index: 0,
  } as Session);

  useSessionStore.setState({
    sessions,
    activeSessionId: sessionId,
    activeProjectPath: projectPath,
    tabOrder: [sessionId],
  });

  // Seed messages if provided
  if (options.messages) {
    const sessionMessages = new Map(useSessionStore.getState().sessionMessages);
    sessionMessages.set(sessionId, options.messages);
    useSessionStore.setState({ sessionMessages });
  }

  return render(component);
}

/**
 * Render with arbitrary store overrides. Applies setState to each store.
 */
export function renderWithStores(
  component: React.ReactElement,
  storeUpdates?: () => void
): RenderResult {
  if (storeUpdates) {
    storeUpdates();
  }
  return render(component);
}
