import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import { SectorId } from "@prostapaper/contracts";

import { openDocument } from "#pdf";
import { settled } from "#tests/fixtures";

const templates = fileURLToPath(new URL("../templates", import.meta.url));
const MIN_ONE_PIECE = 0.95;
const MIN_SYMMETRY = 0.8;

interface LabelMap {
  width: number;
  height: number;
  pixels: Uint8Array;
}

async function labelMap(): Promise<LabelMap> {
  const packed = gunzipSync(await readFile(join(templates, "sector-map-labels.u8.gz")));

  return { width: packed.readUInt32LE(0), height: packed.readUInt32LE(4), pixels: packed.subarray(8) };
}

function pixelsOf(map: LabelMap): Map<string, number[]> {
  const found = new Map<string, number[]>();
  for (const [index, value] of map.pixels.entries()) {
    if (value === 0) continue;
    const id = SectorId.options[value - 1];
    assert.ok(id !== undefined, `label ${value} names no sector`);
    const bucket = found.get(id);
    if (bucket === undefined) found.set(id, [index]);
    else bucket.push(index);
  }

  return found;
}

function largestPieceShare(pixels: number[], width: number): number {
  const set = new Set(pixels);
  let largest = 0;
  while (set.size > 0) {
    const [first] = set;
    if (first === undefined) break;
    const queue = [first];
    set.delete(first);
    for (const index of queue) {
      const row = Math.floor(index / width);
      for (const step of [1, -1, width, -width, width + 1, width - 1, -width + 1, -width - 1]) {
        const next = index + step;
        if (!set.has(next)) continue;
        if (Math.abs(Math.floor(next / width) - row) > 1 || Math.abs((next % width) - (index % width)) > 1)
          continue;
        set.delete(next);
        queue.push(next);
      }
    }
    largest = Math.max(largest, queue.length);
  }

  return largest / pixels.length;
}

await test("the label map is shaped like the sector map template", async () => {
  const map = await labelMap();
  assert.equal(map.pixels.length, map.width * map.height);
  const document = openDocument(await readFile(join(templates, "sector-map.jpg")), "image/jpeg");
  const page = document.loadPage(0);
  try {
    const bounds = await settled(page.getBounds());
    const template = (bounds[2] - bounds[0]) / (bounds[3] - bounds[1]);
    const labels = map.width / map.height;
    assert.ok(Math.abs(template - labels) < 0.005, `template is ${template}, labels are ${labels}`);
  } finally {
    page.destroy();
    document.destroy();
  }
});

await test("every sector is painted, in one piece, and mirrors its other side", async () => {
  const map = await labelMap();
  const found = pixelsOf(map);
  assert.deepEqual(
    SectorId.options.filter((id) => !found.has(id)),
    [],
  );
  for (const [id, pixels] of found) {
    const share = largestPieceShare(pixels, map.width);
    assert.ok(share >= MIN_ONE_PIECE, `${id} has only ${(share * 100).toFixed(0)}% of itself in one piece`);
  }
  for (const id of SectorId.options) {
    if (!id.endsWith("_L")) continue;
    const left = found.get(id)?.length ?? 0;
    const right = found.get(`${id.slice(0, -2)}_R`)?.length ?? 0;
    const ratio = Math.min(left, right) / Math.max(left, right);
    assert.ok(ratio >= MIN_SYMMETRY, `${id.slice(0, -2)} is only ${(ratio * 100).toFixed(0)}% symmetric`);
  }
});

/** Panel boxes and printed label positions, as fractions of each box, read off the PI-RADS figure. */
const PANELS = {
  base: { x: 949, y: 409, width: 544, height: 372 },
  mid: { x: 974, y: 893, width: 480, height: 365 },
  apex: { x: 1031, y: 1354, width: 370, height: 294 },
} as const;
const PRINTED: Record<keyof typeof PANELS, [string, number, number][]> = {
  base: [
    ["AS", 0.37, 0.07],
    ["TZa", 0.3, 0.38],
    ["PZa", 0.07, 0.49],
    ["TZp", 0.27, 0.6],
    ["CZ", 0.33, 0.77],
    ["PZpl", 0.12, 0.79],
    ["PZpm", 0.38, 0.95],
    ["PZa", 0.057, 0.589],
  ],
  mid: [
    ["AS", 0.4, 0.09],
    ["TZa", 0.3, 0.38],
    ["PZa", 0.08, 0.47],
    ["TZp", 0.3, 0.6],
    ["PZpl", 0.1, 0.72],
    ["PZpm", 0.33, 0.83],
  ],
  apex: [
    ["AS", 0.39, 0.13],
    ["PZa", 0.14, 0.3],
    ["TZa", 0.36, 0.33],
    ["TZp", 0.35, 0.52],
    ["PZpl", 0.1, 0.7],
    ["PZpm", 0.3, 0.8],
    ["PZa", 0.078, 0.429],
  ],
};

/** Where each panel prints its vertical midline dash, as a fraction of the panel box. */
const MIDLINE: Record<keyof typeof PANELS, number> = { base: 0.4889, mid: 0.5015, apex: 0.5013 };
const MIDLINE_TOLERANCE_PX = 2;

await test("every word printed on the sheet sits in the sector it names, on both sides", async () => {
  const map = await labelMap();
  const idAt = (x: number, y: number): string =>
    SectorId.options[(map.pixels[y * map.width + x] ?? 0) - 1] ?? "background";
  for (const [level, box] of Object.entries(PANELS) as [
    keyof typeof PANELS,
    (typeof PANELS)[keyof typeof PANELS],
  ][]) {
    for (const [name, fx, fy] of PRINTED[level]) {
      const y = Math.round(box.y + fy * box.height);
      const onTheLeft = idAt(Math.round(box.x + fx * box.width), y);
      const onTheRight = idAt(Math.round(box.x + (1 - fx) * box.width), y);
      assert.equal(onTheLeft, `${level}_${name}_R`, `${level} ${name} on the left of the page`);
      assert.equal(onTheRight, `${level}_${name}_L`, `${level} ${name} on the right of the page`);
    }
  }
});

await test("no sector reaches across its panel's printed midline", async () => {
  const map = await labelMap();
  for (const [level, box] of Object.entries(PANELS) as [
    keyof typeof PANELS,
    (typeof PANELS)[keyof typeof PANELS],
  ][]) {
    const midline = box.x + MIDLINE[level] * box.width;
    const strays: string[] = [];
    for (let y = box.y; y < box.y + box.height; y += 1) {
      for (let x = box.x; x < box.x + box.width; x += 1) {
        const id = SectorId.options[(map.pixels[y * map.width + x] ?? 0) - 1];
        if (id === undefined) continue;
        if (!id.startsWith(`${level}_`)) continue;
        const side = id.endsWith("_R") ? "R" : "L";
        if (side === "R" && x > midline + MIDLINE_TOLERANCE_PX) strays.push(`${id} at ${x},${y}`);
        if (side === "L" && x < midline - MIDLINE_TOLERANCE_PX) strays.push(`${id} at ${x},${y}`);
      }
    }
    assert.deepEqual(
      strays.slice(0, 5),
      [],
      `${level}: ${strays.length} pixels on the wrong side of the midline`,
    );
  }
});

await test("the sheet is read with the patient's right on the left of the page", async () => {
  const map = await labelMap();
  const found = pixelsOf(map);
  for (const id of SectorId.options) {
    if (!id.endsWith("_R")) continue;
    const right = found.get(id) ?? [];
    const left = found.get(`${id.slice(0, -2)}_L`) ?? [];
    const centre = (pixels: number[]): number =>
      pixels.reduce((total, pixel) => total + (pixel % map.width), 0) / pixels.length;
    assert.ok(centre(right) < centre(left), `${id} is not drawn left of its left-hand twin`);
  }
});
