"use client";

import { createContext, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Toast, type ToastAction, type ToastMessage, type ToastTone } from "./Toast";
import styles from "./toast.module.css";

export type ToastOptions = { action?: ToastAction; duration?: number };
export type ToastPromiseMessages<T> = {
  loading: string;
  success: string | ((value: T) => string);
  error: string | ((error: unknown) => string);
};
export type ToastContextValue = {
  success: (message: string, options?: ToastOptions) => string;
  error: (message: string, options?: ToastOptions) => string;
  info: (message: string, options?: ToastOptions) => string;
  promise: <T>(promise: Promise<T>, messages: ToastPromiseMessages<T>) => Promise<T>;
  dismiss: (id?: string) => void;
};

export const ToastContext = createContext<ToastContextValue | null>(null);
const DEFAULT_DURATION = 2800;
const MAX_VISIBLE_TOASTS = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dismiss = useCallback(
    (id?: string) => setToasts((current) => (id ? current.filter((toast) => toast.id !== id) : [])),
    []
  );
  const push = useCallback((tone: ToastTone, message: string, options: ToastOptions = {}) => {
    const id = crypto.randomUUID();
    setToasts((current) => [
      ...current,
      {
        id,
        message,
        tone,
        action: options.action,
        duration: options.duration ?? (tone === "error" ? undefined : DEFAULT_DURATION)
      }
    ]);
    return id;
  }, []);
  const value = useMemo<ToastContextValue>(
    () => ({
      success: (message, options) => push("success", message, options),
      error: (message, options) => push("error", message, options),
      info: (message, options) => push("info", message, options),
      promise: async (promise, messages) => {
        const loadingId = push("info", messages.loading, { duration: 0 });
        try {
          const result = await promise;
          dismiss(loadingId);
          push(
            "success",
            typeof messages.success === "function" ? messages.success(result) : messages.success
          );
          return result;
        } catch (error) {
          dismiss(loadingId);
          push(
            "error",
            typeof messages.error === "function" ? messages.error(error) : messages.error
          );
          throw error;
        }
      },
      dismiss
    }),
    [dismiss, push]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {mounted &&
        createPortal(
          <div
            className={styles.viewport}
            role="region"
            aria-label="Notifications"
            aria-live="polite"
            aria-atomic="false"
          >
            {toasts.slice(-MAX_VISIBLE_TOASTS).map((toast) => (
              <TimedToast key={toast.id} toast={toast} onDismiss={dismiss} />
            ))}
          </div>,
          document.body
        )}
    </ToastContext.Provider>
  );
}

function TimedToast({
  toast,
  onDismiss
}: {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    if (!toast.duration) return;
    const timeout = window.setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => window.clearTimeout(timeout);
  }, [onDismiss, toast.duration, toast.id]);
  return <Toast toast={toast} onDismiss={onDismiss} />;
}
