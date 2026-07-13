"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, type BadgeTone } from "@cribliv/ui";
import type { PgMaintenanceRequest, PgTenantResidence } from "@cribliv/shared-types";
import { CalendarDays, Check, Home, IndianRupee, Utensils, Wrench, X } from "lucide-react";
import SectionCard from "@/components/pg-operator/wizard/shared/SectionCard";
import MaintenanceWorkspace from "@/components/pg-operator/ops/MaintenanceWorkspace";
import {
  acceptTenantOperatorMoveOut,
  rejectTenantOperatorMoveOut,
  requestTenantMoveOut,
  serveTenantNotice
} from "@/lib/pg-operations-api";
import styles from "./pg-residence.module.css";

const STATUS_TONE: Record<PgTenantResidence["assignment_status"], BadgeTone> = {
  reserved: "pending",
  active: "verified",
  notice_served: "brand",
  move_out_requested: "pending",
  move_out_pending_confirmation: "pending",
  moved_out: "neutral",
  cancelled: "neutral"
};

function rupees(value: number | null): string {
  if (value === null) return "Not set";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(value / 100);
}

function title(value: string): string {
  return value.replaceAll("_", " ");
}

function value(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "Not set";
  return String(value);
}

function foodLabel(residence: PgTenantResidence): string {
  const plan = residence.food_plan;
  if (!plan?.provided) return "Not included";
  const meals = [
    plan.breakfast ? "Breakfast" : null,
    plan.lunch ? "Lunch" : null,
    plan.snack ? "Snack" : null,
    plan.dinner ? "Dinner" : null
  ].filter(Boolean);
  return meals.length > 0 ? meals.join(", ") : "Included";
}

function ruleRows(residence: PgTenantResidence): string[] {
  const rules = residence.house_rules ?? {};
  return [
    typeof rules.guests_policy === "string" ? `Guests: ${rules.guests_policy}` : null,
    typeof rules.curfew_time === "string" ? `Curfew: ${rules.curfew_time}` : null,
    rules.smoking === false ? "No smoking" : null,
    rules.alcohol === false ? "No alcohol" : null,
    rules.non_veg === false ? "No non-veg" : null,
    rules.pets === false ? "No pets" : null,
    rules.cooking_in_room === false ? "No cooking in room" : null
  ].filter((item): item is string => Boolean(item));
}

export default function PgResidenceClient({
  initialResidence,
  initialMaintenance,
  maintenanceLoadError,
  token
}: {
  initialResidence: PgTenantResidence | null;
  initialMaintenance: PgMaintenanceRequest[];
  maintenanceLoadError: string | null;
  token: string;
}) {
  const router = useRouter();
  const [residence, setResidence] = useState(initialResidence);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "notice" | "request" | "accept" | "reject") {
    if (!residence) return;
    setPending(action);
    setError(null);
    try {
      const next =
        action === "notice"
          ? await serveTenantNotice(token)
          : action === "request"
            ? await requestTenantMoveOut(token)
            : action === "accept" && residence.operator_move_out_request_id
              ? await acceptTenantOperatorMoveOut(residence.operator_move_out_request_id, token)
              : action === "reject" && residence.operator_move_out_request_id
                ? await rejectTenantOperatorMoveOut(residence.operator_move_out_request_id, token)
                : residence;
      setResidence(next.assignment_status === "moved_out" ? null : next);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update your residence.");
    } finally {
      setPending(null);
    }
  }

  if (!residence) {
    return (
      <section className={styles.empty}>
        <h2>No active PG residence</h2>
        <p>Your tenant account is not mapped to an active or reserved PG bed.</p>
      </section>
    );
  }

  const rules = ruleRows(residence);
  const canServeNotice = residence.assignment_status === "active";
  const canRequestMoveOut = residence.assignment_status === "active";
  const canRespondToOperator = Boolean(residence.operator_move_out_request_id);

  return (
    <div className={styles.stack}>
      <SectionCard
        title="My Stay"
        icon={<Home size={18} aria-hidden="true" />}
        action={
          <Badge tone={STATUS_TONE[residence.assignment_status]}>
            {title(residence.assignment_status)}
          </Badge>
        }
      >
        <dl className={styles.grid}>
          <div>
            <dt>Property</dt>
            <dd>{residence.property_name}</dd>
          </div>
          <div>
            <dt>Room</dt>
            <dd>{residence.room_number}</dd>
          </div>
          <div>
            <dt>Bed</dt>
            <dd>{residence.bed_label}</dd>
          </div>
          <div>
            <dt>Sharing</dt>
            <dd>{value(residence.sharing)}</dd>
          </div>
          <div>
            <dt>Move-in</dt>
            <dd>{value(residence.move_in_date ?? residence.expected_move_in_date)}</dd>
          </div>
          <div>
            <dt>Operator</dt>
            <dd>
              {value(residence.operator_contact.name)}
              {residence.operator_contact.phone_e164 ? (
                <span className={styles.subValue}>{residence.operator_contact.phone_e164}</span>
              ) : null}
            </dd>
          </div>
        </dl>
      </SectionCard>

      <SectionCard title="Money" icon={<IndianRupee size={18} aria-hidden="true" />}>
        <dl className={styles.grid}>
          <div>
            <dt>Monthly rent</dt>
            <dd>{rupees(residence.monthly_rent_paise)}</dd>
          </div>
          <div>
            <dt>Security deposit</dt>
            <dd>{rupees(residence.security_deposit_paise)}</dd>
          </div>
          <div>
            <dt>Notice period</dt>
            <dd>
              {residence.notice_period_days === null
                ? "Not set"
                : `${residence.notice_period_days} days`}
            </dd>
          </div>
          <div>
            <dt>Lock-in</dt>
            <dd>
              {residence.lock_in_months === null ? "Not set" : `${residence.lock_in_months} months`}
            </dd>
          </div>
        </dl>
      </SectionCard>

      <SectionCard title="Food & Rules" icon={<Utensils size={18} aria-hidden="true" />}>
        <div className={styles.rules}>
          <div>
            <span>Food plan</span>
            <strong>{foodLabel(residence)}</strong>
          </div>
          <div>
            <span>House rules</span>
            {rules.length === 0 ? (
              <strong>Not set</strong>
            ) : (
              <ul>
                {rules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Notice / Move-out" icon={<CalendarDays size={18} aria-hidden="true" />}>
        <div className={styles.notice}>
          <div className={styles.noticeState}>
            <span>Notice status</span>
            <strong>{title(residence.assignment_status)}</strong>
            {residence.notice_end_date ? (
              <span>
                Ends {residence.notice_end_date}
                {residence.notice_days_remaining !== null
                  ? ` · ${residence.notice_days_remaining} days remaining`
                  : ""}
              </span>
            ) : null}
          </div>
          <div className={styles.actions}>
            <Button
              type="button"
              variant="secondary"
              disabled={!canServeNotice || pending !== null}
              onClick={() => void run("notice")}
            >
              Serve notice
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!canRequestMoveOut || pending !== null}
              onClick={() => void run("request")}
            >
              Request move-out
            </Button>
            {canRespondToOperator && (
              <>
                <Button
                  type="button"
                  disabled={pending !== null}
                  onClick={() => void run("accept")}
                >
                  <Check size={16} aria-hidden="true" /> Accept
                </Button>
                <Button
                  type="button"
                  variant="tertiary"
                  disabled={pending !== null}
                  onClick={() => void run("reject")}
                >
                  <X size={16} aria-hidden="true" /> Reject
                </Button>
              </>
            )}
          </div>
          {error && <p className={styles.error}>{error}</p>}
        </div>
      </SectionCard>

      <SectionCard title="Maintenance" icon={<Wrench size={18} aria-hidden="true" />}>
        {maintenanceLoadError && (
          <p role="alert" className={styles.error}>
            {maintenanceLoadError}
          </p>
        )}
        <MaintenanceWorkspace
          compact
          initialRequests={initialMaintenance}
          mode="tenant"
          token={token}
        />
      </SectionCard>
    </div>
  );
}
