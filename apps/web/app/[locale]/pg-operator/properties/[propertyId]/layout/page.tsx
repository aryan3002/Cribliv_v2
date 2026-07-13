import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import PgLayoutBuilder, { type RoomTypeOption } from "@/components/pg-operator/ops/PgLayoutBuilder";
import { getManagedProperty, getPropertyLayout } from "@/lib/pg-operations-api";
import styles from "../pg-operations.module.css";

export const dynamic = "force-dynamic";

const sharingLabels = {
  single: "Single",
  double: "Double sharing",
  triple: "Triple sharing",
  quad: "Four sharing",
  dorm: "Dorm"
} as const;

function displayValue(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function formatRent(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(paise / 100);
}

export default async function LayoutPage({
  params
}: {
  params: { locale: string; propertyId: string };
}) {
  const s = await auth();
  if (s?.user?.role !== "pg_operator") redirect(`/${params.locale}/pg-operator/become`);
  const token = (s as any)?.accessToken;

  const property = await getManagedProperty(params.propertyId, token).catch(() => null);
  if (!property) {
    return (
      <main className={styles.page}>
        <div className={styles.inner}>
          <Link href={`/${params.locale}/pg-operator/dashboard`} className={styles.back}>
            <ArrowLeft size={15} aria-hidden="true" /> Dashboard
          </Link>
          <section role="alert" className={styles.loadError}>
            <h1>Could not load this property</h1>
            <p>The layout is unavailable. Refresh the page to try again.</p>
          </section>
        </div>
      </main>
    );
  }
  const layoutResult = await getPropertyLayout(params.propertyId, token)
    .then((rooms) => ({ ok: true as const, rooms }))
    .catch(() => ({ ok: false as const }));

  const roomTypeOptions: RoomTypeOption[] = property.room_types.map((roomType) => ({
    id: roomType.id,
    label: [
      sharingLabels[roomType.sharing],
      roomType.ac ? "AC" : "Non-AC",
      displayValue(roomType.bathroom_kind),
      displayValue(roomType.furnishing),
      formatRent(roomType.monthly_rent_paise)
    ].join(" · ")
  }));

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <Link
          href={`/${params.locale}/pg-operator/properties/${params.propertyId}` as any}
          className={styles.back}
        >
          <ArrowLeft size={15} aria-hidden="true" /> Bed inventory
        </Link>
        <header className={styles.header}>
          <div>
            <h1>Layout: {property.display_name}</h1>
            <p>Review the physical rooms and beds before saving changes.</p>
          </div>
        </header>
        <PgLayoutBuilder
          propertyId={params.propertyId}
          token={token}
          layoutStatus={property.layout_status}
          initialRooms={layoutResult.ok ? layoutResult.rooms : undefined}
          roomTypeOptions={roomTypeOptions}
          loadError={layoutResult.ok ? undefined : "Could not load the saved layout."}
        />
      </div>
    </main>
  );
}
