/**
 * DuoDialogueView — the live back-and-forth between the primary and the mentor.
 * Mentor turns align left, primary turns right, each with a stance badge.
 */
import { useDuoStore } from "../../stores/duoStore";
import type { DuoDialogueTurn } from "../../types/duo";

function stanceColor(stance: DuoDialogueTurn["stance"]): string {
  switch (stance) {
    case "concern":
    case "propose":
      return "var(--yellow)";
    case "defend":
      return "var(--blue)";
    case "accept":
      return "var(--green)";
    default:
      return "var(--text-dim)";
  }
}

export default function DuoDialogueView(): React.ReactElement {
  const dialogue = useDuoStore((s) => s.dialogue);

  if (dialogue.length === 0) {
    return (
      <div
        className="rounded-lg border p-4 text-detail"
        style={{
          background: "var(--bg-elevated)",
          borderColor: "var(--border)",
          color: "var(--text-dim)",
        }}
      >
        No dialogue yet — the mentor and primary haven&apos;t needed to debate.
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border p-3 flex flex-col gap-2 max-h-80 overflow-y-auto"
      style={{ background: "var(--bg-elevated)", borderColor: "var(--border)" }}
    >
      {dialogue.map((turn) => {
        const isPrimary = turn.author === "primary";
        return (
          <div
            key={turn.id}
            className={`flex flex-col max-w-[80%] ${isPrimary ? "self-end items-end" : "self-start items-start"}`}
          >
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-detail font-medium" style={{ color: "var(--text-secondary)" }}>
                {isPrimary ? "Primary" : "Mentor"} · round {turn.round}
              </span>
              <span
                className="text-detail capitalize"
                style={{ color: stanceColor(turn.stance) }}
              >
                {turn.stance}
              </span>
            </div>
            <div
              className="rounded-md px-3 py-2 text-detail whitespace-pre-wrap"
              style={{
                background: isPrimary ? "var(--accent-dim)" : "var(--bg-subtle)",
                color: "var(--text-primary)",
              }}
            >
              {turn.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}
