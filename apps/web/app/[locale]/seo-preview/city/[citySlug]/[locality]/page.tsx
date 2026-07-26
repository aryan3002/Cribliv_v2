import type { Metadata } from "next";
import { LocalityHubView } from "../../../../city/[citySlug]/[locality]/locality-view";
import { requireAdminPreview } from "../../../../../../lib/admin-preview";

// Admin-only preview of a locality page for a city that is not yet
// `programmatic_enabled`. This route is intentionally dynamic — it reads the
// session — which is exactly why it lives here instead of on the public page:
// the old `?adminPreview=1` query param forced the public route to render per
// request for all ~33k programmatic URLs. See lib/admin-preview.ts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function LocalitySeoPreviewPage({
  params
}: {
  params: { locale: string; citySlug: string; locality: string };
}) {
  await requireAdminPreview();
  return <LocalityHubView params={params} allowUnlisted />;
}
