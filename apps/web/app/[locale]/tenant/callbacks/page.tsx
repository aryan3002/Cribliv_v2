import { CallbacksClient } from "../../../../components/tenant/callbacks-client";
import { isValidLocale } from "../../../../lib/i18n";

export const metadata = { title: "My Callbacks · Cribliv" };

export default function TenantCallbacksPage({ params }: { params: { locale: string } }) {
  const locale = isValidLocale(params.locale) ? params.locale : "en";
  return <CallbacksClient locale={locale} />;
}
