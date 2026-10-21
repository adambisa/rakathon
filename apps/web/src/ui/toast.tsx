import { cx } from "#lib/cx";
import { dismissToast, type Toast, type ToastTone, useToasts } from "#lib/toast";
import { Icon, type IconName } from "#ui/icon";

const toneClass: Record<ToastTone, string> = {
  success: "alert-success",
  error: "alert-error",
  info: "alert-info",
};

const toneIcon: Record<ToastTone, IconName> = {
  success: "circleCheck",
  error: "circleAlert",
  info: "info",
};

export function Toaster() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;

  return (
    <div className="toast toast-end toast-bottom z-50 max-w-full gap-3">
      {toasts.map((item) => (
        <ToastItem key={item.id} toast={item} />
      ))}
    </div>
  );
}

interface ToastItemProps {
  toast: Toast;
}

function ToastItem({ toast }: ToastItemProps) {
  const isError = toast.tone === "error";

  return (
    <div
      role={isError ? "alert" : "status"}
      className={cx(
        "toast-notification alert max-w-sm items-start gap-3 alert-soft shadow-sm",
        toneClass[toast.tone],
      )}
    >
      <Icon name={toneIcon[toast.tone]} size="sm" className="mt-0.5" />
      <span className="min-w-0 text-sm leading-6 font-medium text-pretty wrap-anywhere">{toast.message}</span>
      <button
        type="button"
        className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-inherit transition-colors hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        aria-label="Zavřít"
        onClick={() => dismissToast(toast.id)}
      >
        <Icon name="close" size="xs" />
      </button>
    </div>
  );
}
