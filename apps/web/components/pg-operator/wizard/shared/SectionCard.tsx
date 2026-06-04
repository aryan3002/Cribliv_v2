"use client";
import type { ReactNode } from "react";
import styles from "./pg-wizard.module.css";

export default function SectionCard({
  title,
  subtitle,
  icon,
  action,
  children
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionHeadMain}>
          {icon && <span className={styles.sectionIcon}>{icon}</span>}
          <div>
            <h2 className={styles.sectionTitle}>{title}</h2>
            {subtitle && <p className={styles.sectionSub}>{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}
