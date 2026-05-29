import { getApiBaseUrl } from "@/lib/api";
import type { PlanCatalogEntry } from "@/lib/rent-agreement/api/types";
import { NewDraftClient } from "./NewDraftClient";

// Server-side prefetch the plan catalog. The endpoint is public, returns a
// 3-row static list with low change frequency (legal-team controlled), so we
// cache for 5 min on the Next server tier too. ISR `revalidate` keeps cache
// fresh without invalidation hooks. Failure is non-fatal: PlanPicker falls
// back to its client-side fetch if `initialPlans` is undefined.
async function fetchPlans(): Promise<PlanCatalogEntry[] | undefined> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/rent-agreement/plans`, {
      next: { revalidate: 300 }
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { data?: PlanCatalogEntry[] };
    return body.data;
  } catch {
    return undefined;
  }
}

export default async function Page({ params }: { params: { locale: string } }) {
  const initialPlans = await fetchPlans();
  return <NewDraftClient locale={params.locale} initialPlans={initialPlans} />;
}
