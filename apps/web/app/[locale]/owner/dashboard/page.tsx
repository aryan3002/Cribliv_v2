import type { Metadata } from "next";
import { DashboardClient } from "../../../../components/owner/dashboard-client";

export const metadata: Metadata = {
  title: "Your Listings"
};

export default function OwnerDashboardPage({ params }: { params: { locale: string } }) {
  return <DashboardClient locale={params.locale} />;
}
