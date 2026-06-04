"use client";
import type { ReactNode } from "react";
import styles from "./pg-wizard.module.css";

export default function PresetCard({
  title,
  sub,
  icon,
  selected,
  onSelect
}: {
  title: string;
  sub?: string;
  icon?: ReactNode;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`${styles.presetCard} ${selected ? styles.presetCardActive : ""}`}
      onClick={onSelect}
    >
      {icon}
      <span className={styles.presetCardTitle}>{title}</span>
      {sub && <span className={styles.presetCardSub}>{sub}</span>}
    </button>
  );
}
