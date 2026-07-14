import { VerificationClient } from "../../../../components/owner/verification-client";
import type { Locale } from "../../../../lib/i18n";

interface PageProps {
  params: { locale: string };
}

export default function OwnerVerificationPage({ params }: PageProps) {
  return <VerificationClient locale={params.locale as Locale} />;
}
