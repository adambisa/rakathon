import type { ComponentProps, ReactNode } from "react";

import { cx } from "#lib/cx";
import { sizeClass } from "#lib/daisy";
import type { Size } from "#lib/tokens";

export type CardVariant = "shadow" | "border" | "dash" | "plain";

const variantClass: Record<CardVariant, string> = {
  shadow: "shadow-sm",
  border: "card-border",
  dash: "card-dash",
  plain: "",
};

export type CardHeadingLevel = 2 | 3 | 4;

export interface CardProps extends ComponentProps<"section"> {
  heading?: ReactNode;
  headingLevel?: CardHeadingLevel | undefined;
  actions?: ReactNode;
  figure?: ReactNode;
  side?: boolean | undefined;
  size?: Size | undefined;
  variant?: CardVariant | undefined;
}

export function Card({
  heading,
  headingLevel = 2,
  actions,
  figure,
  side = false,
  size = "md",
  variant = "shadow",
  className,
  children,
  ...rest
}: CardProps) {
  const Heading = `h${headingLevel}` as const;

  return (
    <section
      className={cx(
        "card bg-base-100",
        sizeClass("card", size),
        variantClass[variant],
        side && "card-side",
        className,
      )}
      {...rest}
    >
      {figure !== undefined && <figure>{figure}</figure>}
      <div className="card-body">
        {heading !== undefined && <Heading className="card-title">{heading}</Heading>}
        {children}
        {actions !== undefined && <div className="mt-auto card-actions justify-end">{actions}</div>}
      </div>
    </section>
  );
}
