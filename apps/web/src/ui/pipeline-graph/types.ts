import type { PipelineLink, PipelineNode } from "#lib/pipeline";

export interface PipelineGraphProps {
  nodes: readonly PipelineNode[];
  links: readonly PipelineLink[];
  nodeWidth?: number;
  nodeHeight?: number;
  className?: string;
}
