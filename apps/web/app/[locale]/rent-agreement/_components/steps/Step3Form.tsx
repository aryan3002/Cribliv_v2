"use client";

import { useState } from "react";
import type { StepFormProps } from "./types";
import { step3Schema } from "@/lib/rent-agreement/schemas/step-3.zod";

const STATE_OPTIONS = [
  { code: "KA", label: "Karnataka" },
  { code: "DL", label: "Delhi" },
  { code: "MH", label: "Maharashtra" },
  { code: "TN", label: "Tamil Nadu" },
  { code: "GJ", label: "Gujarat" },
  { code: "HR", label: "Haryana" },
  { code: "RJ", label: "Rajasthan" },
  { code: "UP", label: "Uttar Pradesh" }
];

interface FieldState {
  agreement_type: "new" | "renewal";
  agreement_date: string;
  commencement_date: string;
  tenure_months: string;
  lock_in_months: string;
  notice_period_months: string;
  rent_rupees: string;
  deposit_rupees: string;
  annual_increment_pct: string;
  state_code: string;
  city: string;
  acknowledge_registration_required: boolean;
}

const DEFAULTS: FieldState = {
  agreement_type: "new",
  // Backend rule: agreement_date must be today or earlier (@MaxDate).
  agreement_date: "2026-05-15",
  commencement_date: "2026-06-01",
  tenure_months: "11",
  lock_in_months: "6",
  notice_period_months: "2",
  rent_rupees: "25000",
  deposit_rupees: "50000",
  annual_increment_pct: "5",
  state_code: "KA",
  city: "Bengaluru",
  acknowledge_registration_required: false
};

export function Step3Form(props: StepFormProps) {
  const [fields, setFields] = useState<FieldState>(DEFAULTS);
  const [errors, setErrors] = useState<string[]>([]);

  const set = (k: keyof FieldState, v: string | boolean) =>
    setFields((prev) => ({ ...prev, [k]: v }));

  const tenure = parseInt(fields.tenure_months, 10) || 0;
  const registrationRequired = tenure > 11;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const payload = {
      agreement_type: fields.agreement_type,
      agreement_date: fields.agreement_date,
      commencement_date: fields.commencement_date,
      tenure_months: parseInt(fields.tenure_months, 10),
      lock_in_months: parseInt(fields.lock_in_months, 10),
      notice_period_months: parseInt(fields.notice_period_months, 10),
      rent_amount_paise: Math.round(parseFloat(fields.rent_rupees) * 100),
      security_deposit_paise: Math.round(parseFloat(fields.deposit_rupees) * 100),
      annual_increment_pct: parseFloat(fields.annual_increment_pct),
      state_code: fields.state_code,
      city: fields.city,
      acknowledge_registration_required: fields.acknowledge_registration_required
    };

    const result = step3Schema.safeParse(payload);

    if (!result.success) {
      const issues = result.error.issues.map((i) => i.message);
      setErrors(issues);
      return;
    }

    setErrors([]);
    await props.onSubmit(result.data);
  };

  const inputCls = "ra-input";
  const selectCls = "ra-select";

  return (
    <form onSubmit={handleSubmit} className="ra-form">
      {errors.length > 0 && (
        <div className="ra-error-box" role="alert">
          <b>Please fix the following errors:</b>
          <ul>
            {errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      <section className="ra-form-section">
        <h2 className="ra-form-section-title">Agreement dates</h2>
        <div className="ra-form-grid">
          <div className="ra-field">
            <label htmlFor="agreement_type" className="ra-label">
              Agreement type
            </label>
            <select
              id="agreement_type"
              className={selectCls}
              value={fields.agreement_type}
              onChange={(e) => set("agreement_type", e.target.value as "new" | "renewal")}
            >
              <option value="new">New</option>
              <option value="renewal">Renewal</option>
            </select>
          </div>

          <div className="ra-field">
            <label htmlFor="agreement_date" className="ra-label">
              Agreement date
            </label>
            <input
              id="agreement_date"
              type="date"
              className={inputCls}
              value={fields.agreement_date}
              onChange={(e) => set("agreement_date", e.target.value)}
            />
          </div>

          <div className="ra-field">
            <label htmlFor="commencement_date" className="ra-label">
              Commencement date
            </label>
            <input
              id="commencement_date"
              type="date"
              className={inputCls}
              value={fields.commencement_date}
              onChange={(e) => set("commencement_date", e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="ra-form-section">
        <h2 className="ra-form-section-title">Financial terms</h2>
        <div className="ra-form-grid">
          <div className="ra-field">
            <label htmlFor="tenure_months" className="ra-label">
              Tenure (months)
            </label>
            <input
              id="tenure_months"
              type="number"
              className={inputCls}
              value={fields.tenure_months}
              min={1}
              max={132}
              onChange={(e) => set("tenure_months", e.target.value)}
            />
          </div>

          <div className="ra-field">
            <label htmlFor="lock_in_months" className="ra-label">
              Lock-in (months)
            </label>
            <input
              id="lock_in_months"
              type="number"
              className={inputCls}
              value={fields.lock_in_months}
              min={0}
              max={132}
              onChange={(e) => set("lock_in_months", e.target.value)}
            />
          </div>

          <div className="ra-field">
            <label htmlFor="notice_period_months" className="ra-label">
              Notice period (months)
            </label>
            <input
              id="notice_period_months"
              type="number"
              className={inputCls}
              value={fields.notice_period_months}
              min={1}
              max={6}
              onChange={(e) => set("notice_period_months", e.target.value)}
            />
          </div>

          <div className="ra-field">
            <label htmlFor="rent_rupees" className="ra-label">
              Monthly rent (₹)
            </label>
            <input
              id="rent_rupees"
              type="number"
              className={inputCls}
              value={fields.rent_rupees}
              min={1}
              onChange={(e) => set("rent_rupees", e.target.value)}
            />
          </div>

          <div className="ra-field">
            <label htmlFor="deposit_rupees" className="ra-label">
              Security deposit (₹)
            </label>
            <input
              id="deposit_rupees"
              type="number"
              className={inputCls}
              value={fields.deposit_rupees}
              min={0}
              onChange={(e) => set("deposit_rupees", e.target.value)}
            />
          </div>

          <div className="ra-field">
            <label htmlFor="annual_increment_pct" className="ra-label">
              Annual increment (%)
            </label>
            <input
              id="annual_increment_pct"
              type="number"
              className={inputCls}
              value={fields.annual_increment_pct}
              min={0}
              max={100}
              step="0.01"
              onChange={(e) => set("annual_increment_pct", e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="ra-form-section">
        <h2 className="ra-form-section-title">Registration</h2>
        <div className="ra-form-grid">
          <div className="ra-field">
            <label htmlFor="state_code" className="ra-label">
              State
            </label>
            <select
              id="state_code"
              className={selectCls}
              value={fields.state_code}
              onChange={(e) => set("state_code", e.target.value)}
            >
              {STATE_OPTIONS.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div className="ra-field">
            <label htmlFor="city" className="ra-label">
              City
            </label>
            <input
              id="city"
              type="text"
              className={inputCls}
              value={fields.city}
              minLength={2}
              onChange={(e) => set("city", e.target.value)}
            />
          </div>

          <div className="ra-field-full">
            <div className="ra-checkbox-row">
              <input
                id="acknowledge_registration_required"
                type="checkbox"
                checked={fields.acknowledge_registration_required}
                onChange={(e) => set("acknowledge_registration_required", e.target.checked)}
                aria-required={registrationRequired ? "true" : undefined}
              />
              <label htmlFor="acknowledge_registration_required" className="ra-label">
                Acknowledge registration required
              </label>
            </div>
            <p className="ra-hint">
              Required for tenures over 11 months. Agreements longer than 11 months must be
              registered.
            </p>
          </div>
        </div>
      </section>

      <button type="submit" disabled={props.busy} className="ra-button">
        {props.busy ? "Submitting…" : "Save and continue"}
        <span className="sr-only">Advance</span>
      </button>
    </form>
  );
}
