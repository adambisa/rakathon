import { cx, lookup } from "#lib/cx";
import { type SizeClass, sizeClass, toneClass } from "#lib/daisy";
import type { Size, Tone, Variant } from "#lib/tokens";

export type ButtonShape = "square" | "circle" | "wide" | "block";

export interface ButtonStyleProps {
  size?: Size | undefined;
  tone?: Tone | undefined;
  variant?: Variant | undefined;
  shape?: ButtonShape | undefined;
  active?: boolean | undefined;
}

const variantClass: Record<Variant, string> = {
  solid: "",
  outline: "btn-outline",
  ghost: "btn-ghost",
};

const shapeClass: Record<ButtonShape, string> = {
  square: "btn-square",
  circle: "btn-circle",
  wide: "btn-wide",
  block: "btn-block",
};

export const spinnerClass: Record<Size, SizeClass<"loading">> = {
  xs: "loading-xs",
  sm: "loading-xs",
  md: "loading-sm",
  lg: "loading-md",
  xl: "loading-lg",
};

export function buttonClass(style: ButtonStyleProps, className?: string): string {
  const { size = "md", tone = "secondary", variant = "solid", shape, active = false } = style;

  return cx(
    "btn disabled:pointer-events-auto disabled:cursor-not-allowed",
    sizeClass("btn", size),
    toneClass("btn", tone),
    variantClass[variant],
    lookup(shapeClass, shape),
    active && "btn-active",
    className,
  );
}
