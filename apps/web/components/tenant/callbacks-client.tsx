"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { readAuthSession } from "../../lib/client-auth";
import { fetchApi } from "../../lib/api";
import { trackEvent } from "../../lib/analytics";
import { t, type Locale } from "../../lib/i18n";

interface CallbackItem {
  callback_id: string;
  listing_id: string;
  listing_title: string;
  status: "awaiting_call" | "call_claimed" | "refunded";
  requested_at: string | null;
  call_deadline_at: string;
  call_claimed_at: string | null;
  tenant_confirmed_at: string | null;
  disputed_at: string | null;
}

function formatDeadline(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short"
  });
}

export function CallbacksClient({ locale }: { locale: Locale }) {
  const { data: session, status: sessionStatus } = useSession();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [items, setItems] = useState<CallbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (sessionStatus === "loading") return;
    const stored = readAuthSession();
    const nextAuthToken = (session as { accessToken?: string } | null)?.accessToken ?? null;
    setToken(stored?.access_token ?? nextAuthToken ?? null);
  }, [session, sessionStatus]);

  async function load(activeToken: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchApi<{ items: CallbackItem[] }>("/tenant/callbacks", {
        headers: { Authorization: `Bearer ${activeToken}` }
      });
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load callbacks");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) void load(token);
  }, [token]);

  async function act(callbackId: string, action: "confirm" | "dispute") {
    if (!token) return;
    setBusyId(callbackId);
    try {
      await fetchApi(`/tenant/callbacks/${callbackId}/${action}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      trackEvent(action === "confirm" ? "callback_confirmed" : "callback_disputed", {
        callback_id: callbackId
      });
      await load(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  if (token === undefined) {
    return <p style={{ padding: "var(--space-6)" }}>Loading…</p>;
  }
  if (token === null) {
    return <p style={{ padding: "var(--space-6)" }}>{t(locale, "cbLoginPrompt")}</p>;
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "var(--space-6) var(--space-4)" }}>
      <h1 style={{ marginBottom: "var(--space-2)" }}>{t(locale, "cbMyCallbacks")}</h1>
      <p
        className="body-sm"
        style={{ color: "var(--text-secondary)", marginBottom: "var(--space-5)" }}
      >
        {t(locale, "cbGuaranteeLine")}
      </p>

      {loading ? <p>Loading…</p> : null}
      {error ? <p className="alert alert--error">{error}</p> : null}
      {!loading && items.length === 0 ? (
        <p className="caption" style={{ color: "var(--text-tertiary)" }}>
          {t(locale, "cbEmptyState")}
        </p>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        {items.map((item) => {
          const steps =
            item.status === "refunded"
              ? [t(locale, "cbStepRequested"), t(locale, "cbStepRefunded")]
              : item.status === "call_claimed"
                ? [
                    t(locale, "cbStepRequested"),
                    t(locale, "cbStepOwnerNotified"),
                    t(locale, "cbCallMadePrompt")
                  ]
                : [
                    t(locale, "cbStepRequested"),
                    t(locale, "cbStepOwnerNotified"),
                    t(locale, "cbStepCallOnWay").replace(
                      "{time}",
                      formatDeadline(item.call_deadline_at)
                    )
                  ];
          const showPrompt =
            item.status === "call_claimed" && !item.tenant_confirmed_at && !item.disputed_at;
          return (
            <div
              key={item.callback_id}
              className="card"
              data-testid="callback-item"
              style={{
                padding: "var(--space-4)",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-md)"
              }}
            >
              <p style={{ fontWeight: 700 }}>{item.listing_title}</p>
              <ol style={{ margin: "var(--space-2) 0", paddingLeft: "var(--space-4)" }}>
                {steps.map((s) => (
                  <li key={s} className="body-sm">
                    {s}
                  </li>
                ))}
              </ol>
              {item.status === "refunded" ? (
                <p className="caption" style={{ color: "var(--text-secondary)" }}>
                  {t(locale, "cbRefundedCaption")}
                </p>
              ) : null}
              {item.tenant_confirmed_at ? (
                <p className="caption" style={{ color: "var(--text-secondary)" }}>
                  {t(locale, "cbConfirmedCaption")}
                </p>
              ) : null}
              {item.disputed_at ? (
                <p className="caption" style={{ color: "var(--text-secondary)" }}>
                  {t(locale, "cbDisputedCaption")}
                </p>
              ) : null}
              {showPrompt ? (
                <div
                  style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}
                >
                  <button
                    className="btn btn--primary btn--sm"
                    disabled={busyId === item.callback_id}
                    onClick={() => act(item.callback_id, "confirm")}
                  >
                    {t(locale, "cbGotCall")}
                  </button>
                  <button
                    className="btn btn--secondary btn--sm"
                    disabled={busyId === item.callback_id}
                    onClick={() => act(item.callback_id, "dispute")}
                  >
                    {t(locale, "cbNoCall")}
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </main>
  );
}
