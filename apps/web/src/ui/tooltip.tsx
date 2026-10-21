import type { ComponentProps, ReactElement } from "react";

import { cx } from "#lib/cx";
import { toneClass } from "#lib/daisy";
import type { Tone } from "#lib/tokens";

export type TooltipPosition = "top" | "bottom" | "left" | "right";

const positionClass: Record<TooltipPosition, string> = {
  top: "tooltip-top",
  bottom: "tooltip-bottom",
  left: "tooltip-left",
  right: "tooltip-right",
};

export interface TooltipProps extends ComponentProps<"span"> {
  tip: string;
  position?: TooltipPosition | undefined;
  tone?: Tone | undefined;
  /** Force the tooltip visible (otherwise it shows on hover and keyboard focus). */
  open?: boolean | undefined;
}

export function Tooltip({
  tip,
  position = "top",
  tone,
  open = false,
  className,
  children,
  ...rest
}: TooltipProps) {
  return (
    <span
      className={cx(
        "tooltip inline-flex w-fit max-w-full",
        positionClass[position],
        toneClass("tooltip", tone),
        open && "tooltip-open",
        className,
      )}
      data-tip={tip}
      {...rest}
    >
      {children}
    </span>
  );
}

/** Props shared by components that can carry a hover tooltip. */
export interface TooltipHostProps {
  tooltip?: string | undefined;
  tooltipPosition?: TooltipPosition | undefined;
}

interface OptionalTooltipProps extends TooltipHostProps {
  children: ReactElement;
}

/** Wraps `children` in a Tooltip when `tooltip` is set; otherwise renders them unchanged. */
export function OptionalTooltip({ tooltip, tooltipPosition, children }: OptionalTooltipProps) {
  if (tooltip === undefined || tooltip === "") {
    return children;
  }

  return (
    <Tooltip tip={tooltip} position={tooltipPosition}>
      {children}
    </Tooltip>
  );
}
