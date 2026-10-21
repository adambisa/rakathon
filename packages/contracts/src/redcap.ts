import { redcapAllSegmentRegions, redcapSurgicalFields } from "#redcap-schema";

export type RedcapValues = Record<string, string>;

interface RedcapLesion {
  instance: string;
  values: RedcapValues;
}

export interface RedcapUploadInput {
  recordId: string;
  surgery?: RedcapValues;
  lesions: RedcapLesion[];
}

export interface RedcapValidationIssue {
  scope: "record" | "surgery" | "lesion" | "collection";
  field?: string;
  instance?: string;
  code: "required" | "unknown_field" | "branching" | "invalid_value" | "semantic" | "instance";
  message: string;
}

interface FieldIssue {
  field: string;
  code: RedcapValidationIssue["code"];
  message: string;
}

interface RedcapUploadResult {
  projectId: 64;
  rows: RedcapValues[];
  errors: string[];
  issues: RedcapValidationIssue[];
}

type SurgicalField = (typeof redcapSurgicalFields)[number];
const decimal = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;

function validRecordId(id: string): boolean {
  if (id === "") return false;
  for (const character of id) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) return false;
  }

  return true;
}

function normalize(values: RedcapValues): RedcapValues {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()]));
}

export function isRedcapFieldVisible(branching: string, values: RedcapValues): boolean {
  if (branching === "") return true;
  const match = /^\[(\w+)\]\s*=\s*'([^']+)'$/.exec(branching);

  return match !== null && (values[match[1] ?? ""] ?? "").trim() === match[2];
}

function numericBound(bound: string, values: RedcapValues): number | undefined {
  if (bound === "") return undefined;
  const reference = /^\[(\w+)\]$/.exec(bound);
  let value = bound;
  if (reference !== null) value = values[reference[1] ?? ""] ?? "";
  if (!decimal.test(value)) return undefined;

  return Number(value);
}

function valueError(field: SurgicalField, value: string, values: RedcapValues): string | undefined {
  if (field.choices.length > 0 && !field.choices.some((choice) => choice.code === value)) {
    return `${field.label} má neplatný kód.`;
  }
  if (field.validation.startsWith("number") || field.validation === "integer") {
    const number = Number(value);
    const min = numericBound(field.min, values);
    const max = numericBound(field.max, values);
    if (
      !decimal.test(value) ||
      !Number.isFinite(number) ||
      (field.validation === "integer" && (!/^\d+$/.test(value) || !Number.isSafeInteger(number)))
    ) {
      return `${field.label} vyžaduje číslo v desítkovém zápisu${field.validation === "integer" ? " bez desetinné části" : ""}.`;
    }
    if ((min !== undefined && number < min) || (max !== undefined && number > max)) {
      return `${field.label} je mimo povolený rozsah ${field.min}–${field.max}.`;
    }
  }
  if (field.validation.startsWith("date_")) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString().slice(0, 10) !== value
    ) {
      return `${field.label} vyžaduje platné datum YYYY-MM-DD.`;
    }
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague" }).format(new Date());
    if (value < field.min || value > today) {
      return `Datum operace musí být mezi ${field.min} a dneškem.`;
    }
  }

  return undefined;
}

function serializeFields(
  values: RedcapValues,
  form: string,
  surgery: RedcapValues,
): {
  row: RedcapValues;
  issues: FieldIssue[];
} {
  const row: RedcapValues = {};
  const issues: FieldIssue[] = [];
  const fields = redcapSurgicalFields.filter((field) => field.form === form);
  const allowed = new Set(
    fields.flatMap((field) =>
      field.type === "checkbox"
        ? field.choices.map((choice) => `${field.name}___${choice.code}`)
        : [field.name],
    ),
  );
  for (const name of Object.keys(values)) {
    if (!allowed.has(name))
      issues.push({ field: name, code: "unknown_field", message: `Neznámé pole ${name}.` });
  }
  for (const field of fields) {
    const value = values[field.name] ?? "";
    if (!isRedcapFieldVisible(field.branching, surgery)) {
      if (value !== "")
        issues.push({
          field: field.name,
          code: "branching",
          message: `${field.label}: vyplněná hodnota neodpovídá podmínce ${field.branching}; opravte nebo vymažte ji.`,
        });
      continue;
    }
    if (field.type === "checkbox") {
      for (const choice of field.choices) {
        const name = `${field.name}___${choice.code}`;
        const checked = values[name] ?? "";
        if (checked === "") continue;
        if (checked !== "0" && checked !== "1")
          issues.push({ field: field.name, code: "invalid_value", message: `${name} musí být 0 nebo 1.` });
        row[name] = checked;
      }
      continue;
    }
    if (value === "") {
      if (field.required)
        issues.push({ field: field.name, code: "required", message: `Chybí ${field.label}.` });
      continue;
    }
    const error = valueError(field, value, values);
    if (error !== undefined) issues.push({ field: field.name, code: "invalid_value", message: error });
    row[field.name] = value;
  }

  return { row, issues };
}

function validateLesion(values: RedcapValues): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (values["all_sgm___1"] === "1") {
    for (const code of redcapAllSegmentRegions) {
      if (values[`sur_prostate_regions___${code}`] === "0") {
        issues.push({
          field: "sur_prostate_regions",
          code: "semantic",
          message: `Všechny segmenty jsou označeny jako postižené, ale ${code} je výslovně negativní.`,
        });
      }
    }
  }
  let total = 0;
  for (const part of ["prim", "sec", "tert"]) {
    const percent = values[`gleason_${part}_perc`] ?? "";
    if (percent === "") continue;
    if ((values[`gleason_${part}_grade`] ?? "") === "") {
      issues.push({
        field: `gleason_${part}_perc`,
        code: "semantic",
        message: `Gleason ${part}: procento vyžaduje odpovídající stupeň.`,
      });
    }
    total += Number(percent);
  }
  if (total > 100 + 1e-9)
    issues.push({
      field: "gleason_prim_perc",
      code: "semantic",
      message: "Součet Gleason procent nesmí překročit 100 %.",
    });

  return issues;
}

export function prepareRedcapUpload(input: RedcapUploadInput): RedcapUploadResult {
  const issues: RedcapValidationIssue[] = [];
  const add = (issue: RedcapValidationIssue) => issues.push(issue);
  const id = input.recordId.trim();
  if (!validRecordId(id)) {
    add({
      scope: "record",
      field: "record_id",
      code: "required",
      message: "Vyplňte platné REDCap record_id.",
    });
  }
  const surgery = normalize(input.surgery ?? {});
  // Lesion-only uploads need a record identity, not a completed parent form.
  let base: { row: RedcapValues; issues: FieldIssue[] } = { row: {}, issues: [] };
  if (input.surgery !== undefined) base = serializeFields(surgery, "surgery_c61", surgery);
  issues.push(
    ...base.issues.map((issue) => ({
      ...issue,
      scope: "surgery" as const,
      message: `Operace: ${issue.message}`,
    })),
  );
  const rows: RedcapValues[] = [
    {
      record_id: id,
      redcap_repeat_instrument: "",
      redcap_repeat_instance: "",
      ...base.row,
    },
  ];
  const instances = new Set<string>();
  for (const lesion of input.lesions) {
    const instance = lesion.instance.trim();
    const scope = `Ložisko (instance ${instance})`;
    if (!/^[1-9]\d*$/.test(instance) || !Number.isSafeInteger(Number(instance))) {
      add({
        scope: "lesion",
        instance,
        code: "instance",
        message: `${scope}: zadejte kladné celé číslo ověřené cílové instance.`,
      });
    }
    if (instances.has(instance))
      add({ scope: "lesion", instance, code: "instance", message: `${scope}: duplicitní cílová instance.` });
    instances.add(instance);
    const values = normalize(lesion.values);
    const result = serializeFields(values, "surgery_c61_resected_lesion", surgery);
    issues.push(
      ...[...result.issues, ...validateLesion(values)].map((issue) => ({
        ...issue,
        scope: "lesion" as const,
        instance,
        message: `${scope}: ${issue.message}`,
      })),
    );
    if (values["all_sgm___1"] === "1") {
      // Exact @SETVALUE region set from the live dictionary; urethra is not included.
      for (const code of redcapAllSegmentRegions) result.row[`sur_prostate_regions___${code}`] = "1";
    }
    rows.push({
      record_id: id,
      redcap_repeat_instrument: "surgery_c61_resected_lesion",
      redcap_repeat_instance: instance,
      ...result.row,
    });
  }
  const selectedCount = surgery["total_number_lesion_surg"] ?? "";
  let count = Number(selectedCount);
  if (selectedCount === "7") {
    const other = surgery["total_number_lesion_surg_oth"] ?? "";
    if (other === "")
      add({
        scope: "collection",
        field: "total_number_lesion_surg_oth",
        code: "required",
        message: "Operace: volba Other vyžaduje výslovný počet ložisek.",
      });
    count = Number(other);
  }
  if (selectedCount !== "" && count !== input.lesions.length) {
    add({
      scope: "collection",
      field: "total_number_lesion_surg",
      code: "semantic",
      message: "Počet ložisek musí odpovídat počtu vyplněných ložiskových formulářů.",
    });
  }
  const errors = issues.map((issue) => issue.message);

  return { projectId: 64, rows: issues.length > 0 ? [] : rows, errors, issues };
}
