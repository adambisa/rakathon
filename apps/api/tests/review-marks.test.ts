import assert from "node:assert/strict";
import { test } from "node:test";

import { parseMappingReview, redcapAllSegmentRegions } from "@prostapaper/contracts";

import { mappingEvidenceFixture } from "#fixtures/mapping";
import { fixture } from "#fixtures/surgery";
import { effectiveMarks, initializeManualRegions, reconcileRegionEdits, resolveMark } from "#review/marks";
import { applyReviewOperations } from "#review/model";

function context() {
  const record = fixture();
  const lesion = record.lesions[0];
  assert.ok(lesion);
  lesion.sur_prostate_regions.push("pza_mid_rs");
  const evidence = mappingEvidenceFixture(record, ["first"]);
  const mark = evidence.marks[0];
  assert.ok(mark);
  mark.status = "assigned";
  mark.lesionId = "first";
  mark.regions = ["pza_mid_rs"];
  mark.focus = { sectors: [{ id: "mid_PZa_R", share: 1, coverage: 0.5 }], marked: ["mid_PZa_R"] };
  evidence.transformations.push({
    id: "sector-1",
    ruleId: "single-lesion-sector-enforcement",
    ruleVersion: 1,
    reference: { scope: "lesion", lesionId: "first", field: "sur_prostate_regions" },
    before: ["pzpl_base_ls"],
    after: lesion.sur_prostate_regions,
    sourceMarkIds: [mark.id],
  });
  const parsedEvidence = parseMappingReview(evidence, record);
  assert.ok(parsedEvidence);

  return {
    record,
    lesionIds: ["first"],
    retiredLesionIds: [],
    evidence: parsedEvidence,
    proposal: structuredClone(record),
    originalLesionIds: ["first"],
    markHistory: [],
    manualRegions: [],
    actorId: "owner",
    revision: 2,
  };
}

void test("explicit all-segment selection remains complete after its contributing mark is dismissed", () => {
  const current = context();
  const all = applyReviewOperations(current, [
    { kind: "update_lesion", lesionId: "first", changes: { all_sgm: true } },
  ]);
  const state = reconcileRegionEdits({
    ...current,
    ...all,
    previous: current.record,
    previousLesionIds: current.lesionIds,
    manualAllSegments: ["first"],
  });
  const dismissed = resolveMark({
    ...current,
    ...all,
    ...state,
    markId: "mark-1",
    lesionId: null,
    note: "All segments explicitly reviewed",
  });
  assert.equal(dismissed.record.lesions[0]?.all_sgm, true);
  assert.deepEqual(
    new Set(dismissed.record.lesions[0].sur_prostate_regions),
    new Set(redcapAllSegmentRegions),
  );
});

void test("an unrelated manual region addition does not take ownership of unchanged automatic mark regions", () => {
  const current = context();
  assert.deepEqual(initializeManualRegions(current)[0]?.regions, ["pzpl_base_ls"]);
  const edited = applyReviewOperations(current, [
    {
      kind: "update_lesion",
      lesionId: "first",
      changes: { sur_prostate_regions: ["pzpl_base_ls", "pza_mid_rs", "as_mid_ls"] },
    },
  ]);
  const state = reconcileRegionEdits({
    ...current,
    ...edited,
    previous: current.record,
    previousLesionIds: current.lesionIds,
  });
  const dismissed = resolveMark({
    ...current,
    ...edited,
    ...state,
    markId: "mark-1",
    lesionId: null,
    note: "Dismiss only the source mark",
  });
  assert.deepEqual(dismissed.record.lesions[0]?.sur_prostate_regions, ["pzpl_base_ls", "as_mid_ls"]);
});

for (const { action, lesionId, secondRegions } of [
  { action: "dismissed", lesionId: null, secondRegions: ["as_mid_ls"] },
  { action: "reassigned", lesionId: "second", secondRegions: ["as_mid_ls", "pza_mid_rs"] },
]) {
  void test(`a restored lesion loses only its automatic region when its source mark is ${action}`, () => {
    const current = context();
    const second = fixture().lesions[0];
    assert.ok(second);
    second.sur_prostate_regions = ["as_mid_ls"];
    const deleted = applyReviewOperations(
      { record: current.record, lesionIds: current.lesionIds, retiredLesionIds: [] },
      [
        { kind: "delete_lesion", lesionId: "first" },
        { kind: "add_lesion", lesionId: "second", lesion: second },
      ],
    );
    const deletedState = reconcileRegionEdits({
      ...current,
      ...deleted,
      previous: current.record,
      previousLesionIds: current.lesionIds,
    });
    assert.equal(deletedState.markHistory.at(-1)?.action, "unassigned");
    const restored = applyReviewOperations(deleted, [{ kind: "restore_lesion", lesionId: "first" }], current);
    const restoredState = reconcileRegionEdits({
      ...current,
      ...deletedState,
      ...restored,
      previous: deleted.record,
      previousLesionIds: deleted.lesionIds,
      revision: 3,
    });
    assert.equal(effectiveMarks({ ...current, ...restored, ...restoredState })[0]?.status, "unassigned");
    const resolved = resolveMark({
      ...current,
      ...restored,
      ...restoredState,
      revision: 4,
      markId: "mark-1",
      lesionId,
      note: "Correct the restored source mark",
    });
    assert.deepEqual(resolved.record.lesions[0]?.sur_prostate_regions, ["pzpl_base_ls"]);
    assert.deepEqual(resolved.record.lesions[1]?.sur_prostate_regions, secondRegions);
  });
}

void test("a new lesion retains its supplied manual regions after an overlapping mark is assigned and dismissed", () => {
  const current = context();
  const second = fixture().lesions[0];
  assert.ok(second);
  second.sur_prostate_regions = ["as_mid_ls", "pza_mid_rs"];
  const added = applyReviewOperations(current, [{ kind: "add_lesion", lesionId: "second", lesion: second }]);
  const state = reconcileRegionEdits({
    ...current,
    ...added,
    previous: current.record,
    previousLesionIds: current.lesionIds,
  });
  const assigned = resolveMark({
    ...current,
    ...added,
    ...state,
    markId: "mark-1",
    lesionId: "second",
    note: "Assign the source mark to the new lesion",
  });
  const dismissed = resolveMark({
    ...current,
    ...added,
    ...state,
    ...assigned,
    revision: 3,
    markId: "mark-1",
    lesionId: null,
    note: "Dismiss the overlapping source mark",
  });
  assert.deepEqual(dismissed.record.lesions[1]?.sur_prostate_regions, ["as_mid_ls", "pza_mid_rs"]);
});
