import assert from "node:assert/strict";
import test from "node:test";

import {
  caseName,
  caseStem,
  EMPTY_STAGED,
  isSubmittable,
  mergeStaged,
  pairFiles,
  slotOf,
  sortFiles,
  unstage,
} from "#lib/batch-pairing";

const jpeg = (name: string) => new File(["x"], name, { type: "image/jpeg", lastModified: 0 });
const names = (files: readonly File[]) => files.map((file) => file.name);

void test("caseStem takes the trailing number by value, ignoring a copy suffix", () => {
  assert.equal(caseStem("scan-0005.jpg"), "5");
  assert.equal(caseStem("schema-5.JPG"), "5");
  assert.equal(caseStem("Scan_0005 (1).jpg"), "5");
  assert.equal(caseStem("Rakathon35.jpg"), "35");
  assert.equal(caseStem("Novák_Jan.jpg"), "Novák_Jan");
  assert.equal(caseStem("12-report.jpg"), "12-report");
});

void test("caseName spells numeric stems like the sample launcher and keeps the rest", () => {
  assert.equal(caseName("5"), "Rakathon 5");
  assert.equal(caseName("Novák_Jan"), "Novák_Jan");
});

void test("slotOf reads the kind from the words in the filename, in either Unicode form", () => {
  assert.equal(slotOf("Scan_0001.jpg"), "text_description");
  assert.equal(slotOf("report001.jpg"), "text_description");
  assert.equal(slotOf("Nález_0001.jpg".normalize("NFD")), "text_description");
  assert.equal(slotOf("Schema_0001.jpg"), "sector_map");
  assert.equal(slotOf("Schéma_0001.jpg".normalize("NFD")), "sector_map");
  assert.equal(slotOf("sektorova-mapa-12.jpg"), "sector_map");
  assert.equal(slotOf("IMG_0001.jpg"), undefined);
});

void test("sortFiles splits a folder into reports, sheets and the rest", () => {
  const sorted = sortFiles([
    jpeg("Scan_0001.jpg"),
    jpeg("Schema_0001.jpg"),
    jpeg("Scan_0002.jpg"),
    jpeg("IMG_1.jpg"),
  ]);
  assert.deepEqual(names(sorted.text_description), ["Scan_0001.jpg", "Scan_0002.jpg"]);
  assert.deepEqual(names(sorted.sector_map), ["Schema_0001.jpg"]);
  assert.deepEqual(names(sorted.unknown), ["IMG_1.jpg"]);
});

void test("pairFiles matches sheets to reports by number, sorts by it and applies typed names", () => {
  const { cases, problems } = pairFiles(
    sortFiles([
      jpeg("scan-0012.jpg"),
      jpeg("scan-0005.jpg"),
      jpeg("scan-0008.jpg"),
      jpeg("schema-5.jpg"),
      jpeg("schema-0012.jpg"),
    ]),
    { "8": "Novák" },
  );
  assert.deepEqual(
    cases.map((entry) => [entry.stem, entry.name, entry.report.name, entry.sheet?.name]),
    [
      ["5", "Rakathon 5", "scan-0005.jpg", "schema-5.jpg"],
      ["8", "Novák", "scan-0008.jpg", undefined],
      ["12", "Rakathon 12", "scan-0012.jpg", "schema-0012.jpg"],
    ],
  );
  assert.deepEqual(problems, []);
});

void test("pairFiles lists repeated numbers, sheets without a report and unknown files as problems", () => {
  const { cases, problems } = pairFiles(
    sortFiles([jpeg("scan-0005.jpg"), jpeg("Scan_0005 (1).jpg"), jpeg("schema-0009.jpg"), jpeg("IMG_1.jpg")]),
  );
  assert.deepEqual(names(cases.map((entry) => entry.report)), ["scan-0005.jpg"]);
  assert.deepEqual(
    problems.map(({ file, issue }) => [file.name, issue]),
    [
      ["Scan_0005 (1).jpg", "duplicate"],
      ["schema-0009.jpg", "orphan"],
      ["IMG_1.jpg", "unknown"],
    ],
  );
});

void test("isSubmittable needs a case, no problems and no blank names", () => {
  const staged = sortFiles([jpeg("scan-1.jpg")]);
  assert.equal(isSubmittable(pairFiles(staged)), true);
  assert.equal(isSubmittable(pairFiles(staged, { "1": "  " })), false);
  assert.equal(isSubmittable(pairFiles(EMPTY_STAGED)), false);
  assert.equal(isSubmittable(pairFiles(sortFiles([jpeg("scan-1.jpg"), jpeg("IMG_1.jpg")]))), false);
});

void test("mergeStaged skips files already staged in any slot and unstage drops them", () => {
  const report = jpeg("scan-1.jpg");
  const sheet = jpeg("schema-1.jpg");
  const staged = mergeStaged(sortFiles([report]), sortFiles([jpeg("scan-1.jpg"), sheet]));
  assert.deepEqual(names(staged.text_description), ["scan-1.jpg"]);
  assert.deepEqual(names(staged.sector_map), ["schema-1.jpg"]);
  assert.deepEqual(unstage(staged, [report, sheet, undefined]), EMPTY_STAGED);
});
