import { type ComponentProps, useId, useState } from "react";

import type { RegionCode, SectorLesion } from "@prostapaper/contracts";

import { cx } from "#lib/cx";
import { type SectorPaint, sectorPaint, type SectorTone } from "#lib/sector-diagram";
import {
  CX,
  HEIGHT,
  SECTIONS,
  SECTORS,
  type SectorShape,
  URETHRA,
  WIDTH,
  type ZoneKind,
} from "#ui/sector-diagram/geometry.ts";

const ZONE_FILL: Record<ZoneKind, string> = {
  pz: "fill-base-100",
  tz: "fill-base-200",
  cz: "fill-base-300",
  afs: "fill-base-300",
  sv: "fill-base-100",
  urethra: "fill-base-300",
};

const TEXT_CLASS: Record<SectorTone, string> = {
  marked: "fill-primary-content font-bold",
  candidate: "fill-base-content/80 font-semibold",
  none: "fill-base-content/60 font-medium",
};

const TONE_STROKE: Record<SectorTone, string> = {
  marked: "stroke-primary-content/70",
  candidate: "stroke-base-content/25",
  none: "stroke-base-content/25",
};

/** Below this much room around the label point a sector is a sliver, and its label shrinks to fit. */
const TIGHT_ROOM = 10;

const CAPTION = "fill-base-content/60 text-[10px] font-medium";
const DOTS_SWATCH =
  "size-3 rounded-sm border border-base-content/25 bg-base-100 bg-[radial-gradient(var(--color-accent)_0.7px,transparent_0.9px)] bg-size-[3.5px_3.5px]";

export interface SectorDiagramProps extends ComponentProps<"div"> {
  lesions: readonly SectorLesion[];
  onSelectSector?: ((code: RegionCode) => void) | undefined;
}

/** The PI-RADS sector sheet with every marked sector filled orange; the focus count belongs to the report. */
export function SectorDiagram({ lesions, onSelectSector, className, ...rest }: SectorDiagramProps) {
  const id = useId();
  const [hovered, setHovered] = useState<SectorShape | null>(null);
  let hint = "Najeďte na sektor pro podrobnosti";
  if (lesions.every((lesion) => lesion.marked.length === 0)) hint = "Na mapě nejsou vyznačené sektory";

  return (
    <div className={cx("flex min-w-0 flex-col gap-3", className)} {...rest}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="group"
        aria-label="Sektorová mapa prostaty"
        className="w-full max-w-xs self-center text-base-content select-none [.modal-box_&]:h-[70vh] [.modal-box_&]:w-auto [.modal-box_&]:max-w-none"
      >
        <defs>
          <pattern id={`${id}-dots`} width="3.5" height="3.5" patternUnits="userSpaceOnUse">
            <circle cx="1.75" cy="1.75" r="0.7" className="fill-accent" />
          </pattern>
        </defs>
        <text x={CX} y="10" textAnchor="middle" className="fill-base-content/60 text-[9px]">
          Semenné váčky
        </text>
        {SECTIONS.map((section) => (
          <text key={section.key} x="4" y={section.top + 4} className={CAPTION}>
            {section.title}
          </text>
        ))}
        {SECTORS.map((shape) => (
          <Sector
            key={shape.code}
            shape={shape}
            idPrefix={id}
            paint={sectorPaint(lesions, shape.code)}
            onHover={setHovered}
            onSelect={onSelectSector}
          />
        ))}
        {SECTIONS.map((section) => (
          <path
            key={section.key}
            d={section.outline}
            className="pointer-events-none fill-none stroke-base-content/70"
            strokeWidth="1.25"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {hovered !== null && (
          <path
            d={hovered.d}
            fillRule="evenodd"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            className="pointer-events-none fill-none stroke-base-content stroke-2"
          />
        )}
        <text x={URETHRA.labelX} y={URETHRA.y + 3} className="fill-base-content/60 text-[9px]">
          uretra
        </text>
        <text x="4" y={HEIGHT - 4} className={CAPTION}>
          <title>pravá strana pacienta</title>P
        </text>
        <text x={WIDTH - 4} y={HEIGHT - 4} textAnchor="end" className={CAPTION}>
          <title>levá strana pacienta</title>L
        </text>
      </svg>
      <div className="flex w-full max-w-xs flex-col gap-2 self-center">
        <div
          aria-live="polite"
          className="grid min-h-14 place-content-center gap-0.5 rounded-box bg-base-200 px-3 py-2 text-center"
        >
          {hovered === null && <p className="text-sm text-base-content/60">{hint}</p>}
          {hovered !== null && (
            <>
              <p className="text-sm font-medium">{hovered.name}</p>
              <p className="text-xs text-base-content/70">{sectorPaint(lesions, hovered.code).detail}</p>
            </>
          )}
        </div>
        <div className="flex justify-center gap-4 text-xs text-base-content/60">
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm bg-primary" />
            vyznačeno
          </span>
          <span className="flex items-center gap-1.5">
            <span className={DOTS_SWATCH} />
            možná, nezapočteno
          </span>
        </div>
      </div>
    </div>
  );
}

interface SectorProps {
  shape: SectorShape;
  paint: SectorPaint;
  idPrefix: string;
  onHover: (shape: SectorShape | null) => void;
  onSelect: ((code: RegionCode) => void) | undefined;
}

function Sector({ shape, paint, idPrefix, onHover, onSelect }: SectorProps) {
  let text = shape.zone;
  let textSize = "text-[8.5px]";
  if (shape.room < TIGHT_ROOM) textSize = "text-[6.5px]";
  let fillClass = ZONE_FILL[shape.kind];
  if (paint.tone === "marked") fillClass = "fill-primary";
  if (paint.tone === "candidate") text = `${shape.zone ?? ""}?`;
  let tabIndex: number | undefined;
  if (onSelect !== undefined || paint.tone !== "none") tabIndex = 0;
  let role = "graphics-symbol";
  if (onSelect !== undefined) role = "button";
  const select = () => onSelect?.(shape.code);

  return (
    <g>
      <path
        d={shape.d}
        fillRule="evenodd"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        tabIndex={tabIndex}
        role={role}
        aria-label={`${shape.name}: ${paint.detail}`}
        className={cx(
          "cursor-default stroke-[0.75] transition-colors outline-none",
          fillClass,
          TONE_STROKE[paint.tone],
          onSelect !== undefined && "cursor-pointer",
        )}
        onPointerEnter={() => onHover(shape)}
        onPointerLeave={() => onHover(null)}
        onFocus={() => onHover(shape)}
        onBlur={() => onHover(null)}
        onClick={select}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          select();
        }}
      >
        <title>{shape.name}</title>
      </path>
      {paint.tone === "candidate" && (
        <path d={shape.d} fill={`url(#${idPrefix}-dots)`} className="pointer-events-none" />
      )}
      {text !== null && (
        <text
          x={shape.label[0]}
          y={shape.label[1]}
          textAnchor="middle"
          dominantBaseline="middle"
          className={cx("pointer-events-none", textSize, TEXT_CLASS[paint.tone])}
        >
          {text}
        </text>
      )}
    </g>
  );
}
