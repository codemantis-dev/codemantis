// Visual icon for a capability. Catalog entries reference an `icon` filename
// (e.g. "stripe.svg"). For Phase 3 we ship the components but not yet the
// SVG art — fall back to a category-tinted circle with the first letter of
// the service name. Phase 5 ships the real SVGs alongside community catalog
// contributions.

interface CapabilityIconProps {
  serviceName: string;
  /** Optional icon filename declared in the catalog entry (Phase 5 assets). */
  iconFile?: string | null;
  /** Service category — drives the fallback colour band. */
  category?: string | null;
  size?: number;
}

const CATEGORY_COLOURS: Record<string, string> = {
  llm_provider: "rgb(124, 58, 237)", // accent purple
  payments: "rgb(34, 197, 94)", // green
  email: "rgb(59, 130, 246)", // blue
  backend: "rgb(20, 184, 166)", // teal
  auth: "rgb(245, 158, 11)", // amber
  runtime: "rgb(168, 85, 247)", // violet
  package_manager: "rgb(236, 72, 153)", // pink
  version_control: "rgb(107, 114, 128)", // grey
  containerization: "rgb(14, 165, 233)", // sky
};

function categoryColour(category?: string | null): string {
  if (!category) return "rgb(99, 102, 241)";
  return CATEGORY_COLOURS[category] ?? "rgb(99, 102, 241)";
}

export default function CapabilityIcon({
  serviceName,
  iconFile,
  category,
  size = 32,
}: CapabilityIconProps) {
  // Phase 5: when SVGs ship in catalog/icons/, attempt to load via Tauri
  // resource resolver. For now, fall through to the letter circle.
  void iconFile;

  const initial = (serviceName || "?").trim().charAt(0).toUpperCase();
  const colour = categoryColour(category);

  return (
    <div
      aria-hidden="true"
      className="rounded-full flex items-center justify-center shrink-0 font-semibold"
      style={{
        width: size,
        height: size,
        background: `color-mix(in srgb, ${colour} 18%, transparent)`,
        color: colour,
        fontSize: size * 0.4,
      }}
    >
      {initial}
    </div>
  );
}
