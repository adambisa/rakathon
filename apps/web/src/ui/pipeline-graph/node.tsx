import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import type { CSSProperties } from "react";

import { cx } from "#lib/cx";
import { type PipelineNode, StepState } from "#lib/pipeline";
import { useGraph } from "#ui/pipeline-graph/context";
import { GRAPH_TRANSITION } from "#ui/pipeline-graph/motion.ts";

const STATE_CLASS: Record<StepState, string> = {
  [StepState.Pending]: "border-base-300 bg-base-100 text-base-content/40",
  [StepState.Queued]: "border-base-300 border-dashed bg-base-100 text-base-content/60",
  [StepState.Active]: "border-info/30 bg-info/8 text-info",
  [StepState.Done]: "border-base-300 bg-base-200/50 text-base-content",
};

const HANDLE_STYLE = { width: 1, height: 1, minWidth: 1, minHeight: 1, border: 0, background: "transparent" };

interface StepNodeData extends Record<string, unknown> {
  node: PipelineNode;
}

export type StepFlowNode = Node<StepNodeData, "step">;

export function StepNode({ id, data: { node } }: NodeProps<StepFlowNode>) {
  const { focus, lineage, nodeWidth, nodeHeight } = useGraph();
  const dimmed = focus !== null && lineage.get(focus)?.has(id) !== true;

  return (
    <div
      className={cx("transition-opacity", GRAPH_TRANSITION, dimmed && "opacity-20")}
      style={{ width: nodeWidth, height: nodeHeight }}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} style={HANDLE_STYLE} />
      {node.state === StepState.Active && (
        <span
          className="rfp-halo pointer-events-none absolute -inset-[3px] rounded-box ring-2 ring-info/25"
          style={
            {
              "--halo-scale-x": 1 + 11.2 / (nodeWidth + 6),
              "--halo-scale-y": 1 + 11.2 / (nodeHeight + 6),
            } as CSSProperties
          }
        />
      )}
      <div
        className={cx(
          "relative flex h-full flex-col justify-center overflow-hidden rounded-box border px-3 transition-all",
          GRAPH_TRANSITION,
          STATE_CLASS[node.state],
          focus === id && "ring-2 ring-base-content/25",
        )}
      >
        <span className="truncate text-[11.5px] leading-tight font-semibold" title={node.label}>
          {node.label}
        </span>
        <span className="mt-1 font-mono text-[10px] opacity-55">{node.description}</span>
        {node.state === StepState.Active && (
          <span className="absolute inset-x-0 bottom-0 block h-[2px] bg-info/15">
            <span className="rfp-slide block h-full w-1/3 bg-info" />
          </span>
        )}
      </div>
      {node.state === StepState.Done && (
        <span className="rfp-pop absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-base-200 text-base-content/65">
          <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
            <path
              d="M1.5 5.2 4 7.5 8.5 2.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} style={HANDLE_STYLE} />
    </div>
  );
}
