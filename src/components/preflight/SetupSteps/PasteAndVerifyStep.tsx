// The workhorse step: user pastes a value, we live-validate against the
// regex (green/red border as they type), then "Verify" runs the real
// verification recipe (api_probe / secret_present etc.) and reports back.
//
// On success: auto-advance via onSuccess. On failure: surface the catalog's
// troubleshooting hint or the verifier's error message.

import { useState } from "react";
import { Check, AlertCircle, Loader2 } from "lucide-react";
import type { ValueValidation } from "../../../types/preflight";

interface PasteAndVerifyStepProps {
  /** Catalog's value_validation block — drives the inline regex check. */
  validation?: ValueValidation | null;
  /**
   * Called when the user clicks "Verify". Should:
   *  1. Store the secret (preflightStoreSecret)
   *  2. Run verification (preflightVerifyOne)
   *  3. Return Ok-with-message on success, or Err-with-message on failure.
   */
  onVerify: (value: string) => Promise<{ ok: true; message?: string } | { ok: false; error: string }>;
  /** Fired once verification has succeeded. */
  onSuccess: () => void;
  placeholder?: string;
}

export default function PasteAndVerifyStep({
  validation,
  onVerify,
  onSuccess,
  placeholder,
}: PasteAndVerifyStepProps) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const validity = checkRegex(value, validation);
  const canVerify = value.trim().length > 0 && validity !== "invalid" && !busy;

  const handleVerify = async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const result = await onVerify(value.trim());
    setBusy(false);
    if (result.ok) {
      setSuccess(result.message ?? "Verified");
      // Brief pause so the user sees the green tick before the modal advances.
      setTimeout(onSuccess, 600);
    } else {
      setError(result.error);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder ?? "Paste the value here"}
          autoComplete="off"
          autoFocus
          className="w-full px-3 py-2 rounded-md outline-none text-ui transition-colors"
          style={{
            background: "var(--bg-elevated)",
            border: `1px solid ${
              validity === "valid"
                ? "rgb(34, 197, 94)"
                : validity === "invalid"
                  ? "rgb(239, 68, 68)"
                  : "var(--border)"
            }`,
            color: "var(--text-primary)",
          }}
        />
        {validation?.kind === "regex" && validation.exampleFormat && (
          <p className="text-detail text-text-ghost mt-1">
            Format: <code>{validation.exampleFormat}</code>
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={handleVerify}
        disabled={!canVerify}
        className="px-4 py-2 rounded-md text-ui font-medium transition-colors disabled:opacity-50"
        style={{ background: "var(--accent)", color: "white" }}
      >
        {busy ? (
          <>
            <Loader2 size={14} className="animate-spin inline mr-1.5" />
            Verifying…
          </>
        ) : (
          "Verify"
        )}
      </button>

      {success && (
        <p
          className="text-detail flex items-center gap-1.5"
          style={{ color: "rgb(34, 197, 94)" }}
        >
          <Check size={14} />
          {success}
        </p>
      )}

      {error && (
        <p
          className="text-detail flex items-start gap-1.5"
          style={{ color: "rgb(239, 68, 68)" }}
        >
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      {validation?.kind === "regex" && validation.hint && validity === "invalid" && (
        <p className="text-detail text-text-dim">{validation.hint}</p>
      )}
    </div>
  );
}

type Validity = "neutral" | "valid" | "invalid";

function checkRegex(value: string, validation?: ValueValidation | null): Validity {
  if (!value.trim()) return "neutral";
  if (!validation || validation.kind !== "regex") return "neutral";
  try {
    const re = new RegExp(validation.pattern);
    return re.test(value.trim()) ? "valid" : "invalid";
  } catch {
    return "neutral";
  }
}
