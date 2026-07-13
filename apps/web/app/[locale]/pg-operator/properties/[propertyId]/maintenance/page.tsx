import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Wrench } from "lucide-react";
import { auth } from "@/auth";
import MaintenanceWorkspace from "@/components/pg-operator/ops/MaintenanceWorkspace";
import {
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

  const data = await Promise.all([
    getManagedProperty(params.propertyId, token),
    bedId
      ? listBedMaintenance(params.propertyId, bedId, token)
      : listPropertyMaintenance(params.propertyId, token)
  ])
    .then(([property, requests]) => (property ? { property, requests } : null))
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
        <MaintenanceWorkspace
          initialRequests={data.requests}
          mode="operator"
          propertyId={params.propertyId}
          token={token}
        />
      </div>
    </main>
  );
}
