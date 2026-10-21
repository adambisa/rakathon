import assert from "node:assert/strict";
import test from "node:test";

import { assessmentRequiresDecision, parseMappingReview } from "@prostapaper/contracts";

import { consensus } from "#consensus";
import { buildMappingReview, type ReviewPass } from "#review";
import { applySectorMap, sectorMapMarks } from "#sector-map";
import { fixture } from "#test-fixtures";
import { assembleCaseText, type CaseDocumentText } from "#text";

const report: CaseDocumentText = {
  documentId: "report-1",
  sourceVersion: "version-1",
  extractionIdentity: "sha256:extraction-1",
  filename: "nalez.jpg",
  kind: "text_description",
  extracted: { pages: [{ page: 1, text: "  Rozměr ložiska 12 mm.\nAdenokarcinom.  ", source: "ocr" }] },
};
const pass = (): ReviewPass => ({
  record: fixture(),
  diagnostics: { repaired: false },
  citations: [
    {
      path: "lesions.0.lesion_x_mm",
      documentId: "report-1",
      extractionIdentity: "sha256:extraction-1",
      page: 1,
      quote: "Rozměr ložiska 12 mm.",
      relation: "supports",
    },
  ],
});
const build = (passes: ReviewPass[], documents: CaseDocumentText[] = [report]) => {
  const selected = consensus(passes.map((item) => item.record));

  return buildMappingReview({
    mappingIdentity: "run-1",
    record: selected.record,
    consensus: selected,
    passes,
    requestedPassCount: passes.length,
    documents,
  });
};

void test("verified citations are pinned to exact canonical page text and the selected field", () => {
  const review = build([pass(), pass(), pass()]);
  const size = review.assessments.find(
    (item) => item.reference.scope === "lesion" && item.reference.field === "lesion_x_mm",
  );
  assert.equal(size?.confidence, "high");
  assert.equal(size.selectedSupport, 3);
  assert.equal(review.sources[0]?.pages[0]?.text, report.extracted.pages[0]?.text);
  assert.equal(review.evidence[0]?.verification.status, "verified");
  assert.equal(review.evidence[0].verification.start, 2);
  assert.equal(review.assessments.length, 15);
  assert.ok(review.assessments.every((item) => item.reference.scope !== "surgery"));
  assert.deepEqual(parseMappingReview(review, fixture()), review);
});

void test("missing/invalid citations never acquire confidence from unanimous votes", () => {
  const noCitation = pass();
  noCitation.citations = [];
  const review = build([noCitation, noCitation, noCitation]);
  const size = review.assessments.find(
    (item) => item.reference.scope === "lesion" && item.reference.field === "lesion_x_mm",
  );
  assert.equal(size?.confidence, "low");
  const invented = pass();
  assert.ok(invented.citations?.[0]);
  invented.citations[0].quote = "Invented quote";
  const invalid = build([pass(), pass(), invented]);
  const invalidSize = invalid.assessments.find(
    (item) => item.reference.scope === "lesion" && item.reference.field === "lesion_x_mm",
  );
  assert.equal(invalidSize?.confidence, "low");
  assert.ok(invalidSize.reasonCodes.includes("citation_invalid"));
});

void test("repair uncertainty caps confidence and no source identity is fabricated for legacy input", () => {
  const repaired = pass();
  repaired.diagnostics.repaired = true;
  const review = build([pass(), pass(), repaired]);
  assert.equal(
    review.assessments.find(
      (item) => item.reference.scope === "lesion" && item.reference.field === "lesion_x_mm",
    )?.confidence,
    "low",
  );
  const legacy = build(
    [pass()],
    [{ filename: "legacy.jpg", kind: "text_description", extracted: report.extracted }],
  );
  assert.equal(legacy.sources.length, 0);
  assert.ok(legacy.assessments.every((item) => item.confidence === "unavailable"));
});

function sheet(): CaseDocumentText {
  const focus = {
    sectors: [{ id: "base_PZpl_L" as const, share: 1, coverage: 0.5 }],
    marked: ["base_PZpl_L" as const],
  };

  return {
    documentId: "sheet-1",
    sourceVersion: "sheet-version",
    extractionIdentity: "sheet-extraction",
    filename: "mapa.jpg",
    kind: "sector_map",
    extracted: {
      pages: [{ page: 1, text: "machine sheet", source: "opencv" }],
      sectorMap: { pages: [{ page: 1, foci: [focus, focus] }] },
    },
  };
}

void test("distinct marks remain unresolved despite the same region already appearing on a lesion", () => {
  const output = pass();
  const second = output.record.lesions[0];
  assert.ok(second);
  output.record.lesions.push({ ...second, sur_prostate_regions: ["tza_apex_rs"] });
  const review = build([output], [report, sheet()]);
  assert.equal(review.marks.length, 2);
  assert.notEqual(review.marks[0]?.id, review.marks[1]?.id);
  assert.ok(review.marks.every((mark) => mark.status === "ambiguous" && mark.lesionId === null));
});

void test("sector postprocessing recomputes selected votes and retains before/after plus source mark IDs", () => {
  const output = pass();
  const lesion = output.record.lesions[0];
  assert.ok(lesion);
  lesion.sur_prostate_regions = [];
  const selected = consensus([output.record, output.record, output.record]);
  const documents = [report, sheet()];
  const applied = applySectorMap(selected.record, sectorMapMarks(documents));
  const review = buildMappingReview({
    mappingIdentity: "run",
    record: applied.record,
    consensus: selected,
    passes: [output, output, output],
    requestedPassCount: 3,
    documents,
  });
  const regions = review.assessments.find(
    (item) => item.reference.scope === "lesion" && item.reference.field === "sur_prostate_regions",
  );
  assert.equal(regions?.selectedSupport, 0);
  assert.equal(regions.selectionMethod, "sector");
  assert.equal(regions.confidence, "low");
  assert.deepEqual(review.transformations[0]?.before, []);
  assert.deepEqual(review.transformations[0].after, ["pzpl_base_ls"]);
  assert.equal(review.transformations[0].sourceMarkIds.length, 2);
});

void test("pinned prompt pages expose identifiers while keeping original text and legacy prompt stable", () => {
  const text = assembleCaseText([report], { citations: true });
  assert.ok(text.includes('document="report-1"'));
  assert.ok(text.includes('extraction="sha256:extraction-1" page=1'));
  assert.ok(text.endsWith(report.extracted.pages[0]?.text ?? "missing"));
});

void test("region-set ordering does not turn supporting citations into conflicts", () => {
  const a = pass();
  const b = pass();
  const first = a.record.lesions[0];
  const second = b.record.lesions[0];
  assert.ok(first);
  assert.ok(second);
  first.sur_prostate_regions = ["pzpl_base_ls", "tza_apex_rs"];
  second.sur_prostate_regions = ["tza_apex_rs", "pzpl_base_ls"];
  const citation = a.citations?.[0];
  assert.ok(citation);
  a.citations = [{ ...citation, path: "lesions.0.sur_prostate_regions" }];
  b.citations = a.citations;
  const review = build([a, b, a]);
  const regions = review.assessments.find(
    (item) => item.reference.scope === "lesion" && item.reference.field === "sur_prostate_regions",
  );
  assert.equal(regions?.selectedSupport, 3);
  assert.equal(regions.confidence, "high");
  assert.ok(review.evidence.every((item) => item.relation === "supports"));
});

void test("disabled evidence instrumentation reports unavailable instead of measured low confidence", () => {
  const uninstrumented = pass();
  delete uninstrumented.citations;
  const review = build([uninstrumented, uninstrumented, uninstrumented]);
  assert.ok(review.assessments.every((assessment) => assessment.confidence === "unavailable"));
  assert.ok(
    review.assessments.every((assessment) => assessment.reasonCodes.includes("evidence_not_collected")),
  );
});

void test("a selected zero-lesion count still requires a count decision when citations are disabled", () => {
  const empty = pass();
  empty.record.lesions = [];
  delete empty.citations;
  const one = pass();
  delete one.citations;
  const review = build([empty, empty, one]);
  const count = review.assessments.find((item) => item.reference.scope === "collection");
  assert.ok(count);
  assert.equal(count.selectedValue, 0);
  assert.equal(count.selectedSupport, 2);
  assert.deepEqual(count.alternatives, [
    { value: 0, count: 2 },
    { value: 1, count: 1 },
  ]);
  assert.ok(count.reasonCodes.includes("lesion_count_disagreement"));
  assert.ok(assessmentRequiresDecision(count, true));
  assert.deepEqual(parseMappingReview(review, empty.record), review);
});

void test("a losing value's conflicting citation is not attributed against the selected value", () => {
  const losing = pass();
  const lesion = losing.record.lesions[0];
  const citation = losing.citations?.[0];
  assert.ok(lesion);
  assert.ok(citation);
  lesion.lesion_x_mm = 13;
  // The report says 12 mm, which conflicts with this pass's 13 mm value only.
  citation.relation = "conflicts";
  const review = build([pass(), pass(), losing]);
  const size = review.assessments.find(
    (item) => item.reference.scope === "lesion" && item.reference.field === "lesion_x_mm",
  );
  assert.ok(size);
  assert.equal(size.selectedValue, 12);
  assert.equal(size.selectedSupport, 2);
  assert.equal(size.evidenceStatus, "verified");
  assert.equal(size.confidence, "medium");
  assert.equal(size.evidenceIds.length, 2);
  assert.ok(review.evidence.every((item) => item.relation === "supports"));
});

void test("citations conflicting with the selected value still require a decision", () => {
  const conflicting = pass();
  const citation = conflicting.citations?.[0];
  assert.ok(citation);
  citation.relation = "conflicts";
  const review = build([pass(), pass(), conflicting]);
  const size = review.assessments.find(
    (item) => item.reference.scope === "lesion" && item.reference.field === "lesion_x_mm",
  );
  assert.ok(size);
  assert.equal(size.evidenceStatus, "conflicting");
  assert.ok(assessmentRequiresDecision(size, true));
});
