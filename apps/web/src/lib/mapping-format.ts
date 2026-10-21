import { SECTORS } from "#ui/sector-diagram/geometry.ts";

const regionNames = new Map<string, string>(SECTORS.map((sector) => [sector.code, sector.name]));

export function formatRegion(code: string): string {
  return regionNames.get(code) ?? code;
}

export function formatMarkLabel(index: number): string {
  return index < 0 ? "Značka schématu" : `Značka ${index + 1}`;
}

export function formatMappingValue(
  value: unknown,
  choices?: readonly { code: string; label: string }[],
): string {
  const choice = (code: string) => {
    const found = choices?.find((candidate) => candidate.code === code);

    return regionNames.get(code) ?? found?.label ?? code;
  };
  if (value === null || value === undefined) return "Neuvedeno v dokumentech";
  if (Array.isArray(value)) {
    if (value.length === 0) return "Neuvedeno v dokumentech";

    return value.map((item) => choice(String(item))).join(", ");
  }
  if (typeof value === "boolean") {
    if (value) return "Ano";

    return "Neoznačeno (výchozí stav)";
  }
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return choice(value);

  return JSON.stringify(value);
}

export function mappingFieldRowId(fieldName: string, lesionIndex?: number): string {
  if (fieldName === "lesions.length") return "mapping-field-lesions.length";
  let scope = "surgery";
  if (lesionIndex !== undefined) scope = `lesion-${lesionIndex + 1}`;

  return `mapping-field-${scope}-${fieldName}`;
}
