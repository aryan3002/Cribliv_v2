import type { Metadata } from "next";
import { LandmarkIntentView } from "../../../../../../city/[citySlug]/near/[landmark]/[intent]/landmark-intent-view";
import { requireAdminPreview } from "../../../../../../../../lib/admin-preview";

// Admin-only preview of a landmark-intent page for a city that is not yet
// `programmatic_enabled`. This route is intentionally dynamic — it reads the
// session — which is exactly why it lives here instead of on the public page:
// the old `?adminPreview=1` query param forced the public route to render per
// request for all ~33k programmatic URLs. See lib/admin-preview.ts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function LandmarkIntentSeoPreviewPage({
  params
}: {
  params: { locale: string; citySlug: string; landmark: string; intent: string };
}) {
  await requireAdminPreview();
  return <LandmarkIntentView params={params} allowUnlisted />;
}
