import { type RegionCode, regionFromSectorId, SectorId } from "@prostapaper/contracts";

import { SHEET } from "#ui/sector-diagram/sheet.gen.ts";

export const WIDTH = SHEET.width;
export const HEIGHT = SHEET.height;
export const CX = SHEET.midline;

export type ZoneKind = "pz" | "tz" | "cz" | "afs" | "sv" | "urethra";
type SectionKey = keyof typeof SHEET.sections;

export interface SectorShape {
  code: RegionCode;
  name: string;
  d: string;
  label: readonly [x: number, y: number];
  /** Distance from the label point to the sector's edge, in viewBox units; slivers get a smaller label. */
  room: number;
  zone: string | null;
  kind: ZoneKind;
}

export interface Section {
  key: SectionKey;
  title: string;
  outline: string;
  top: number;
}

const TITLES: Record<SectionKey, string> = { base: "Báze", mid: "Střed", apex: "Apex" };
/** Patient-right sits on the image's left, as on the printed PI-RADS sheet. */
const SIDE_NAMES = { R: "vpravo", L: "vlevo" } as const;
const KINDS: Record<string, ZoneKind> = { AS: "afs", CZ: "cz", TZa: "tz", TZp: "tz", sv: "sv" };

/** Each sheet sector as the figure draws it, traced from the label map the mark reader uses. */
const sector = (id: SectorId): SectorShape => {
  const { d, label, room } = SHEET.sectors[id];
  const [first, zone, side] = id.split("_") as [string, string, keyof typeof SIDE_NAMES | undefined];
  if (first === "sv") {
    const sideName = SIDE_NAMES[zone as keyof typeof SIDE_NAMES];

    return {
      code: regionFromSectorId(id),
      name: `Semenný váček ${sideName}`,
      d,
      label,
      room,
      zone: "SV",
      kind: "sv",
    };
  }
  let shown = zone;
  if (zone === "AS") shown = "AFS";

  return {
    code: regionFromSectorId(id),
    name: `${TITLES[first as SectionKey]} · ${shown} ${SIDE_NAMES[side ?? "R"]}`,
    d,
    label,
    room,
    zone: shown,
    kind: KINDS[zone] ?? "pz",
  };
};

const ring = (r: number) => {
  const [x, y] = SHEET.urethra;

  return `M${x - r} ${y} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
};

export const SECTIONS: readonly Section[] = (Object.keys(SHEET.sections) as SectionKey[]).map((key) => ({
  key,
  title: TITLES[key],
  outline: SHEET.sections[key].d,
  top: SHEET.sections[key].top[1],
}));

export const SECTORS: readonly SectorShape[] = [
  ...SectorId.options.map(sector),
  {
    code: "urethra",
    name: "Uretra",
    d: `${ring(9)} ${ring(4.5)}`,
    label: SHEET.urethra,
    room: 9,
    zone: null,
    kind: "urethra",
  },
];

export const URETHRA = { y: SHEET.urethra[1], labelX: SHEET.urethra[0] + 16 };
