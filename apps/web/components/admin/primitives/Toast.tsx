"use client";

import { useEffect, useState, type ReactNode } from "react";

export interface ToastMessage {
  id: number;
  message: ReactNode;
  tone?: "trust" | "warn" | "danger";
  ttl?: number;
}

interface Props {
  toast: ToastMessage | null;
  onDismiss: () => void;
}

export function Toast({ toast, onDismiss }: Props) {
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(onDismiss, toast.ttl ?? 4000);
    return () => window.clearTimeout(t);
  }, [toast, onDismiss]);

  if (!toast) return null;

  return (
    <div className="admin-toast" data-tone={toast.tone ?? "trust"} role="status">
      {toast.message}
    </div>
  );
}

export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const push = (message: ReactNode, tone?: ToastMessage["tone"], ttl?: number) =>
    setToast({ id: Date.now(), message, tone, ttl });
  return { toast, push, dismiss: () => setToast(null) };
}
