import { type ComponentProps, useId } from "react";

import { cx } from "#lib/cx";

export interface SelectProps extends ComponentProps<"select"> {
  label: string;
}

export function Select({ label, id, className, children, ...props }: SelectProps) {
  const generated = useId();
  const inputId = id ?? generated;

  return (
    <label className="flex flex-col gap-1.5 text-sm" htmlFor={inputId}>
      <span className="font-medium">{label}</span>
      <select {...props} id={inputId} className={cx("select w-full", className)}>
        {children}
      </select>
    </label>
  );
}
