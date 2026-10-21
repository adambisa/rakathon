# @prostapaper/extraction

Turns an uploaded JPEG scan into an `ExtractedDocument`. The uploader says what the
file is, and that routes it:

- **text_description** (`extractDocument`): every page is read by the configured reader (`tesseract`, or `bedrock-mantle`, which is
  off for now).
- **sector_map** (`extractSectorSheet`): the hand-marked prostate sector sheet is read by
  OpenCV alone, with no reader and no model. `sectorMap` holds the reading per page as
  one entry per pen mark: every sector the mark touches with `share` and `coverage`
  (see below), and `marked`, the sectors it counts for. Sector ids are the shared
  `SectorId` enum from `@prostapaper/contracts`. `regionFromSectorId` converts a sheet
  sector to a REDCap `RegionCode`; mapping places it in `lesions[].sur_prostate_regions`
  rather than asking the model to re-read a sentence. The page text (source `opencv`) is
  a human-readable summary for the UI only. A page that is not the sheet fails the
  extraction: a wrongly filed upload never reaches mapping.

The kind picks the extractor through `extractors`, a map from `DocumentKind` to a function
of `(source, tools)`; the ingest Lambda and the CLI both read it and route nothing
themselves.

- `pnpm --filter @prostapaper/extraction extract <file> [--kind text_description|sector_map] [--reader bedrock-mantle --model <id>]`:
  the whole extraction, printed as JSON. `--kind` defaults to `text_description`.
- `pnpm --filter @prostapaper/extraction sheet <file>... [--verbose]`: only the
  sector-sheet reader, per page, with no reader, S3 or model. Use absolute paths.

## Sector sheet

The Czech PI-RADS form (_Semenné váčky / Báze / Střed / Apex_) is read with OpenCV
(`@techstark/opencv-js`, WebAssembly), entirely locally:

1. **Detect and align.** ORB keypoints on the page are matched to the blank form
   (`templates/sector-sheet.jpg`) and RANSAC fits a homography. Too few inliers, or an
   implausible scale, means the page is not a sheet.
2. **Flatten the paper.** Per colour channel, a smooth surface is fitted to the page
   where the form is blank paper and divided out, so grey, tinted or unevenly lit
   paper reads as white.
3. **Find ink.** Coloured pixels, or pixels much darker than the form away from its
   printed lines. On the form's grey zones both images are smoothed first, so a
   dithered fax's dots average back into grey.
4. **Find foci.** Gaps are closed and outlines filled, so hatching, scribbles and
   rings become solid areas. Specks are dropped.
5. **Assign sectors.** `templates/sector-sheet-labels.u8.gz` names one of 40 sectors
   (38 prostate, 2 seminal vesicles) per pixel. A focus marks its main sector, any
   sector holding at least `markedShare` of it, and any sector it covers at least
   `coveredShare` of.

Per focus, `share` is the portion of that mark lying in the sector and `coverage` the
portion of the sector the mark covers, both 0 to 1 and rounded to three decimals. A
sector is marked when the focus has its largest part there, a share of at least
`markedShare`, or a coverage of at least `coveredShare`. Values near those thresholds
are the marks to distrust; they travel with the focus into the mapping prompt.

All thresholds live in `templates/sector-sheet.json`, validated on load and shipped
with the Lambda. They are first guesses from synthetic sheets and still need tuning
on real scans.

## The form the hospital actually prints

`tests/fixtures/czech/sector-sheet.jpg` is the Czech form the reader was first built on. The scans MOÚ sends are a grayscale
print of **Figure 16 of PI-RADS v2.1** (`docs/reference/PI-RADS_v2.1_2019.pdf`, page 75; the PDF is not included in the public copy, get it from the ACR),
an English sheet with four panels, the whole-gland views and a PZ/CZ/TZ/AFS/US legend.
Against the Czech template all 40 schema scans fail: 14 inliers at best, where 40 are
needed. The sector ids in `@prostapaper/contracts` were modelled on the English sheet
all along.

`pnpm --filter @prostapaper/extraction sheet:template` renders that figure into
`templates/sector-map.jpg`: page 75 at the scale that makes the artwork 1600 px wide,
the ruled box around the figure and the paper around the artwork trimmed away, as
grayscale, because the hospital prints it in grayscale. The PDF is the source, so the
template is reproducible rather than a scan someone cropped by hand.

`pnpm --filter @prostapaper/extraction sheet:overlay --scans <dir> [--json <file>]`
reports, per scan, whether it is recognised, on how many inliers, and how closely it
lands on the template: the share of template edge pixels with a scan edge within 1, 2
and 4 px once the homography has warped the scan into template space, plus the median
and p90 distance, the scale and the rotation. It also repeats the measurement with the
homography nudged 8 px, so a metric that cannot tell alignment from noise shows up as a
control that scores just as well.

On the 40 schema scans, with `templates/sector-map.jpg`:

|                          |                                      |
| ------------------------ | ------------------------------------ |
| recognised               | 40 of 40                             |
| inliers                  | 123 at worst, 221 median (40 needed) |
| edge overlay within 2 px | 93.2% at worst, 98.6% median         |
| median edge distance     | 0 px, p90 under 1 px                 |
| scale / rotation         | 1.01, within 1.3°                    |
| nudged control           | 34.8% median                         |

`tests/sector-overlay.test.ts` asserts looser bounds than those numbers, so a weaker scanner
still passes: 80 inliers, 90% within 2 px, p90 under 2 px, 3° of rotation, and the nudged control
at least 30 points below the real score. The dataset is hospital paper,
so it lives outside the repository: point `SECTOR_SHEET_SCANS` at the scan directory,
or the test skips. The other test in that file needs no dataset.

`pnpm --filter @prostapaper/extraction sheet:labels` paints the label map for that template,
`templates/sector-map-labels.u8.gz`, from the figure itself. The legend gives the five zone
colours, so every pixel knows its zone; the dashed lines that split sectors of one colour are
written down once as cuts in `scripts/sector-labels.ts` (a midline, one or two horizontals and a
mirrored pair of diagonals per panel), so both sides are the same geometry by construction.
A region is named by where it sits against those cuts, outlines and printed words are filled in
from the sector around them, and the script refuses to write a map where a sector is missing,
in pieces, mostly the wrong colour, or more than 20% off its mirror image.

`pnpm --filter @prostapaper/extraction sheet:diagram` traces that label map into the web app's
sector diagram, `apps/web/src/ui/sector-diagram/sheet.gen.ts`: one outline per sector plus the
point with the most room for its label, scaled to the diagram's viewBox with the figure's wide
gaps closed up. The label map is folded onto its mirror image, zone borders are smoothed and the
dashed cuts are fitted as exact straight lines, so the drawing is symmetric and clean while every
sector stays within a few percent of the area the coverage figures measure. Rerun it whenever the
label map is repainted.

The detector loads every form in `SECTOR_SHEETS` (`src/assets.ts`), finds the page's keypoints
once, matches them against each form and reads the page against the one recognised with the most
inliers; `sheet` in the reading and in the ingest log says which one won. Only the PI-RADS sheet ships: the hospital has no other form.
The Czech form lives on as `tests/fixtures/czech/`, where the synthetic degraded captures
(phone photo, fax, carbon copy) are drawn on it to exercise the mark reader.

`tests/sector-map-labels.test.ts` checks the committed map: every sector present and in one
piece, left and right within 20%, the patient's right on the left of the page, and every word
the sheet prints (AFS, TZa, PZpl, …) sitting inside the sector it names, on both sides.

Pen marks on the hospital's scans are highlighter: light pink and yellow on a grey print, with
a colour saturation of 30–60 once the page is resampled. `chroma` in `sector-sheet.json` is 30
for that reason; at the old 50, half the scans read as unmarked. On the form's printed lines the
bar is `chromaOnLines`, 50, because scanner colour fringing lives exactly there. A closed loop
fills to the area it encloses; an open arc keeps its own footprint, thickened, so it still lands
on a sector without claiming the whole concave side of a crescent. Two strokes of different
colours that overlap still read as one focus.

## Tests

`tests/sector-sheet.test.ts` covers detection, a clean example sheet, large lesions
and three degraded captures built by `tests/sheet-captures.ts`: a phone photo on
grey, unevenly lit paper; a one-bit dithered fax; and yellow carbon-copy paper.
Captures are deterministic and go through a JPEG round trip like an upload.

Known gap: a number written inside the gland next to a lesion (a PI-RADS score, say)
is read as ink and adds sectors.
