import { type ComponentProps, useId } from "react";

import { cx } from "#lib/cx";

export interface TextareaProps extends ComponentProps<"textarea"> {
  label: string;
}

export function Textarea({ label, id, className, ...props }: TextareaProps) {
  const generated = useId();
  const inputId = id ?? generated;

  return (
    <label className="flex flex-col gap-1.5 text-sm" htmlFor={inputId}>
      <span className="font-medium">{label}</span>
      <textarea {...props} id={inputId} className={cx("textarea w-full", className)} />
    </label>
  );
}
