import type { RedcapUploadInput, RedcapValues } from "#redcap";
import { RegionCode } from "#region";
import type { SurgeryRecord } from "#surgery";

function scalars(values: Readonly<Record<string, string | number | null>>): RedcapValues {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      if (value === null) return [key, ""];

      return [key, String(value)];
    }),
  );
}

export function toRedcapRows(record: SurgeryRecord, recordId: string): RedcapUploadInput {
  return {
    recordId,
    lesions: record.lesions.map(({ sur_prostate_regions, all_sgm, ...values }, index) => ({
      instance: String(index + 1),
      values: {
        ...scalars(values),
        all_sgm___1: all_sgm ? "1" : "0",
        ...Object.fromEntries(
          RegionCode.options.map((code) => [
            `sur_prostate_regions___${code}`,
            sur_prostate_regions.includes(code) ? "1" : "0",
          ]),
        ),
      },
    })),
  };
}
