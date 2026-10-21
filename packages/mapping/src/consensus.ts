import { z } from "zod";

import {
  isPopulatedMappingValue,
  type JsonValue,
  reviewValueKey,
  SurgeryRecord,
} from "@prostapaper/contracts";

type Structure =
  | { kind: "object"; children: Record<string, Structure> }
  | { kind: "array"; item: Structure }
  | { kind: "value" };
type Flat = Map<string, string>;

/** Region selections are sets for comparison; displayed values retain their original order. */
export function consensusValueKey(path: string, value: JsonValue): string {
  return reviewValueKey(path.split(".").at(-1) ?? "", value);
}

export interface ConsensusFieldDiagnostic {
  path: string;
  selectedValue: JsonValue;
  selectedSupport: number;
  comparablePassCount: number;
  totalPassCount: number;
  alternatives: { value: JsonValue; count: number }[];
  selectionMethod: "majority" | "closest" | "lesion_fallback";
  reasonCodes: string[];
}

function structureOf(schema: z.ZodType): Structure {
  if (schema instanceof z.ZodReadonly) return structureOf(schema.def.innerType as z.ZodType);
  if (schema instanceof z.ZodObject) {
    return {
      kind: "object",
      children: Object.fromEntries(
        Object.entries<z.ZodType>(schema.shape).map(([key, child]) => [key, structureOf(child)]),
      ),
    };
  }
  if (schema instanceof z.ZodArray && schema.element instanceof z.ZodObject)
    return { kind: "array", item: structureOf(schema.element) };

  return { kind: "value" };
}

const RECORD = structureOf(SurgeryRecord);
const childPath = (path: string, key: string): string => {
  if (path === "") return key;

  return `${path}.${key}`;
};

function units(structure: Structure, value: unknown, path: string): [string, string][] {
  if (structure.kind === "value") return [[path, JSON.stringify(value)]];
  if (structure.kind === "array") {
    const array = value as unknown[];

    return [
      [`${path}.length`, JSON.stringify(array.length)],
      ...array.flatMap((item, index) => units(structure.item, item, childPath(path, String(index)))),
    ];
  }
  const object = value as Record<string, unknown>;

  return Object.entries(structure.children).flatMap(([key, child]) =>
    units(child, object[key], childPath(path, key)),
  );
}

function assemble(structure: Structure, path: string, majority: Flat): unknown {
  if (structure.kind === "value") return JSON.parse(majority.get(path) ?? "null") as unknown;
  if (structure.kind === "array") {
    const length = Number(majority.get(`${path}.length`));

    return Array.from({ length }, (_, index) =>
      assemble(structure.item, childPath(path, String(index)), majority),
    );
  }

  return Object.fromEntries(
    Object.entries(structure.children).map(([key, child]) => [
      key,
      assemble(child, childPath(path, key), majority),
    ]),
  );
}

function winner(counts: Map<string, number>): string {
  const first = [...counts].toSorted((left, right) => right[1] - left[1])[0];
  if (first === undefined) throw new Error("consensus needs at least one record");

  return first[0];
}

function aligned(records: readonly SurgeryRecord[]): boolean {
  return records.every((left, index) =>
    records.slice(index + 1).every((right) =>
      left.lesions.every((lesion, position) => {
        const other = right.lesions[position]?.sur_prostate_regions ?? [];

        return (
          lesion.sur_prostate_regions.length === 0 ||
          other.length === 0 ||
          lesion.sur_prostate_regions.some((region) => other.includes(region))
        );
      }),
    ),
  );
}

const overlaps = (left: readonly string[], right: readonly string[]): boolean =>
  left.some((region) => right.includes(region));

/** Votes are positional, so a pass lesion pairs with the selected lesion at its position by region overlap.
 * A single leftover lesion without regions on either side pairs by elimination. */
function lesionPairs(records: readonly SurgeryRecord[], resultRecord: SurgeryRecord): boolean[][] {
  const selected = resultRecord.lesions;

  return records.map(({ lesions }) => {
    if (lesions.length !== selected.length) return selected.map(() => false);
    const paired = selected.map((lesion, index) =>
      overlaps(lesion.sur_prostate_regions, lesions[index]?.sur_prostate_regions ?? []),
    );
    const leftover = [...paired.keys()].filter((index) => paired[index] === false);
    const [only] = leftover;
    if (
      leftover.length === 1 &&
      only !== undefined &&
      (selected[only]?.sur_prostate_regions.length === 0 || lesions[only]?.sur_prostate_regions.length === 0)
    )
      paired[only] = true;

    return paired;
  });
}

function diagnosticsFor(options: {
  records: readonly SurgeryRecord[];
  resultRecord: SurgeryRecord;
  source: Consensus["source"];
  lesionFallback: boolean;
}): ConsensusFieldDiagnostic[] {
  const { records, resultRecord, source, lesionFallback } = options;
  const selected = new Map(units(RECORD, resultRecord, ""));
  const flats = records.map((record) => new Map(units(RECORD, record, "")));
  const countDisagreement = new Set(records.map(({ lesions }) => lesions.length)).size > 1;
  const pairs = lesionPairs(records, resultRecord);

  return [...selected].map(([path, selectedJson]) => {
    const selectedValue = JSON.parse(selectedJson) as JsonValue;
    const comparableKey = (raw: string): string => consensusValueKey(path, JSON.parse(raw) as JsonValue);
    const isLesion = path.startsWith("lesions.") && path !== "lesions.length";
    const [, position = "", field = ""] = path.split(".");
    const lesionIndex = Number(position);
    const pairedIn = (index: number): boolean => !isLesion || pairs[index]?.[lesionIndex] === true;
    // Without a pairing, any lesion of that pass could be the source, so all of them must be empty.
    const emptyEverywhere =
      isLesion &&
      records.every((record, index) => {
        let candidates = record.lesions;
        if (pairedIn(index)) candidates = record.lesions.slice(lesionIndex, lesionIndex + 1);

        return candidates.every(
          (lesion) => !isPopulatedMappingValue(lesion[field as keyof typeof lesion] as JsonValue),
        );
      });
    const uncertainLesion =
      isLesion &&
      !emptyEverywhere &&
      records.some(
        (record, index) => record.lesions.length === resultRecord.lesions.length && !pairedIn(index),
      );
    const comparable = records.flatMap((record, index) => {
      if (isLesion && record.lesions.length !== resultRecord.lesions.length) return [];
      if (!pairedIn(index) && !emptyEverywhere) return [];
      const value = flats[index]?.get(path);
      if (value === undefined) return [];

      return [value];
    });
    const counts = new Map<string, number>();
    for (const value of comparable)
      counts.set(comparableKey(value), (counts.get(comparableKey(value)) ?? 0) + 1);
    const reasonCodes: string[] = [];
    let selectionMethod: ConsensusFieldDiagnostic["selectionMethod"] = source;
    if (isLesion && lesionFallback) selectionMethod = "lesion_fallback";
    if (selectionMethod === "closest") reasonCodes.push("closest_fallback");
    if (selectionMethod === "lesion_fallback") reasonCodes.push("lesion_fallback");
    if (countDisagreement && path.startsWith("lesions.")) reasonCodes.push("lesion_count_disagreement");
    if (uncertainLesion) reasonCodes.push("lesion_alignment_uncertain");

    return {
      path,
      selectedValue,
      selectedSupport: counts.get(comparableKey(selectedJson)) ?? 0,
      comparablePassCount: comparable.length,
      totalPassCount: records.length,
      alternatives: [...counts].map(([value, count]) => ({ value: JSON.parse(value) as JsonValue, count })),
      selectionMethod,
      reasonCodes,
    };
  });
}

export interface Consensus {
  record: SurgeryRecord;
  source: "majority" | "closest";
  lesionAlignment: "aligned" | "closest";
  closestIndex: number;
  fields: number;
  stable: number;
  unstable: string[];
  fieldDiagnostics: ConsensusFieldDiagnostic[];
}

export function consensus(records: readonly SurgeryRecord[]): Consensus {
  if (records.length === 0) throw new Error("consensus needs at least one record");
  const lengths = new Map<string, number>();
  for (const record of records) {
    const key = String(record.lesions.length);
    lengths.set(key, (lengths.get(key) ?? 0) + 1);
  }
  const length = Number(winner(lengths));
  const eligible = records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.lesions.length === length);
  const lesionAlignment: Consensus["lesionAlignment"] = aligned(eligible.map(({ record }) => record))
    ? "aligned"
    : "closest";
  const flats = records.map((record) => new Map(units(RECORD, record, "")));
  const votes = new Map<string, Map<string, number>>();
  for (const [index, flat] of flats.entries()) {
    for (const [path, value] of flat) {
      if (path === "lesions.length") continue;
      if (
        path.startsWith("lesions.") &&
        (records[index]?.lesions.length !== length || lesionAlignment === "closest")
      )
        continue;
      const counts = votes.get(path) ?? new Map<string, number>();
      counts.set(value, (counts.get(value) ?? 0) + 1);
      votes.set(path, counts);
    }
  }
  votes.set("lesions.length", lengths);
  const majority: Flat = new Map();
  const unstable: string[] = [];
  let stable = 0;
  for (const [path, counts] of votes) {
    majority.set(path, winner(counts));
    if (counts.size === 1) stable += 1;
    else unstable.push(`${path}: ${[...counts].map(([value, count]) => `${value} ×${count}`).join(" | ")}`);
  }
  const ranked = eligible
    .map(({ index, record }) => ({
      index,
      record,
      agreement: [...(flats[index] ?? [])].filter(([path, value]) => majority.get(path) === value).length,
    }))
    .toSorted((left, right) => right.agreement - left.agreement);
  const closest = ranked[0];
  if (closest === undefined) throw new Error("consensus needs at least one record");
  const assembled = assemble(RECORD, "", majority) as Record<string, unknown>;
  if (lesionAlignment === "closest") assembled["lesions"] = closest.record.lesions;
  const parsed = SurgeryRecord.safeParse(assembled);
  const result = { closestIndex: closest.index, fields: votes.size, stable, unstable, lesionAlignment };

  if (parsed.success) {
    return {
      ...result,
      record: parsed.data,
      source: "majority",
      fieldDiagnostics: diagnosticsFor({
        records,
        resultRecord: parsed.data,
        source: "majority",
        lesionFallback: lesionAlignment === "closest",
      }),
    };
  }

  return {
    ...result,
    record: closest.record,
    source: "closest",
    fieldDiagnostics: diagnosticsFor({
      records,
      resultRecord: closest.record,
      source: "closest",
      lesionFallback: lesionAlignment === "closest",
    }),
  };
}
