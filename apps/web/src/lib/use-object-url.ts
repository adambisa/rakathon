import type { RefCallback } from "react";

export function useObjectUrl(blob: Blob): RefCallback<HTMLImageElement> {
  return (img) => {
    if (img === null) {
      return;
    }
    const url = URL.createObjectURL(blob);
    img.setAttribute("src", url);

    return () => URL.revokeObjectURL(url);
  };
}
