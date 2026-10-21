import { type ReactNode, useId } from "react";
import {
  type Accept,
  type DropzoneOptions,
  ErrorCode,
  type FileError,
  type FileRejection,
  useDropzone,
} from "react-dropzone";

import { cx } from "#lib/cx";
import { sizeClass } from "#lib/daisy";
import { fileKey } from "#lib/file-key";
import { formatBytes } from "#lib/format";
import type { Size } from "#lib/tokens";
import { Button } from "#ui/button";
import { type DocumentSheet, PaperStackGraphic } from "#ui/paper-stack-graphic";
import { StepMark } from "#ui/step-mark";

export type { Accept, FileRejection } from "react-dropzone";

const sizeClasses: Record<Size, { zone: string; stack: string; title: string; button: Size }> = {
  xs: { zone: "gap-1.5 p-3", stack: "h-8 w-7", title: "text-xs font-medium", button: "xs" },
  sm: { zone: "gap-2 p-4", stack: "h-10 w-9", title: "text-sm font-medium", button: "xs" },
  md: { zone: "gap-3 p-8", stack: "h-15 w-13", title: "text-base font-medium", button: "sm" },
  lg: { zone: "gap-4 p-12", stack: "h-20 w-18", title: "text-lg font-semibold", button: "md" },
  xl: { zone: "gap-5 p-16", stack: "h-25 w-22", title: "text-xl font-semibold", button: "lg" },
};

const COPY = {
  one: { title: "Přetáhněte soubor sem", button: "Vybrat soubor" },
  many: { title: "Přetáhněte soubory sem", button: "Vybrat soubory" },
  folder: { title: "Přetáhněte složku nebo soubory", button: "Vybrat složku" },
};

const DIRECTORY_INPUT = { multiple: true, webkitdirectory: "" };

export interface DropzoneProps {
  onFiles: (accepted: File[], rejected: FileRejection[]) => void;
  accept?: Accept | undefined;
  maxSize?: number | undefined;
  minSize?: number | undefined;
  maxFiles?: number | undefined;
  multiple?: boolean | undefined;
  disabled?: boolean | undefined;
  loading?: boolean | undefined;
  size?: Size | undefined;
  title?: string | undefined;
  hint?: ReactNode;
  /** What the front sheet of the paper stack is printed with. */
  sheet?: DocumentSheet | undefined;
  /** Sits after the title, e.g. to mark the zone required or optional. */
  badge?: ReactNode;
  /** Ordinal shown before the title when the zone is one of several. */
  step?: number | undefined;
  buttonLabel?: string | undefined;
  /** The picker takes a whole folder instead of files; dropping works either way. */
  folders?: boolean | undefined;
  className?: string | undefined;
  /** Replaces the zone's graphics, keeping it a drop target; `open` lets your own control pick files. */
  children?: ((open: () => void) => ReactNode) | undefined;
}

export function Dropzone({
  onFiles,
  accept,
  maxSize,
  minSize,
  maxFiles = 0,
  multiple = true,
  disabled = false,
  loading = false,
  size = "md",
  title,
  hint,
  sheet,
  badge,
  step,
  buttonLabel,
  folders = false,
  className,
  children,
}: DropzoneProps) {
  const hintId = useId();
  const inactive = disabled || loading;
  let fileLimit = 1;
  if (multiple) {
    fileLimit = maxFiles;
  }
  const limits: Limits = { maxSize, maxFiles: fileLimit };
  const options: DropzoneOptions = {
    onDrop: onFiles,
    maxFiles: limits.maxFiles,
    multiple,
    disabled: inactive,
    noClick: true,
    noKeyboard: true,
    getErrorMessage: (error) => describeError(error, limits),
  };
  if (accept !== undefined) {
    options.accept = accept;
  }
  if (maxSize !== undefined) {
    options.maxSize = maxSize;
  }
  if (minSize !== undefined) {
    options.minSize = minSize;
  }
  const { getRootProps, getInputProps, isDragAccept, isDragReject, fileRejections, open } =
    useDropzone(options);

  let input = <input {...getInputProps()} />;
  if (folders) input = <input {...getInputProps(DIRECTORY_INPUT)} />;
  const dragClasses = cx(
    isDragAccept && "border-primary bg-primary/5",
    isDragReject && "border-error bg-error/5",
  );

  if (children !== undefined) {
    return (
      <div {...getRootProps({ className: cx("transition-colors", dragClasses, className) })}>
        {input}
        {children(open)}
      </div>
    );
  }

  const classes = sizeClasses[size];
  let copy = COPY[multiple ? "many" : "one"];
  if (folders) copy = COPY.folder;
  const resolvedTitle = title ?? copy.title;
  // A picked folder also lists hidden files like .DS_Store, which nobody meant to upload.
  const rejections = fileRejections.filter(({ file }) => !file.name.startsWith("."));
  const hasRejections = rejections.length > 0;
  const rejected = isDragReject || (hasRejections && !isDragAccept);

  return (
    <div
      {...getRootProps({
        role: "group",
        "aria-label": resolvedTitle,
        "aria-describedby": hintId,
        "aria-disabled": inactive,
        "aria-busy": loading,
        onClick: open,
        className: cx(
          "flex flex-col items-center justify-center rounded-box border-2 border-dashed text-center",
          "border-base-300 bg-base-100 transition-colors outline-none",
          "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-base-200",
          !inactive && "group cursor-pointer hover:border-primary/50 hover:bg-primary/[0.03]",
          inactive && "cursor-not-allowed opacity-60",
          dragClasses,
          classes.zone,
          className,
        ),
      })}
    >
      {input}

      {loading && <span className={cx("loading loading-spinner text-primary", sizeClass("loading", size))} />}
      {!loading && (
        <PaperStackGraphic sheet={sheet} className={classes.stack} accept={isDragAccept} reject={rejected} />
      )}

      <div className="flex flex-col gap-1">
        <p className={cx("flex flex-wrap items-center justify-center gap-2", classes.title)}>
          {step !== undefined && <StepMark>{step}</StepMark>}
          {isDragReject && "Některé soubory nelze nahrát"}
          {!isDragReject && resolvedTitle}
          {badge}
        </p>
        <div id={hintId} className="flex flex-col gap-0.5 text-xs">
          {hint !== undefined && <p className="opacity-70">{hint}</p>}
          <p className="opacity-60">{constraints(accept, maxSize)}</p>
        </div>
      </div>

      <Button
        size={classes.button}
        variant="outline"
        disabled={inactive}
        aria-describedby={hintId}
        className="mt-1"
        onClick={(event) => {
          event.stopPropagation();
          open();
        }}
      >
        {buttonLabel ?? copy.button}
      </Button>

      {hasRejections && (
        <ul role="alert" className="flex flex-col gap-0.5 text-xs text-error">
          {rejections.map(({ file, errors }) => (
            <li key={fileKey(file)}>
              <strong>{file.name}</strong>: {errors.map((error) => error.message).join(", ")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function constraints(accept: Accept | undefined, maxSize: number | undefined): string {
  const parts: string[] = [];
  if (accept !== undefined) {
    const extensions = Object.values(accept)
      .flat()
      .map((ext) => ext.replace(/^\./, "").toUpperCase());
    if (extensions.length > 0) {
      parts.push([...new Set(extensions)].join(", "));
    }
  }
  if (maxSize !== undefined) {
    parts.push(`max. ${formatBytes(maxSize)} na soubor`);
  }

  if (parts.length === 0) {
    return "Libovolný typ souboru";
  }

  return parts.join(" · ");
}

interface Limits {
  maxSize: number | undefined;
  maxFiles: number;
}

const errorMessage: Record<ErrorCode, (limits: Limits) => string> = {
  [ErrorCode.FileInvalidType]: () => "nepodporovaný typ souboru",
  [ErrorCode.FileTooLarge]: ({ maxSize }) => {
    if (maxSize === undefined) {
      return "soubor je příliš velký";
    }

    return `soubor je větší než ${formatBytes(maxSize)}`;
  },
  [ErrorCode.FileTooSmall]: () => "soubor je prázdný",
  [ErrorCode.TooManyFiles]: ({ maxFiles }) => {
    if (maxFiles === 1) {
      return "lze nahrát jen jeden soubor";
    }

    return `lze nahrát nejvýše ${maxFiles} ${maxFiles < 5 ? "soubory" : "souborů"}`;
  },
};

const isErrorCode = (code: string): code is ErrorCode => Object.hasOwn(errorMessage, code);

function describeError(error: FileError, limits: Limits): string {
  if (isErrorCode(error.code)) {
    return errorMessage[error.code](limits);
  }

  return "soubor nelze nahrát";
}
