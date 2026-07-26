import type { Metadata } from "next";
import { OwnerListingsClient } from "../../../../components/owner/owner-listings-client";

export const metadata: Metadata = {
  title: "Owner listings"
};

interface PageProps {
  params: { locale: string };
}

export default function OwnerListingsPage({ params }: PageProps) {
  return <OwnerListingsClient locale={params.locale} />;
}
