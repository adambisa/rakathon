import { type ComponentProps, useId } from "react";

import { cx } from "#lib/cx";

export interface CheckboxProps extends Omit<ComponentProps<"input">, "type"> {
  label: string;
}
export function Checkbox({ label, id, className, ...props }: CheckboxProps) {
  const generated = useId();
  const inputId = id ?? generated;

  return (
    <label htmlFor={inputId} className="flex items-center gap-2 text-sm">
      <input
        {...props}
        type="checkbox"
        id={inputId}
        className={cx("checkbox shrink-0 checkbox-sm", className)}
      />
      <span>{label}</span>
    </label>
  );
}
