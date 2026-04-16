import { describe, it, expect, beforeEach, vi } from "vitest";
import { useGuideStore } from "./guideStore";
import type { ImplementationGuide } from "../types/implementation-guide";
import type { ParsedSessionPlan } from "../lib/parse-session-plan";

vi.mock("../lib/tauri-commands", () => ({
  saveGuide: vi.fn().mockResolvedValue("guide-123"),
  loadGuide: vi.fn().mockResolvedValue(null),
  updateGuideData: vi.fn().mockResolvedValue(undefined),
  deleteGuide: vi.fn().mockResolvedValue(undefined),
  deleteGuidesForProject: vi.fn().mockResolvedValue(undefined),
}));

const PROJECT = "/test/project";

function makeParsedPlan(): ParsedSessionPlan {
  return {
    title: "Test App",
    sessions: [
      {
        index: 1,
        name: "Foundation",
        scope: "Phase 1",
        readSections: "Sections 1, 2",
        files: ["src/db.ts"],
        prompt: "Build the foundation.",
        verifyChecks: ["TypeScript compiles", "Tests pass"],
      },
      {
        index: 2,
        name: "Features",
        scope: "Phase 2",
        readSections: "Sections 3, 4",
        files: ["src/api.ts"],
        prompt: "Build the features.",
        verifyChecks: ["API responds", "UI renders"],
      },
      {
        index: 3,
        name: "Polish",
        scope: "Phase 3",
        readSections: "Sections 5",
        files: ["src/styles.ts"],
        prompt: "Polish everything.",
        verifyChecks: ["All checks pass"],
      },
    ],
  };
}

function makeGuide(): ImplementationGuide {
  return {
    id: "guide-123",
    projectPath: PROJECT,
    specFilename: "test.md",
    auditFilename: null,
    title: "Test App",
    sessions: [
      {
        index: 1,
        name: "Foundation",
        scope: "Phase 1",
        readSections: "Sections 1, 2",
        files: ["src/db.ts"],
        prompt: "Build the foundation.",
        verifyChecks: [
          { id: "verify-1-0", label: "TypeScript compiles", checked: false },
          { id: "verify-1-1", label: "Tests pass", checked: false },
        ],
        status: "active",
      },
      {
        index: 2,
        name: "Features",
        scope: "Phase 2",
        readSections: "Sections 3, 4",
        files: ["src/api.ts"],
        prompt: "Build the features.",
        verifyChecks: [
          { id: "verify-2-0", label: "API responds", checked: false },
          { id: "verify-2-1", label: "UI renders", checked: false },
        ],
        status: "pending",
      },
      {
        index: 3,
        name: "Polish",
        scope: "Phase 3",
        readSections: "Sections 5",
        files: ["src/styles.ts"],
        prompt: "Polish everything.",
        verifyChecks: [
          { id: "verify-3-0", label: "All checks pass", checked: false },
        ],
        status: "pending",
      },
    ],
    createdAt: "2026-03-01T00:00:00.000Z",
    status: "active",
  };
}

describe("guideStore", () => {
  beforeEach(() => {
    useGuideStore.setState({ guide: null, loading: false });
    vi.clearAllMocks();
  });

  it("starts with null guide and loading false", () => {
    const state = useGuideStore.getState();
    expect(state.guide).toBeNull();
    expect(state.loading).toBe(false);
  });

  it("loadGuideForProject sets null when no guide exists", async () => {
    await useGuideStore.getState().loadGuideForProject(PROJECT);
    expect(useGuideStore.getState().guide).toBeNull();
    expect(useGuideStore.getState().loading).toBe(false);
  });

  it("loadGuideForProject deserializes guide from payload", async () => {
    const guide = makeGuide();
    const { loadGuide } = await import("../lib/tauri-commands");
    (loadGuide as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "guide-123",
      dataJson: JSON.stringify(guide),
    });

    await useGuideStore.getState().loadGuideForProject(PROJECT);
    const loaded = useGuideStore.getState().guide;
    expect(loaded).not.toBeNull();
    expect(loaded!.title).toBe("Test App");
    expect(loaded!.sessions).toHaveLength(3);
    expect(loaded!.id).toBe("guide-123");
  });

  it("createGuide builds guide from parsed plan with session 1 active", async () => {
    const plan = makeParsedPlan();
    const created = await useGuideStore
      .getState()
      .createGuide(PROJECT, "test.md", null, plan);

    expect(created).toBe(true);

    const guide = useGuideStore.getState().guide;
    expect(guide).not.toBeNull();
    expect(guide!.title).toBe("Test App");
    expect(guide!.sessions[0].status).toBe("active");
    expect(guide!.sessions[1].status).toBe("pending");
    expect(guide!.sessions[2].status).toBe("pending");
    expect(guide!.status).toBe("active");
  });

  it("createGuide replaces hallucinated spec filenames in prompts", async () => {
    const plan: ParsedSessionPlan = {
      title: "Test App",
      sessions: [
        {
          index: 1,
          name: "Foundation",
          scope: "Phase 1",
          readSections: "Sections 1, 2",
          files: ["src/db.ts"],
          prompt: "Read docs/specs/hallucinated-name.md — but ONLY these sections:\n- Section 1",
          verifyChecks: ["TypeScript compiles"],
        },
        {
          index: 2,
          name: "Features",
          scope: "Phase 2",
          readSections: "Sections 3",
          files: ["src/api.ts"],
          prompt: "Read docs/specs/wrong-slug.md — but ONLY these sections:\n- Section 3",
          verifyChecks: ["API responds"],
        },
      ],
    };

    await useGuideStore.getState().createGuide(PROJECT, "actual-spec-name.md", null, plan);
    const guide = useGuideStore.getState().guide;

    expect(guide!.sessions[0].prompt).toContain("docs/specs/actual-spec-name.md");
    expect(guide!.sessions[0].prompt).not.toContain("hallucinated-name");
    expect(guide!.sessions[1].prompt).toContain("docs/specs/actual-spec-name.md");
    expect(guide!.sessions[1].prompt).not.toContain("wrong-slug");
  });

  it("createGuide preserves prompt text outside spec filename references", async () => {
    const plan: ParsedSessionPlan = {
      title: "Test App",
      sessions: [
        {
          index: 1,
          name: "Foundation",
          scope: "Phase 1",
          readSections: "Sections 1",
          files: [],
          prompt: "Read docs/specs/foo.md — ONLY section 1.\n\nDo NOT modify files from previous sessions.",
          verifyChecks: ["Check"],
        },
        {
          index: 2,
          name: "More",
          scope: "Phase 2",
          readSections: "Sections 2",
          files: [],
          prompt: "No spec reference here.",
          verifyChecks: ["Check"],
        },
      ],
    };

    await useGuideStore.getState().createGuide(PROJECT, "real.md", null, plan);
    const guide = useGuideStore.getState().guide;

    expect(guide!.sessions[0].prompt).toBe(
      "Read docs/specs/real.md — ONLY section 1.\n\nDo NOT modify files from previous sessions.",
    );
    // Prompt without spec reference should be unchanged
    expect(guide!.sessions[1].prompt).toBe("No spec reference here.");
  });

  it("createGuide maps verificationPrompt from parsed plan onto GuideSession", async () => {
    const plan: ParsedSessionPlan = {
      title: "Test App",
      sessions: [
        {
          index: 1,
          name: "Foundation",
          scope: "Phase 1",
          readSections: "Sections 1",
          files: ["src/a.ts"],
          prompt: "Build it.",
          verifyChecks: ["tsc"],
          verificationPrompt: "Open `src/a.ts`\n- VERIFY: exports default",
        },
        {
          index: 2,
          name: "Polish",
          scope: "Phase 2",
          readSections: "Sections 2",
          files: ["src/b.ts"],
          prompt: "Polish it.",
          verifyChecks: ["tsc"],
          verificationPrompt: null,
        },
      ],
    };

    await useGuideStore
      .getState()
      .createGuide(PROJECT, "real.md", null, plan);
    const guide = useGuideStore.getState().guide!;

    expect(guide.sessions[0].verificationPrompt).toBe(
      "Open `src/a.ts`\n- VERIFY: exports default",
    );
    expect(guide.sessions[1].verificationPrompt).toBeNull();
  });

  it("createGuide rewrites spec filenames inside verificationPrompt", async () => {
    const plan: ParsedSessionPlan = {
      title: "Test App",
      sessions: [
        {
          index: 1,
          name: "Foundation",
          scope: "Phase 1",
          readSections: "Sections 1",
          files: ["src/a.ts"],
          prompt: "Build it.",
          verifyChecks: ["tsc"],
          verificationPrompt:
            "Read docs/specs/hallucinated.md then open `src/a.ts`.",
        },
        {
          index: 2,
          name: "More",
          scope: "Phase 2",
          readSections: "Sections 2",
          files: ["src/b.ts"],
          prompt: "More.",
          verifyChecks: ["tsc"],
        },
      ],
    };

    await useGuideStore
      .getState()
      .createGuide(PROJECT, "actual.md", null, plan);
    const guide = useGuideStore.getState().guide!;

    expect(guide.sessions[0].verificationPrompt).toContain(
      "docs/specs/actual.md",
    );
    expect(guide.sessions[0].verificationPrompt).not.toContain("hallucinated");
    // Session 2 omitted verificationPrompt entirely → defaults to null
    expect(guide.sessions[1].verificationPrompt).toBeNull();
  });

  it("toggleVerifyCheck flips the checked state", () => {
    useGuideStore.setState({ guide: makeGuide() });

    useGuideStore.getState().toggleVerifyCheck(1, "verify-1-0");
    const s1 = useGuideStore.getState().guide!.sessions[0];
    expect(s1.verifyChecks[0].checked).toBe(true);
    expect(s1.verifyChecks[1].checked).toBe(false);

    // Toggle back
    useGuideStore.getState().toggleVerifyCheck(1, "verify-1-0");
    expect(useGuideStore.getState().guide!.sessions[0].verifyChecks[0].checked).toBe(false);
  });

  it("markSessionComplete transitions done→next active when all checks done", () => {
    const guide = makeGuide();
    guide.sessions[0].verifyChecks[0].checked = true;
    guide.sessions[0].verifyChecks[1].checked = true;
    useGuideStore.setState({ guide });

    const result = useGuideStore.getState().markSessionComplete(1);
    expect(result).toBe(true);

    const updated = useGuideStore.getState().guide!;
    expect(updated.sessions[0].status).toBe("done");
    expect(updated.sessions[1].status).toBe("active");
    expect(updated.sessions[2].status).toBe("pending");
    expect(updated.status).toBe("active");
  });

  it("markSessionComplete returns false when checks are not all done", () => {
    const guide = makeGuide();
    guide.sessions[0].verifyChecks[0].checked = true;
    // verifyChecks[1] is still false
    useGuideStore.setState({ guide });

    const result = useGuideStore.getState().markSessionComplete(1);
    expect(result).toBe(false);

    // Status unchanged
    expect(useGuideStore.getState().guide!.sessions[0].status).toBe("active");
  });

  it("completing last session sets guide status to completed", () => {
    const guide = makeGuide();
    // Mark sessions 1 & 2 as done
    guide.sessions[0].status = "done";
    guide.sessions[0].verifyChecks.forEach((c) => (c.checked = true));
    guide.sessions[1].status = "done";
    guide.sessions[1].verifyChecks.forEach((c) => (c.checked = true));
    // Session 3 is active with all checks done
    guide.sessions[2].status = "active";
    guide.sessions[2].verifyChecks[0].checked = true;
    useGuideStore.setState({ guide });

    const result = useGuideStore.getState().markSessionComplete(3);
    expect(result).toBe(true);
    expect(useGuideStore.getState().guide!.status).toBe("completed");
  });

  it("unloadGuide clears in-memory state without deleting from database", async () => {
    useGuideStore.setState({ guide: makeGuide() });

    useGuideStore.getState().unloadGuide();
    expect(useGuideStore.getState().guide).toBeNull();

    // Verify deleteGuide was NOT called
    const { deleteGuide } = await import("../lib/tauri-commands");
    expect(deleteGuide).not.toHaveBeenCalled();
  });

  it("dismissGuide clears state", async () => {
    useGuideStore.setState({ guide: makeGuide() });

    await useGuideStore.getState().dismissGuide();
    expect(useGuideStore.getState().guide).toBeNull();
  });

  it("updateSessionStatus changes session status", () => {
    useGuideStore.setState({ guide: makeGuide() });

    useGuideStore.getState().updateSessionStatus(2, "active");
    expect(useGuideStore.getState().guide!.sessions[1].status).toBe("active");
  });
});
