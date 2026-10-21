const UNITS = ["B", "kB", "MB", "GB"] as const;

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (Math.round(value) >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = value < 10 && unit > 0 ? 1 : 0;

  return `${value.toLocaleString("cs-CZ", { maximumFractionDigits: digits })} ${UNITS[unit]}`;
}

const PLURAL = new Intl.PluralRules("cs-CZ");

export interface PluralForms {
  one: string;
  few: string;
  other: string;
}

export function countLabel(count: number, forms: PluralForms): string {
  const rule = PLURAL.select(count);

  return `${count} ${rule === "one" || rule === "few" ? forms[rule] : forms.other}`;
}
