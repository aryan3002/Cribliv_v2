"use client";
import Link from "next/link";
import { FileEdit } from "lucide-react";
import type { PgDraftSummary } from "@/lib/pg-operator-api";

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
    <section style={{ marginBottom: 24 }}>
      <h2 className="pgo-heading pgo-heading--sm" style={{ marginBottom: 12 }}>
        Continue your draft
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {drafts.map((d) => (
          <Link
            key={d.draft_id}
            href={`/${locale}/pg-operator/listings/new?draft=${d.draft_id}` as any}
            className="pgo-glass pgo-glass--sm"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 16px",
              textDecoration: "none",
              color: "inherit"
            }}
          >
            <FileEdit size={16} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, fontWeight: 500 }}>{d.display_name || "Untitled PG"}</span>
            <span className="pgo-caption">edited {relativeTime(d.updated_at)}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
