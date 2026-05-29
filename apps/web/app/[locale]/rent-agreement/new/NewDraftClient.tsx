"use client";
import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, FilePlus } from "lucide-react";
import { useSession } from "next-auth/react";
import { PlanPicker } from "../_components/PlanPicker";
import { useCreateDraft } from "@/lib/rent-agreement/hooks/use-create-draft";
import { newIdempotencyKey } from "@/lib/rent-agreement/state/idempotency";
import type { Locale, PlanCatalogEntry, PlanId } from "@/lib/rent-agreement/api/types";

/**
 * Client half of /[locale]/rent-agreement/new. The RSC parent fetches the plan
 * catalog server-side and hands it in via `initialPlans` so the picker renders
 * without a "Loading plans…" flash. `initialPlans` may be undefined if the
 * server fetch failed; in that case PlanPicker falls back to its client fetch.
 */
export function NewDraftClient({
  locale,
  initialPlans
}: {
  locale: string;
  initialPlans?: PlanCatalogEntry[];
}) {
  const router = useRouter();
  const { status } = useSession();
  const searchParams = useSearchParams();

  // A plan carried back from the login round-trip pre-selects the picker.
  const planParam = searchParams.get("plan");
  const initialPlan: PlanId =
    planParam === "standard" || planParam === "premium" ? planParam : "basic";

  // The draft's content locale defaults to the current UI locale.
  const [pick, setPick] = useState<{ plan: PlanId; locale: Locale }>({
    plan: initialPlan,
    locale: locale === "hi" ? "hi" : "en"
  });
  const [idemKey] = useState(() => newIdempotencyKey("create-draft"));
  const createDraft = useCreateDraft();

  async function submit() {
    // Creating a draft needs a signed-in user. Send the visitor to login
    // first, preserving the chosen plan so it survives the round-trip.
    if (status !== "authenticated") {
      const back = `/${locale}/rent-agreement/new?plan=${pick.plan}`;
      router.push(`/${locale}/auth/login?from=${encodeURIComponent(back)}` as Route);
      return;
    }
    const draft = await createDraft.mutateAsync({
      plan_id: pick.plan,
      locale: pick.locale,
      idempotencyKey: idemKey
    });
    router.push(`/${locale}/rent-agreement/${draft.id}` as Route);
  }

  return (
    <>
      <div className="ra-topbar">
        <nav className="ra-breadcrumbs" aria-label="Breadcrumb">
          <Link href={`/${locale}/rent-agreement` as Route}>Rent agreements</Link>
          <span>/</span>
          <span>New draft</span>
        </nav>
        <Link href={`/${locale}/rent-agreement` as Route} className="ra-button-ghost">
          <ArrowLeft size={16} aria-hidden="true" />
          Back
        </Link>
      </div>

      <header className="ra-page-header">
        <div>
          <h1 className="ra-page-title">New rent agreement</h1>
          <p className="ra-page-copy">
            Pick the document package and language. The next screen creates a draft and opens the
            guided agreement workflow.
          </p>
        </div>
      </header>

      <section className="ra-panel" aria-labelledby="plan-picker-title">
        <div className="ra-panel-header">
          <h2 id="plan-picker-title" className="ra-panel-title">
            Plan and language
          </h2>
        </div>
        <div className="ra-panel-body">
          <PlanPicker value={pick} onChange={setPick} initialPlans={initialPlans} />
        </div>
      </section>

      {createDraft.isError && (
        <p className="ra-error-box" role="alert">
          {(createDraft.error as { code?: string }).code ?? "Error"}
        </p>
      )}
      <button onClick={submit} disabled={createDraft.isPending} className="ra-button">
        <FilePlus size={17} aria-hidden="true" />
        {createDraft.isPending
          ? "Creating…"
          : status === "authenticated"
            ? "Create draft"
            : "Sign in to continue"}
      </button>
    </>
  );
}
