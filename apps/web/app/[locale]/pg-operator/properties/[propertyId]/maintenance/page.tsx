import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Wrench } from "lucide-react";
import { auth } from "@/auth";
import MaintenanceWorkspace from "@/components/pg-operator/ops/MaintenanceWorkspace";
import MaintenanceKanban from "@/components/pg-operator/ops/maintenance/MaintenanceKanban";
import MaintenanceQueueList from "@/components/pg-operator/ops/maintenance/MaintenanceQueueList";
import { isPgMaintenanceOpsV2Enabled } from "@/lib/pg-maintenance-ops-v2-flag";
import {
  fetchMaintenanceAnalytics,
  fetchMaintenanceCategories,
  getManagedProperty,
  listBedMaintenance,
  listPropertyMaintenance
} from "@/lib/pg-operations-api";
import styles from "../pg-operations.module.css";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams
}: {
  params: { locale: string; propertyId: string };
  searchParams: { bedId?: string };
}) {
  const session = await auth();
  if (session?.user?.role !== "pg_operator") redirect(`/${params.locale}/pg-operator/become`);
  const token = (session as any)?.accessToken;
  const bedId = typeof searchParams.bedId === "string" ? searchParams.bedId : undefined;
  const maintenanceOpsV2Enabled = isPgMaintenanceOpsV2Enabled();
  const ticketHrefBase = `/${params.locale}/pg-operator/properties/${params.propertyId}/maintenance`;

  const data = bedId
    ? await Promise.all([
        getManagedProperty(params.propertyId, token),
        listBedMaintenance(params.propertyId, bedId, token)
      ])
        .then(([property, requests]) =>
          property ? { mode: "bed" as const, property, requests } : null
        )
        .catch(() => null)
    : !maintenanceOpsV2Enabled
      ? await Promise.all([
          getManagedProperty(params.propertyId, token),
          listPropertyMaintenance(params.propertyId, token, {
            sort: "newest",
            limit: 100,
            include_closed: true
          })
        ])
          .then(([property, page]) =>
            property ? { mode: "workspace" as const, property, requests: page.rows } : null
          )
          .catch(() => null)
      : await Promise.all([
          getManagedProperty(params.propertyId, token),
          fetchMaintenanceCategories(token),
          fetchMaintenanceAnalytics(params.propertyId, token),
          listPropertyMaintenance(params.propertyId, token, {
            sort: "sla_due",
            view: "list",
            limit: 25
          }),
          listPropertyMaintenance(params.propertyId, token, {
            status: "open",
            sort: "sla_due",
            view: "kanban",
            limit: 25
          }),
          listPropertyMaintenance(params.propertyId, token, {
            status: "in_progress",
            sort: "sla_due",
            view: "kanban",
            limit: 25
          }),
          listPropertyMaintenance(params.propertyId, token, {
            status: "waiting_on_tenant",
            sort: "sla_due",
            view: "kanban",
            limit: 25
          }),
          listPropertyMaintenance(params.propertyId, token, {
            status: "resolved",
            sort: "sla_due",
            view: "kanban",
            limit: 25
          })
        ])
          .then(
            ([property, categories, analytics, queuePage, open, inProgress, waiting, resolved]) =>
              property
                ? {
                    mode: "queue" as const,
                    property,
                    categories,
                    analytics,
                    queuePage,
                    kanbanPages: {
                      open,
                      in_progress: inProgress,
                      waiting_on_tenant: waiting,
                      resolved
                    }
                  }
                : null
          )
          .catch(() => null);

  if (!data) {
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
            <h1>Could not load maintenance</h1>
            <p>Maintenance tickets are unavailable. Refresh the page to try again.</p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <Link
          href={`/${params.locale}/pg-operator/properties/${params.propertyId}` as any}
          className={styles.back}
        >
          <ArrowLeft size={15} aria-hidden="true" /> {data.property.display_name}
        </Link>
        <header className={styles.header}>
          <div>
            <h1>Maintenance</h1>
            <p>
              {bedId ? "Tickets for the selected bed" : "Review and update maintenance tickets"}
            </p>
          </div>
          <div className={styles.headerActions}>
            {bedId ? (
              <Link
                href={
                  `/${params.locale}/pg-operator/properties/${params.propertyId}/maintenance` as any
                }
                className={styles.secondaryLink}
              >
                <Wrench size={16} aria-hidden="true" /> All tickets
              </Link>
            ) : null}
          </div>
        </header>
        {data.mode === "bed" ? (
          <MaintenanceWorkspace
            initialRequests={data.requests}
            mode="operator"
            propertyId={params.propertyId}
            token={token}
          />
        ) : data.mode === "workspace" ? (
          <MaintenanceWorkspace
            initialRequests={data.requests}
            mode="operator"
            propertyId={params.propertyId}
            token={token}
          />
        ) : (
          <>
            <MaintenanceQueueList
              propertyId={params.propertyId}
              token={token}
              categories={data.categories}
              analytics={data.analytics}
              initialPage={data.queuePage}
              ticketHrefBase={ticketHrefBase}
            />
            <MaintenanceKanban
              propertyId={params.propertyId}
              token={token}
              initialPage={data.queuePage}
              initialColumnPages={data.kanbanPages}
              ticketHrefBase={ticketHrefBase}
            />
          </>
        )}
      </div>
    </main>
  );
}
