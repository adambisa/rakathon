import { getViewportForBounds, type Rect, useStore, type Viewport } from "@xyflow/react";

export function usePipelineViewport(bounds: Rect): Viewport {
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);

  if (width <= 0 || height <= 0 || bounds.width <= 0 || bounds.height <= 0) {
    return { x: 0, y: 0, zoom: 1 };
  }

  return getViewportForBounds(bounds, width, height, 0.1, 2, 0.16);
}
