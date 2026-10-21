import type { ComponentProps } from "react";

import type { CaseStatus, DocumentKind, DocumentStatus } from "@prostapaper/contracts";

import { cx } from "#lib/cx";
import { sizeClass, toneClass } from "#lib/daisy";
import type { Size, Tone, Variant } from "#lib/tokens";
import { Icon, type IconName } from "#ui/icon";
import { OptionalTooltip, type TooltipHostProps } from "#ui/tooltip";

export type BadgeVariant = Exclude<Variant, "ghost"> | "soft";

const variantClass: Record<BadgeVariant, string> = {
  solid: "",
  outline: "badge-outline",
  soft: "badge-soft",
};

const iconSize: Record<Size, Size> = {
  xs: "xs",
  sm: "xs",
  md: "xs",
  lg: "sm",
  xl: "md",
};

// Spinner sits at text height, not badge height.
const spinnerClass: Record<Size, string> = {
  xs: "w-2.5",
  sm: "w-3",
  md: "w-3.5",
  lg: "loading-xs",
  xl: "loading-sm",
};

export interface BadgeProps extends ComponentProps<"span">, TooltipHostProps {
  size?: Size | undefined;
  tone?: Tone | undefined;
  variant?: BadgeVariant | undefined;
  /** Decorative leading icon; the badge text carries the meaning. */
  icon?: IconName | undefined;
  /** Shows a spinner in place of the icon, e.g. for in-progress workflow statuses. */
  loading?: boolean | undefined;
}

export function Badge({
  size = "md",
  tone,
  variant = "solid",
  icon,
  loading = false,
  tooltip,
  tooltipPosition,
  className,
  children,
  ...rest
}: BadgeProps) {
  const badge = (
    <span
      className={cx(
        "badge cursor-default select-none",
        sizeClass("badge", size),
        toneClass("badge", tone),
        variantClass[variant],
        className,
      )}
      aria-busy={loading}
      {...rest}
    >
      {loading && (
        <span aria-hidden="true" className={cx("loading-spinner-thin loading", spinnerClass[size])} />
      )}
      {!loading && icon !== undefined && <Icon name={icon} size={iconSize[size]} />}
      {children}
    </span>
  );

  return (
    <OptionalTooltip tooltip={tooltip} tooltipPosition={tooltipPosition}>
      {badge}
    </OptionalTooltip>
  );
}

interface ConfidenceLevel {
  tone?: Tone;
  tip: string;
}

// Checked top to bottom; the first level whose `min` the value reaches wins.
const CONFIDENCE_LEVELS: Record<"high" | "medium" | "low", ConfidenceLevel & { min: number }> = {
  high: { min: 0.9, tone: "success", tip: "Vysoká jistota – stačí přijmout" },
  medium: { min: 0.7, tone: "warning", tip: "Střední jistota – zkontrolujte" },
  low: { min: 0, tone: "error", tip: "Nízká jistota – ověřte v textu" },
};
const NOT_STATED: ConfidenceLevel = { tip: "Ve zprávě neuvedeno" };

function confidenceLevel(value: number | null): ConfidenceLevel {
  if (value === null) {
    return NOT_STATED;
  }

  return Object.values(CONFIDENCE_LEVELS).find((level) => value >= level.min) ?? CONFIDENCE_LEVELS.low;
}

export interface ConfidenceBadgeProps extends Omit<BadgeProps, "tone" | "children"> {
  value: number | null;
}

export function ConfidenceBadge({ value, tooltip, className, ...rest }: ConfidenceBadgeProps) {
  const level = confidenceLevel(value);
  let label = "—";
  let accessibleLabel = "Jistota: neuvedeno";
  if (value !== null) {
    label = value.toFixed(2);
    accessibleLabel = `Jistota ${label}`;
  }

  return (
    <Badge
      tone={level.tone}
      tooltip={tooltip ?? level.tip}
      aria-label={accessibleLabel}
      className={cx("font-mono tabular-nums", className)}
      {...rest}
    >
      {label}
    </Badge>
  );
}

interface StatusPresentation {
  label: string;
  tip: string;
  tone?: Tone;
  variant?: BadgeVariant;
  icon?: IconName;
  loading?: boolean;
}

const DOCUMENT_STATUSES: Record<DocumentStatus, StatusPresentation> = {
  awaiting_upload: {
    label: "čeká na soubor",
    tip: "Soubor se ještě nenahrál",
    icon: "fileClock",
    variant: "outline",
  },
  uploaded: { label: "nahráno", tip: "Soubor je uložen", icon: "check" },
  extracting: { label: "extrakce", tip: "Extrakce textu běží", tone: "info", loading: true },
  extracted: { label: "extrahováno", tip: "Text načten", tone: "success", icon: "doubleCheck" },
};
const CASE_STATUSES: Record<CaseStatus, StatusPresentation> = {
  draft: { label: "koncept", tip: "Dokumenty lze přidávat", icon: "pencil", variant: "outline" },
  queued: { label: "ve frontě", tip: "Dokumenty jsou uzamčeny", icon: "clock" },
  mapping: { label: "mapování", tip: "Mapování do struktury běží", tone: "info", loading: true },
  ready_for_review: {
    label: "k revizi",
    tip: "Připraveno k revizi",
    tone: "warning",
    icon: "clipboardList",
  },
  in_review: { label: "revize", tip: "Revize probíhá", tone: "warning", icon: "review" },
  approved: { label: "schváleno", tip: "Obsah případu je uzamčen", tone: "success", icon: "check" },
  exporting: { label: "export", tip: "Export probíhá", tone: "info", loading: true },
  exported: { label: "exportováno", tip: "Export dokončen", tone: "success", icon: "download" },
};
const DOCUMENT_KINDS: Record<DocumentKind, StatusPresentation> = {
  text_description: { label: "textový popis", tip: "Naskenovaný textový popis nálezu", icon: "scrollText" },
  sector_map: { label: "sektorová mapa", tip: "Ručně značená sektorová mapa prostaty", icon: "map" },
};
type StatusBadgeBaseProps = Omit<BadgeProps, "tone" | "variant" | "icon" | "loading" | "children">;

interface StatusBadgeProps extends StatusBadgeBaseProps {
  presentation: StatusPresentation;
}
function StatusBadge({ presentation, tooltip, className, ...rest }: StatusBadgeProps) {
  return (
    <Badge
      tone={presentation.tone}
      variant={presentation.variant ?? "soft"}
      icon={presentation.icon}
      loading={presentation.loading}
      tooltip={tooltip ?? presentation.tip}
      className={cx("status-badge", className)}
      {...rest}
    >
      {presentation.label}
    </Badge>
  );
}

export interface DocumentStatusBadgeProps extends StatusBadgeBaseProps {
  status: DocumentStatus;
}
export function DocumentStatusBadge({ status, ...rest }: DocumentStatusBadgeProps) {
  return <StatusBadge presentation={DOCUMENT_STATUSES[status]} {...rest} />;
}

export interface CaseStatusBadgeProps extends StatusBadgeBaseProps {
  status: CaseStatus;
}
export function CaseStatusBadge({ status, ...rest }: CaseStatusBadgeProps) {
  return <StatusBadge presentation={CASE_STATUSES[status]} {...rest} />;
}

export interface DocumentKindBadgeProps extends StatusBadgeBaseProps {
  kind: DocumentKind;
}
export function DocumentKindBadge({ kind, ...rest }: DocumentKindBadgeProps) {
  return <StatusBadge presentation={DOCUMENT_KINDS[kind]} {...rest} />;
}
