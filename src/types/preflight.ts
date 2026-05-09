// Preflight System — TypeScript mirror of the Rust types in
// `src-tauri/src/preflight/`. Keep in sync — drift will silently mis-render
// status badges in Mission Control.

export type CapabilityState =
  | "unknown"
  | "detecting"
  | "satisfied"
  | "missing"
  | "stale"
  | "auto_installing"
  | "awaiting_user_action";

export interface CapabilityStatus {
  projectId: string;
  capabilityId: string;
  catalogRef?: string | null;
  state: CapabilityState;
  /** Unix epoch milliseconds. */
  lastChecked: number;
  message?: string | null;
  error?: string | null;
  detectionSource?: string | null;
  userAcknowledgedOptionalSkip: boolean;
}

export interface PreflightStatus {
  projectId: string;
  allSatisfied: boolean;
  blockingCount: number;
  optionalCount: number;
  capabilities: CapabilityStatus[];
}

export interface DetectionHit {
  capabilityId: string;
  /** "env_var" | "secret_store" | (Phase 5: "file") */
  source: string;
  confidence: number;
  suggestion?: string | null;
}

export type Category =
  | "auto_resolvable"
  | "guided_human"
  | "pre_existing_detection";

export interface ValueValidationRegex {
  kind: "regex";
  pattern: string;
  hint?: string | null;
  exampleFormat?: string | null;
}
export type ValueValidation = ValueValidationRegex | { kind: "unsupported" };

export type Verification =
  | {
      kind: "shell_command";
      command: string;
      successWhen?: string | null;
      timeoutMs: number;
    }
  | {
      kind: "env_var_present";
      varName: string;
      valueValidation?: ValueValidation | null;
    }
  | { kind: "secret_present"; key: string }
  | {
      kind: "api_probe";
      method: string;
      url: string;
      auth?: string | null;
      extraHeaders: Record<string, string>;
      successWhen?: string | null;
      timeoutMs: number;
    }
  | { kind: "unsupported" };

export interface DetectionHints {
  envVars: string[];
}

export interface Storage {
  kind: "secret_box" | "env_var" | "project_env_file" | "tauri_store";
  key: string;
}

export interface Capability {
  id: string;
  catalogRef: string;
  name: string;
  category: Category;
  purpose?: string | null;
  sessionsRequiring: string[];
  storage?: Storage | null;
  verification: Verification;
  valueValidation?: ValueValidation | null;
  required: boolean;
  blocksSelfDrive: boolean;
  detectionHints: DetectionHints;
}

export interface Manifest {
  schemaVersion: string;
  project: string;
  generatedBy?: string | null;
  generatedAt?: string | null;
  capabilities: Capability[];
}

export type ProgressStream = "stdout" | "stderr";

export interface InstallResult {
  success: boolean;
  exitCode?: number | null;
  message: string;
}

// ── Event payloads (fired from Rust via `app.emit`) ──

export interface VerificationStartedPayload {
  projectId: string;
  capabilityId: string;
}

export interface VerificationCompletePayload {
  projectId: string;
  capabilityId: string;
  status: CapabilityStatus;
}

export interface AllCompletePayload {
  projectId: string;
  status: PreflightStatus;
}

export interface InstallerProgressPayload {
  projectId: string;
  capabilityId: string;
  line: string;
  stream: ProgressStream;
}

export interface DetectionHitPayload {
  projectId: string;
  hit: DetectionHit;
}

// ── Event names (must match Rust constants in events.rs) ──

export const PREFLIGHT_EVENTS = {
  verificationStarted: "preflight:verification_started",
  verificationComplete: "preflight:verification_complete",
  allComplete: "preflight:all_complete",
  installerProgress: "preflight:installer_progress",
  detectionHit: "preflight:detection_hit",
} as const;
