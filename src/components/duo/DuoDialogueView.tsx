/**
 * DuoDialogueView — the real conversation between the primary and the mentor.
 *
 * Renders the full timeline: primary turns (right), mentor reviews (left, with
 * the verdict result — stance, build/test outcome, confidence), and centered
 * system markers for outcomes/decisions (repair directed, agreement reached,
 * tie-break, drift, budget). Auto-scrolls to the latest entry.
 */
import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  XCircle,
  Wrench,
  Gavel,
  AlertTriangle,
  CircleDollarSign,
  Flag,
} from "lucide-react";
import { useDuoStore } from "../../stores/duoStore";
import { Badge } from "./DuoPrimitives";
import { levelColor } from "./duo-colors";
import type { DuoDialogueTurn } from "../../types/duo";

const PRIMARY_PREVIEW_CHARS = 280;

function systemStyle(stance: DuoDialogueTurn["stance"]): { color: string; Icon: typeof Flag } {
  switch (stance) {
    case "resolve":
      return { color: "var(--green)", Icon: CheckCircle2 };
    case "repair":
      return { color: "var(--yellow)", Icon: Wrench };
    case "drift":
      return { color: "var(--red)", Icon: AlertTriangle };
    case "budget":
      return { color: "var(--red)", Icon: CircleDollarSign };
    case "decision":
    default:
      return { color: "var(--blue)", Icon: Gavel };
  }
}

function SystemMarker({ turn }: { turn: DuoDialogueTurn }): React.ReactElement {
  const { color, Icon } = systemStyle(turn.stance);
  return (
    <div className="flex items-center justify-center my-1">
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-detail"
        style={{ color, background: "var(--bg-subtle)" }}
      >
        <Icon size={12} />
        {turn.text}
      </span>
    </div>
  );
}

function RanCheck({ ran, label }: { ran: boolean; label: string }): React.ReactElement {
  return (
    <span
      className="inline-flex items-center gap-1 text-detail"
      style={{ color: ran ? "var(--green)" : "var(--text-dim)" }}
    >
      {ran ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
      {label}
    </span>
  );
}

function VerdictChips({ verdict }: { verdict: NonNullable<DuoDialogueTurn["verdict"]> }): React.ReactElement {
  return (
    <div className="flex items-center gap-2 flex-wrap mt-1">
      <Badge text={verdict.stance} color={levelColor(verdict.stance === "agree" ? "improving" : "regressing")} />
      <Badge text={verdict.severity} color={levelColor(verdict.severity)} />
      <RanCheck ran={verdict.ranBuild} label="build" />
      <RanCheck ran={verdict.ranTests} label="tests" />
      <span className="text-detail" style={{ color: "var(--text-dim)" }}>
        {Math.round((verdict.confidence ?? 0) * 100)}% conf
      </span>
    </div>
  );
}

function AgentBubble({ turn }: { turn: DuoDialogueTurn }): React.ReactElement {
  const isPrimary = turn.author === "primary";
  const [expanded, setExpanded] = useState(false);
  const long = turn.text.length > PRIMARY_PREVIEW_CHARS;
  const body = isPrimary && long && !expanded
    ? turn.text.slice(0, PRIMARY_PREVIEW_CHARS) + "…"
    : turn.text;
  const label = isPrimary ? "Primary" : "Mentor";

  return (
    <div className={`flex flex-col max-w-[85%] ${isPrimary ? "self-end items-end" : "self-start items-start"}`}>
      <div className="flex items-center gap-2 mb-0.5">
        <span className="text-detail font-medium" style={{ color: "var(--text-secondary)" }}>
          {label}
          {turn.round > 0 ? ` · round ${turn.round}` : ""}
        </span>
      </div>
      <div
        className="rounded-md px-3 py-2 text-detail whitespace-pre-wrap"
        style={{
          background: isPrimary ? "var(--accent-dim)" : "var(--bg-subtle)",
          color: "var(--text-primary)",
        }}
      >
        {body}
        {isPrimary && long && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="ml-1 underline text-detail"
            style={{ color: "var(--text-dim)" }}
          >
            {expanded ? "show less" : "show more"}
          </button>
        )}
        {turn.verdict && <VerdictChips verdict={turn.verdict} />}
        {turn.verdict?.checkResults && (
          <div
            className="mt-1 text-detail rounded px-2 py-1 whitespace-pre-wrap"
            style={{ background: "var(--bg-primary)", color: "var(--text-dim)" }}
          >
            {turn.verdict.checkResults}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DuoDialogueView(): React.ReactElement {
  const dialogue = useDuoStore((s) => s.dialogue);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [dialogue.length]);

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
        Waiting for the first turn — the conversation appears here as the agents work.
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border p-3 flex flex-col gap-2 overflow-y-auto"
      style={{ background: "var(--bg-elevated)", borderColor: "var(--border)", maxHeight: "60vh" }}
    >
      {dialogue.map((turn) =>
        turn.author === "system" ? (
          <SystemMarker key={turn.id} turn={turn} />
        ) : (
          <AgentBubble key={turn.id} turn={turn} />
        ),
      )}
      <div ref={bottomRef} />
    </div>
  );
}
