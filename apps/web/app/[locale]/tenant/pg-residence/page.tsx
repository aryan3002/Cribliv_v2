import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import { isPgMaintenanceOpsV2Enabled } from "@/lib/pg-maintenance-ops-v2-flag";
import { getTenantResidence, listResidenceMaintenance } from "@/lib/pg-operations-api";
import PgResidenceClient from "./PgResidenceClient";
import styles from "./pg-residence.module.css";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: { locale: string } }) {
  const session = await auth();
  if (session?.user?.role !== "tenant") {
    redirect(`/${params.locale}/auth/login`);
  }

  const token = session.accessToken;
  const residence = await getTenantResidence(token).catch(() => null);
  const maintenanceOpsV2Enabled = isPgMaintenanceOpsV2Enabled();
  const maintenance = maintenanceOpsV2Enabled
    ? await listResidenceMaintenance(token, "all").catch(() => null)
    : residence
      ? await listResidenceMaintenance(token).catch(() => null)
      : [];

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <Link href={`/${params.locale}/tenant/dashboard`} className={styles.back}>
          <ArrowLeft size={15} aria-hidden="true" /> Dashboard
        </Link>
        <header className={styles.header}>
          <h1>PG residence</h1>
        </header>
        <PgResidenceClient
          initialResidence={residence}
          initialMaintenance={maintenance ?? []}
          maintenanceLoadError={maintenance === null ? "Could not load maintenance tickets." : null}
          maintenanceHistoryEnabled={maintenanceOpsV2Enabled}
          token={token}
        />
      </div>
    </main>
  );
}
