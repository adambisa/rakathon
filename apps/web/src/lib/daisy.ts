import type { Size, Tone } from "#lib/tokens";

export type SizedPrefix = "btn" | "badge" | "input" | "card" | "loading";
export type TonedPrefix = "btn" | "badge" | "input" | "link" | "tooltip";

export type SizeClass<P extends SizedPrefix> = `${P}-${Size}`;
export type ToneClass<P extends TonedPrefix> = `${P}-${Tone}`;

export function sizeClass<P extends SizedPrefix>(prefix: P, size: Size): SizeClass<P> {
  return `${prefix}-${size}`;
}

export function toneClass<P extends TonedPrefix>(
  prefix: P,
  tone: Tone | undefined,
): ToneClass<P> | undefined {
  if (tone === undefined) {
    return undefined;
  }

  return `${prefix}-${tone}`;
}
