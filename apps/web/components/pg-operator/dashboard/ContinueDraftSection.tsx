"use client";
import Link from "next/link";
import { FileEdit, ArrowRight } from "lucide-react";
import type { PgDraftSummary } from "@/lib/pg-operator-api";
import styles from "@/app/[locale]/pg-operator/dashboard/pg-dashboard.module.css";

interface Props {
  drafts: PgDraftSummary[];
  locale: string;
}

function relativeTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch {
    return iso;
  }
}

export default function ContinueDraftSection({ drafts, locale }: Props) {
  if (!drafts.length) return null;

  return (
    <section>
      <p className={styles.sectionTitle}>Continue your draft</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {drafts.map((d) => (
          <Link
            key={d.draft_id}
            href={`/${locale}/pg-operator/listings/new?draft=${d.draft_id}` as any}
            className={styles.draftCard}
          >
            <span className={styles.draftIcon}>
              <FileEdit size={18} />
            </span>
            <div className={styles.draftBody}>
              <div className={styles.draftTitle}>{d.display_name || "Untitled PG"}</div>
              <div className={styles.draftSub}>Draft · edited {relativeTime(d.updated_at)}</div>
            </div>
            <button type="button" className={styles.draftResume} tabIndex={-1} aria-hidden>
              Resume <ArrowRight size={14} />
            </button>
          </Link>
        ))}
      </div>
    </section>
  );
}
