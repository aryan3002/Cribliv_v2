import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, LayoutGrid } from "lucide-react";
import { auth } from "@/auth";
import PgAssignmentDrawer from "@/components/pg-operator/ops/PgAssignmentDrawer";
import { getManagedProperty, getPropertyInventory, listAssignments } from "@/lib/pg-operations-api";
import styles from "../pg-operations.module.css";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams
}: {
  params: { locale: string; propertyId: string };
  searchParams?: { bedId?: string; mode?: "reserve" | "move-in" };
}) {
  const s = await auth();
  if (s?.user?.role !== "pg_operator") redirect(`/${params.locale}/pg-operator/become`);
  const token = (s as any)?.accessToken;

  const data = await Promise.all([
    getManagedProperty(params.propertyId, token),
    listAssignments(params.propertyId, token),
    getPropertyInventory(params.propertyId, token)
  ])
    .then(([property, assignments, rooms]) => (property ? { property, assignments, rooms } : null))
    .catch(() => null);

  if (!data) {
    return (
      <main className={styles.page}>
        <div className={styles.inner}>
          <Link
            href={`/${params.locale}/pg-operator/properties/${params.propertyId}` as any}
            className={styles.back}
          >
            <ArrowLeft size={15} aria-hidden="true" /> Operations
          </Link>
          <section role="alert" className={styles.loadError}>
            <h1>Could not load tenants</h1>
            <p>Assignments and inventory are unavailable. Refresh the page to try again.</p>
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
          <ArrowLeft size={15} aria-hidden="true" /> Operations
        </Link>
        <header className={styles.header}>
          <div>
            <h1>Tenants</h1>
            <p>
              {data.property.display_name} - {data.assignments.length} assignments
            </p>
          </div>
          <Link
            href={`/${params.locale}/pg-operator/properties/${params.propertyId}/layout` as any}
            className={styles.layoutLink}
          >
            <LayoutGrid size={16} aria-hidden="true" /> Edit layout
          </Link>
        </header>
        <PgAssignmentDrawer
          propertyId={params.propertyId}
          token={token}
          assignments={data.assignments}
          rooms={data.rooms}
          initialBedId={searchParams?.bedId}
          initialMode={searchParams?.mode}
        />
      </div>
    </main>
  );
}
