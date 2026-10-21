import assert from "node:assert/strict";
import { test } from "node:test";

import {
  emptyReviewWorkflow,
  lesionCollectionRef,
  type ReviewDraftRecord,
  type ReviewMarkView,
  type ReviewWorkspace,
} from "@prostapaper/contracts";

import { mappingFieldViews } from "#lib/mapping-review";
import { reviewAttention } from "#lib/review-attention";

const record: ReviewDraftRecord = {
  surgery: {
    surgery_date: "2026-10-01",
    surgery_type: "2",
    lymphadenectomy: "1",
    node_no_surgery: 8,
    node_positive_no_surgery: 1,
    pt_surg: null,
    pn_surg: null,
    pm_surg: null,
    classify_r_surg: "1",
    classify_l_surg: "1",
    vascular_inv: "1",
    isup: "2",
    histol_post_surg: "1",
    histol_post_surg_specify: null,
    surgery_text: null,
  },
  lesions: [],
};
const mark: ReviewMarkView = {
  source: {
    id: "mark-1",
    documentId: "sheet",
    sourceVersion: "v1",
    extractionIdentity: "sha256:sheet",
    page: 1,
    focus: { sectors: [{ id: "apex_AS_L", share: 1, coverage: 1 }], marked: ["apex_AS_L"] },
    regions: ["as_apex_ls"],
    status: "unassigned",
    lesionId: null,
    candidateLesionIds: [],
    ruleVersion: 1,
  },
  status: "unassigned",
  lesionId: null,
  resolutionId: null,
  note: null,
};
const workspace: ReviewWorkspace = {
  note: "",
  proposal: { record },
  evidence: null,
  mappingIdentity: "mapping/case/record.json",
  baseline: { versionId: "v1", sha256: "a".repeat(64) },
  approvedRevision: null,
  revision: 1,
  snapshot: null,
  record,
  lesionIds: [],
  proposalLesionIds: [],
  issues: [],
  readOnly: false,
  workflow: emptyReviewWorkflow(),
  marks: [mark],
  markHistory: [],
  workflowStatus: {
    fields: [
      {
        reference: { scope: "surgery", field: "surgery_date" },
        decisionRequired: true,
        noteRequired: false,
        resolved: false,
      },
      {
        reference: { scope: "surgery", field: "surgery_type" },
        decisionRequired: true,
        noteRequired: true,
        resolved: true,
      },
      { reference: lesionCollectionRef, decisionRequired: true, noteRequired: false, resolved: false },
    ],
    sections: [],
  },
};

await test("the worklist lists server-required decisions once, unresolved marks, and orders by priority", () => {
  const fields = mappingFieldViews(record, null, []);
  const attention = reviewAttention(workspace, fields);
  const keys = attention.items.map((item) => item.key);
  assert.ok(keys.includes('decision:["surgery","surgery_date"]'));
  assert.ok(!keys.some((key) => key.includes("surgery_type")));
  assert.ok(keys.some((key) => key.startsWith("decision:") && key.includes("collection")));
  const markItem = attention.items.find((item) => item.key === "mark:mark-1");
  assert.ok(markItem);
  assert.equal(markItem.priority, 1);
  assert.equal(markItem.label, "Značka 1 · Schéma · strana 1");
  assert.equal(new Set(keys).size, keys.length);
  const priorities = attention.items.map((item) => item.priority);
  assert.deepEqual(
    priorities,
    priorities.toSorted((a, b) => a - b),
  );
});
await test("marks assigned or dismissed on the server do not stay in the worklist", () => {
  const fields = mappingFieldViews(record, null, []);
  const resolved = reviewAttention(
    { ...workspace, marks: [{ ...mark, status: "dismissed", note: "Artefakt skenu." }] },
    fields,
  );
  assert.ok(!resolved.items.some((item) => item.key.startsWith("mark:")));
});

await test("mark numbering includes resolved marks so all review surfaces identify the same mark", () => {
  const nextMark = { ...mark, source: { ...mark.source, id: "mark-second" } };
  const attention = reviewAttention(
    { ...workspace, marks: [{ ...mark, status: "dismissed" }, nextMark] },
    mappingFieldViews(record, null, []),
  );
  const item = attention.items.find((item) => item.key === "mark:mark-second");
  assert.equal(item?.label, "Značka 2 · Schéma · strana 1");
  assert.ok(!item.label.includes("mark-second"));
});
