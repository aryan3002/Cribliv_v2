import type { Metadata } from "next";
import { LeadsClient } from "../../../../components/owner/leads-client";

export const metadata: Metadata = {
  title: "Leads Pipeline"
};

export default function OwnerLeadsPage({ params }: { params: { locale: string } }) {
  return <LeadsClient locale={params.locale} />;
}
