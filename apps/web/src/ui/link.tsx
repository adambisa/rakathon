import type { ComponentProps } from "react";

import { buttonClass, type ButtonStyleProps } from "#lib/button-class";
import { cx } from "#lib/cx";
import { toneClass } from "#lib/daisy";
import type { Tone } from "#lib/tokens";
import { OptionalTooltip, type TooltipHostProps } from "#ui/tooltip";

export interface AnchorProps extends ComponentProps<"a"> {
  tone?: Tone | undefined;
}

export function Anchor({ tone, className, children, ...rest }: AnchorProps) {
  return (
    <a className={cx("link rounded-field", toneClass("link", tone), className)} {...rest}>
      {children}
    </a>
  );
}

export interface ButtonAnchorProps extends ComponentProps<"a">, ButtonStyleProps, TooltipHostProps {}

export function ButtonAnchor({
  size,
  tone,
  variant,
  shape,
  active,
  tooltip,
  tooltipPosition,
  className,
  children,
  ...rest
}: ButtonAnchorProps) {
  const anchor = (
    <a className={buttonClass({ size, tone, variant, shape, active }, className)} {...rest}>
      {children}
    </a>
  );

  return (
    <OptionalTooltip tooltip={tooltip} tooltipPosition={tooltipPosition}>
      {anchor}
    </OptionalTooltip>
  );
}
