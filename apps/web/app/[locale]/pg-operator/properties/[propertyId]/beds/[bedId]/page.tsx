import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ClipboardList, Users, Wrench } from "lucide-react";
import { Badge } from "@cribliv/ui";
import { auth } from "@/auth";
import MaintenanceWorkspace from "@/components/pg-operator/ops/MaintenanceWorkspace";
import { getOperatorBedDetail, listBedMaintenance } from "@/lib/pg-operations-api";
import styles from "./bed-detail.module.css";

export const dynamic = "force-dynamic";

function statusText(value: string): string {
  if (value === "active") return "moved in";
  return value.replaceAll("_", " ");
}

function money(value: number | null): string {
  if (value == null) return "Not set";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(value / 100);
}

function dateText(value: string | null): string {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(`${value}T00:00:00`));
}

export default async function Page({
  params
}: {
  params: { locale: string; propertyId: string; bedId: string };
}) {
  const s = await auth();
  if (s?.user?.role !== "pg_operator") redirect(`/${params.locale}/pg-operator/become`);
  const token = (s as any)?.accessToken;

  const [detail, maintenance] = await Promise.all([
    getOperatorBedDetail(params.propertyId, params.bedId, token).catch(() => null),
    listBedMaintenance(params.propertyId, params.bedId, token).catch(() => null)
  ]);

  if (!detail) {
    return (
      <main className={styles.page}>
        <div className={styles.inner}>
          <Link
            href={`/${params.locale}/pg-operator/properties/${params.propertyId}` as any}
            className={styles.back}
          >
            <ArrowLeft size={15} aria-hidden="true" /> Property
          </Link>
          <section role="alert" className={styles.loadError}>
            <h1>Could not load this bed</h1>
            <p>The bed record is unavailable. Refresh the page to try again.</p>
          </section>
        </div>
      </main>
    );
  }

  const assignment = detail.assignment;
  const statusTone =
    detail.bed.status === "occupied" || detail.bed.status === "vacant" ? "verified" : "pending";

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <Link
          href={`/${params.locale}/pg-operator/properties/${params.propertyId}` as any}
          className={styles.back}
        >
          <ArrowLeft size={15} aria-hidden="true" /> {detail.property_name}
        </Link>

        <header className={styles.header}>
          <div>
            <h1>
              {detail.room.display_label || detail.room.room_number} / Bed {detail.bed.bed_label}
            </h1>
            <p>
              Room {detail.room.room_number}
              {detail.room.floor == null ? "" : `, floor ${detail.room.floor}`}
            </p>
          </div>
          <div className={styles.headerActions}>
            <Badge tone={statusTone}>{detail.bed.status}</Badge>
            <Link
              href={
                `/${params.locale}/pg-operator/properties/${params.propertyId}/tenants?bedId=${encodeURIComponent(
                  params.bedId
                )}&mode=${detail.bed.status === "reserved" ? "move-in" : "reserve"}` as any
              }
              className={styles.primaryLink}
            >
              <Users size={16} aria-hidden="true" /> Manage tenant
            </Link>
          </div>
        </header>

        <section className={styles.grid}>
          <article className={styles.panel}>
            <h2>Current stay</h2>
            {assignment ? (
              <dl className={styles.details}>
                <div>
                  <dt>Tenant</dt>
                  <dd>{assignment.occupant_name}</dd>
                </div>
                <div>
                  <dt>Phone</dt>
                  <dd>{assignment.occupant_phone_e164}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{statusText(assignment.status)}</dd>
                </div>
                <div>
                  <dt>Move-in</dt>
                  <dd>{dateText(assignment.move_in_date ?? assignment.expected_move_in_date)}</dd>
                </div>
                <div>
                  <dt>Monthly rent</dt>
                  <dd>{money(assignment.monthly_rent_paise)}</dd>
                </div>
                <div>
                  <dt>Deposit</dt>
                  <dd>{money(assignment.security_deposit_paise)}</dd>
                </div>
                <div>
                  <dt>Notice end</dt>
                  <dd>{dateText(assignment.notice_end_date)}</dd>
                </div>
                <div>
                  <dt>Move-out</dt>
                  <dd>{dateText(assignment.move_out_date)}</dd>
                </div>
              </dl>
            ) : (
              <div className={styles.empty}>No live assignment is linked to this bed.</div>
            )}
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHeading}>
              <h2>Maintenance</h2>
              <Link
                href={
                  `/${params.locale}/pg-operator/properties/${params.propertyId}/maintenance?bedId=${encodeURIComponent(
                    params.bedId
                  )}` as any
                }
                className={styles.maintenanceLink}
              >
                <Wrench size={15} aria-hidden="true" /> Full queue
              </Link>
            </div>
            <dl className={styles.details}>
              <div>
                <dt>Open tickets</dt>
                <dd>{detail.maintenance_summary.open_items}</dd>
              </div>
              <div>
                <dt>All tickets</dt>
                <dd>{maintenance?.length ?? "Unavailable"}</dd>
              </div>
            </dl>
          </article>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <h2>Latest maintenance tickets</h2>
            <Wrench size={17} aria-hidden="true" />
          </div>
          {maintenance === null ? (
            <p role="alert" className={styles.note}>
              Could not load maintenance tickets for this bed. Refresh the page to try again.
            </p>
          ) : (
            <MaintenanceWorkspace
              compact
              initialRequests={maintenance}
              mode="operator"
              propertyId={params.propertyId}
              token={token}
            />
          )}
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <h2>Assignment history</h2>
            <ClipboardList size={17} aria-hidden="true" />
          </div>
          {detail.events.length === 0 ? (
            <div className={styles.empty}>No assignment events recorded for this bed.</div>
          ) : (
            <ol className={styles.timeline}>
              {detail.events.map((event) => (
                <li key={event.id}>
                  <span>{statusText(event.event_type)}</span>
                  <strong>
                    {statusText(event.from_status ?? "new")} to {statusText(event.to_status)}
                  </strong>
                  <time dateTime={event.created_at}>
                    {new Intl.DateTimeFormat("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit"
                    }).format(new Date(event.created_at))}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </main>
  );
}
