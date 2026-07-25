import type { Metadata } from "next";
import { OwnerOverviewClient } from "../../../../components/owner/owner-overview-client";

export const metadata: Metadata = {
  title: "Owner workspace"
};

interface PageProps {
  params: { locale: string };
}

export default function OwnerDashboardPage({ params }: PageProps) {
  return <OwnerOverviewClient locale={params.locale} />;
}
