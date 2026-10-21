import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";

import type { Mat } from "@techstark/opencv-js";

import { SectorId } from "@prostapaper/contracts";

import { loadOpenCv } from "#opencv";

const { values } = parseArgs({
  options: {
    labels: {
      type: "string",
      default: fileURLToPath(new URL("../templates/sector-map-labels.u8.gz", import.meta.url)),
    },
    out: {
      type: "string",
      default: fileURLToPath(
        new URL("../../../apps/web/src/ui/sector-diagram/sheet.gen.ts", import.meta.url),
      ),
    },
  },
});

/** The diagram's viewBox width; label-map pixels are scaled to it. */
const VIEW_WIDTH = 320;
/** Room around the drawing for the level titles, the urethra and the side letters, in label-map pixels. */
const PAD = { top: 40, side: 40, bottom: 110 };
/** The figure leaves wide gaps between its drawings; each keeps its exact shape but sits this far below the last. */
const GAP = 64;
const UPSCALE = 4;
const BLUR = { outline: 10, tissue: 6, vesicle: 18 };
const CONTOUR_BLUR = 1.5;
const TOLERANCE = 0.08;
const MARGIN = 24;
const LEVELS = ["base", "mid", "apex"] as const;
const GROUPS = ["sv", ...LEVELS] as const;

type Group = (typeof GROUPS)[number];
type Point = readonly [number, number];
type Box = readonly [x0: number, y0: number, x1: number, y1: number];

const bytes = gunzipSync(await readFile(values.labels));
const width = bytes.readUInt32LE(0);
const height = bytes.readUInt32LE(4);
const cv = await loadOpenCv();

const groupOf = (id: string): Group => GROUPS.find((group) => id.startsWith(`${group}_`)) ?? "sv";
const sectorOf = (label: number): SectorId | undefined => SectorId.options[label - 1];
const zoneOf = (id: SectorId) => id.slice(groupOf(id).length + 1, -2);

/** Only the largest connected piece of each sector counts, which drops strays such as figure lettering. */
function cleanLabels(source: Uint8Array): Uint8Array {
  const clean = new Uint8Array(source.length);
  for (const [index] of SectorId.options.entries()) {
    const label = index + 1;
    const mask = cv.matFromArray(
      height,
      width,
      cv.CV_8UC1 as number,
      source.map((value) => (value === label ? 255 : 0)),
    );
    const components = new cv.Mat();
    const count = cv.connectedComponents(mask, components, 8, cv.CV_32S as number);
    const owners = components.data32S;
    const areas = Array.from({ length: count }, () => 0);
    for (const owner of owners) areas[owner] = (areas[owner] ?? 0) + 1;
    let best = 1;
    for (let owner = 2; owner < count; owner += 1) if ((areas[owner] ?? 0) > (areas[best] ?? 0)) best = owner;
    for (const [at, owner] of owners.entries()) if (owner === best) clean[at] = label;
    mask.delete();
    components.delete();
  }

  return clean;
}

const labels = cleanLabels(bytes.subarray(8));

/** Where the patient's right sectors meet the left ones, rounded so the mirror maps pixels onto pixels. */
function midlineOf(group: Group, box: Box): number {
  if (group === "sv") return Math.round(box[0] + box[2]) / 2;
  const seams: number[] = [];
  for (let y = box[1]; y <= box[3]; y += 1) {
    for (let x = box[0]; x < box[2]; x += 1) {
      const here = sectorOf(labels[y * width + x] ?? 0);
      const next = sectorOf(labels[y * width + x + 1] ?? 0);
      if (here?.startsWith(`${group}_`) === true && here.endsWith("_R") && next?.endsWith("_L") === true)
        seams.push(x + 0.5);
    }
  }
  seams.sort((left, right) => left - right);

  return Math.round(2 * (seams[Math.floor(seams.length / 2)] ?? 0)) / 2;
}

function boxOfLabels(group: Group): Box {
  let box: [number, number, number, number] = [width, height, 0, 0];
  for (const [index, label] of labels.entries()) {
    const id = sectorOf(label);
    if (id === undefined || groupOf(id) !== group) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
  }

  return box;
}

interface Crop {
  x0: number;
  y0: number;
  w: number;
  h: number;
  midline: number;
}

/** A window centred on the midline, so a column and its mirror image are both inside it. */
function cropOf(group: Group): Crop {
  const box = boxOfLabels(group);
  const midline = midlineOf(group, box);
  const half = Math.ceil(Math.max(midline - box[0], box[2] - midline) + MARGIN);
  const x0 = Math.floor(midline - half);
  const w = Math.round(2 * midline) - 2 * x0 + 1;
  const y0 = box[1] - MARGIN;

  return { x0, y0, w, h: box[3] + MARGIN - y0 + 1, midline };
}

/** An indicator averaged with its mirror image, then blurred and upscaled: a smooth, symmetric field. */
function field(crop: Crop, keep: (id: SectorId) => boolean, blur: number): Float32Array {
  const { x0, y0, w, h } = crop;
  const raw = new Float32Array(w * h);
  const hit = (x: number, y: number) => {
    const id = sectorOf(labels[(y0 + y) * width + x0 + x] ?? 0);

    if (id === undefined || !keep(id)) return 0;

    return 0.5;
  };
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) raw[y * w + x] = hit(x, y) + hit(w - 1 - x, y);
  const source = cv.matFromArray(h, w, cv.CV_32FC1 as number, raw);
  const blurred = new cv.Mat();
  const large = new cv.Mat();
  cv.GaussianBlur(source, blurred, new cv.Size(0, 0), blur, blur, cv.BORDER_REFLECT as number);
  cv.resize(blurred, large, new cv.Size(w * UPSCALE, h * UPSCALE), 0, 0, cv.INTER_LINEAR as number);
  const smooth = Float32Array.from(large.data32F);
  for (const mat of [source, blurred, large]) mat.delete();

  return smooth;
}

const TISSUES = ["PZ", "TZ", "AS", "CZ"] as const;
const mirror = (midline: number, [x, y]: Point): Point => [2 * midline - x, y];
const mirrorRight = (midline: number, point: Point): Point => {
  if (point[0] <= midline) return point;

  return mirror(midline, point);
};
const MEDIAL = new Set(["PZpm", "TZp", "CZ"]);
const tissueOf = (zone: string) => zone.slice(0, 2);

interface Line {
  slope: number;
  offset: number;
}

/** Least squares `along = slope * across + offset` through seam points, both sides folded onto the right. */
function fit(points: readonly Point[]): Line {
  const n = points.length;
  const mx = points.reduce((sum, [x]) => sum + x, 0) / n;
  const my = points.reduce((sum, [, y]) => sum + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const [x, y] of points) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
  }
  let slope = 0;
  if (sxx > 0) slope = sxy / sxx;

  return { slope, offset: my - slope * mx };
}

/** Pixels of one zone with a pixel of another one step away, as seam points folded onto the patient's right. */
interface Seam {
  from: (zone: string) => boolean;
  to: (zone: string) => boolean;
  step: Point;
}

function seam(group: Group, midline: number, { from, to, step }: Seam): Point[] {
  const points: Point[] = [];
  for (const [index, label] of labels.entries()) {
    const id = sectorOf(label);
    if (id === undefined || groupOf(id) !== group || !from(zoneOf(id))) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    let dx = step[0];
    if (id.endsWith("_L")) dx = -dx;
    const next = sectorOf(labels[(y + step[1]) * width + x + dx] ?? 0);
    if (next?.slice(-2) !== id.slice(-2) || !to(zoneOf(next))) continue;
    points.push(mirrorRight(midline, [x + dx / 2, y + step[1] / 2]));
  }
  if (points.length === 0) throw new Error(`${group}: no seam to fit a cut to`);

  return points;
}

/** The dashed cuts as exact lines on the patient's right: PZa/PZpl, TZa/TZp and PZpl against the medial sectors. */
function cutsOf(group: Group, midline: number) {
  const peripheral = fit(
    seam(group, midline, { from: (zone) => zone === "PZa", to: (zone) => zone === "PZpl", step: [0, 1] }),
  );
  const transition = seam(group, midline, {
    from: (zone) => zone === "TZa",
    to: (zone) => zone === "TZp",
    step: [0, 1],
  });
  const oblique = fit(
    seam(group, midline, {
      from: (zone) => zone === "PZpl",
      to: (zone) => MEDIAL.has(zone),
      step: [1, 0],
    }).map(([x, y]): Point => [y, x]),
  );

  return {
    peripheral,
    transition: transition.reduce((sum, [, y]) => sum + y, 0) / transition.length,
    oblique,
  };
}

/** Every upscaled pixel decided level by level: inside, tissue, then the cuts. Only the tissue borders
 * are smoothed; the cuts are exact lines, so they run straight right up to the capsule and the zones. */
function paintGroup(group: Group, crop: Crop): Uint8Array {
  const inGroup = (id: SectorId) => groupOf(id) === group;
  let blur = BLUR.outline;
  if (group === "sv") blur = BLUR.vesicle;
  const inside = field(crop, inGroup, blur);
  const size = inside.length;
  const painted = new Uint8Array(size);
  const W = crop.w * UPSCALE;
  const labelOf = (zone: string, index: number) => {
    let side = "L";
    if (index % W < W / 2) side = "R";

    return SectorId.options.indexOf(SectorId.parse([group, zone, side].filter(Boolean).join("_"))) + 1;
  };
  if (group === "sv") {
    for (let index = 0; index < size; index += 1)
      if ((inside[index] ?? 0) >= 0.5) painted[index] = labelOf("", index);

    return painted;
  }
  const present = TISSUES.filter((tissue) =>
    SectorId.options.some((id) => inGroup(id) && tissueOf(zoneOf(id)) === tissue),
  );
  const tissues = present.map((tissue) =>
    field(crop, (id) => inGroup(id) && tissueOf(zoneOf(id)) === tissue, BLUR.tissue),
  );
  const { peripheral, transition, oblique } = cutsOf(group, crop.midline);
  for (let index = 0; index < size; index += 1) {
    if ((inside[index] ?? 0) < 0.5) continue;
    let best = 0;
    for (let at = 1; at < tissues.length; at += 1)
      if ((tissues[at]?.[index] ?? 0) > (tissues[best]?.[index] ?? 0)) best = at;
    const tissue = present[best] ?? "PZ";
    const x = crop.x0 + ((index % W) + 0.5) / UPSCALE - 0.5;
    const y = crop.y0 + (Math.floor(index / W) + 0.5) / UPSCALE - 0.5;
    const [right] = mirrorRight(crop.midline, [x, y]);
    const anterior = y < peripheral.slope * right + peripheral.offset;
    const lateral = right < oblique.slope * y + oblique.offset;
    let zone: string = tissue;
    if (tissue === "TZ" && y < transition) zone = "TZa";
    if (tissue === "TZ" && y >= transition) zone = "TZp";
    if (tissue === "PZ" && anterior) zone = "PZa";
    if (tissue === "PZ" && !anterior) zone = "PZpm";
    if (lateral && MEDIAL.has(zone)) zone = "PZpl";
    painted[index] = labelOf(zone, index);
  }

  return painted;
}

/** A closed polyline smoothed along its length, which irons out the upscaled pixel steps. */
function smooth(points: readonly Point[], sigma: number): Point[] {
  const reach = Math.ceil(3 * sigma);
  const weights = Array.from({ length: 2 * reach + 1 }, (_, at) =>
    Math.exp(-(((at - reach) / sigma) ** 2) / 2),
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  return points.map((_, index) => {
    let x = 0;
    let y = 0;
    for (const [at, weight] of weights.entries()) {
      const [px, py] = points[(index + at - reach + points.length) % points.length] ?? [0, 0];
      x += px * weight;
      y += py * weight;
    }

    return [x / total, y / total];
  });
}

function simplify(points: readonly Point[], tolerance: number): Point[] {
  const keep = new Uint8Array(points.length);
  const distance = ([px, py]: Point, [ax, ay]: Point, [bx, by]: Point) => {
    const length = Math.hypot(bx - ax, by - ay);
    if (length === 0) return Math.hypot(px - ax, py - ay);

    return Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
  };
  const run = (from: number, to: number) => {
    let far = -1;
    let most = tolerance;
    for (let at = from + 1; at < to; at += 1) {
      const found = distance(points[at] ?? [0, 0], points[from] ?? [0, 0], points[to] ?? [0, 0]);
      if (found > most) {
        far = at;
        most = found;
      }
    }
    if (far < 0) return;
    keep[far] = 1;
    run(from, far);
    run(far, to);
  };
  const half = Math.floor(points.length / 2);
  keep[0] = 1;
  keep[half] = 1;
  run(0, half);
  run(half, points.length - 1);
  if (distance(points.at(-1) ?? [0, 0], points[half] ?? [0, 0], points[0] ?? [0, 0]) > tolerance)
    keep[points.length - 1] = 1;

  return points.filter((_, at) => keep[at] === 1);
}

/** The region's outline in label-map pixels and the point deepest inside it, where its label has most room. */
function trace(crop: Crop, mask: Mat): { points: Point[]; label: Point; room: number } {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL as number, cv.CHAIN_APPROX_NONE as number);
  let largest = contours.get(0);
  for (let index = 1; index < contours.size(); index += 1) {
    const contour = contours.get(index);
    if (cv.contourArea(contour) > cv.contourArea(largest)) largest = contour;
  }
  const flat = [...largest.data32S];
  const steps: Point[] = [];
  for (let index = 0; index + 1 < flat.length; index += 2)
    steps.push([flat[index] ?? 0, flat[index + 1] ?? 0]);
  const toMap = ([x, y]: Point): Point => [
    crop.x0 + (x + 0.5) / UPSCALE - 0.5,
    crop.y0 + (y + 0.5) / UPSCALE - 0.5,
  ];
  const distance = new cv.Mat();
  cv.distanceTransform(mask, distance, cv.DIST_L2 as number, 5);
  let best = 0;
  for (const [index, value] of distance.data32F.entries())
    if (value > (distance.data32F[best] ?? 0)) best = index;
  const room = (distance.data32F[best] ?? 0) / UPSCALE;
  const W = crop.w * UPSCALE;
  for (const mat of [contours, hierarchy, distance]) mat.delete();

  return {
    points: simplify(smooth(steps, CONTOUR_BLUR).map(toMap), TOLERANCE),
    label: toMap([best % W, Math.floor(best / W)]),
    room,
  };
}

const maskOf = (crop: Crop, painted: Uint8Array, keep: (label: number) => boolean): Mat =>
  cv.matFromArray(
    crop.h * UPSCALE,
    crop.w * UPSCALE,
    cv.CV_8UC1 as number,
    painted.map((label) => Number(keep(label)) * 255),
  );

const traced = new Map<SectorId, { points: Point[]; label: Point; room: number }>();
const sections: { level: (typeof LEVELS)[number]; points: Point[]; box: Box }[] = [];
const midlines = new Map<Group, number>();
for (const group of GROUPS) {
  const crop = cropOf(group);
  midlines.set(group, crop.midline);
  const painted = paintGroup(group, crop);
  for (const id of SectorId.options) {
    if (groupOf(id) !== group || !id.endsWith("_R")) continue;
    const mask = maskOf(crop, painted, (label) => label === SectorId.options.indexOf(id) + 1);
    const shape = trace(crop, mask);
    mask.delete();
    traced.set(id, shape);
    traced.set(SectorId.parse(`${id.slice(0, -2)}_L`), {
      points: shape.points.map((point) => mirror(crop.midline, point)).toReversed(),
      label: mirror(crop.midline, shape.label),
      room: shape.room,
    });
  }
  if (group === "sv") continue;
  const mask = maskOf(crop, painted, (label) => label !== 0);
  const { points } = trace(crop, mask);
  mask.delete();
  sections.push({ level: group, points, box: boxOf(points) });
}

function boxOf(points: readonly Point[]): Box {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);

  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const shapes = SectorId.options.map((id) => {
  const shape = traced.get(id);
  if (shape === undefined) throw new Error(`${id} was not traced`);

  return { id, ...shape };
});

const shift = new Map<string, number>();
let below = Number.NEGATIVE_INFINITY;
for (const group of GROUPS) {
  const [, top, , bottom] = boxOf(
    shapes.filter((shape) => groupOf(shape.id) === group).flatMap((shape) => shape.points),
  );
  let dy = 0;
  if (Number.isFinite(below)) dy = below + GAP - top;
  shift.set(group, dy);
  below = bottom + dy;
}
const moved = (group: string, points: readonly Point[]): Point[] =>
  points.map(([x, y]) => [x, y + (shift.get(group) ?? 0)]);
for (const shape of shapes) {
  const group = groupOf(shape.id);
  shape.points = moved(group, shape.points);
  shape.label = moved(group, [shape.label])[0] ?? shape.label;
}
for (const section of sections) {
  section.points = moved(section.level, section.points);
  section.box = boxOf(section.points);
}

const [x0, y0, x1, y1] = boxOf(shapes.flatMap((shape) => shape.points));
const scale = VIEW_WIDTH / (x1 - x0 + 2 * PAD.side);
const originX = x0 - PAD.side;
const originY = y0 - PAD.top;
const round = (value: number) => Math.round(value * 10) / 10;
const at = ([x, y]: Point): Point => [round((x - originX) * scale), round((y - originY) * scale)];
const path = (points: readonly Point[]) => {
  const scaled = points.map(at).filter(([x, y], index, all) => {
    const [px, py] = all[index - 1] ?? [Number.NaN, Number.NaN];

    return x !== px || y !== py;
  });

  return `M${scaled.map(([x, y]) => `${x} ${y}`).join(" L")} Z`;
};
const midline = midlines.get("base") ?? 0;
const apexBox = sections[2]?.box ?? [0, 0, 0, 0];

const sheet = {
  width: VIEW_WIDTH,
  height: round((y1 - y0 + PAD.top + PAD.bottom) * scale),
  midline: at([midline, 0])[0],
  urethra: at([midline, apexBox[3] + PAD.bottom * 0.45]),
  sectors: Object.fromEntries(
    shapes.map(({ id, points, label, room }) => [
      id,
      { d: path(points), label: at(label), room: round(room * scale) },
    ]),
  ),
  sections: Object.fromEntries(
    sections.map(({ level, points, box }) => [
      level,
      { d: path(points), top: at([box[0], box[1]]), bottom: at([box[2], box[3]]) },
    ]),
  ),
};

await writeFile(
  values.out,
  [
    `/** Traced from packages/extraction/templates/sector-map-labels.u8.gz by \`pnpm --filter @prostapaper/extraction sheet:diagram\`; do not edit. */`,
    `export const SHEET = ${JSON.stringify(sheet, null, 2)} as const;`,
    "",
  ].join("\n"),
);
console.info(`${shapes.length} sectors, ${sections.length} sections -> ${values.out}`);
