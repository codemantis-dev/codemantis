// SetupFlowModal — guided stepper that walks the user through whatever the
// catalog entry's `remediation` block prescribes. One step at a time, no
// jumping backwards (we never want to "undo" a verification step).
//
// "Skip for now" is ALWAYS visible. Even on a blocking capability we never
// trap the user — Mission Control surfaces consequences honestly but the
// modal itself is exit-friendly.

import { useState, useMemo } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, ChevronRight } from "lucide-react";
import type { Capability, ValueValidation } from "../../types/preflight";
import { usePreflightStore } from "../../stores/preflightStore";
import {
  preflightStoreSecret,
  preflightVerifyOne,
} from "../../lib/tauri-commands";
import OpenUrlStep from "./SetupSteps/OpenUrlStep";
import PasteAndVerifyStep from "./SetupSteps/PasteAndVerifyStep";
import ConfirmInstallStep from "./SetupSteps/ConfirmInstallStep";
import ManualConfirmStep from "./SetupSteps/ManualConfirmStep";
import AiGeneratedBanner from "./AiGeneratedBanner";

// Trimmed version of the catalog's RemediationStep — everything we need to
// render one step. Caller flattens whatever shape the catalog hands us.
export interface FlowStep {
  id: number;
  title: string;
  body?: string | null;
  action?: FlowAction | null;
}
export type FlowAction =
  | { kind: "open_url"; url: string; label?: string | null }
  | { kind: "paste_and_verify" }
  | { kind: "confirm_install"; command: string; args: string[] }
  | { kind: "manual_confirm"; label?: string | null };

export interface SetupFlowDefinition {
  capability: Capability;
  serviceName: string;
  /** Catalog's value_validation, used by the paste-and-verify step. */
  validation?: ValueValidation | null;
  /** Whether the catalog entry was AI-generated (drives the banner). */
  aiGenerated?: boolean;
  aiCrossVerified?: boolean;
  steps: FlowStep[];
}

interface SetupFlowModalProps {
  open: boolean;
  projectPath: string;
  flow: SetupFlowDefinition | null;
  onClose: () => void;
  /** Optional callback when verification finishes successfully. */
  onSatisfied?: () => void;
}

export default function SetupFlowModal({
  open,
  projectPath,
  flow,
  onClose,
  onSatisfied,
}: SetupFlowModalProps) {
  const [stepIndex, setStepIndex] = useState(0);
  // IMPORTANT: select stable references only (never compute new arrays/objects
  // inside a Zustand selector — that triggers an infinite render loop).
  const allInstallerLogs = usePreflightStore((s) => s.installerLogs);
  const runAutoInstall = usePreflightStore((s) => s.runAutoInstall);
  const verifyOne = usePreflightStore((s) => s.verifyOne);
  const installerLogs = flow ? allInstallerLogs[flow.capability.id] ?? [] : [];

  // Reset when the modal opens for a new flow.
  const stepCount = flow?.steps.length ?? 0;
  const step = flow && stepIndex < stepCount ? flow.steps[stepIndex] : null;

  const advance = () => {
    if (!flow) return;
    if (stepIndex + 1 >= stepCount) {
      onSatisfied?.();
      onClose();
      setStepIndex(0);
    } else {
      setStepIndex(stepIndex + 1);
    }
  };

  const handleClose = () => {
    setStepIndex(0);
    onClose();
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-50"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
        />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 rounded-xl border overflow-hidden flex flex-col"
          style={{
            background: "var(--bg-primary)",
            borderColor: "var(--border)",
            width: "min(92vw, 560px)",
            maxHeight: "min(86vh, 700px)",
          }}
        >
          {flow && step ? (
            <>
              <header className="px-5 pt-4 pb-3 border-b" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center justify-between">
                  <Dialog.Title className="text-ui font-semibold text-text-primary">
                    Set up {flow.serviceName}
                  </Dialog.Title>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="text-text-dim hover:text-text-primary"
                    aria-label="Close"
                  >
                    <X size={16} />
                  </button>
                </div>
                <Stepper count={stepCount} active={stepIndex} />
              </header>

              <div className="px-5 py-4 overflow-auto flex-1 space-y-3">
                {flow.aiGenerated && (
                  <AiGeneratedBanner crossVerified={!!flow.aiCrossVerified} />
                )}
                <h3 className="text-ui font-semibold text-text-primary">{step.title}</h3>
                {step.body && (
                  <p className="text-label text-text-secondary leading-relaxed whitespace-pre-line">
                    {step.body}
                  </p>
                )}
                <StepRenderer
                  step={step}
                  capability={flow.capability}
                  projectPath={projectPath}
                  validation={flow.validation ?? null}
                  installerLogs={installerLogs}
                  onAdvance={advance}
                  runAutoInstall={runAutoInstall}
                  verifyOne={verifyOne}
                />
              </div>

              <footer
                className="px-5 py-3 border-t flex items-center justify-between"
                style={{ borderColor: "var(--border)" }}
              >
                <span className="text-detail text-text-dim">
                  Step {stepIndex + 1} of {stepCount}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-3 py-1.5 rounded-md text-ui text-text-secondary hover:text-text-primary"
                  >
                    Skip for now
                  </button>
                  {!step.action && (
                    <button
                      type="button"
                      onClick={advance}
                      className="px-3 py-1.5 rounded-md text-ui font-medium flex items-center gap-1"
                      style={{ background: "var(--accent)", color: "white" }}
                    >
                      Next
                      <ChevronRight size={14} />
                    </button>
                  )}
                </div>
              </footer>
            </>
          ) : (
            <div className="p-6 text-text-dim text-ui">No setup flow available.</div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Stepper({ count, active }: { count: number; active: number }) {
  return (
    <div className="flex gap-1.5 mt-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-1 flex-1 rounded-full transition-colors"
          style={{
            background:
              i < active
                ? "rgb(34, 197, 94)"
                : i === active
                  ? "var(--accent)"
                  : "var(--border)",
          }}
          data-testid="stepper-segment"
          data-active={i === active}
        />
      ))}
    </div>
  );
}

interface StepRendererProps {
  step: FlowStep;
  capability: Capability;
  projectPath: string;
  validation: ValueValidation | null;
  installerLogs: string[];
  onAdvance: () => void;
  runAutoInstall: (path: string, capId: string) => Promise<void>;
  verifyOne: (path: string, capId: string) => Promise<void>;
}

function StepRenderer({
  step,
  capability,
  projectPath,
  validation,
  installerLogs,
  onAdvance,
  runAutoInstall,
  verifyOne,
}: StepRendererProps) {
  const action = step.action;
  return useMemo(() => {
    if (!action) return null;
    switch (action.kind) {
      case "open_url":
        return (
          <OpenUrlStep
            url={action.url}
            label={action.label ?? null}
            onContinue={onAdvance}
          />
        );
      case "paste_and_verify":
        return (
          <PasteAndVerifyStep
            validation={validation}
            onSuccess={onAdvance}
            onVerify={async (value) => {
              try {
                await preflightStoreSecret(projectPath, capability.id, value);
                const status = await preflightVerifyOne(projectPath, capability.id);
                if (status.state === "satisfied") {
                  return { ok: true, message: status.message ?? "Verified" };
                }
                return {
                  ok: false,
                  error: status.message ?? status.error ?? "Verification didn't pass",
                };
              } catch (e) {
                return { ok: false, error: String(e) };
              }
            }}
          />
        );
      case "confirm_install":
        return (
          <ConfirmInstallStep
            command={action.command}
            args={action.args}
            installerLogs={installerLogs}
            onConfirm={async () => {
              await runAutoInstall(projectPath, capability.id);
            }}
            onSuccess={onAdvance}
          />
        );
      case "manual_confirm":
        return (
          <ManualConfirmStep
            label={action.label ?? null}
            onConfirm={async () => {
              await verifyOne(projectPath, capability.id);
              onAdvance();
            }}
          />
        );
    }
  }, [
    action,
    capability.id,
    installerLogs,
    onAdvance,
    projectPath,
    runAutoInstall,
    validation,
    verifyOne,
  ]);
}
