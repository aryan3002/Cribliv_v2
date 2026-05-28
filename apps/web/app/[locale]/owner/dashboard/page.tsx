import type { Metadata } from "next";
import { DashboardClient } from "../../../../components/owner/dashboard-client";

export const metadata: Metadata = {
  title: "Owner workspace · Cribliv"
};

interface PageProps {
  params: { locale: string };
  searchParams?: { tab?: string };
}

export default function OwnerDashboardPage({ params, searchParams }: PageProps) {
  const initialTab = searchParams?.tab === "leads" ? "leads" : "listings";
  return <DashboardClient locale={params.locale} initialTab={initialTab} />;
}
