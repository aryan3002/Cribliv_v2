"use client";
import {
  ScrollText,
  Cigarette,
  Wine,
  Drumstick,
  PawPrint,
  ChefHat,
  FileSignature,
  Zap,
  Wallet
} from "lucide-react";
import type { PgWizardState, PgWizardAction } from "@/lib/pg-wizard-state";
import SectionCard from "../shared/SectionCard";
import SegmentedControl from "../shared/SegmentedControl";
import ChipMultiSelect from "../shared/ChipMultiSelect";
import TimeRange from "../shared/TimeRange";
import Disclosure from "../shared/Disclosure";
import RupeeInput from "../shared/RupeeInput";

const RULE_FLAGS = [
  { value: "smoking", label: "Smoking", icon: <Cigarette size={15} /> },
  { value: "alcohol", label: "Alcohol", icon: <Wine size={15} /> },
  { value: "non_veg", label: "Non-veg", icon: <Drumstick size={15} /> },
  { value: "pets", label: "Pets", icon: <PawPrint size={15} /> },
  { value: "cooking_in_room", label: "Cooking in room", icon: <ChefHat size={15} /> }
];

export default function PgRulesAgreementStep({
  state,
  dispatch
}: {
  state: PgWizardState;
  dispatch: (a: PgWizardAction) => void;
  locale: string;
}) {
  const d = (state.draft.pg_details ?? {}) as any;
  const r = (d.house_rules ?? {}) as Record<string, unknown>;
  const setF = (path: string, value: unknown) => dispatch({ type: "SET_FIELD", path, value });

  const applyStandard = () =>
    setF("pg_details.house_rules", {
      smoking: false,
      alcohol: false,
      non_veg: true,
      pets: false,
      cooking_in_room: false
    });

  const allowed = RULE_FLAGS.filter((f) => r[f.value] === true).map((f) => f.value);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <SectionCard
        title="House rules"
        subtitle="Tap what's allowed on the property."
        icon={<ScrollText size={20} />}
        action={
          <button type="button" className="pgo-btn pgo-btn--secondary" onClick={applyStandard}>
            Apply standard PG rules
          </button>
        }
      >
        <ChipMultiSelect
          label="What's allowed?"
          value={allowed}
          options={RULE_FLAGS}
          onChange={(vals) => {
            const set = new Set(vals);
            RULE_FLAGS.forEach((f) => setF(`pg_details.house_rules.${f.value}`, set.has(f.value)));
          }}
        />

        <TimeRange
          label="Quiet hours"
          from={(r.quiet_hours as any)?.from ?? "22:00"}
          to={(r.quiet_hours as any)?.to ?? "06:00"}
          onChange={(v) => setF("pg_details.house_rules.quiet_hours", v)}
        />
      </SectionCard>

      <SectionCard
        title="Agreement & payment"
        subtitle="Deposit, notice period and billing."
        icon={<FileSignature size={20} />}
      >
        <RupeeInput
          label="Security deposit"
          valuePaise={d.security_deposit_paise ?? null}
          onChangePaise={(p) => setF("pg_details.security_deposit_paise", p)}
        />

        <SegmentedControl
          label="Notice period"
          value={d.notice_period_days != null ? String(d.notice_period_days) : undefined}
          options={[
            { value: "15", label: "15 days" },
            { value: "30", label: "30 days" },
            { value: "60", label: "60 days" }
          ]}
          onChange={(v) => setF("pg_details.notice_period_days", Number(v))}
        />

        <div>
          <span style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            <Zap size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            Electricity billing
          </span>
          <SegmentedControl
            value={d.electricity_mode ?? undefined}
            options={[
              { value: "flat", label: "Flat" },
              { value: "submetered", label: "Sub-metered" },
              { value: "split_equally", label: "Split" }
            ]}
            onChange={(v) => setF("pg_details.electricity_mode", v)}
          />
        </div>

        <Disclosure summary="Add payment & lock-in details">
          <SegmentedControl
            label="Lock-in period"
            value={d.lock_in_months != null ? String(d.lock_in_months) : undefined}
            options={["0", "1", "2", "3", "6"].map((value) => ({
              value,
              label: value === "0" ? "None" : `${value} mo`
            }))}
            onChange={(v) => setF("pg_details.lock_in_months", Number(v))}
          />
          <ChipMultiSelect
            label="Payment modes"
            value={(d.payment_modes as string[]) ?? []}
            options={[
              { value: "upi", label: "UPI", icon: <Wallet size={15} /> },
              { value: "bank_transfer", label: "Bank transfer" },
              { value: "cash", label: "Cash" }
            ]}
            onChange={(v) => setF("pg_details.payment_modes", v)}
          />
          <SegmentedControl
            label="Rent due day"
            value={d.rent_due_day != null ? String(d.rent_due_day) : undefined}
            options={[
              { value: "1", label: "1st" },
              { value: "5", label: "5th" },
              { value: "10", label: "10th" }
            ]}
            onChange={(v) => setF("pg_details.rent_due_day", Number(v))}
          />
          <SegmentedControl
            label="Rent negotiable?"
            value={d.price_negotiable ? "yes" : "no"}
            options={[
              { value: "no", label: "Fixed" },
              { value: "yes", label: "Negotiable" }
            ]}
            onChange={(v) => setF("pg_details.price_negotiable", v === "yes")}
          />
        </Disclosure>
      </SectionCard>
    </div>
  );
}
