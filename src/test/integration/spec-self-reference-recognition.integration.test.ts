/**
 * Integration regression for the recurring "spec saved but not recognized as
 * a Guide" + "filenames in the spec body don't match the saved filename"
 * bug pair. Reproduces the failing flow on the real
 * `_examples/specloom-saas-multi.md` fixture and asserts the full save-time
 * pipeline (normalize body → parseSessionPlan → guideStore.createGuide)
 * produces a guide whose prompts reference the saved filename.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resetAllStores } from "../helpers/store-reset";
import { normalizeSpecSelfReferences } from "../../lib/spec-self-reference";
import { parseSessionPlan } from "../../lib/parse-session-plan";
import { useGuideStore } from "../../stores/guideStore";

vi.mock("../../lib/tauri-commands", () => ({
  saveGuide: vi.fn().mockResolvedValue("guide-test-id"),
  loadGuide: vi.fn().mockResolvedValue(null),
  updateGuideData: vi.fn().mockResolvedValue(undefined),
  deleteGuide: vi.fn().mockResolvedValue(undefined),
}));

const FIXTURE = readFileSync(
  join(process.cwd(), "_examples/specloom-saas-multi.md"),
  "utf-8",
);

const PROJECT = "/tmp/test-project";
const SAVED_FILENAME = "specloom-saas-multi.md";

beforeEach(() => {
  resetAllStores();
  vi.clearAllMocks();
});

describe("SpecWriter save-time recognition — specloom-saas-multi.md fixture", () => {
  it("normalizes self-references then parses an 8-session guide (Session 9 audit wrap-up skipped)", () => {
    const normalized = normalizeSpecSelfReferences(FIXTURE, SAVED_FILENAME);
    const parsed = parseSessionPlan(normalized);

    expect(parsed).not.toBeNull();
    expect(parsed!.sessions).toHaveLength(8);
    expect(parsed!.title).toBe(
      "SpecLoom SaaS Multi-Tenancy & Admin Layer",
    );
  });

  it("rewrites every internal docs/specs/ reference to the saved filename", () => {
    const normalized = normalizeSpecSelfReferences(FIXTURE, SAVED_FILENAME);

    // The fixture's placeholder filename "saas-multitenancy" must be gone.
    expect(normalized).not.toMatch(/docs\/specs\/saas-multitenancy\.md/);
    expect(normalized).not.toMatch(/docs\/specs\/saas-multitenancy\.audit\.md/);
    // Every internal reference now points at the chosen filename pair.
    expect(normalized).toContain(`docs/specs/${SAVED_FILENAME}`);
    expect(normalized).toContain(
      `docs/specs/${SAVED_FILENAME.replace(/\.md$/, ".audit.md")}`,
    );
  });

  it("createGuide produces an in-memory guide whose prompts reference the saved filename", async () => {
    const normalized = normalizeSpecSelfReferences(FIXTURE, SAVED_FILENAME);
    const parsed = parseSessionPlan(normalized);
    expect(parsed).not.toBeNull();

    const ok = await useGuideStore
      .getState()
      .createGuide(PROJECT, SAVED_FILENAME, null, parsed!);
    expect(ok).toBe(true);

    const guide = useGuideStore.getState().guide!;
    expect(guide).not.toBeNull();
    expect(guide.specFilename).toBe(SAVED_FILENAME);
    expect(guide.sessions).toHaveLength(8);

    // No prompt may reference the placeholder filename.
    for (const session of guide.sessions) {
      expect(session.prompt).not.toContain("saas-multitenancy.md");
      expect(session.prompt).not.toContain("saas-multitenancy.audit.md");
    }
    // At least one prompt must reference the actual saved filename.
    const anyReferencesSaved = guide.sessions.some((s) =>
      s.prompt.includes(`docs/specs/${SAVED_FILENAME}`),
    );
    expect(anyReferencesSaved).toBe(true);
  });
});
