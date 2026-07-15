"use client";

import { X } from "lucide-react";
import styles from "./toast.module.css";

export type ToastTone = "success" | "error" | "info";
export type ToastAction = { label: string; onClick: () => void };
export type ToastMessage = {
  id: string;
  message: string;
  tone: ToastTone;
  duration?: number;
  action?: ToastAction;
};

export function Toast({
  toast,
  onDismiss
}: {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      className={`${styles.toast} ${styles[toast.tone]}`}
      role={toast.tone === "error" ? "alert" : "status"}
      aria-live={toast.tone === "error" ? "assertive" : undefined}
    >
      <p className={styles.message}>{toast.message}</p>
      {toast.action && (
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            toast.action?.onClick();
            onDismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        className={styles.dismiss}
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
