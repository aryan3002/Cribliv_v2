"use client";
import { useState, type ReactNode } from "react";
import styles from "./pg-wizard.module.css";

export default function Disclosure({
  summary,
  children
}: {
  summary: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        className={styles.disclosureBtn}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "− " : "+ "}
        {summary}
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}
