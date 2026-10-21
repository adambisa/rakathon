import { type ComponentProps, type ReactNode, useState } from "react";

import { cx } from "#lib/cx";
import { Button } from "#ui/button";
import { Icon } from "#ui/icon";
import { Modal } from "#ui/modal";

export interface ExpandableProps extends ComponentProps<"div"> {
  title: string;
  children: ReactNode;
}

/** Content with an icon in its corner, shown on hover or focus, that opens it large in a modal. */
export function Expandable({ title, className, children, ...rest }: ExpandableProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={cx("group relative", className)} {...rest}>
      {children}
      <div className="absolute top-2 right-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <Button
          size="sm"
          variant="ghost"
          shape="square"
          aria-label="Zvětšit"
          tooltip="Zvětšit"
          tooltipPosition="left"
          onClick={() => setOpen(true)}
        >
          <Icon name="maximize" size="xs" />
        </Button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={title} size="xl" boxClassName="w-11/12">
        <div className="flex justify-center">{children}</div>
      </Modal>
    </div>
  );
}
