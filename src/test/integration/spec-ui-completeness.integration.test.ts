/**
 * Integration regression for the SpecWriter UI-completeness audit.
 *
 * Feeds deliberately UI-incomplete and UI-complete specs through the full
 * audit pipeline and asserts that the new cross-cutting UI checks
 * (orphan entities, untriggered endpoints, invisible errors, session
 * outcomes, foundation contiguity, form validation, list states)
 * surface end-to-end into failures + recheck prompts + report
 * summary — exactly what `CoveragePanel` consumes.
 */
import { describe, it, expect } from "vitest";
import { auditCoverage, summarizeReport, describeFailure } from "../../lib/spec-coverage-audit";
import { parseAuditPatch, applyAuditPatch } from "../../lib/spec-audit-patch";

const UI_INCOMPLETE_SPEC = `---

# Acme Dashboard — Requirements Specification

## 1. Overview
A project management dashboard for small teams.

## 2. Data Model

### User
- id (uuid, PK)
- email (text, unique)
- name (text)

### Project
- id (uuid, PK)
- name (text)
- owner_id (uuid, FK → User.id)

## 3. Pages & Routes
- /dashboard — main view

## 6. API
### POST /api/projects
- creates a project
- returns the created project

### GET /api/projects
- lists projects for the current user

## 7. Error Handling & Edge Cases
When the API fails the request fails. The user retries. Errors include
500, 404, network errors, and validation problems. The system logs each
failure for debugging.

## 9. Implementation Checklist
### Phase 1: Foundation
- [ ] Scaffold project

## 10. Session Plan

### Session 1: Database scaffold
**Scope:** schema setup
**Read sections:** §2
**Files:**
- \`db/schema.sql\` (create)

### Session 2: Build the dashboard
**Scope:** dashboard work
**User-visible outcome:** user navigates to /dashboard and sees the project list with empty state, loading skeleton, and error banner

### Session 3: Auth scaffold
**User-visible outcome:** (foundation)
**Foundation justification:** auth backend wiring
`;

const UI_COMPLETE_SPEC = `---

# Acme Dashboard — Requirements Specification

## 1. Overview
A project management dashboard.

## 2. Data Model

### User
- id (uuid, PK)
- email (text, unique)
Screens: SignupPage, SignInPage, ProfileEditPage

### Project
- id (uuid, PK)
- name (text)
Screens: ProjectListPage, ProjectDetailPage, CreateProjectModal, DeleteConfirmModal

## 3. Pages & Routes
- /dashboard
- /projects
- /projects/:id

## 6. API
### POST /api/projects
- creates a project
Triggered by: CreateProjectModal "Create" button

### GET /api/projects
- lists projects
Triggered by: ProjectListPage on mount

## 7. Error Handling & Edge Cases
On API failure show a toast: "Failed to load. Please try again."
Recovery: user clicks retry which re-issues the call.
Validation errors render inline below each form field.

## 9. Implementation Checklist
### Phase 1: Foundation
- [ ] Scaffold

## 10. Session Plan

### Session 1: Foundation
**User-visible outcome:** (foundation)
**Foundation justification:** database schema + auth scaffolding required before any route is reachable

### Session 2: Dashboard
**User-visible outcome:** user navigates to /dashboard and sees the ProjectListPage with empty state, loading skeleton, and error banner; the SignupForm has email + password validation on submit.
`;

describe("spec UI-completeness audit — integration", () => {
  it("flags every UI gap in an incomplete spec end-to-end", () => {
    const report = auditCoverage([], UI_INCOMPLETE_SPEC, { skipForNewApp: true });

    expect(report.status).toBe("fail");

    // Orphan entities: User and Project both lack Screens:.
    const orphans = report.failures.filter((f) => f.kind === "ui-orphan-entity");
    expect(orphans.map((f) => (f.kind === "ui-orphan-entity" ? f.entity : "")))
      .toEqual(expect.arrayContaining(["User", "Project"]));

    // Untriggered endpoints: both POST and GET /api/projects lack Triggered by:.
    const untriggered = report.failures.filter((f) => f.kind === "ui-untriggered-endpoint");
    expect(untriggered.length).toBeGreaterThanOrEqual(2);

    // Error Handling section has no UI surface keywords.
    expect(report.failures.some((f) => f.kind === "ui-invisible-errors")).toBe(true);

    // Session 1 has no User-visible outcome: field.
    expect(
      report.failures.some(
        (f) => f.kind === "ui-session-no-outcome" && f.session.startsWith("Session 1"),
      ),
    ).toBe(true);

    // Session 3 is tagged (foundation) but appears AFTER Session 2's user-visible work.
    expect(
      report.failures.some(
        (f) => f.kind === "ui-foundation-non-contiguous" && f.session.startsWith("Session 3"),
      ),
    ).toBe(true);
  });

  it("propagates UI failures into the recheck prompt with actionable patch guidance", () => {
    const report = auditCoverage([], UI_INCOMPLETE_SPEC, { skipForNewApp: true });

    expect(report.recheckPrompts).toHaveLength(1);
    const prompt = report.recheckPrompts[0];
    expect(prompt).toContain("AUDIT-PATCH");
    expect(prompt).toContain("Screens:");
    expect(prompt).toContain("Triggered by:");
    expect(prompt).toMatch(/User-visible outcome/i);
    expect(prompt).toMatch(/foundation/i);
  });

  it("produces a FAIL summary that lists each UI failure category", () => {
    const report = auditCoverage([], UI_INCOMPLETE_SPEC, { skipForNewApp: true });
    const summary = summarizeReport(report);
    expect(summary).toMatch(/FAIL/);
    expect(summary).toMatch(/orphan entity/i);
    expect(summary).toMatch(/Triggered by/i);
    expect(summary).toMatch(/User-visible outcome/i);
  });

  it("exposes a human-readable description for every UI failure (CoveragePanel rendering contract)", () => {
    const report = auditCoverage([], UI_INCOMPLETE_SPEC, { skipForNewApp: true });
    for (const failure of report.failures) {
      const description = describeFailure(failure);
      expect(description.length).toBeGreaterThan(0);
      expect(description).not.toMatch(/undefined|\[object/i);
    }
  });

  it("passes a UI-complete spec without UI failures", () => {
    const report = auditCoverage([], UI_COMPLETE_SPEC, { skipForNewApp: true });
    const uiFailures = report.failures.filter((f) => f.kind.startsWith("ui-"));
    expect(uiFailures).toEqual([]);
  });

  it("skipUIChecks=true disables UI auditing on an incomplete spec", () => {
    const report = auditCoverage([], UI_INCOMPLETE_SPEC, {
      skipForNewApp: true,
      skipUIChecks: true,
    });
    const uiFailures = report.failures.filter((f) => f.kind.startsWith("ui-"));
    expect(uiFailures).toEqual([]);
  });

  // ─── ui-session-too-large → recheck → AUDIT-PATCH round trip ────────
  // This is the full pipeline for the Session 7 failure mode: the audit
  // flags the oversized session, the recheck prompt asks for a split using
  // suffix numbering, and the resulting AUDIT-PATCH cleanly merges into the
  // existing spec without renumbering later sessions.

  const OVERSIZED_SESSION_SPEC = [
    "# Acme — Spec",
    "",
    "## Session Plan",
    "",
    "### Session 6: Tiny prep",
    "**Scope:** schema only",
    "**Files:**",
    "- `migrations/001.sql` (create)",
    "**User-visible outcome:** schema in place.",
    "",
    "### Session 7: Notes-sync surfaces",
    "**Scope:** spans worker + edge fn + frontend + deploys",
    "**User-visible outcome:** everything at once.",
    "**Prompt:**",
    "1. Extend note_proactive_analysis.py with 2 new contradiction checks.",
    "2. Extend notes_sync_preview.py for ui_surface_diff.",
    "3. Extend notes_sync_apply.py to invoke apply_ui_note_targets_atomic.",
    "4. Add insert_ui_note_target worker action.",
    "5. Create NoteTargetSelector.tsx.",
    "6. Modify NoteCapturePanel.",
    "7. Modify SyncPreviewDialog.",
    "8. Create surfaces-regenerate edge function.",
    "9. Create RegenerationInbox page.",
    "10. Register route.",
    "11. Tests.",
    "12. Deploy worker.",
    "13. Deploy edge functions.",
    "14. Run pnpm check:worker-actions.",
    "",
    "### Session 8: Polish",
    "**Scope:** final pass",
    "**Files:**",
    "- `src/components/Dashboard.tsx` (modify)",
    "**User-visible outcome:** dashboard looks finished.",
    "",
  ].join("\n");

  it("flags the oversized session and emits an actionable split recheck prompt", () => {
    const report = auditCoverage([], OVERSIZED_SESSION_SPEC, { skipForNewApp: true });
    const tooLarge = report.failures.filter(
      (f): f is Extract<typeof f, { kind: "ui-session-too-large" }> =>
        f.kind === "ui-session-too-large",
    );
    expect(tooLarge).toHaveLength(1);
    expect(tooLarge[0].session).toContain("Session 7");
    expect(report.recheckPrompts).toHaveLength(1);
    expect(report.recheckPrompts[0]).toContain("AUDIT-PATCH");
    expect(report.recheckPrompts[0]).toContain("suffix numbering");
    expect(report.recheckPrompts[0]).toContain("Session 7: Notes-sync surfaces");
  });

  it("accepts a model-shaped AUDIT-PATCH reply that splits Session 7 into 7a/7b/7c", () => {
    // The model is expected to reply with this kind of envelope after seeing
    // the recheck prompt. Simulate it and run the splicer end-to-end.
    const reply = [
      "<!-- AUDIT-PATCH -->",
      '<!-- patch:replace-section heading="### Session 7: Notes-sync surfaces" -->',
      "### Session 7a: Worker contradictions + sync",
      "**Scope:** Worker-side changes only.",
      "**Files:**",
      "- `note_proactive_analysis.py` (modify)",
      "- `notes_sync_preview.py` (modify)",
      "- `notes_sync_apply.py` (modify)",
      "**User-visible outcome:** worker computes new contradiction kinds.",
      "",
      "### Session 7b: Frontend NoteTargetSelector",
      "**Scope:** Frontend-only changes.",
      "**Files:**",
      "- `src/components/NoteTargetSelector.tsx` (create)",
      "- `src/components/NoteCapturePanel.tsx` (modify)",
      "**User-visible outcome:** PM can pick a target when capturing.",
      "",
      "### Session 7c: Deploys",
      "**Scope:** Deploy worker + edge functions.",
      "**User-visible outcome:** all changes live in staging.",
      "**Prompt:**",
      "1. Deploy worker.",
      "2. Deploy edge functions.",
      "<!-- /patch -->",
    ].join("\n");

    const parsed = parseAuditPatch(reply);
    expect(parsed.ops).toHaveLength(1);
    const apply = applyAuditPatch(OVERSIZED_SESSION_SPEC, parsed.ops);
    expect(apply.errors).toEqual([]);
    expect(apply.merged).not.toBeNull();
    const merged = apply.merged!;
    expect(merged).not.toContain("### Session 7: Notes-sync surfaces");
    expect(merged).toContain("### Session 7a:");
    expect(merged).toContain("### Session 7b:");
    expect(merged).toContain("### Session 7c:");
    // Session 6 and Session 8 are still intact (no renumbering).
    expect(merged).toContain("### Session 6: Tiny prep");
    expect(merged).toContain("### Session 8: Polish");
  });
});
