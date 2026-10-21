import dagre from "@dagrejs/dagre";

import { linkId, type PipelineLink, type PipelineNode } from "#lib/pipeline";

export interface LayoutOptions {
  nodeWidth: number;
  nodeHeight: number;
  rankSep: number;
  nodeSep: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Left-to-right dagre layout; returns top-left corners in flow coordinates. */
export function layoutGraph(
  nodes: readonly PipelineNode[],
  links: readonly PipelineLink[],
  options: LayoutOptions,
): Map<string, Point> {
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({
    rankdir: "LR",
    nodesep: options.nodeSep,
    ranksep: options.rankSep,
    marginx: 8,
    marginy: 8,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) {
    graph.setNode(node.id, { width: options.nodeWidth, height: options.nodeHeight });
  }
  for (const link of links) graph.setEdge(link.from.id, link.to.id, {}, linkId(link));
  dagre.layout(graph);

  return new Map(
    nodes.map((node) => {
      const placed = graph.node(node.id) as Point;

      return [node.id, { x: placed.x - options.nodeWidth / 2, y: placed.y - options.nodeHeight / 2 }];
    }),
  );
}

export function graphBounds(positions: ReadonlyMap<string, Point>, nodeWidth: number, nodeHeight: number) {
  if (positions.size === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const points = [...positions.values()];
  const x = Math.min(...points.map((point) => point.x));
  const y = Math.min(...points.map((point) => point.y));

  return {
    x,
    y,
    width: Math.max(...points.map((point) => point.x)) + nodeWidth - x,
    height: Math.max(...points.map((point) => point.y)) + nodeHeight - y,
  };
}
