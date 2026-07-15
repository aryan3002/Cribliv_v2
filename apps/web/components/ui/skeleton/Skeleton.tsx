"use client";

import type { HTMLAttributes } from "react";
import styles from "./skeleton.module.css";

export function Skeleton({
  className = "",
  label,
  ...props
}: HTMLAttributes<HTMLDivElement> & { label?: string }) {
  return (
    <div
      {...props}
      className={`${styles.skeleton} ${className}`.trim()}
      {...(label ? { role: "status", "aria-label": label } : { "aria-hidden": true })}
    />
  );
}
