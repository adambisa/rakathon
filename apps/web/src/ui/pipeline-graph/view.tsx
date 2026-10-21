import { ReactFlow, type Viewport } from "@xyflow/react";
import { useState } from "react";

import { cx } from "#lib/cx";
import { graphLineage, linkId, StepState } from "#lib/pipeline";
import { graphBounds, layoutGraph } from "#lib/pipeline-layout";
import { GraphContext } from "#ui/pipeline-graph/context";
import { FlowEdge, type FlowLink } from "#ui/pipeline-graph/edge";
import { type StepFlowNode, StepNode } from "#ui/pipeline-graph/node";
import type { PipelineGraphProps as GraphProps } from "#ui/pipeline-graph/types.ts";
import { usePipelineViewport } from "#ui/pipeline-graph/use-pipeline-viewport.ts";

const NODE_TYPES = { step: StepNode };
const EDGE_TYPES = { flow: FlowEdge };

export function Graph({ nodes, links, nodeWidth = 220, nodeHeight = 64, className }: GraphProps) {
  const lineage = graphLineage(nodes, links);
  const positions = layoutGraph(nodes, links, { nodeWidth, nodeHeight, rankSep: 72, nodeSep: 40 });
  const bounds = graphBounds(positions, nodeWidth, nodeHeight);
  const viewport = usePipelineViewport(bounds);
  const flowNodes: StepFlowNode[] = nodes.map((node) => ({
    id: node.id,
    type: "step",
    position: positions.get(node.id) ?? { x: 0, y: 0 },
    width: nodeWidth,
    height: nodeHeight,
    data: { node },
  }));
  const flowEdges: FlowLink[] = links.map((link) => ({
    id: linkId(link),
    type: "flow",
    source: link.from.id,
    target: link.to.id,
    data: { available: link.from.state === StepState.Done },
  }));

  return (
    <GraphView
      flowNodes={flowNodes}
      flowEdges={flowEdges}
      lineage={lineage}
      viewport={viewport}
      nodeWidth={nodeWidth}
      nodeHeight={nodeHeight}
      className={className}
    />
  );
}

interface GraphViewProps {
  flowNodes: StepFlowNode[];
  flowEdges: FlowLink[];
  lineage: ReadonlyMap<string, ReadonlySet<string>>;
  viewport: Viewport;
  nodeWidth: number;
  nodeHeight: number;
  className?: string | undefined;
}

function GraphView({
  flowNodes,
  flowEdges,
  lineage,
  viewport,
  nodeWidth,
  nodeHeight,
  className,
}: GraphViewProps) {
  const [focus, setFocus] = useState<string | null>(null);

  return (
    <GraphContext value={{ focus, lineage, nodeWidth, nodeHeight }}>
      <div className={cx("h-[22rem] w-full", className)}>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          viewport={viewport}
          minZoom={0.1}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          panOnDrag={false}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          onNodeMouseEnter={(_, node) => setFocus(node.id)}
          onNodeMouseLeave={() => setFocus(null)}
        />
      </div>
    </GraphContext>
  );
}
