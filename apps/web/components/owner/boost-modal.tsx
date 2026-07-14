"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  fetchBoostPlans,
  fetchBoostStatus,
  createBoostOrder,
  type BoostPlan
} from "../../lib/owner-api";
import { loadRazorpayScript, openRazorpayCheckout } from "../../lib/razorpay";

interface BoostModalProps {
  listingId: string;
  listingTitle: string;
  accessToken: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (paymentId: string) => void;
}

interface Toast {
  type: "success" | "error" | "info";
  message: string;
}

function formatRupees(paise: number) {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}

function formatDuration(hours: number) {
  if (hours % 24 === 0) return `${hours / 24} day${hours / 24 > 1 ? "s" : ""}`;
  return `${hours} hrs`;
}

export function BoostModal({
  listingId,
  listingTitle,
  accessToken,
  isOpen,
  onClose,
  onSuccess
}: BoostModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [plans, setPlans] = useState<BoostPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [activeBoost, setActiveBoost] = useState<{ boostType: string; expiresAt?: string } | null>(
    null
  );

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setSelectedPlanId(null);
    setToast(null);

    Promise.all([fetchBoostPlans(accessToken), fetchBoostStatus(accessToken, listingId)])
      .then(([boostPlans, status]) => {
        setPlans(boostPlans);
        if (status.hasBoost && status.boostType) {
          setActiveBoost({ boostType: status.boostType, expiresAt: status.expiresAt });
        } else {
          setActiveBoost(null);
        }
      })
      .catch(() =>
        setToast({ type: "error", message: "Failed to load boost plans. Please try again." })
      )
      .finally(() => setLoading(false));
  }, [isOpen, accessToken, listingId]);

  useEffect(() => {
    if (!isOpen) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [isOpen, onClose]);

  function showToast(t: Toast) {
    setToast(t);
    setTimeout(() => setToast(null), 5000);
  }

  async function handlePurchase() {
    if (!selectedPlanId) return;
    setPurchasing(true);

    try {
      const order = await createBoostOrder(accessToken, listingId, selectedPlanId);

      if (!order.razorpayOrderId) {
        showToast({
          type: "info",
          message: "Order created! Payment gateway will be available soon."
        });
        setTimeout(onClose, 2000);
        return;
      }

      const loaded = await loadRazorpayScript();
      if (!loaded) {
        showToast({
          type: "error",
          message: "Could not load payment gateway. Please check your connection."
        });
        return;
      }

      openRazorpayCheckout({
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? "",
        amount: order.amountPaise,
        currency: "INR",
        name: "Cribliv",
        description: order.planLabel,
        order_id: order.razorpayOrderId,
        handler: (response) => {
          showToast({
            type: "success",
            message: "Payment successful! Your listing is now boosted."
          });
          onSuccess(response.razorpay_payment_id);
        },
        theme: { color: "#0066FF" },
        modal: {
          ondismiss: () => {
            showToast({ type: "info", message: "Payment cancelled." });
          }
        }
      });
    } catch {
      showToast({
        type: "error",
        message: "We couldn't start the boost purchase. Please try again."
      });
    } finally {
      setPurchasing(false);
    }
  }

  if (!isOpen) return null;

  const featuredPlans = plans.filter((p) => p.boostType === "featured");
  const boostPlans = plans.filter((p) => p.boostType === "boost");
  const selectedPlan = plans.find((p) => p.planId === selectedPlanId);

  return (
    <div
      className="modal-overlay owner-modal-overlay"
      role="dialog"
      aria-modal
      aria-label="Boost listing"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal owner-sheet" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal__header">
          <div>
            <h2 className="modal__title owner-sheet__title">⚡ Boost Listing</h2>
            <p className="owner-sheet__subtitle">{listingTitle}</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label="Close boost dialog"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="modal__body owner-sheet__body">
          {/* Active boost banner */}
          {activeBoost && (
            <div
              className="alert alert--info"
              style={{ marginBottom: "var(--space-4)", fontSize: 13 }}
            >
              <span style={{ fontSize: 16 }}>✨</span>
              <div>
                <strong>Already boosted</strong>
                {activeBoost.expiresAt && (
                  <span style={{ display: "block", fontSize: 12, marginTop: 2 }}>
                    {activeBoost.boostType} active until{" "}
                    {new Intl.DateTimeFormat("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric"
                    }).format(new Date(activeBoost.expiresAt))}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Toast */}
          {toast && (
            <div
              className={`alert alert--${toast.type === "success" ? "success" : toast.type === "error" ? "error" : "info"}`}
              style={{ marginBottom: "var(--space-4)", fontSize: 13 }}
            >
              {toast.message}
            </div>
          )}

          {loading ? (
            <div>
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="skeleton-card"
                  style={{
                    height: 72,
                    borderRadius: "var(--radius-md)",
                    marginBottom: "var(--space-2)"
                  }}
                />
              ))}
            </div>
          ) : plans.length === 0 ? (
            <p
              style={{
                color: "var(--text-secondary)",
                fontSize: 14,
                textAlign: "center",
                padding: "var(--space-8) 0"
              }}
            >
              No boost plans available right now.
            </p>
          ) : (
            <>
              {/* Featured plans */}
              {featuredPlans.length > 0 && (
                <div style={{ marginBottom: "var(--space-5)" }}>
                  <p
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.07em",
                      color: "#92400e",
                      marginBottom: "var(--space-2)"
                    }}
                  >
                    ⭐ Featured: appears at top of search
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                    {featuredPlans.map((plan) => (
                      <PlanCard
                        key={plan.planId}
                        plan={plan}
                        selected={selectedPlanId === plan.planId}
                        onSelect={() => setSelectedPlanId(plan.planId)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Boost plans */}
              {boostPlans.length > 0 && (
                <div>
                  <p
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.07em",
                      color: "var(--brand-dark)",
                      marginBottom: "var(--space-2)"
                    }}
                  >
                    🚀 Boost: increased visibility in feed
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                    {boostPlans.map((plan) => (
                      <PlanCard
                        key={plan.planId}
                        plan={plan}
                        selected={selectedPlanId === plan.planId}
                        onSelect={() => setSelectedPlanId(plan.planId)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="modal__footer">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onClose}
            disabled={purchasing}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!selectedPlanId || purchasing || loading}
            onClick={() => void handlePurchase()}
            style={{ minWidth: 160 }}
          >
            {purchasing ? (
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    width: 14,
                    height: 14,
                    border: "2px solid rgba(255,255,255,0.4)",
                    borderTopColor: "white",
                    borderRadius: "50%",
                    display: "inline-block",
                    animation: "spin 0.7s linear infinite"
                  }}
                />
                Processing…
              </span>
            ) : selectedPlan ? (
              `Pay ${formatRupees(selectedPlan.amountPaise)}`
            ) : (
              "Select a plan"
            )}
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function PlanCard({
  plan,
  selected,
  onSelect
}: {
  plan: BoostPlan;
  selected: boolean;
  onSelect: () => void;
}) {
  const isFeatured = plan.boostType === "featured";

  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-3)",
        padding: "var(--space-3) var(--space-4)",
        borderRadius: "var(--radius-md)",
        border: `2px solid ${selected ? (isFeatured ? "#d97706" : "var(--brand)") : "var(--border)"}`,
        background: selected
          ? isFeatured
            ? "rgba(217,119,6,0.05)"
            : "var(--brand-light)"
          : "var(--surface)",
        cursor: "pointer",
        transition: "all var(--transition-fast)",
        textAlign: "left",
        width: "100%"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        {/* Radio dot */}
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: "50%",
            border: `2px solid ${selected ? (isFeatured ? "#d97706" : "var(--brand)") : "var(--border-strong)"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            background: selected ? (isFeatured ? "#d97706" : "var(--brand)") : "transparent"
          }}
        >
          {selected && (
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "white" }} />
          )}
        </span>

        <div>
          <p
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--text-primary)",
              margin: 0,
              lineHeight: 1.3
            }}
          >
            {plan.label}
          </p>
          <p style={{ fontSize: 12, color: "var(--text-tertiary)", margin: 0 }}>
            {formatDuration(plan.durationHours)} ·{" "}
            <span
              style={{
                padding: "1px 6px",
                borderRadius: "var(--radius-full)",
                fontSize: 10,
                fontWeight: 700,
                background: isFeatured ? "#fef3c7" : "var(--brand-light)",
                color: isFeatured ? "#92400e" : "var(--brand-dark)"
              }}
            >
              {isFeatured ? "FEATURED" : "BOOST"}
            </span>
          </p>
        </div>
      </div>

      <span
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 17,
          fontWeight: 700,
          color: selected ? (isFeatured ? "#d97706" : "var(--brand)") : "var(--text-primary)",
          flexShrink: 0
        }}
      >
        {formatRupees(plan.amountPaise)}
      </span>
    </button>
  );
}
