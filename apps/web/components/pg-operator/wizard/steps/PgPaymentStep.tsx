"use client";
import { Dispatch } from "react";
import { motion } from "framer-motion";
import {
  CreditCard,
  Zap,
  ChevronLeft,
  ChevronRight,
  Smartphone,
  Building,
  Banknote
} from "lucide-react";
import { PgWizardState, PgWizardAction } from "@/lib/pg-wizard-state";
import RupeeInput from "../shared/RupeeInput";
import EnumChips from "../shared/EnumChips";

const ELECTRICITY = [
  { value: "flat" as const, label: "Flat Rate", icon: <Zap size={16} /> },
  { value: "submetered" as const, label: "Submetered", icon: <Zap size={16} /> },
  { value: "split_equally" as const, label: "Split Equally", icon: <Zap size={16} /> }
];

const PAYMENT = [
  { value: "upi", label: "UPI", icon: <Smartphone size={16} /> },
  { value: "bank_transfer", label: "Bank Transfer", icon: <Building size={16} /> },
  { value: "cash", label: "Cash", icon: <Banknote size={16} /> }
];

export default function PgPaymentStep({
  state,
  dispatch
}: {
  state: PgWizardState;
  dispatch: Dispatch<PgWizardAction>;
  locale: string;
}) {
  const d = state.draft.pg_details ?? ({} as any);
  const setF = (path: string, value: unknown) => dispatch({ type: "SET_FIELD", path, value });

  const togglePayment = (m: string) => {
    const cur = new Set<string>((d as any).payment_modes ?? []);
    cur.has(m) ? cur.delete(m) : cur.add(m);
    setF("pg_details.payment_modes", Array.from(cur));
  };

  return (
    <section className="pgo-stagger">
      <div className="pgo-form-section">
        <div className="pgo-section-header">
          <div className="pgo-section-header__icon">
            <CreditCard size={20} />
          </div>
          <div className="pgo-section-header__text">
            <span className="pgo-overline">Terms</span>
            <span className="pgo-heading pgo-heading--xs">Notice & lock-in</span>
          </div>
        </div>

        <div className="pgo-form-row">
          <div className="pgo-field">
            <input
              className="pgo-field__input"
              type="number"
              aria-label="notice period"
              value={d.notice_period_days ?? ""}
              onChange={(e) =>
                setF("pg_details.notice_period_days", parseInt(e.target.value, 10) || null)
              }
              placeholder=" "
            />
            <label className="pgo-field__label">Notice period (days)</label>
            <span className="pgo-field__bar" />
          </div>
          <div className="pgo-field">
            <input
              className="pgo-field__input"
              type="number"
              aria-label="lock-in"
              value={d.lock_in_months ?? ""}
              onChange={(e) =>
                setF("pg_details.lock_in_months", parseInt(e.target.value, 10) || null)
              }
              placeholder=" "
            />
            <label className="pgo-field__label">Lock-in (months)</label>
            <span className="pgo-field__bar" />
          </div>
        </div>
      </div>

      <div className="pgo-form-section">
        <EnumChips
          label="Electricity billing"
          value={(d as any).electricity_mode}
          onChange={(v) => setF("pg_details.electricity_mode", v)}
          options={
            ELECTRICITY as unknown as { value: string; label: string; icon?: React.ReactNode }[]
          }
        />

        <div className="pgo-form-row">
          <RupeeInput
            aria-label="maintenance"
            label="Maintenance / month"
            valuePaise={(d as any).maintenance_paise ?? null}
            onChangePaise={(v) => setF("pg_details.maintenance_paise", v)}
            placeholder=" "
          />
          <div className="pgo-field">
            <input
              className="pgo-field__input"
              type="number"
              min={1}
              max={28}
              aria-label="rent due day"
              value={(d as any).rent_due_day ?? ""}
              onChange={(e) =>
                setF("pg_details.rent_due_day", parseInt(e.target.value, 10) || null)
              }
              placeholder=" "
            />
            <label className="pgo-field__label">Rent due day (1-28)</label>
            <span className="pgo-field__bar" />
          </div>
        </div>
      </div>

      <div className="pgo-form-section">
        <span className="pgo-chips__label">Payment modes accepted</span>
        <div className="pgo-chips__grid" style={{ marginTop: 10 }}>
          {PAYMENT.map((m) => {
            const active = ((d as any).payment_modes ?? []).includes(m.value);
            return (
              <motion.button
                key={m.value}
                type="button"
                className={`pgo-chip ${active ? "pgo-chip--selected" : ""}`}
                aria-label={m.value}
                aria-pressed={active}
                onClick={() => togglePayment(m.value)}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                <span className="pgo-chip__icon">{m.icon}</span>
                {m.label}
              </motion.button>
            );
          })}
        </div>
      </div>

      <div className="pgo-form-section">
        <label className={`pgo-switch ${!!(d as any).price_negotiable ? "pgo-switch--on" : ""}`}>
          <input
            type="checkbox"
            id="price_negotiable"
            aria-label="price negotiable"
            checked={!!(d as any).price_negotiable}
            onChange={(e) => setF("pg_details.price_negotiable", e.target.checked)}
          />
          <div className="pgo-switch__track">
            <div className="pgo-switch__thumb" />
          </div>
          <span className="pgo-switch__label">Rent is negotiable</span>
          <span className="pgo-switch__emoji">💬</span>
        </label>
      </div>

      <div>
        <div className="pgo-field">
          <textarea
            className="pgo-field__input pgo-field__input--textarea"
            aria-label="late fee policy"
            value={(d as any).late_fee_policy?.note ?? ""}
            onChange={(e) => setF("pg_details.late_fee_policy", { note: e.target.value })}
            placeholder=" "
            rows={3}
          />
          <label className="pgo-field__label">Late fee policy (optional)</label>
          <span className="pgo-field__bar" />
        </div>
      </div>

      <div className="pgo-step-nav">
        <button
          className="pgo-btn pgo-btn--secondary"
          type="button"
          onClick={() => dispatch({ type: "GOTO_STEP", step: 2 })}
        >
          Back
        </button>
        <button
          className="pgo-btn pgo-btn--primary"
          type="button"
          onClick={() => dispatch({ type: "GOTO_STEP", step: 4 })}
        >
          Next
        </button>
      </div>
    </section>
  );
}
