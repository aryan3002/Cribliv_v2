import type { Metadata } from "next";
import { MetroStationView } from "../../../../../city/[citySlug]/metro/[station]/station-view";
import { requireAdminPreview } from "../../../../../../../lib/admin-preview";

// Admin-only preview of a metro station page for a city that is not yet
// `programmatic_enabled`. This route is intentionally dynamic — it reads the
// session — which is exactly why it lives here instead of on the public page:
// the old `?adminPreview=1` query param forced the public route to render per
// request for all ~33k programmatic URLs. See lib/admin-preview.ts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function MetroStationSeoPreviewPage({
  params
}: {
  params: { locale: string; citySlug: string; station: string };
}) {
  await requireAdminPreview();
  return <MetroStationView params={params} allowUnlisted />;
}
