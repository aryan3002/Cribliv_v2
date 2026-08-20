"use client";

import { useEffect, useState } from "react";

export interface PgTransferOwnerModalProps {
  listingId: string;
  currentOwnerName: string | null;
  currentOwnerPhone: string | null;
  onClose: () => void;
  onTransferred: (result: { operatorPhone: string; leadsMoved: number }) => void;
  onTransfer: (
    listingId: string,
    phoneE164: string,
    fullName?: string
  ) => Promise<{
    operatorUserId: string;
    operatorPhone: string;
    leadsMoved: number;
    alreadyOwned: boolean;
  }>;
}

const LABEL_STYLE: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "#6B7280",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: "0.05em"
};

// The API is the single authority on what a valid phone is — this modal
// deliberately does not re-implement `normalizeIndianPhone` (phone.util.ts on
// the API side), matching TransferOwnerModal's reasoning: one round-trip on a
// typo is cheaper than two validators drifting apart. Only the empty-field case
// is caught here, since that needs no server to know it's wrong.
export function PgTransferOwnerModal({
  listingId,
  currentOwnerName,
  currentOwnerPhone,
  onClose,
  onTransferred,
  onTransfer
}: PgTransferOwnerModalProps) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    if (!phone.trim()) {
      setError("Enter the operator's phone number");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await onTransfer(listingId, phone.trim(), name.trim() || undefined);
      onTransferred({ operatorPhone: result.operatorPhone, leadsMoved: result.leadsMoved });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="admin-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Transfer ownership"
        className="admin-drawer admin-drawer--center"
        style={{
          width: "min(440px, 94vw)",
          borderRadius: 14
        }}
      >
        <header className="admin-drawer__head">
          <div>
            <div className="admin-drawer__title">Transfer ownership</div>
            <div className="admin-drawer__sub">
              Currently operated by {currentOwnerName ?? "an unnamed account"} (
              {currentOwnerPhone ?? "-"})
            </div>
          </div>
        </header>

        <div className="admin-drawer__body" style={{ display: "grid", gap: 12 }}>
          <div>
            <label htmlFor="pg-transfer-phone" style={LABEL_STYLE}>
              Operator&apos;s phone
            </label>
            <input
              id="pg-transfer-phone"
              className="admin-input"
              style={{ width: "100%" }}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="98765 43210"
              inputMode="tel"
              disabled={busy}
            />
          </div>

          <div>
            <label htmlFor="pg-transfer-name" style={LABEL_STYLE}>
              Operator&apos;s name (optional)
            </label>
            <input
              id="pg-transfer-name"
              className="admin-input"
              style={{ width: "100%" }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          </div>

          <p style={{ fontSize: 12, color: "#6B7280", margin: 0, lineHeight: 1.6 }}>
            The whole PG moves, not just the listing: the property and everything on it — rooms,
            beds, tenants and maintenance — goes to this number, along with existing leads. Anyone
            currently living there will see the new number as their operator contact straight away.
            The new operator sees the PG after logging in with this number.
          </p>

          {error ? (
            <p
              role="alert"
              style={{
                fontSize: 12,
                color: "#B91C1C",
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                borderRadius: 6,
                padding: "6px 10px",
                margin: 0
              }}
            >
              {error}
            </p>
          ) : null}
        </div>

        <footer className="admin-drawer__footer">
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="admin-btn admin-btn--primary"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? "Transferring…" : "Transfer ownership"}
          </button>
        </footer>
      </div>
    </>
  );
}
