import { z } from "zod";

const share = z.number().min(0).max(1);
const pixels = z.number().int().positive();
const level = z.number().int().min(0).max(255);

/** Tuning for one printed form, kept next to its template. Pixel sizes are at the working width
 * (`SECTOR_SHEET_WIDTH`). These are first guesses from synthetic sheets, to be tuned on real scans. */
export const SectorSheetSettings = z
  .object({
    detection: z
      .object({
        /** ORB keypoints taken from the page and the template. */
        orbFeatures: pixels,
        /** Lowe's ratio test: the best match must beat the second best by this factor. */
        ratio: share,
        ransacThresholdPx: z.number().positive(),
        /** A sheet needs this many matches agreeing on one homography... */
        minInliers: pixels,
        /** ...and this share of all good matches. */
        minInlierShare: share,
        /** Page-to-template area scale outside this range is a false match. */
        minScale: z.number().positive(),
        maxScale: z.number().positive(),
      })
      .strict(),
    ink: z
      .object({
        /** Pixels this far from grey (max − min of RGB) are coloured pen... */
        chroma: level,
        /** ...except on the form's printed lines, where scanner colour fringing sits, which need this much. */
        chromaOnLines: level,
        /** Pixels this much darker than the template, away from its printed lines, are dark pen. */
        darkerThanTemplate: level,
        /** Template pixels at least this bright are blank paper: the page's paper tone is measured there, and
         * ink on it is found per pixel. Darker template pixels are grey zones, compared after smoothing. */
        paperTemplate: level,
        /** Gaussian kernel for comparing grey zones, wide enough to average a fax's dither back into a tone. */
        smoothingPx: z
          .number()
          .int()
          .positive()
          .refine((size) => size % 2 === 1, "must be odd"),
        /** Template pixels darker than this are printed lines... */
        whiteTemplate: level,
        /** ...widened by this margin, so a scan's slightly shifted lines are not read as pen. */
        lineMarginPx: z.number().int().min(0),
        /** Gaps up to about this size are closed, turning hatching and scribbles into solid foci. */
        closeKernelPx: pixels,
        /** Smaller blobs are specks, not foci. */
        minFocusAreaPx: pixels,
      })
      .strict(),
    marking: z
      .object({
        /** A sector holding this share of a focus is marked; smaller slivers are pen slop. */
        markedShare: share,
        /** A sector this much covered by one focus is marked too, so a large focus marks every sector it spans. */
        coveredShare: share,
      })
      .strict(),
  })
  .strict();

export type SectorSheetSettings = z.infer<typeof SectorSheetSettings>;
