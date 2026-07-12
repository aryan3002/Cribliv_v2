"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, CircleX, Clock3, ShieldCheck } from "lucide-react";
import { getManageRequest, requestManage } from "@/lib/pg-operations-api";
import type { PgManageRequestState } from "@cribliv/shared-types";
import styles from "./PgManageRequestPanel.module.css";

interface Props {
  listingId: string;
  locale: string;
  accessToken?: string;
}

export function PgManageRequestPanel({ listingId, locale, accessToken }: Props) {
  const [state, setState] = useState<PgManageRequestState | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setState(await getManageRequest(listingId, accessToken));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the Manage PG status.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, listingId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRequest() {
    setSubmitting(true);
    setError(null);
    try {
      await requestManage(listingId, {}, accessToken);
      setState({ status: "pending" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not submit the Manage PG request.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <section className={styles.panel}>Checking Manage PG status...</section>;
  }

  if (error) {
    return (
      <section className={styles.panel} aria-live="polite">
        <p className={styles.error}>{error}</p>
        <button type="button" className={styles.secondaryButton} onClick={() => void load()}>
          Try again
        </button>
      </section>
    );
  }

  if (state?.status === "approved") {
    return (
      <section className={styles.panel}>
        <div className={styles.copy}>
          <BadgeCheck size={18} aria-hidden="true" className={styles.approvedIcon} />
          <div>
            <h2>Manage PG is active</h2>
            <p>Your property is ready for managed operations.</p>
          </div>
        </div>
        {state.managed_property_id ? (
          <Link
            className={styles.primaryLink}
            href={`/${locale}/pg-operator/properties/${state.managed_property_id}` as any}
          >
            Open Manage PG
          </Link>
        ) : (
          <span className={styles.error}>
            Managed property details are unavailable. Contact support.
          </span>
        )}
      </section>
    );
  }

  if (state?.status === "pending") {
    return (
      <section className={styles.panel}>
        <div className={styles.copy}>
          <Clock3 size={18} aria-hidden="true" className={styles.pendingIcon} />
          <div>
            <h2>Manage PG request pending approval.</h2>
            <p>We will notify you once the request has been reviewed.</p>
          </div>
        </div>
      </section>
    );
  }

  if (state?.status === "rejected" || state?.status === "cancelled") {
    return (
      <section className={styles.panel}>
        <div className={styles.copy}>
          <CircleX size={18} aria-hidden="true" className={styles.rejectedIcon} />
          <div>
            <h2>Manage PG request not approved</h2>
            {state.request?.decision_notes && <p>{state.request.decision_notes}</p>}
            <p>Contact support for help with your request.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.panel}>
      <div className={styles.copy}>
        <ShieldCheck size={18} aria-hidden="true" className={styles.requestIcon} />
        <div>
          <h2>Manage this PG</h2>
          <p>Send this listing to the operations team for managed setup.</p>
        </div>
      </div>
      <button
        type="button"
        className={styles.primaryButton}
        onClick={() => void handleRequest()}
        disabled={submitting}
      >
        {submitting ? "Requesting..." : "Request Manage PG"}
      </button>
    </section>
  );
}
