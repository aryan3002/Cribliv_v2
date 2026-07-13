import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, LayoutGrid } from "lucide-react";
import { auth } from "@/auth";
import PgBedGrid from "@/components/pg-operator/ops/PgBedGrid";
import PgOccupancySummary from "@/components/pg-operator/ops/PgOccupancySummary";
import {
  getManagedProperty,
  getOccupancySummary,
  getPropertyLayout
} from "@/lib/pg-operations-api";
import type { PgOccupancySummary as PgOccupancySummaryData } from "@cribliv/shared-types";
import styles from "./pg-operations.module.css";

export const dynamic = "force-dynamic";

function emptySummary(propertyId: string): PgOccupancySummaryData {
  return {
    property_id: propertyId,
    total_beds: 0,
    vacant_beds: 0,
    reserved_beds: 0,
    occupied_beds: 0,
    blocked_beds: 0,
    inactive_beds: 0,
    occupancy_percent: 0,
    by_status: { vacant: 0, reserved: 0, occupied: 0, blocked: 0, inactive: 0 },
    by_floor: [],
    upcoming_move_ins: [],
    upcoming_move_outs: [],
    available_from: []
  };
}

export default async function Page({ params }: { params: { locale: string; propertyId: string } }) {
  const s = await auth();
  if (s?.user?.role !== "pg_operator") redirect(`/${params.locale}/pg-operator/become`);
  const token = (s as any)?.accessToken;

  const property = await getManagedProperty(params.propertyId, token).catch(() => null);
  if (!property) redirect(`/${params.locale}/pg-operator/dashboard`);

  const [summary, rooms] = await Promise.all([
    getOccupancySummary(params.propertyId, token).catch(() => emptySummary(params.propertyId)),
    getPropertyLayout(params.propertyId, token).catch(() => [])
  ]);

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
          <Link
            href={`/${params.locale}/pg-operator/properties/${params.propertyId}/layout` as any}
            className={styles.layoutLink}
          >
            <LayoutGrid size={16} aria-hidden="true" /> Edit layout
          </Link>
        </header>
        <PgOccupancySummary summary={summary} />
        <section className={styles.inventory}>
          <div className={styles.sectionHeading}>
            <h2>Bed inventory</h2>
            <span>{summary.vacant_beds} available now</span>
          </div>
          <PgBedGrid propertyId={params.propertyId} token={token} rooms={rooms} />
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
