import { type ComponentProps, useId } from "react";

import { cx } from "#lib/cx";
import { sizeClass, toneClass } from "#lib/daisy";
import type { Size, Tone } from "#lib/tokens";

export type InputVariant = "outline" | "ghost";

const variantClass: Record<InputVariant, string> = {
  outline: "",
  ghost: "input-ghost",
};

export interface InputProps extends Omit<ComponentProps<"input">, "size"> {
  size?: Size | undefined;
  tone?: Tone | undefined;
  variant?: InputVariant | undefined;
  label?: string | undefined;
}

export function Input({ size = "md", tone, variant = "outline", label, id, className, ...rest }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const labelled = label !== undefined;
  const input = (
    <input
      id={inputId}
      className={cx(
        "input",
        sizeClass("input", size),
        toneClass("input", tone),
        variantClass[variant],
        labelled && "w-full",
        className,
      )}
      {...rest}
    />
  );

  if (!labelled) {
    return input;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      {input}
    </div>
  );
}
