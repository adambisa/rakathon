import { type ReactNode, type SyntheticEvent, useEffect, useId, useRef } from "react";

import { cx } from "#lib/cx";
import type { Size } from "#lib/tokens";

const sizeClass: Record<Size, string> = {
  xs: "max-w-xs",
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  actions?: ReactNode;
  size?: Size | undefined;
  dismissible?: boolean | undefined;
  boxClassName?: string | undefined;
  children: ReactNode;
}

export function Modal({
  open,
  onClose,
  title,
  actions,
  size = "md",
  dismissible = true,
  boxClassName,
  children,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    }
    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    if (!dismissible) {
      event.preventDefault();
    }
  };

  // The native close event also fires for our own dialog.close(); only report user-initiated closes.
  // Chromium's close-watcher lets a repeated Escape bypass onCancel, so a non-dismissible dialog reopens.
  const handleClose = () => {
    if (!open) return;
    if (!dismissible) {
      ref.current?.showModal();

      return;
    }
    onClose();
  };

  let labelledBy: string | undefined;
  if (title !== undefined) {
    labelledBy = titleId;
  }

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={labelledBy}
      onClose={handleClose}
      onCancel={handleCancel}
    >
      <div className={cx("modal-box", sizeClass[size], boxClassName)}>
        {dismissible && (
          <form method="dialog">
            <button
              type="submit"
              className="btn absolute top-2 right-2 btn-circle btn-ghost btn-sm"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </form>
        )}
        {title !== undefined && (
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
        )}
        <div className="py-4">{children}</div>
        {actions !== undefined && <div className="modal-action">{actions}</div>}
      </div>
      {dismissible && (
        <form method="dialog" className="modal-backdrop">
          <button type="submit">Zavřít</button>
        </form>
      )}
    </dialog>
  );
}
