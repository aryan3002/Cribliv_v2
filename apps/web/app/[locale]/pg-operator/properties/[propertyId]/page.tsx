import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, LayoutGrid, Users } from "lucide-react";
import { auth } from "@/auth";
import PgBedGrid from "@/components/pg-operator/ops/PgBedGrid";
import PgOccupancySummary from "@/components/pg-operator/ops/PgOccupancySummary";
import {
  getManagedProperty,
  getOccupancySummary,
  getPropertyInventory
} from "@/lib/pg-operations-api";
import styles from "./pg-operations.module.css";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: { locale: string; propertyId: string } }) {
  const s = await auth();
  if (s?.user?.role !== "pg_operator") redirect(`/${params.locale}/pg-operator/become`);
  const token = (s as any)?.accessToken;

  const data = await Promise.all([
    getManagedProperty(params.propertyId, token),
    getOccupancySummary(params.propertyId, token),
    getPropertyInventory(params.propertyId, token)
  ])
    .then(([property, summary, rooms]) => (property ? { property, summary, rooms } : null))
    .catch(() => null);

  if (!data) {
    return (
      <main className={styles.page}>
        <div className={styles.inner}>
          <Link href={`/${params.locale}/pg-operator/dashboard`} className={styles.back}>
            <ArrowLeft size={15} aria-hidden="true" /> Dashboard
          </Link>
          <section role="alert" className={styles.loadError}>
            <h1>Could not load this property</h1>
            <p>Occupancy and bed inventory are unavailable. Refresh the page to try again.</p>
          </section>
        </div>
      </main>
    );
  }

  const { property, summary, rooms } = data;

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <Link href={`/${params.locale}/pg-operator/dashboard`} className={styles.back}>
          <ArrowLeft size={15} aria-hidden="true" /> Dashboard
        </Link>
        <header className={styles.header}>
          <div>
            <h1>{property.display_name}</h1>
            <p>
              {property.room_count} rooms, {property.bed_count} active beds
            </p>
          </div>
          <div className={styles.headerActions}>
            <Link
              href={`/${params.locale}/pg-operator/properties/${params.propertyId}/tenants` as any}
              className={styles.secondaryLink}
            >
              <Users size={16} aria-hidden="true" /> Tenants
            </Link>
            <Link
              href={`/${params.locale}/pg-operator/properties/${params.propertyId}/layout` as any}
              className={styles.layoutLink}
            >
              <LayoutGrid size={16} aria-hidden="true" /> Edit layout
            </Link>
          </div>
        </header>
        <PgOccupancySummary summary={summary} />
        <section className={styles.inventory}>
          <div className={styles.sectionHeading}>
            <h2>Bed inventory</h2>
            <span>{summary.vacant_beds} available now</span>
          </div>
          <PgBedGrid
            propertyId={params.propertyId}
            token={token}
            rooms={rooms}
            assignmentHrefBase={`/${params.locale}/pg-operator/properties/${params.propertyId}/tenants`}
          />
        </section>
        <section className={styles.upcoming}>
          <div>
            <h2>Upcoming move-ins</h2>
            {summary.upcoming_move_ins.length === 0 ? (
              <p>No upcoming move-ins.</p>
            ) : (
              <ul>
                {summary.upcoming_move_ins.map((item) => (
                  <li key={item.bed_id}>
                    {item.room_number} / Bed {item.bed_label} - {item.date}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h2>Upcoming move-outs</h2>
            {summary.upcoming_move_outs.length === 0 ? (
              <p>No upcoming move-outs.</p>
            ) : (
              <ul>
                {summary.upcoming_move_outs.map((item) => (
                  <li key={item.bed_id}>
                    {item.room_number} / Bed {item.bed_label} - {item.date}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
