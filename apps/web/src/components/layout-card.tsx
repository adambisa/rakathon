import type { ReactNode } from "react";

import { cx } from "#lib/cx";
import type { Size } from "#lib/tokens";
import { Card, type CardProps } from "#ui";

const sizeClasses: Record<Size, { figure: string; heading: string }> = {
  xs: { figure: "w-16", heading: "text-xs" },
  sm: { figure: "w-24", heading: "text-sm" },
  md: { figure: "w-32", heading: "text-base" },
  lg: { figure: "w-40", heading: "text-lg" },
  xl: { figure: "w-48", heading: "text-xl" },
};

export interface LayoutCardProps extends Omit<CardProps, "side" | "figure" | "heading" | "headingLevel"> {
  name: string;
  extension: string;
  thumbnail?: ReactNode;
  size?: Size | undefined;
}

export function LayoutCard({ name, extension, thumbnail, size = "sm", children, ...rest }: LayoutCardProps) {
  return (
    <Card
      side
      size={size}
      variant="border"
      headingLevel={3}
      heading={<span className={cx("line-clamp-2 break-all", sizeClasses[size].heading)}>{name}</span>}
      figure={
        <div className={cx("relative shrink-0 self-stretch bg-base-200", sizeClasses[size].figure)}>
          <span className="absolute inset-0 flex items-center justify-center font-mono text-xs font-semibold tracking-wider opacity-60">
            {extension}
          </span>
          {thumbnail}
        </div>
      }
      {...rest}
    >
      {children}
    </Card>
  );
}
