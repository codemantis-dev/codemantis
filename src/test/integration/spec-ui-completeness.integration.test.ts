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
});
