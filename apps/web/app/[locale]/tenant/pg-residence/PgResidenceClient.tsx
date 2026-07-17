"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, type BadgeTone } from "@cribliv/ui";
import type {
  PgMaintenanceLocation,
  PgMaintenanceRequest,
  PgTenantResidence
} from "@cribliv/shared-types";
import { Check, X } from "lucide-react";
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

const TABS = ["Overview", "Money", "Food & Rules", "Notice", "Maintenance"] as const;
type ResidenceTab = (typeof TABS)[number];

function tabId(tab: ResidenceTab): string {
  return `residence-tab-${tab.toLowerCase().replaceAll(/[^a-z]+/g, "-")}`;
}

function panelId(tab: ResidenceTab): string {
  return `residence-panel-${tab.toLowerCase().replaceAll(/[^a-z]+/g, "-")}`;
}

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

function currentMaintenanceLocation(residence: PgTenantResidence): PgMaintenanceLocation {
  return {
    property_id: residence.property_id,
    property_name: residence.property_name,
    room_id: residence.room_id,
    room_number: residence.room_number,
    room_label: residence.room_number,
    floor: residence.floor,
    bed_id: residence.bed_id,
    bed_label: residence.bed_label,
    tenant_name: null,
    tenant_phone_e164: null
  };
}

export default function PgResidenceClient({
  initialResidence,
  initialMaintenance,
  maintenanceLoadError,
  maintenanceHistoryEnabled,
  token
}: {
  initialResidence: PgTenantResidence | null;
  initialMaintenance: PgMaintenanceRequest[];
  maintenanceLoadError: string | null;
  maintenanceHistoryEnabled: boolean;
  token: string;
}) {
  const router = useRouter();
  const [residence, setResidence] = useState(initialResidence);

  useEffect(() => {
    setResidence(initialResidence);
  }, [initialResidence]);

  const [activeTab, setActiveTab] = useState<ResidenceTab>("Overview");
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
      <div className={styles.stack}>
        <section className={styles.empty}>
          <h2>No active PG residence</h2>
          <p>Your tenant account is not mapped to an active or reserved PG bed.</p>
        </section>
        {maintenanceHistoryEnabled ? (
          <section
            className={`${styles.panel} ${styles.maintenanceHistoryPanel}`}
            aria-labelledby="past-stay-maintenance-heading"
          >
            <h2 id="past-stay-maintenance-heading" className={styles.panelHeading}>
              Past-stay maintenance
            </h2>
            {maintenanceLoadError ? (
              <p role="alert" className={styles.error}>
                {maintenanceLoadError}
              </p>
            ) : initialMaintenance.length > 0 ? (
              <MaintenanceWorkspace
                compact
                readOnly
                initialRequests={initialMaintenance}
                mode="tenant"
                token={token}
              />
            ) : (
              <p className={styles.historyEmpty}>
                Past stay maintenance is available for recent stays only. No historical tickets are
                available.
              </p>
            )}
          </section>
        ) : null}
      </div>
    );
  }

  const rules = ruleRows(residence);
  const maintenanceLocation = currentMaintenanceLocation(residence);
  const canServeNotice = residence.assignment_status === "active";
  const canRequestMoveOut = residence.assignment_status === "active";
  const canRespondToOperator = Boolean(residence.operator_move_out_request_id);
  const noticeEnd = residence.notice_end_date
    ? `Ends ${residence.notice_end_date}${
        residence.notice_days_remaining !== null
          ? ` / ${residence.notice_days_remaining} days remaining`
          : ""
      }`
    : "Not served";

  return (
    <div className={styles.stack}>
      <section className={styles.commandStrip} aria-label="Current residence">
        <div className={styles.propertySummary}>
          <span>Current residence</span>
          <strong>{residence.property_name}</strong>
          <p>
            Room {residence.room_number} / Bed {residence.bed_label}
          </p>
        </div>
        <div className={styles.commandFact}>
          <span>Status</span>
          <Badge tone={STATUS_TONE[residence.assignment_status]}>
            {title(residence.assignment_status)}
          </Badge>
        </div>
        <div className={styles.commandFact}>
          <span>Monthly rent</span>
          <strong>{rupees(residence.monthly_rent_paise)}</strong>
        </div>
        <div className={styles.commandFact}>
          <span>Notice</span>
          <strong>{noticeEnd}</strong>
        </div>
        <div className={`${styles.commandFact} ${styles.operatorCommand}`}>
          <span>Operator</span>
          <strong>{value(residence.operator_contact.name)}</strong>
          {residence.operator_contact.phone_e164 ? (
            <a href={`tel:${residence.operator_contact.phone_e164}`}>
              {residence.operator_contact.phone_e164}
            </a>
          ) : null}
        </div>
      </section>

      <div className={styles.tabBar} role="tablist" aria-label="Residence sections">
        {TABS.map((tab) => (
          <button
            key={tab}
            id={tabId(tab)}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={panelId(tab)}
            className={styles.tab}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <section
        id={panelId("Overview")}
        role="tabpanel"
        aria-labelledby={tabId("Overview")}
        className={styles.panel}
        hidden={activeTab !== "Overview"}
      >
        <dl className={styles.factGrid}>
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
            <dt>Assignment status</dt>
            <dd>{title(residence.assignment_status)}</dd>
          </div>
          <div>
            <dt>Monthly rent</dt>
            <dd>{rupees(residence.monthly_rent_paise)}</dd>
          </div>
          <div>
            <dt>Notice</dt>
            <dd>{noticeEnd}</dd>
          </div>
          <div className={styles.operatorTile}>
            <dt>Operator</dt>
            <dd>
              {value(residence.operator_contact.name)}
              {residence.operator_contact.phone_e164 ? (
                <a href={`tel:${residence.operator_contact.phone_e164}`}>
                  {residence.operator_contact.phone_e164}
                </a>
              ) : null}
            </dd>
          </div>
        </dl>
      </section>

      <section
        id={panelId("Money")}
        role="tabpanel"
        aria-labelledby={tabId("Money")}
        className={styles.panel}
        hidden={activeTab !== "Money"}
      >
        <div className={styles.rentEmphasis}>
          <span>Monthly rent</span>
          <strong>{rupees(residence.monthly_rent_paise)}</strong>
        </div>
        <dl className={styles.secondaryFacts}>
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
            <dt>Lock-in period</dt>
            <dd>
              {residence.lock_in_months === null ? "Not set" : `${residence.lock_in_months} months`}
            </dd>
          </div>
        </dl>
      </section>

      <section
        id={panelId("Food & Rules")}
        role="tabpanel"
        aria-labelledby={tabId("Food & Rules")}
        className={styles.panel}
        hidden={activeTab !== "Food & Rules"}
      >
        <div className={styles.foodPlan}>
          <span>Food plan</span>
          <strong>{foodLabel(residence)}</strong>
        </div>
        <div className={styles.rules}>
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
      </section>

      <section
        id={panelId("Notice")}
        role="tabpanel"
        aria-labelledby={tabId("Notice")}
        className={styles.panel}
        hidden={activeTab !== "Notice"}
      >
        <div className={styles.notice}>
          <div className={styles.noticeState}>
            <span>Notice status</span>
            <strong>{title(residence.assignment_status)}</strong>
            <p>{noticeEnd}</p>
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
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
        </div>
      </section>

      <section
        id={panelId("Maintenance")}
        role="tabpanel"
        aria-labelledby={tabId("Maintenance")}
        className={`${styles.panel} ${styles.maintenancePanel}`}
        hidden={activeTab !== "Maintenance"}
      >
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
          currentResidenceLocation={maintenanceLocation}
        />
      </section>
    </div>
  );
}
