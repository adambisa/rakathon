import type { ComponentProps } from "react";

import { cx } from "#lib/cx";

export function MouLogo({ className, ...rest }: ComponentProps<"img">) {
  return (
    <img
      src="/mou-logo.svg"
      alt="Masarykův onkologický ústav"
      width={121}
      height={70}
      className={cx("w-auto select-none", className)}
      {...rest}
    />
  );
}
