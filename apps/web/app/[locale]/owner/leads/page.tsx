import { LeadsClient } from "../../../../components/owner/leads-client";

interface PageProps {
  params: { locale: string };
}

export default function OwnerLeadsPage({ params }: PageProps) {
  return <LeadsClient locale={params.locale} />;
}
