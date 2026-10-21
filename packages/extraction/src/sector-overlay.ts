import type { Mat } from "@techstark/opencv-js";

import { type Cv, loadOpenCv } from "#opencv";
import type { GrayImage } from "#pdf";

export interface SheetOverlay {
  /** Template edge pixels the warped scan reproduces, by distance to the nearest scan edge. */
  within1px: number;
  within2px: number;
  within4px: number;
  medianDistancePx: number;
  p90DistancePx: number;
  edgePixels: number;
  scale: number;
  rotationDegrees: number;
}

const CANNY_LOW = 60;
const CANNY_HIGH = 160;

function matrixOf(cv: Cv, image: GrayImage): Mat {
  return cv.matFromArray(image.height, image.width, cv.CV_8UC1, image.data);
}

function edges(cv: Cv, source: Mat): Mat {
  const blurred = new cv.Mat();
  const found = new cv.Mat();
  try {
    cv.GaussianBlur(source, blurred, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT as number);
    cv.Canny(blurred, found, CANNY_LOW, CANNY_HIGH);

    return found;
  } finally {
    blurred.delete();
  }
}

function quantile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));

  return sorted[index] ?? Number.NaN;
}

/** How closely the scan lands on the blank form once the homography puts it in template space. */
export async function measureSheetOverlay(
  template: GrayImage,
  scan: GrayImage,
  matrix: readonly number[],
): Promise<SheetOverlay> {
  if (matrix.length !== 9) throw new Error(`Expected a 3x3 homography, received ${matrix.length} values`);
  const cv = await loadOpenCv();
  const templateMat = matrixOf(cv, template);
  const scanMat = matrixOf(cv, scan);
  const homography = cv.matFromArray(3, 3, cv.CV_64F, [...matrix]);
  const warped = new cv.Mat();
  const inverted = new cv.Mat();
  const distances = new cv.Mat();
  let templateEdges: Mat | undefined;
  let scanEdges: Mat | undefined;
  try {
    cv.warpPerspective(
      scanMat,
      warped,
      homography,
      new cv.Size(template.width, template.height),
      cv.INTER_LINEAR as number,
      cv.BORDER_CONSTANT as number,
      new cv.Scalar(255, 255, 255, 255),
    );
    templateEdges = edges(cv, templateMat);
    scanEdges = edges(cv, warped);
    cv.bitwise_not(scanEdges, inverted);
    cv.distanceTransform(inverted, distances, cv.DIST_L2 as number, 3);
    if (!distances.isContinuous() || distances.data32F.length !== template.width * template.height) {
      throw new Error("The distance transform came back strided");
    }

    const distanceData = distances.data32F;
    const unsorted: number[] = [];
    for (const [index, edge] of templateEdges.data.entries()) {
      if (edge === 0) continue;
      unsorted.push(distanceData[index] ?? Number.NaN);
    }
    const found = unsorted.toSorted((left, right) => left - right);
    const share = (limit: number): number => {
      if (found.length === 0) return 0;

      return Number((found.filter((value) => value <= limit).length / found.length).toFixed(4));
    };
    const a = matrix[0] ?? 0;
    const d = matrix[3] ?? 0;

    return {
      within1px: share(1),
      within2px: share(2),
      within4px: share(4),
      medianDistancePx: Number(quantile(found, 0.5).toFixed(2)),
      p90DistancePx: Number(quantile(found, 0.9).toFixed(2)),
      edgePixels: found.length,
      scale: Number(Math.hypot(a, d).toFixed(4)),
      rotationDegrees: Number(((Math.atan2(d, a) * 180) / Math.PI).toFixed(2)),
    };
  } finally {
    templateMat.delete();
    scanMat.delete();
    homography.delete();
    warped.delete();
    inverted.delete();
    distances.delete();
    templateEdges?.delete();
    scanEdges?.delete();
  }
}
