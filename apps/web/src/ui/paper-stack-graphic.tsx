import { cx } from "#lib/cx";
import { PaperGraphic } from "#ui/paper-graphic";

/** What the front sheet of the stack is printed with. */
export type DocumentSheet = "text" | "sectors";

interface PaperStackGraphicProps {
  className?: string | undefined;
  sheet?: DocumentSheet | undefined;
  accept: boolean;
  reject: boolean;
}

export function PaperStackGraphic({ className, sheet = "text", accept, reject }: PaperStackGraphicProps) {
  const sheetClass =
    "absolute inset-0 size-full transition-transform duration-300 ease-out motion-reduce:transition-none";
  const expanded = accept && !reject;
  let tone = "text-base-content/60";
  if (reject) {
    tone = "text-error [--paper-fold:var(--color-error)]";
  } else if (accept) {
    tone = "text-primary";
  }

  return (
    <div aria-hidden="true" className={cx("pointer-events-none relative", tone, className)}>
      <PaperGraphic
        fold="bottom-left"
        viewBox="78 -16 472 638"
        outlineOpacity={0.5}
        surfaceOpacity={1}
        className={cx(
          sheetClass,
          "origin-bottom-left -translate-x-[10%] translate-y-[4%] -rotate-[5deg]",
          "group-hover:-translate-x-[42%] group-hover:translate-y-[10%] group-hover:-rotate-[18deg]",
          expanded && "-translate-x-[42%] translate-y-[10%] -rotate-[18deg]",
        )}
      />
      <PaperGraphic
        fold="bottom-left"
        viewBox="78 -16 472 638"
        outlineOpacity={0.5}
        surfaceOpacity={1}
        className={cx(
          sheetClass,
          "origin-bottom-right translate-x-[14%] -translate-y-[2%] rotate-[8deg] delay-75 duration-500",
          "group-hover:translate-x-[34%] group-hover:-translate-y-[8%] group-hover:rotate-[11deg]",
          expanded && "translate-x-[34%] -translate-y-[8%] rotate-[11deg]",
        )}
      />
      <PaperGraphic
        fold="bottom-left"
        viewBox="78 -16 472 638"
        outlineOpacity={0.5}
        surfaceOpacity={1}
        className={cx(sheetClass, "group-hover:-translate-y-[18%]", expanded && "-translate-y-[18%]")}
      >
        {sheet === "text" ? <TextFace /> : <SectorFace />}
      </PaperGraphic>
    </div>
  );
}

function TextFace() {
  return (
    <g stroke="currentColor" strokeLinecap="round" fill="none">
      <path d="M174 190h164" strokeWidth="26" strokeOpacity="0.5" />
      <path d="M174 262h240m-240 60h180m-180 60h240m-240 60h120" strokeWidth="16" strokeOpacity="0.32" />
    </g>
  );
}

const SECTIONS = [
  { cy: 178, rx: 104, ry: 60 },
  { cy: 318, rx: 94, ry: 54 },
  { cy: 446, rx: 80, ry: 46 },
];

function SectorFace() {
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      {SECTIONS.map(({ cy, rx, ry }) => (
        <g key={cy} stroke="currentColor">
          <ellipse cx="316" cy={cy} rx={rx} ry={ry} strokeOpacity="0.4" strokeWidth="12" />
          <path
            d={`M316 ${cy - ry + 6}v${ry * 2 - 12}M${316 - rx + 6} ${cy + 8}h${rx * 2 - 12}`}
            strokeOpacity="0.3"
            strokeWidth="9"
            strokeDasharray="16 14"
          />
        </g>
      ))}
      <g stroke="var(--paper-fold, var(--color-primary))" strokeOpacity="0.85" strokeWidth="14">
        <path d="M236 196c-10 14-2 30 14 30s26-14 18-28c-6-12-24-14-32-2Z" />
        <path d="M356 334c-8 16 4 30 20 28s24-18 14-32c-8-12-26-10-34 4Z" />
      </g>
    </g>
  );
}
