"use client";

import { useParams, useRouter } from "next/navigation";
import { ListingWizard } from "../../../../../components/listing-wizard/ListingWizard";

export default function NewListingPage() {
  const router = useRouter();
  const params = useParams();
  const locale = typeof params?.locale === "string" ? params.locale : "en";

  return (
    <ListingWizard
      locale={locale}
      mode="owner"
      onPublished={() => router.push(`/${locale}/owner/dashboard`)}
    />
  );
}
