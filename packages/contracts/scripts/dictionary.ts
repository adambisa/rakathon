import { z } from "zod";

const Metadata = z.array(
  z.object({
    field_name: z.string(),
    form_name: z.string(),
    field_type: z.string(),
    field_label: z.string(),
    select_choices_or_calculations: z.string(),
    text_validation_type_or_show_slider_number: z.string(),
    text_validation_min: z.string(),
    text_validation_max: z.string(),
    required_field: z.string(),
    branching_logic: z.string(),
    field_annotation: z.string(),
  }),
);

interface DictionaryField {
  name: string;
  form: string;
  type: string;
  label: string;
  choices: { code: string; label: string }[];
  validation: string;
  min: string;
  max: string;
  required: boolean;
  branching: string;
}

export function buildSurgicalDictionary(raw: unknown): { fields: DictionaryField[]; regions: string[] } {
  const metadata = Metadata.parse(raw);
  const fields = metadata
    .filter((field) => !["descriptive", "sql", "calc"].includes(field.field_type))
    .map((field) => {
      const choices = [];
      if (
        ["radio", "dropdown", "checkbox"].includes(field.field_type) &&
        field.select_choices_or_calculations !== ""
      ) {
        for (const choice of field.select_choices_or_calculations.split("|")) {
          const comma = choice.indexOf(",");
          if (comma === -1) throw new Error(`Invalid choices for ${field.field_name}`);
          choices.push({ code: choice.slice(0, comma).trim(), label: choice.slice(comma + 1).trim() });
        }
      }

      return {
        name: field.field_name,
        form: field.form_name,
        type: field.field_type,
        label: field.field_label,
        choices,
        validation: field.text_validation_type_or_show_slider_number,
        min: field.text_validation_min,
        max: field.text_validation_max,
        required: field.required_field === "y",
        branching: field.branching_logic,
      };
    });
  const annotation =
    metadata.find((field) => field.field_name === "sur_prostate_regions")?.field_annotation ?? "";
  const match = /@SETVALUE\s*=\s*(['"])(.*?)\1/s.exec(annotation);
  if (match?.[2] === undefined) throw new Error("sur_prostate_regions has no @SETVALUE annotation");
  const regions = match[2]
    .split(",")
    .map((region) => region.trim())
    .filter((region) => region !== "");

  const allowedRegions = new Set(
    fields.find((field) => field.name === "sur_prostate_regions")?.choices.map((choice) => choice.code),
  );
  if (
    regions.length === 0 ||
    new Set(regions).size !== regions.length ||
    regions.some((region) => !allowedRegions.has(region))
  ) {
    throw new Error("Invalid all-segment region annotation");
  }

  return { fields, regions };
}
