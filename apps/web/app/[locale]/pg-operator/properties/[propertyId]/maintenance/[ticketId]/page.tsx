import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import MaintenanceTicketPageClient from "@/components/pg-operator/ops/maintenance/MaintenanceTicketPageClient";
import { isPgMaintenanceOpsV2Enabled } from "@/lib/pg-maintenance-ops-v2-flag";
import {
  fetchMaintenanceTimeline,
  getMaintenanceTicket,
  getManagedProperty
} from "@/lib/pg-operations-api";
import styles from "../../pg-operations.module.css";

export const dynamic = "force-dynamic";

export default async function Page({
  params
}: {
  params: { locale: string; propertyId: string; ticketId: string };
}) {
  const session = await auth();
  if (session?.user?.role !== "pg_operator") redirect(`/${params.locale}/pg-operator/become`);
  const token = (session as any)?.accessToken;
  const maintenanceHref = `/${params.locale}/pg-operator/properties/${params.propertyId}/maintenance`;
  if (!isPgMaintenanceOpsV2Enabled()) redirect(maintenanceHref);

  const data = await Promise.all([
    getManagedProperty(params.propertyId, token),
    getMaintenanceTicket(params.propertyId, params.ticketId, token)
  ])
    .then(async ([property, ticket]) => {
      if (!property) return null;
      const timeline = await fetchMaintenanceTimeline(
        params.propertyId,
        params.ticketId,
        token
      ).catch(() => ticket.timeline ?? []);
      return { property, ticket: { ...ticket, timeline } };
    })
    .catch(() => null);

  if (!data) {
    return (
      <main className={styles.page}>
        <div className={styles.inner}>
          <Link href={maintenanceHref as any} className={styles.back}>
            <ArrowLeft size={15} aria-hidden="true" /> Maintenance
          </Link>
          <section role="alert" className={styles.loadError}>
            <h1>Could not load ticket</h1>
            <p>Maintenance ticket details are unavailable. Refresh the page to try again.</p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <Link href={maintenanceHref as any} className={styles.back}>
          <ArrowLeft size={15} aria-hidden="true" /> Maintenance
        </Link>
        <header className={styles.header}>
          <div>
            <h1>Maintenance ticket</h1>
            <p>{data.property.display_name}</p>
          </div>
        </header>
        <MaintenanceTicketPageClient
          initialRequest={data.ticket}
          propertyId={params.propertyId}
          token={token ?? ""}
        />
      </div>
    </main>
  );
}
