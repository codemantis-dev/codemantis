/**
 * Integration test: in-chat search (Cmd+F).
 *
 * Exercises the full search slice end-to-end:
 *   ChatPanel + MessageBubble + ChatSearchBar + chatSearchStore.
 * Stores are real (per CLAUDE.md mocking policy); only Tauri IPC is mocked.
 */
import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { resetAllStores } from "../helpers/store-reset";
import { useSessionStore } from "../../stores/sessionStore";
import { useChatSearchStore } from "../../stores/chatSearchStore";
import ChatPanel from "../../components/chat/ChatPanel";
import type { Session, Message } from "../../types/session";

const SESSION: Session = {
  id: "s1",
  name: "Test",
  project_path: "/tmp",
  status: "connected",
  created_at: "",
  model: null,
  icon_index: 0,
};

const MESSAGES: Message[] = [
  { id: "m1", role: "user", content: "Where is the auth module?", timestamp: "", activityIds: [], isStreaming: false },
  { id: "m2", role: "assistant", content: "The auth module lives in src/auth.", timestamp: "", activityIds: [], isStreaming: false },
  { id: "m3", role: "user", content: "And the database?", timestamp: "", activityIds: [], isStreaming: false },
  { id: "m4", role: "assistant", content: "Database setup is in src/db. Auth tokens are stored there too.", timestamp: "", activityIds: [], isStreaming: false },
  { id: "m5", role: "user", content: "Thanks!", timestamp: "", activityIds: [], isStreaming: false },
];

function seedSession(): void {
  useSessionStore.setState({
    sessions: new Map([[SESSION.id, SESSION]]),
    activeSessionId: SESSION.id,
    sessionMessages: new Map([[SESSION.id, MESSAGES]]),
    sessionStreaming: new Map([[SESSION.id, { isStreaming: false, streamingContent: "", currentMessageId: null }]]),
    sessionContext: new Map([[SESSION.id, { used: 0, max: 200000 }]]),
    tabOrder: [SESSION.id],
    activeProjectPath: "/tmp",
  });
}

describe("chat search integration", () => {
  beforeEach(() => {
    resetAllStores();
    seedSession();
  });

  it("opens via store, counts matches, and updates active mark on next/prev", async () => {
    render(React.createElement(ChatPanel));

    // Open the search bar via the store (the keyboard shortcut handler is
    // tested separately; here we focus on the bar + highlighting wiring).
    act(() => {
      useChatSearchStore.getState().open();
    });

    const input = await screen.findByPlaceholderText("Find in chat...");
    expect(input).toBeInTheDocument();

    // Type a query that matches twice across two assistant messages.
    fireEvent.change(input, { target: { value: "auth" } });

    // Counter is updated by the layout effect — wait a tick.
    await act(async () => {
      await Promise.resolve();
    });

    // 4 matches total: "auth" in m1, "auth" twice in m2 ("The auth..." and "src/auth"),
    // and "Auth" in m4.
    const marks = document.querySelectorAll("mark[data-search-match-index]");
    expect(marks.length).toBe(4);

    expect(useChatSearchStore.getState().totalMatches).toBe(4);
    expect(useChatSearchStore.getState().currentIndex).toBe(0);

    // First match should be the active one.
    const allMarks = Array.from(document.querySelectorAll<HTMLElement>("mark[data-search-match-index]"));
    expect(allMarks[0].getAttribute("data-search-active")).toBe("true");
    expect(allMarks[1].getAttribute("data-search-active")).toBeNull();

    // Press Enter in the input → next match.
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(useChatSearchStore.getState().currentIndex).toBe(1);

    const after = Array.from(document.querySelectorAll<HTMLElement>("mark[data-search-match-index]"));
    expect(after[1].getAttribute("data-search-active")).toBe("true");
    expect(after[0].getAttribute("data-search-active")).toBeNull();

    // Shift+Enter → prev match.
    act(() => {
      fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    });
    expect(useChatSearchStore.getState().currentIndex).toBe(0);

    // Esc closes the bar and clears highlights.
    act(() => {
      fireEvent.keyDown(input, { key: "Escape" });
    });
    expect(useChatSearchStore.getState().isOpen).toBe(false);
    expect(useChatSearchStore.getState().query).toBe("");
    expect(screen.queryByPlaceholderText("Find in chat...")).not.toBeInTheDocument();
    expect(document.querySelectorAll("mark[data-search-match-index]").length).toBe(0);
  });

  it("shows 'No results' when query has no matches", async () => {
    render(React.createElement(ChatPanel));

    act(() => {
      useChatSearchStore.getState().open();
    });

    const input = await screen.findByPlaceholderText("Find in chat...");
    fireEvent.change(input, { target: { value: "zzz-no-such-term" } });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("No results")).toBeInTheDocument();
    expect(useChatSearchStore.getState().totalMatches).toBe(0);
  });

  it("resets when active session changes", async () => {
    render(React.createElement(ChatPanel));

    act(() => {
      useChatSearchStore.getState().open();
      useChatSearchStore.getState().setQuery("auth");
    });

    expect(useChatSearchStore.getState().isOpen).toBe(true);

    // Switch to a different session.
    const session2: Session = { ...SESSION, id: "s2", name: "Other" };
    await act(async () => {
      useSessionStore.setState((state) => ({
        sessions: new Map([...state.sessions, [session2.id, session2]]),
        sessionMessages: new Map([...state.sessionMessages, [session2.id, []]]),
        sessionStreaming: new Map([
          ...state.sessionStreaming,
          [session2.id, { isStreaming: false, streamingContent: "", currentMessageId: null }],
        ]),
        activeSessionId: session2.id,
        tabOrder: [...state.tabOrder, session2.id],
      }));
      await Promise.resolve();
    });

    expect(useChatSearchStore.getState().isOpen).toBe(false);
    expect(useChatSearchStore.getState().query).toBe("");
  });
});
