"use client";

import { useState } from "react";
import { Database, Sparkles, Wallet } from "lucide-react";
import { SectionCard } from "../primitives/SectionCard";
import {
  adjustAdminWallet,
  triggerAiBackfill,
  triggerAiRecomputeScores
} from "../../../lib/admin-api";

interface Props {
  accessToken: string;
  onToast: (message: string, tone?: "trust" | "warn" | "danger") => void;
}

export function SystemTab({ accessToken, onToast }: Props) {
  const [aiBusy, setAiBusy] = useState<"backfill" | "scores" | null>(null);
  const [walletUserId, setWalletUserId] = useState("");
  const [walletDelta, setWalletDelta] = useState("0");
  const [walletReason, setWalletReason] = useState("");
  const [walletBusy, setWalletBusy] = useState(false);

  async function runBackfill() {
    setAiBusy("backfill");
    try {
      const r = await triggerAiBackfill(accessToken);
      onToast(r.message ?? "Backfill triggered", "trust");
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Backfill failed", "danger");
    } finally {
      setAiBusy(null);
    }
  }

  async function runRecompute() {
    setAiBusy("scores");
    try {
      const r = await triggerAiRecomputeScores(accessToken);
      onToast(r.message ?? "Recompute triggered", "trust");
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Recompute failed", "danger");
    } finally {
      setAiBusy(null);
    }
  }

  async function adjustWallet() {
    if (!walletUserId || !walletReason.trim()) {
      onToast("User id and reason are required", "warn");
      return;
    }
    const delta = Number(walletDelta);
    if (!Number.isFinite(delta)) {
      onToast("Delta must be a number", "warn");
      return;
    }
    setWalletBusy(true);
    try {
      const r = await adjustAdminWallet(accessToken, walletUserId, delta, walletReason.trim());
      onToast(`New balance: ${r.new_balance}`, "trust");
      setWalletUserId("");
      setWalletDelta("0");
      setWalletReason("");
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Adjust failed", "danger");
    } finally {
      setWalletBusy(false);
    }
  }

  return (
    <div className="admin-main__section">
      <div className="admin-page-title">
        <h1>System Tools</h1>
        <span className="admin-page-title__sub">Operator-only actions, fully audited</span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 16
        }}
      >
        <SectionCard
          title={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Sparkles size={14} aria-hidden="true" /> AI · Embeddings
            </span>
          }
          subtitle="Backfill listing embeddings for semantic search"
        >
          <p style={{ margin: 0, color: "var(--ad-text-2)", fontSize: 13, lineHeight: 1.5 }}>
            Re-runs the embedding pipeline against all active listings missing vectors. Safe to run
            multiple times; only fills gaps.
          </p>
          <button
            type="button"
            className="admin-btn admin-btn--primary"
            style={{ marginTop: 14 }}
            onClick={() => void runBackfill()}
            disabled={aiBusy != null}
          >
            {aiBusy === "backfill" ? "Running…" : "Run backfill"}
          </button>
        </SectionCard>

        <SectionCard
          title={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Database size={14} aria-hidden="true" /> AI · Scores
            </span>
          }
          subtitle="Recompute fraud and quality scores"
        >
          <p style={{ margin: 0, color: "var(--ad-text-2)", fontSize: 13, lineHeight: 1.5 }}>
            Re-evaluates fraud and quality scoring for every listing using current rules. Emits new
            fraud_flags as needed.
          </p>
          <button
            type="button"
            className="admin-btn admin-btn--primary"
            style={{ marginTop: 14 }}
            onClick={() => void runRecompute()}
            disabled={aiBusy != null}
          >
            {aiBusy === "scores" ? "Running…" : "Recompute scores"}
          </button>
        </SectionCard>

        <SectionCard
          title={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Wallet size={14} aria-hidden="true" /> Wallet adjustment
            </span>
          }
          subtitle="Credit or debit a user's wallet"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Field label="User ID">
              <input
                type="text"
                value={walletUserId}
                onChange={(e) => setWalletUserId(e.target.value)}
                placeholder="UUID"
                style={fieldStyle}
              />
            </Field>
            <Field label="Credits delta (+ to credit, − to debit)">
              <input
                type="number"
                value={walletDelta}
                onChange={(e) => setWalletDelta(e.target.value)}
                style={fieldStyle}
              />
            </Field>
            <Field label="Reason">
              <input
                type="text"
                value={walletReason}
                onChange={(e) => setWalletReason(e.target.value)}
                placeholder="e.g. comp for failed unlock"
                style={fieldStyle}
              />
            </Field>
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              onClick={() => void adjustWallet()}
              disabled={walletBusy}
            >
              {walletBusy ? "Adjusting…" : "Apply adjustment"}
            </button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ad-text-2)" }}>{label}</span>
      {children}
    </label>
  );
}

const fieldStyle: React.CSSProperties = {
  height: 34,
  padding: "0 12px",
  borderRadius: 8,
  border: "1px solid var(--ad-border)",
  background: "var(--ad-surface)",
  fontSize: 13,
  fontFamily: "inherit"
};
