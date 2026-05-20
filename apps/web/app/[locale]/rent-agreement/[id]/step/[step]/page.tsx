"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { ArrowLeft } from "lucide-react";
import { StepForm } from "../../../_components/StepForm";
import { StatusBadge } from "../../../_components/StatusBadge";
import { ValidationErrors } from "../../../_components/ValidationErrors";
import { useAdvanceStep } from "@/lib/rent-agreement/hooks/use-advance-step";
import { useDraft } from "@/lib/rent-agreement/hooks/use-draft";
import { sequenceFor } from "@/lib/rent-agreement/state/step-registry";
import { planLabel, stepTitle } from "../../../_components/ui-copy";

export default function Page({ params }: { params: { locale: string; id: string; step: string } }) {
  const router = useRouter();
  const step = Number(params.step);
  const advance = useAdvanceStep();
  const draft = useDraft(params.id);

  async function onSubmit(payload: unknown) {
    try {
      const r = await advance.mutateAsync({ agreementId: params.id, step, payload });
      const base = `/${params.locale}/rent-agreement/${params.id}`;
      if (r.terminal) router.push(`${base}/checkout` as Route);
      else router.push(`${base}/step/${r.current_step}` as Route);
    } catch {
      // The failure is captured in `advance.error` and rendered by
      // <ValidationErrors> below — swallow the rejection here so it does
      // not surface as an unhandled promise rejection.
    }
  }

  if (draft.isLoading) return <p className="ra-loading">Loading agreement…</p>;
  if (draft.isError || !draft.data) return <p className="ra-error">Draft not found.</p>;

  const base = `/${params.locale}/rent-agreement/${params.id}`;
  const seq = sequenceFor(draft.data.plan_id);

  return (
    <>
      <div className="ra-topbar">
        <nav className="ra-breadcrumbs" aria-label="Breadcrumb">
          <Link href={`/${params.locale}/rent-agreement` as Route}>Rent agreements</Link>
          <span>/</span>
          <Link href={base as Route}>{planLabel(draft.data.plan_id)} agreement</Link>
          <span>/</span>
          <span>{stepTitle(step)}</span>
        </nav>
        <Link href={base as Route} className="ra-button-ghost">
          <ArrowLeft size={16} aria-hidden="true" />
          Overview
        </Link>
      </div>

      <header className="ra-page-header">
        <div>
          <h1 className="ra-page-title">{stepTitle(step)}</h1>
          <p className="ra-page-copy">
            Step {step} of {seq.length}. Changes are validated before the draft moves forward.
          </p>
        </div>
        <StatusBadge status={draft.data.status} />
      </header>

      <div className="ra-workspace">
        <section>
          <StepForm
            step={step}
            agreementId={params.id}
            onSubmit={onSubmit}
            busy={advance.isPending}
          />
          <ValidationErrors error={advance.error} />
        </section>

        <aside className="ra-step-rail" aria-label="Agreement steps">
          <div className="ra-step-rail-header">
            <h2 className="ra-panel-title">Sections</h2>
            <p className="ra-hint">Validated sections can be reopened from here.</p>
          </div>
          <ol className="ra-step-list">
            {seq.map((s) => {
              const done = Boolean(draft.data!.step_validated_at?.[String(s)]);
              const active = s === step;
              return (
                <li key={s}>
                  <Link
                    href={`${base}/step/${s}` as Route}
                    className={`ra-step-link${active ? " ra-step-link--active" : ""}${
                      done ? " ra-step-link--done" : ""
                    }`}
                  >
                    <span className="ra-step-index">{done ? "✓" : s}</span>
                    <span>
                      <span className="ra-step-name">{stepTitle(s)}</span>
                      <span className="ra-step-meta">
                        {done ? "Validated" : active ? "Current section" : `Step ${s}`}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </aside>
      </div>
    </>
  );
}
