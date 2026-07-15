"use client";

import { useContext } from "react";
import { ToastContext, type ToastContextValue } from "./toast-provider";

export function useToast(): ToastContextValue {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error("useToast must be used within a ToastProvider");
  return toast;
}
