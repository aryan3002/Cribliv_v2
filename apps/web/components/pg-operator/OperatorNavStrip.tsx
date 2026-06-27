"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./operator-nav.module.css";

export default function OperatorNavStrip({ locale }: { locale: string }) {
  const pathname = usePathname();
  const base = `/${locale}/pg-operator`;
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const links = [
    { label: "Dashboard", href: `${base}/dashboard`, anchor: false },
    { label: "Listings", href: `${base}/listings`, anchor: false },
    { label: "Leads", href: `#leads-section`, anchor: true },
    { label: "Analytics", href: `#analytics-section`, anchor: true }
  ];
  return (
    <nav className={styles.strip} aria-label="Operator">
      <span className={styles.brand}>cribliv</span>
      <span className={styles.badge}>Operator</span>
      <div className={styles.links}>
        {links.map((l) =>
          l.anchor ? (
            <a key={l.label} href={l.href} className={styles.link}>
              {l.label}
            </a>
          ) : (
            <Link
              key={l.label}
              href={l.href as any}
              className={`${styles.link} ${isActive(l.href) ? styles.linkActive : ""}`}
            >
              {l.label}
            </Link>
          )
        )}
      </div>
    </nav>
  );
}
