import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, render, screen, fireEvent } from "@testing-library/react";
import { RightTabBar } from "./RightTabBar";
import { useDuoVisible, useRightTabs } from "./useRightTabs";
import { useDuoStore } from "../../stores/duoStore";
import { useUiStore } from "../../stores/uiStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useGuideStore } from "../../stores/guideStore";
import { resetAllStores } from "../../test/helpers/store-reset";

describe("useDuoVisible (project-scoped)", () => {
  beforeEach(() => resetAllStores());

  it("is false when there is no active project", () => {
    expect(renderHook(() => useDuoVisible()).result.current).toBe(false);
  });

  it("is true when a run is active for the active project", () => {
    useSessionStore.setState({ activeProjectPath: "/proj" });
    useDuoStore.setState({ status: "running", projectPath: "/proj" });
    expect(renderHook(() => useDuoVisible()).result.current).toBe(true);
  });

  it("is false when the duo run belongs to a DIFFERENT project (no lock)", () => {
    useSessionStore.setState({ activeProjectPath: "/other" });
    useDuoStore.setState({ status: "running", projectPath: "/proj" });
    expect(renderHook(() => useDuoVisible()).result.current).toBe(false);
  });

  it("is true when the user opened Duo for the active project (no run yet)", () => {
    useSessionStore.setState({ activeProjectPath: "/proj" });
    useUiStore.setState({ showDuoDashboard: true });
    expect(renderHook(() => useDuoVisible()).result.current).toBe(true);
  });
});

describe("useRightTabs ordering", () => {
  beforeEach(() => resetAllStores());

  it("omits the duo tab when not visible; activity is first", () => {
    const { result } = renderHook(() => useRightTabs());
    expect(result.current[0].id).toBe("activity");
    expect(result.current.some((t) => t.id === "duo")).toBe(false);
  });

  it("puts duo as the LEFTMOST tab when visible", () => {
    useSessionStore.setState({ activeProjectPath: "/proj" });
    useDuoStore.setState({ status: "running", projectPath: "/proj" });
    const { result } = renderHook(() => useRightTabs());
    expect(result.current[0].id).toBe("duo");
  });

  it("appends the guide tab when a guide exists", () => {
    useGuideStore.setState({ guide: {} as never });
    const { result } = renderHook(() => useRightTabs());
    expect(result.current.some((t) => t.id === "guide")).toBe(true);
  });
});

describe("RightTabBar", () => {
  const tabs = [
    { id: "duo" as const, label: "Duo", icon: (() => null) as never },
    { id: "activity" as const, label: "Activity", icon: (() => null) as never },
  ];

  it("renders tabs and fires onSelect", () => {
    const onSelect = vi.fn();
    render(<RightTabBar tabs={tabs} active="activity" onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Duo"));
    expect(onSelect).toHaveBeenCalledWith("duo");
  });
});
