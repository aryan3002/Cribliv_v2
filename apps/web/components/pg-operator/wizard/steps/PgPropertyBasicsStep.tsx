"use client";
import { Dispatch } from "react";
import { Building2, BedDouble, GraduationCap, Briefcase, Users } from "lucide-react";
import { PgWizardState, PgWizardAction } from "@/lib/pg-wizard-state";
import SectionCard from "../shared/SectionCard";
import SegmentedControl from "../shared/SegmentedControl";
import PresetCard from "../shared/PresetCard";
import Stepper from "../shared/Stepper";
import styles from "../shared/pg-wizard.module.css";

interface Props {
  state: PgWizardState;
  dispatch: Dispatch<PgWizardAction>;
  locale: string;
  accessToken: string | null;
}

const TENANTS = [
  { value: "students", label: "Students", icon: <GraduationCap size={22} /> },
  { value: "working", label: "Working", icon: <Briefcase size={22} /> },
  { value: "any", label: "Any", icon: <Users size={22} /> }
] as const;

export default function PgPropertyBasicsStep({ state, dispatch }: Props) {
  const d = state.draft;
  const setF = (path: string, value: unknown) => dispatch({ type: "SET_FIELD", path, value });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <SectionCard
        title="Property identity"
        subtitle="What tenants will see first."
        icon={<Building2 size={20} />}
      >
        <div>
          <span className={styles.fieldLabel}>Property name</span>
          <input
            className={styles.textInput}
            aria-label="property name"
            value={d.property?.display_name ?? ""}
            onChange={(e) => setF("property.display_name", e.target.value)}
            placeholder="e.g. Sunrise Residency"
          />
        </div>

        <SegmentedControl
          label="Who is it for?"
          value={d.pg_details?.gender_policy ?? undefined}
          options={[
            { value: "boys", label: "Boys" },
            { value: "girls", label: "Girls" },
            { value: "coed", label: "Co-ed" }
          ]}
          onChange={(v) => setF("pg_details.gender_policy", v)}
        />

        <div>
          <span className={styles.fieldLabel}>Tenant type</span>
          <div className={styles.presetGrid}>
            {TENANTS.map((t) => (
              <PresetCard
                key={t.value}
                title={t.label}
                icon={<span className={styles.presetIcon}>{t.icon}</span>}
                selected={d.pg_details?.tenant_type === t.value}
                onSelect={() => setF("pg_details.tenant_type", t.value)}
              />
            ))}
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Capacity"
        subtitle="Total beds and building size."
        icon={<BedDouble size={20} />}
      >
        <div className={styles.row2}>
          <Stepper
            label="Total beds"
            value={d.pg_details?.total_beds ?? 0}
            min={0}
            onChange={(v) => setF("pg_details.total_beds", v)}
          />
          <Stepper
            label="Total floors"
            value={d.property?.total_floors ?? 0}
            min={0}
            max={99}
            onChange={(v) => setF("property.total_floors", v)}
          />
        </div>
      </SectionCard>
    </div>
  );
}
