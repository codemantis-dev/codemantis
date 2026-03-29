// ═══════════════════════════════════════════════════════════════════════
// Implementation Guide — Type definitions
// ═══════════════════════════════════════════════════════════════════════

export interface ImplementationGuide {
  id: string;
  projectPath: string;
  specFilename: string;
  auditFilename: string | null;
  title: string;
  sessions: GuideSession[];
  createdAt: string;
  status: "active" | "completed";
}

export interface GuideSession {
  index: number;
  name: string;
  scope: string;
  readSections: string;
  files: string[];
  prompt: string;
  verifyChecks: VerifyCheck[];
  status: "pending" | "active" | "done";
  promptSent?: boolean;
  verifyRequested?: boolean;
}

export interface VerifyCheck {
  id: string;
  label: string;
  checked: boolean;
}
