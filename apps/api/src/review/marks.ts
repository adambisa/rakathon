import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";

import {
  type MappingReview,
  redcapAllSegmentRegions,
  RegionCode,
  type ReviewManualRegions,
  type ReviewMarkResolution,
  type ReviewMarkView,
  reviewValueKey,
  type SurgeryRecord,
} from "@prostapaper/contracts";

interface MarkInput {
  record: SurgeryRecord;
  lesionIds: string[];
  evidence: MappingReview | null;
  markHistory: ReviewMarkResolution[];
}

export function effectiveMarks(input: MarkInput): ReviewMarkView[] {
  return (
    input.evidence?.marks.map((source) => {
      const latest = input.markHistory.findLast((event) => event.markId === source.id);
      let status: ReviewMarkView["status"] = latest?.action ?? source.status;
      let lesionId = source.lesionId;
      if (latest !== undefined) lesionId = latest.lesionId;
      if (status === "assigned") {
        const lesion = input.record.lesions[input.lesionIds.indexOf(lesionId ?? "")];
        if (
          lesion === undefined ||
          !source.regions.every((region) => lesion.sur_prostate_regions.includes(region))
        ) {
          status = "unassigned";
          lesionId = null;
        }
      }

      return { source, status, lesionId, resolutionId: latest?.id ?? null, note: latest?.note ?? null };
    }) ?? []
  );
}

interface RegionStateInput extends MarkInput {
  proposal: SurgeryRecord;
  originalLesionIds: string[];
  manualRegions: ReviewManualRegions[];
}

export function initializeManualRegions(input: RegionStateInput): ReviewManualRegions[] {
  return input.lesionIds.map((lesionId, index) => {
    const stored = input.manualRegions.find((item) => item.lesionId === lesionId);
    if (stored !== undefined) return structuredClone(stored);
    const current = input.record.lesions[index];
    if (current === undefined) throw new Error("Lesion identity mismatch");
    const original = input.proposal.lesions[input.originalLesionIds.indexOf(lesionId)];
    let regions = current.sur_prostate_regions;
    if (
      original !== undefined &&
      reviewValueKey("sur_prostate_regions", regions) ===
        reviewValueKey("sur_prostate_regions", original.sur_prostate_regions)
    ) {
      const transformation = input.evidence?.transformations.find(
        (item) =>
          item.reference.scope === "lesion" &&
          item.reference.lesionId === lesionId &&
          item.reference.field === "sur_prostate_regions" &&
          item.ruleId === "single-lesion-sector-enforcement",
      );
      const before = RegionCode.array().safeParse(transformation?.before);
      if (before.success) regions = before.data;
    }

    return { lesionId, regions: [...regions] };
  });
}

interface UpdateMarksInput extends RegionStateInput {
  previous: SurgeryRecord;
  previousLesionIds: string[];
  revision: number;
  actorId: string;
  manualAllSegments?: string[];
}

/** Manual additions own only their delta; removing a mark's regions reopens that assignment. */
export function reconcileRegionEdits(input: UpdateMarksInput): {
  manualRegions: ReviewManualRegions[];
  markHistory: ReviewMarkResolution[];
} {
  const history = [...input.markHistory];
  const previousManual = initializeManualRegions({
    ...input,
    record: input.previous,
    lesionIds: input.previousLesionIds,
  });
  const manualRegions = initializeManualRegions({ ...input, manualRegions: previousManual });
  for (const [index, lesionId] of input.lesionIds.entries()) {
    const current = input.record.lesions[index];
    const previous = input.previous.lesions[input.previousLesionIds.indexOf(lesionId)];
    if (current === undefined) throw new Error("Lesion identity mismatch");
    const owned = manualRegions.find((entry) => entry.lesionId === lesionId);
    if (input.manualAllSegments?.includes(lesionId) === true && owned !== undefined) {
      owned.regions = [...current.sur_prostate_regions];
      continue;
    }
    if (
      previous === undefined ||
      reviewValueKey("sur_prostate_regions", previous.sur_prostate_regions) ===
        reviewValueKey("sur_prostate_regions", current.sur_prostate_regions)
    )
      continue;
    const entry = manualRegions.find((entry) => entry.lesionId === lesionId);
    if (entry !== undefined)
      entry.regions = current.sur_prostate_regions.filter(
        (region) => entry.regions.includes(region) || !previous.sur_prostate_regions.includes(region),
      );
  }
  for (const source of input.evidence?.marks ?? []) {
    const latest = history.findLast((event) => event.markId === source.id);
    if (latest !== undefined && latest.action !== "assigned") continue;
    if (latest === undefined && source.status !== "assigned") continue;
    let targetId = source.lesionId;
    if (latest !== undefined) targetId = latest.lesionId;
    const target = input.record.lesions[input.lesionIds.indexOf(targetId ?? "")];
    if (
      target !== undefined &&
      source.regions.every((region) => target.sur_prostate_regions.includes(region))
    )
      continue;
    history.push({
      id: randomUUID(),
      markId: source.id,
      action: "unassigned",
      lesionId: null,
      actorId: input.actorId,
      atRevision: input.revision,
      at: new Date().toISOString(),
      note: "Cílové ložisko bylo odstraněno nebo byly změněny jeho oblasti.",
    });
  }

  return { manualRegions, markHistory: history };
}

interface ResolveMarkInput extends MarkInput {
  manualRegions: ReviewManualRegions[];
  actorId: string;
  revision: number;
  markId: string;
  note: string;
  lesionId: string | null;
}

export function resolveMark(input: ResolveMarkInput): {
  record: SurgeryRecord;
  markHistory: ReviewMarkResolution[];
} {
  const source = input.evidence?.marks.find((mark) => mark.id === input.markId);
  if (source === undefined) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown source mark" });
  if (input.lesionId !== null && !input.lesionIds.includes(input.lesionId))
    throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown target lesion" });
  const markHistory: ReviewMarkResolution[] = [
    ...input.markHistory,
    {
      id: randomUUID(),
      markId: input.markId,
      action: "assigned",
      lesionId: input.lesionId,
      actorId: input.actorId,
      atRevision: input.revision,
      at: new Date().toISOString(),
      note: input.note,
    },
  ];
  const event = markHistory.at(-1);
  if (event !== undefined && input.lesionId === null) event.action = "dismissed";
  // Read assignment state against a temporary union so a newly assigned region isn't treated as missing.
  const record = structuredClone(input.record);
  for (const [index, lesionId] of input.lesionIds.entries()) {
    const lesion = record.lesions[index];
    if (lesion === undefined) throw new Error("Lesion identity mismatch");
    const regions = new Set(
      input.manualRegions.find((item) => item.lesionId === lesionId)?.regions ?? lesion.sur_prostate_regions,
    );
    for (const mark of input.evidence?.marks ?? []) {
      const latest = markHistory.findLast((event) => event.markId === mark.id);
      let target = mark.lesionId;
      if (latest !== undefined) target = latest.lesionId;
      if (
        latest?.action === "dismissed" ||
        latest?.action === "unassigned" ||
        (latest === undefined && mark.status !== "assigned") ||
        target !== lesionId
      )
        continue;
      for (const region of mark.regions) regions.add(region);
    }
    lesion.sur_prostate_regions = [...regions];
    if (
      lesion.all_sgm &&
      (regions.size !== redcapAllSegmentRegions.length ||
        !redcapAllSegmentRegions.every((region) => regions.has(region)))
    )
      lesion.all_sgm = false;
  }

  return { record, markHistory };
}
