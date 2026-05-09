// "I've done it manually — please re-check" step. Used for things CodeMantis
// can't verify directly (e.g. completing an OAuth consent screen). The user
// confirms; the parent runs the verification recipe and advances on success.

interface ManualConfirmStepProps {
  label?: string | null;
  /** Called when the user confirms; parent runs the verification. */
  onConfirm: () => void;
}

export default function ManualConfirmStep({
  label,
  onConfirm,
}: ManualConfirmStepProps) {
  return (
    <button
      type="button"
      onClick={onConfirm}
      className="px-4 py-2 rounded-md text-ui font-medium transition-colors"
      style={{ background: "var(--accent)", color: "white" }}
    >
      {label ?? "I've completed this step"}
    </button>
  );
}
