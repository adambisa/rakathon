import type { ComponentProps } from "react";

import { cx } from "#lib/cx";

export interface SkeletonProps extends ComponentProps<"div"> {
  round?: boolean | undefined;
}

export function Skeleton({ round = false, className, ...rest }: SkeletonProps) {
  return <div aria-hidden className={cx("skeleton", round && "rounded-full", className)} {...rest} />;
}
