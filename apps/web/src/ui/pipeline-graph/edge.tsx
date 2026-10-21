import { type Edge, type EdgeProps, getBezierPath } from "@xyflow/react";

import { cx } from "#lib/cx";
import { useGraph } from "#ui/pipeline-graph/context";
import { GRAPH_TRANSITION } from "#ui/pipeline-graph/motion.ts";

interface FlowLinkData extends Record<string, unknown> {
  available: boolean;
}

export type FlowLink = Edge<FlowLinkData, "flow">;

export function FlowEdge({
  id,
  data,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps<FlowLink>) {
  const { focus, lineage } = useGraph();
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const dimmed = focus !== null && lineage.get(focus)?.has(id) !== true;

  return (
    <path
      d={path}
      className={cx(
        "fill-none transition-[stroke,opacity]",
        GRAPH_TRANSITION,
        data?.available === true ? "stroke-base-content/25" : "stroke-base-300",
        dimmed && "opacity-20",
      )}
      strokeWidth={1.5}
      strokeDasharray={data?.available === true ? undefined : "4 5"}
    />
  );
}
