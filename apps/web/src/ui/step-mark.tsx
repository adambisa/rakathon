import type { ReactNode } from "react";

import { cx } from "#lib/cx";

export interface StepMarkProps {
  children: ReactNode;
  className?: string | undefined;
}

export function StepMark({ children, className }: StepMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-base-200",
        "font-mono text-xs font-medium opacity-70",
        className,
      )}
    >
      {children}
    </span>
  );
}
