import { useSyncExternalStore } from "react";

import { errorMessage } from "#lib/error-message";

export type ToastTone = "success" | "error" | "info";

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

const DURATION_MS: Record<ToastTone, number> = { success: 4000, info: 5000, error: 8000 };

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

export function dismissToast(id: number): void {
  if (!toasts.some((toast) => toast.id === id)) return;
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

function push(tone: ToastTone, message: string): void {
  const id = nextId++;
  toasts = [...toasts, { id, tone, message }];
  emit();
  setTimeout(() => dismissToast(id), DURATION_MS[tone]);
}

export const toast = {
  success: (message: string) => push("success", message),
  info: (message: string) => push("info", message),
  error: (error: unknown) => push("error", typeof error === "string" ? error : errorMessage(error)),
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);

  return () => listeners.delete(listener);
};

export const useToasts = (): Toast[] => useSyncExternalStore(subscribe, () => toasts);
