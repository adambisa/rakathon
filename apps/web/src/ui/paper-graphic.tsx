import type { ComponentProps } from "react";

export interface PaperGraphicProps extends ComponentProps<"svg"> {
  fold: "bottom-left" | "top-right";
  outlineOpacity?: number | undefined;
  surfaceOpacity?: number | undefined;
}

export function PaperGraphic({
  fold,
  className,
  children,
  viewBox,
  outlineOpacity = 0.15,
  surfaceOpacity,
  ...rest
}: PaperGraphicProps) {
  return (
    <svg
      viewBox={viewBox ?? (fold === "bottom-left" ? "0 0 600 760" : "0 0 680 520")}
      fill="none"
      className={className}
      {...rest}
    >
      {fold === "bottom-left" ? (
        <g>
          <path
            d="M118 0h392q24 0 24 24v546q0 32-32 32H186c-48 0-92-44-92-96V24q0-24 24-24Z"
            fill="var(--color-base-100)"
            fillOpacity={surfaceOpacity ?? 0.7}
            stroke="currentColor"
            strokeOpacity={outlineOpacity}
            vectorEffect="non-scaling-stroke"
          />
          <path
            d="M94 506c0 14 14 20 30 20h26q24 0 24 24v20q0 24 12 32c-48 0-92-44-92-96Z"
            fill="var(--paper-fold, var(--color-primary))"
            fillOpacity="0.8"
          />
        </g>
      ) : (
        <g>
          <path
            d="M0 44h440c84 0 148 64 148 148v328H0V44Z"
            fill="var(--color-base-100)"
            fillOpacity={surfaceOpacity ?? 0.6}
          />
          <path
            d="M0 44h440c84 0 148 64 148 148v328"
            stroke="currentColor"
            strokeOpacity={outlineOpacity}
            vectorEffect="non-scaling-stroke"
          />
          <path
            d="M440 44c16 12 20 28 20 48v52q0 28 28 28h52c20 0 36 4 48 20 0-84-64-148-148-148Z"
            fill="currentColor"
            className="text-base-content/[0.025]"
          />
        </g>
      )}
      {children}
    </svg>
  );
}
