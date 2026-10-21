export const SIZES = ["xs", "sm", "md", "lg", "xl"] as const;
export type Size = (typeof SIZES)[number];

export const TONES = ["primary", "secondary", "accent", "info", "success", "warning", "error"] as const;
export type Tone = (typeof TONES)[number];

export const VARIANTS = ["solid", "outline", "ghost"] as const;
export type Variant = (typeof VARIANTS)[number];
