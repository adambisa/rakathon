import type { ComponentProps } from "react";

import { buttonClass, type ButtonStyleProps, spinnerClass } from "#lib/button-class";
import { cx } from "#lib/cx";
import { OptionalTooltip, type TooltipHostProps } from "#ui/tooltip";

export interface ButtonProps extends ComponentProps<"button">, ButtonStyleProps, TooltipHostProps {
  loading?: boolean | undefined;
}

export function Button({
  size,
  tone,
  variant,
  shape,
  active,
  loading = false,
  disabled = false,
  type = "button",
  tooltip,
  tooltipPosition,
  className,
  children,
  ...rest
}: ButtonProps) {
  const button = (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading}
      className={buttonClass({ size, tone, variant, shape, active }, className)}
      {...rest}
    >
      {loading && <span className={cx("loading loading-spinner", spinnerClass[size ?? "md"])} />}
      {children}
    </button>
  );

  return (
    <OptionalTooltip tooltip={tooltip} tooltipPosition={tooltipPosition}>
      {button}
    </OptionalTooltip>
  );
}
