"use client";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, FilePlus } from "lucide-react";
import { PlanPicker } from "../_components/PlanPicker";
import { useCreateDraft } from "@/lib/rent-agreement/hooks/use-create-draft";
import { newIdempotencyKey } from "@/lib/rent-agreement/state/idempotency";
import type { Locale, PlanId } from "@/lib/rent-agreement/api/types";

export default function Page({ params }: { params: { locale: string } }) {
  const router = useRouter();
  // The draft's content locale defaults to the current UI locale.
  const [pick, setPick] = useState<{ plan: PlanId; locale: Locale }>({
    plan: "basic",
    locale: params.locale === "hi" ? "hi" : "en"
  });
  const [idemKey] = useState(() => newIdempotencyKey("create-draft"));
  const createDraft = useCreateDraft();

  async function submit() {
    const draft = await createDraft.mutateAsync({
      plan_id: pick.plan,
      locale: pick.locale,
      idempotencyKey: idemKey
    });
    router.push(`/${params.locale}/rent-agreement/${draft.id}` as Route);
  }

  return (
    <>
      <div className="ra-topbar">
        <nav className="ra-breadcrumbs" aria-label="Breadcrumb">
          <Link href={`/${params.locale}/rent-agreement` as Route}>Rent agreements</Link>
          <span>/</span>
          <span>New draft</span>
        </nav>
        <Link href={`/${params.locale}/rent-agreement` as Route} className="ra-button-ghost">
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
          <PlanPicker value={pick} onChange={setPick} />
        </div>
      </section>

      {createDraft.isError && (
        <p className="ra-error-box" role="alert">
          {(createDraft.error as { code?: string }).code ?? "Error"}
        </p>
      )}
      <button onClick={submit} disabled={createDraft.isPending} className="ra-button">
        <FilePlus size={17} aria-hidden="true" />
        {createDraft.isPending ? "Creating…" : "Create draft"}
      </button>
    </>
  );
}
