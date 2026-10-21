export const StepState = {
  Pending: "pending",
  Queued: "queued",
  Active: "active",
  Done: "done",
} as const;
export type StepState = (typeof StepState)[keyof typeof StepState];

export interface PipelineNode {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly state: StepState;
}

export interface PipelineLink {
  readonly from: PipelineNode;
  readonly to: PipelineNode;
}

export function linkId(link: PipelineLink): string {
  return `${link.from.id}->${link.to.id}`;
}

function walk(id: string, next: Map<string, string[]>, seen: Set<string>): void {
  for (const neighbor of next.get(id) ?? []) {
    if (seen.has(neighbor)) continue;
    seen.add(neighbor);
    walk(neighbor, next, seen);
  }
}

export function graphLineage(
  nodes: readonly PipelineNode[],
  links: readonly PipelineLink[],
): Map<string, ReadonlySet<string>> {
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const link of links) {
    const id = linkId(link);
    parents.set(id, [link.from.id]);
    parents.set(link.to.id, [...(parents.get(link.to.id) ?? []), id]);
    children.set(link.from.id, [...(children.get(link.from.id) ?? []), id]);
    children.set(id, [link.to.id]);
  }

  return new Map(
    nodes.map((node) => {
      const seen = new Set([node.id]);
      walk(node.id, parents, seen);
      walk(node.id, children, seen);

      return [node.id, seen];
    }),
  );
}
