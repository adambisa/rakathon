type ClassValue = string | false | null | undefined;

export const cx = (...values: ClassValue[]): string => values.filter(Boolean).join(" ");

export function lookup<K extends string>(map: Record<K, string>, key: K | undefined): string | undefined {
  if (key === undefined) {
    return undefined;
  }

  return map[key];
}
