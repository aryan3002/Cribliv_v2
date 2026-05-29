import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getDashboard } from "@/lib/pg-operator-api";
import ListingHealthCard from "@/components/pg-operator/dashboard/ListingHealthCard";
import LeadsInbox from "@/components/pg-operator/dashboard/LeadsInbox";

export const revalidate = 60;

export default async function Page({ params }: { params: { locale: string } }) {
  const s = await auth();
  if (s?.user?.role !== "pg_operator") redirect(`/${params.locale}/pg-operator/become`);
  let data;
  try {
    data = await getDashboard((s as any)?.accessToken ?? undefined);
  } catch {
    data = { listing_health: [], leads_inbox: [] };
  }
  return (
    <main className="pg-dashboard">
      <h1>Your PG dashboard</h1>
      <section className="pg-dashboard-grid">
        {data.listing_health.map((lh) => (
          <ListingHealthCard key={lh.listing_id} data={lh} />
        ))}
      </section>
      <LeadsInbox leads={data.leads_inbox} />
    </main>
  );
}
