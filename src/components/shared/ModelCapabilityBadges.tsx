import type { OpenRouterModel } from "../../types/assistant-provider";

interface Props {
  model: OpenRouterModel;
  showText?: boolean;
}

export default function ModelCapabilityBadges({ model, showText = false }: Props) {
  const supportsImage = model.inputModalities.includes("image");
  const supportsFile = model.inputModalities.includes("file");

  return (
    <span className="inline-flex items-center gap-0.5">
      {model.isFree && (
        <span
          className="px-1 py-px rounded text-micro font-medium leading-tight"
          style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }}
          title="Free model"
        >
          {showText ? "FREE" : "F"}
        </span>
      )}
      {supportsImage && (
        <span
          className="px-1 py-px rounded text-micro leading-tight"
          style={{ background: "color-mix(in srgb, var(--text-dim) 12%, transparent)", color: "var(--text-dim)" }}
          title="Supports image inputs"
        >
          IMG
        </span>
      )}
      {supportsFile && (
        <span
          className="px-1 py-px rounded text-micro leading-tight"
          style={{ background: "color-mix(in srgb, var(--text-dim) 12%, transparent)", color: "var(--text-dim)" }}
          title="Supports file/document inputs"
        >
          DOC
        </span>
      )}
    </span>
  );
}
