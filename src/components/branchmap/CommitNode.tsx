// One commit dot in the branch graph, drawn as an SVG group. Styled to echo the
// shared `StatusDot` look (hollow ring in the lane color), with a pulsing halo
// for HEAD ("you are here") and a filled core for merge commits.

import { NODE_R, HEAD_R } from "../../lib/branchmap/constants";
import type { LaidOutNode } from "../../lib/branchmap/lane-layout";

interface CommitNodeProps {
  node: LaidOutNode;
  selected: boolean;
  onSelect: (hash: string) => void;
  onHover?: (hash: string | null, el: SVGGElement | null) => void;
  /** Native tooltip text (rich hovercard is layered on in Phase 4). */
  title?: string;
}

export default function CommitNode({
  node,
  selected,
  onSelect,
  onHover,
  title,
}: CommitNodeProps) {
  const { x, y, colorVar, isHead, isMerge } = node;
  return (
    <g
      transform={`translate(${x}, ${y})`}
      className="cursor-pointer"
      onClick={() => onSelect(node.hash)}
      onMouseEnter={(e) => onHover?.(node.hash, e.currentTarget)}
      onMouseLeave={() => onHover?.(null, null)}
    >
      {/* Generous invisible hit target. */}
      <circle r={NODE_R + 8} fill="transparent" />

      {/* HEAD "you are here" halo. */}
      {isHead && (
        <circle
          r={HEAD_R}
          fill="none"
          stroke={colorVar}
          strokeOpacity={0.4}
          strokeWidth={2}
          className="animate-pulse"
        />
      )}

      {/* Selection ring. */}
      {selected && (
        <circle r={NODE_R + 4} fill="none" stroke={colorVar} strokeWidth={2} />
      )}

      {/* The node itself: hollow ring in the lane color. */}
      <circle r={NODE_R} fill="var(--bg-primary)" stroke={colorVar} strokeWidth={2.5} />

      {/* Merge join → filled core. */}
      {isMerge && <circle r={NODE_R - 3} fill={colorVar} />}

      {/* HEAD also gets a solid center so the current spot reads at a glance. */}
      {isHead && !isMerge && <circle r={NODE_R - 3.5} fill={colorVar} />}

      {title && <title>{title}</title>}
    </g>
  );
}
