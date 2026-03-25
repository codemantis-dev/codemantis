import { describe, it, expect } from "vitest";
import { parseSelectableOptions } from "./spec-option-parser";

// ═══════════════════════════════════════════════════════════════════════
// Primary ?> marker parsing
// ═══════════════════════════════════════════════════════════════════════

describe("parseSelectableOptions — primary ?> markers", () => {
  it("extracts standard ?> options", () => {
    const content = `Here is my question:\n?> Option A\n?> Option B\n?> Option C`;
    const result = parseSelectableOptions(content);
    expect(result).not.toBeNull();
    expect(result!.options).toEqual(["Option A", "Option B", "Option C"]);
    expect(result!.cleanContent).toBe("Here is my question:");
  });

  it("handles leading whitespace on ?> lines", () => {
    const content = `Question?\n  ?> Alpha\n  ?> Beta`;
    const result = parseSelectableOptions(content);
    expect(result).not.toBeNull();
    expect(result!.options).toEqual(["Alpha", "Beta"]);
  });

  it("preserves star markers in option text", () => {
    const content = `Select features:\n?> ★ Auth — recommended\n?> Dashboard`;
    const result = parseSelectableOptions(content);
    expect(result!.options).toEqual(["★ Auth — recommended", "Dashboard"]);
  });

  it("strips ?> lines from clean content", () => {
    const content = `Intro text\n\n?> A\n?> B\n\nTrailing text`;
    const result = parseSelectableOptions(content);
    expect(result!.cleanContent).toBe("Intro text\n\n\nTrailing text");
  });

  it("returns null when no patterns match", () => {
    const content = `Just a normal response with no options at all.`;
    expect(parseSelectableOptions(content)).toBeNull();
  });

  it("sweeps adjacent bullets alongside ?> markers (format drift)", () => {
    const content = `Select which features to include:\n?> Auth\n?> Dashboard\n- Settings page`;
    const result = parseSelectableOptions(content);
    expect(result!.options).toEqual(["Auth", "Dashboard", "Settings page"]);
  });

  it("does NOT sweep distant bullets into ?> results", () => {
    const content = `?> Auth\n?> Dashboard\n\nHere are the implementation details:\n\nThe architecture uses:\n- API Gateway\n- Auth Service\n- Database`;
    const result = parseSelectableOptions(content);
    expect(result!.options).toEqual(["Auth", "Dashboard"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Fallback: markdown checkboxes
// ═══════════════════════════════════════════════════════════════════════

describe("parseSelectableOptions — fallback checkboxes", () => {
  it("detects - [ ] checkboxes after selection trigger", () => {
    const content = `Here are the features I'll include. Select which ones to include:\n\n- [ ] User authentication\n- [ ] Dashboard\n- [ ] Settings page`;
    const result = parseSelectableOptions(content);
    expect(result).not.toBeNull();
    expect(result!.options).toEqual(["User authentication", "Dashboard", "Settings page"]);
  });

  it("detects - [x] pre-checked checkboxes", () => {
    const content = `Choose which to include:\n- [x] Auth\n- [ ] Dashboard\n- [x] API`;
    const result = parseSelectableOptions(content);
    expect(result!.options).toEqual(["Auth", "Dashboard", "API"]);
  });

  it("strips checkbox lines from clean content", () => {
    const content = `Intro.\n\nSelect which features to include:\n\n- [ ] A\n- [ ] B\n\nFooter text.`;
    const result = parseSelectableOptions(content);
    expect(result!.cleanContent).toContain("Intro.");
    expect(result!.cleanContent).toContain("Select which features to include:");
    expect(result!.cleanContent).toContain("Footer text.");
    expect(result!.cleanContent).not.toContain("- [ ]");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Fallback: numbered lists
// ═══════════════════════════════════════════════════════════════════════

describe("parseSelectableOptions — fallback numbered lists", () => {
  it("detects numbered list after selection trigger", () => {
    const content = `How would you like to handle these?\n\n1. Use a task queue\n2. Use WebSockets\n3. Use polling`;
    const result = parseSelectableOptions(content);
    expect(result).not.toBeNull();
    expect(result!.options).toEqual(["Use a task queue", "Use WebSockets", "Use polling"]);
  });

  it("handles 1) parenthesis format", () => {
    const content = `Select which approach:\n1) Server-side rendering\n2) Client-side rendering`;
    const result = parseSelectableOptions(content);
    expect(result!.options).toEqual(["Server-side rendering", "Client-side rendering"]);
  });

  it("preserves bold markers in options", () => {
    const content = `Choose which features to include:\n1. **Authentication** — email + OAuth\n2. **Dashboard** — metric cards`;
    const result = parseSelectableOptions(content);
    expect(result!.options).toEqual(["**Authentication** — email + OAuth", "**Dashboard** — metric cards"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Fallback: bullet lists
// ═══════════════════════════════════════════════════════════════════════

describe("parseSelectableOptions — fallback bullet lists", () => {
  it("detects bullet list after selection trigger", () => {
    const content = `Here are the options:\n\n- Background workers\n- Serverless functions\n- Cron jobs`;
    const result = parseSelectableOptions(content);
    expect(result).not.toBeNull();
    expect(result!.options).toEqual(["Background workers", "Serverless functions", "Cron jobs"]);
  });

  it("handles * bullets", () => {
    const content = `Select which features to include:\n* Auth\n* Dashboard\n* Settings`;
    const result = parseSelectableOptions(content);
    expect(result!.options).toEqual(["Auth", "Dashboard", "Settings"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// False positive prevention
// ═══════════════════════════════════════════════════════════════════════

describe("parseSelectableOptions — false positive prevention", () => {
  it("does NOT parse bullet list without a selection trigger", () => {
    const content = `The architecture uses these components:\n\n- API Gateway\n- Auth Service\n- Database`;
    expect(parseSelectableOptions(content)).toBeNull();
  });

  it("does NOT parse numbered steps without a selection trigger", () => {
    const content = `Here's how the flow works:\n\n1. User logs in\n2. Token is issued\n3. Token is stored`;
    expect(parseSelectableOptions(content)).toBeNull();
  });

  it("does NOT parse list more than 3 blank lines from trigger", () => {
    const content = `Select which to include:\n\n\n\n\n- Auth\n- Dashboard`;
    expect(parseSelectableOptions(content)).toBeNull();
  });

  it("requires at least 2 items for fallback", () => {
    const content = `Select which features to include:\n- Only one item`;
    expect(parseSelectableOptions(content)).toBeNull();
  });

  it("does NOT parse implementation checklists as options", () => {
    const content = `### Phase 1: Foundation\n- [ ] Scaffold project\n- [ ] Configure database\n- [ ] Run migrations`;
    expect(parseSelectableOptions(content)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Real-world Gemini response patterns (from the reported issue)
// ═══════════════════════════════════════════════════════════════════════

describe("parseSelectableOptions — real-world Gemini patterns", () => {
  it("detects feature list from Gemini's first response pattern", () => {
    const content = `I've reviewed your project. It's a FastAPI backend with a React/TypeScript frontend.

Feature Selection

Based on your requirements, here are the features I'll include in the specification. Select which ones to include for this phase of the project:

- [ ] Maturity Model CRUD
- [ ] Domain & Aspect Management
- [ ] Question Bank with 1000+ questions
- [ ] AI-powered quality control
- [ ] Export to PDF/Excel
- [ ] Real-time collaboration

Use the checkboxes above to select your desired features.`;
    const result = parseSelectableOptions(content);
    expect(result).not.toBeNull();
    expect(result!.options).toHaveLength(6);
    expect(result!.options[0]).toBe("Maturity Model CRUD");
    expect(result!.options[5]).toBe("Real-time collaboration");
  });

  it("detects numbered architecture decisions from Gemini", () => {
    const content = `Architecture Question: Long-Running AI Jobs

Generating a maturity model with up to 1000 questions will take significant time. How would you like to handle these long-running tasks?

1. Background task queue (Celery/Redis)
2. WebSocket-based streaming
3. Polling with job status endpoint
4. Server-Sent Events (SSE)`;
    const result = parseSelectableOptions(content);
    expect(result).not.toBeNull();
    expect(result!.options).toHaveLength(4);
    expect(result!.options[0]).toBe("Background task queue (Celery/Redis)");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Format drift: mixed ?> and markdown items (the reported bug)
// ═══════════════════════════════════════════════════════════════════════

describe("parseSelectableOptions — format drift (mixed ?> + markdown)", () => {
  it("collects all 18 items when AI mixes ?> and bullets", () => {
    const content = `Here are all the features I'll include. Select which to include:

?> ★ QCModel entity — new DB table
?> ★ Quality Check landing page — stats overview
?> ★ Cancel QC job — hard stop
?> ★ Resume paused QC job — continues
?> ★ Side-by-side diff view — original vs QC-ed
?> ★ Download QC-ed model as JSON
?> ★ Promote to Models Workspace — one-way export
?> "Quality Check" sidebar nav item
?> Landing page stats cards — total uploaded
?> Job progress banner on dashboard
?> ★ Upload maturity model JSON — parse on upload
?> ★ QCModel table columns — status badge, name
?> ★ Active job progress widget on landing page
?> ★ QC model detail page — metadata panel
- ★ Start QC job dialog — select AI provider
- ★ Question-by-question Celery worker
- ★ Real-time progress in detail page
- ★ Pause QC job — graceful`;
    const result = parseSelectableOptions(content);
    expect(result).not.toBeNull();
    expect(result!.options).toHaveLength(18);
    expect(result!.options[0]).toBe("★ QCModel entity — new DB table");
    expect(result!.options[13]).toBe("★ QC model detail page — metadata panel");
    expect(result!.options[14]).toBe("★ Start QC job dialog — select AI provider");
    expect(result!.options[17]).toBe("★ Pause QC job — graceful");
  });

  it("collects all items when AI drifts from ?> to numbered", () => {
    const content = `Select which features to include:

?> ★ Authentication
?> ★ Dashboard
?> ★ Settings
1. API endpoints
2. Database migrations`;
    const result = parseSelectableOptions(content);
    expect(result).not.toBeNull();
    expect(result!.options).toHaveLength(5);
    expect(result!.options[3]).toBe("API endpoints");
    expect(result!.options[4]).toBe("Database migrations");
  });

  it("handles large list of 18+ pure ?> markers without truncation", () => {
    const items = Array.from({ length: 20 }, (_, i) => `?> Feature ${i + 1}`);
    const content = `Select features:\n\n${items.join("\n")}`;
    const result = parseSelectableOptions(content);
    expect(result).not.toBeNull();
    expect(result!.options).toHaveLength(20);
    expect(result!.options[0]).toBe("Feature 1");
    expect(result!.options[19]).toBe("Feature 20");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Fallback parser resilience (sub-headers, interruptions)
// ═══════════════════════════════════════════════════════════════════════

describe("parseSelectableOptions — fallback parser resilience", () => {
  it("collects items across a sub-header interruption", () => {
    const content = `Here are the features I'll include. Select which to include:

- Authentication
- Dashboard
**Nice to have:**
- Settings page
- Notifications`;
    const result = parseSelectableOptions(content);
    expect(result).not.toBeNull();
    expect(result!.options).toHaveLength(4);
    expect(result!.options).toEqual([
      "Authentication", "Dashboard", "Settings page", "Notifications",
    ]);
  });

  it("stops collecting when list truly ends (2+ non-matching lines)", () => {
    const content = `Select which features to include:

- Auth
- Dashboard

That covers the main features. Let me know if you want to add more.

Also, regarding the timeline, we should plan for 3 sprints.`;
    const result = parseSelectableOptions(content);
    expect(result).not.toBeNull();
    expect(result!.options).toEqual(["Auth", "Dashboard"]);
  });
});
