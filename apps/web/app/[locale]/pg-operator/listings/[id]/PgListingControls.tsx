"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { Eye, EyeOff, Archive, Pencil, Loader2 } from "lucide-react";
import { setPgListingStatus, type PgListingVisibility } from "@/lib/pg-operator-api";
import { useToast } from "@/components/ui/toast/use-toast";
import styles from "./pg-listing-manage.module.css";

export default function PgListingControls({
  listingId,
  status,
  locale,
  token
}: {
  listingId: string;
  status: string;
  locale: string;
  token?: string;
}) {
  const router = useRouter();
  const [cur, setCur] = useState(status);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  const apply = async (next: PgListingVisibility, label: string) => {
    if (next === cur || busy) return;
    setBusy(next);
    const prev = cur;
    setCur(next);
    try {
      await setPgListingStatus(listingId, next, token);
      toast.success(label);
      router.refresh();
    } catch (e) {
      setCur(prev);
      toast.error(e instanceof Error ? e.message : "Couldn't update status", {
        action: { label: "Retry", onClick: () => void apply(next, label) }
      });
    } finally {
      setBusy(null);
    }
  };

  const archived = cur === "archived";

  return (
    <div className={styles.controls}>
      {!archived ? (
        <>
          <div className={styles.segmented} role="group" aria-label="Listing visibility">
            <button
              type="button"
              className={`${styles.segBtn} ${cur === "active" ? styles.segActive : ""}`}
              disabled={busy != null}
              onClick={() => apply("active", "Listing is now live")}
            >
              {busy === "active" ? <Loader2 size={14} className="pgo-spin" /> : <Eye size={14} />}
              Live
            </button>
            <button
              type="button"
              className={`${styles.segBtn} ${cur === "paused" ? styles.segActivePaused : ""}`}
              disabled={busy != null}
              onClick={() => apply("paused", "Listing paused, hidden from search")}
            >
              {busy === "paused" ? (
                <Loader2 size={14} className="pgo-spin" />
              ) : (
                <EyeOff size={14} />
              )}
              Paused
            </button>
          </div>
          <p className={styles.controlNote}>
            {cur === "active"
              ? "Visible on the homepage and search. Switch to Paused to hide it temporarily."
              : "Hidden from tenants. Switch to Live to show it again."}
          </p>
        </>
      ) : (
        <p className={styles.controlNote}>
          This listing is archived and removed from all public surfaces.
        </p>
      )}

      <div className={styles.btnRow}>
        <Link
          href={`/${locale}/pg-operator/listings/new?edit=${listingId}` as any}
          className={`${styles.btn} ${styles.btnPrimary}`}
        >
          <Pencil size={15} /> Edit listing
        </Link>
        {!archived && (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnDanger}`}
            disabled={busy != null}
            onClick={() => {
              if (confirm("Archive this listing? It will be removed from all public surfaces.")) {
                void apply("archived", "Listing archived");
              }
            }}
          >
            {busy === "archived" ? (
              <Loader2 size={15} className="pgo-spin" />
            ) : (
              <Archive size={15} />
            )}
            Archive
          </button>
        )}
      </div>
    </div>
  );
}
