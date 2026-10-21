import type { ComponentProps } from "react";

import { cx } from "#lib/cx";

export interface JoinProps extends ComponentProps<"div"> {
  vertical?: boolean | undefined;
}

export function Join({ vertical = false, className, children, ...rest }: JoinProps) {
  return (
    <div
      className={cx(
        "join rounded-field focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-base-content",
        "[&>*:focus]:outline-none [&>*:focus-visible]:outline-none",
        "[&>.btn]:relative [&>.btn]:z-1",
        vertical && "join-vertical",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
