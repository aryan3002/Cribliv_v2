import type { Locale } from "@/lib/i18n";

export const PG_DASHBOARD_SECTION_IDS = {
  overview: "overview-section",
  analytics: "analytics-section",
  listings: "listings-section",
  leads: "leads-section"
} as const;

export function getPgDashboardLinks(locale: Locale) {
  const base = `/${locale}/pg-operator/dashboard`;
  return [
    { label: "Dashboard", href: `${base}#${PG_DASHBOARD_SECTION_IDS.overview}` },
    { label: "Analytics", href: `${base}#${PG_DASHBOARD_SECTION_IDS.analytics}` },
    { label: "Listings", href: `${base}#${PG_DASHBOARD_SECTION_IDS.listings}` },
    { label: "Leads", href: `${base}#${PG_DASHBOARD_SECTION_IDS.leads}` }
  ];
}
