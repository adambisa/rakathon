import type { ComponentProps } from "react";

import { cx } from "#lib/cx";

const SHEET =
  "M0 0 L18 0 C24.26 0 30 5.5 30 12 L30 15 A11 11 0 0 1 19 26 L9 26 L9 40 L0 40 Z " +
  "M9 9 L19 9 A2 2 0 0 1 21 11 L21 15 A2 2 0 0 1 19 17 L9 17 Z";

const FOLD =
  "M30 12 C30 10.25 28.18 9.5 26.09 9.5 L22.69 9.5 Q19.56 9.5 19.56 6.5 L19.56 4 Q19.56 1 18 0 C24.26 0 30 5.5 30 12 Z";

// Set to the host font's capital P: cap height 0.705em, sidebearings 0.055/0.027em. Chrome gives an
// inline SVG its own baseline, 0.088em below the text one, so translate (not layout) pulls it back.
const GLYPH = "inline-block h-[0.705em] w-auto shrink-0 -translate-y-[0.088em] pl-[0.055em] pr-[0.027em]";
const ON_PRIMARY = "text-primary [--logo-fold:color-mix(in_oklab,var(--color-primary)_55%,#000)]";

export function LogoMark({ className, ...rest }: ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 30 40" aria-hidden className={cx("w-auto shrink-0", className)} {...rest}>
      <path d={SHEET} fill="currentColor" fillRule="evenodd" />
      <path d={FOLD} fill="var(--logo-fold, var(--color-primary))" />
    </svg>
  );
}

export interface LogoProps extends ComponentProps<"span"> {
  tailClassName?: string | undefined;
}

export function Logo({ tailClassName, className, ...rest }: LogoProps) {
  return (
    <span
      role="img"
      aria-label="ProstaPaper"
      className={cx("font-extrabold tracking-tight select-none", className)}
      {...rest}
    >
      <LogoMark className={cx(GLYPH, ON_PRIMARY)} />
      <span className={cx(ON_PRIMARY, "mr-[0.16em]", tailClassName)}>rosta</span>
      <LogoMark className={GLYPH} />
      <span className={tailClassName}>aper</span>
    </span>
  );
}
