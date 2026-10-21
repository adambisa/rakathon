import type { ComponentProps } from "react";

import { cx } from "#lib/cx";
import { type IconName, icons } from "#lib/icons";
import type { Size } from "#lib/tokens";

export type { IconName } from "#lib/icons";

const sizeClass: Record<Size, string> = {
  xs: "size-4",
  sm: "size-5",
  md: "size-6",
  lg: "size-8",
  xl: "size-12",
};

export interface IconProps extends Omit<ComponentProps<"svg">, "name"> {
  name: IconName;
  size?: Size | undefined;
  label?: string | undefined;
}

export function Icon({ name, size = "md", label, className, ...rest }: IconProps) {
  const Glyph = icons[name];
  const classes = cx("inline-block shrink-0", sizeClass[size], className);
  if (label === undefined) {
    return <Glyph aria-hidden className={classes} {...rest} />;
  }

  return <Glyph role="img" aria-label={label} className={classes} {...rest} />;
}
