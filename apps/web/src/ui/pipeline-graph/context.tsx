import { createContext, useContext } from "react";

export interface GraphContextValue {
  lineage: ReadonlyMap<string, ReadonlySet<string>>;
  focus: string | null;
  nodeWidth: number;
  nodeHeight: number;
}

export const GraphContext = createContext<GraphContextValue | null>(null);

export function useGraph(): GraphContextValue {
  const value = useContext(GraphContext);
  if (value === null) throw new Error("Pipeline nodes must render inside PipelineGraph");

  return value;
}
