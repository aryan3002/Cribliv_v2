"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { submitPgListing } from "@/lib/pg-operator-api";

/**
 * Operator action: submit a DRAFT listing for admin review (draft →
 * pending_review). After success we refresh the server component so the page
 * reflects the new "Pending admin approval" state. Shown only for drafts.
 */
export default function PgSubmitForReview({
  listingId,
  token,
  title
}: {
  listingId: string;
  token?: string;
  title: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit() {
    setBusy(true);
    setErr(null);
    try {
      await submitPgListing(listingId, token);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Submit failed");
      setBusy(false);
    }
  }

  return (
    <div
      className="pgo-glass"
      style={{ padding: 16, marginBottom: 20, borderLeft: "3px solid var(--pgo-brand)" }}
    >
      <strong>Draft, not yet submitted.</strong>{" "}
      <span className="pgo-desc">
        Submit {title ? `“${title}”` : "this listing"} for admin review. It goes live once approved.
      </span>
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
        <button
          type="button"
          className="pgo-btn pgo-btn--primary"
          disabled={busy}
          onClick={onSubmit}
        >
          <Send size={16} /> {busy ? "Submitting…" : "Submit for review"}
        </button>
        {err && (
          <span className="pgo-desc" style={{ color: "#ef4444" }}>
            {err}
          </span>
        )}
      </div>
    </div>
  );
}
