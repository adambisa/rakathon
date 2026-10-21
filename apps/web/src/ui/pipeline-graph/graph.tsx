import "@xyflow/react/dist/style.css";

import { ReactFlowProvider } from "@xyflow/react";

import type { PipelineGraphProps } from "#ui/pipeline-graph/types.ts";
import { Graph } from "#ui/pipeline-graph/view";

export function PipelineGraph(props: PipelineGraphProps) {
  return (
    <ReactFlowProvider>
      <Graph {...props} />
    </ReactFlowProvider>
  );
}
