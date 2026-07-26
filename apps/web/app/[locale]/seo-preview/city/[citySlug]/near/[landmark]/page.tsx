import type { Metadata } from "next";
import { LandmarkHubView } from "../../../../../city/[citySlug]/near/[landmark]/landmark-view";
import { requireAdminPreview } from "../../../../../../../lib/admin-preview";

// Admin-only preview of a landmark page for a city that is not yet
// `programmatic_enabled`. This route is intentionally dynamic — it reads the
// session — which is exactly why it lives here instead of on the public page:
// the old `?adminPreview=1` query param forced the public route to render per
// request for all ~33k programmatic URLs. See lib/admin-preview.ts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function LandmarkSeoPreviewPage({
  params
}: {
  params: { locale: string; citySlug: string; landmark: string };
}) {
  await requireAdminPreview();
  return <LandmarkHubView params={params} allowUnlisted />;
}
