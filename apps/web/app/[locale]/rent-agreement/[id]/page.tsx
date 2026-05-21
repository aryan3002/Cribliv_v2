"use client";
import Link from "next/link";
import type { Route } from "next";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useDraft } from "@/lib/rent-agreement/hooks/use-draft";
import { sequenceFor } from "@/lib/rent-agreement/state/step-registry";
import { StatusBadge } from "../_components/StatusBadge";
import { formatDateTime, formatRupees, planLabel, stepTitle } from "../_components/ui-copy";

export default function Page({ params }: { params: { locale: string; id: string } }) {
  const d = useDraft(params.id);
  if (d.isLoading) return <p className="ra-loading">Loading agreement…</p>;
  if (d.isError || !d.data) return <p className="ra-error">Draft not found.</p>;

  const base = `/${params.locale}/rent-agreement/${d.data.id}`;
  const seq = sequenceFor(d.data.plan_id);
  const completedCount = seq.filter((s) => d.data!.step_validated_at?.[String(s)]).length;
  return (
    <>
      <div className="ra-topbar">
        <nav className="ra-breadcrumbs" aria-label="Breadcrumb">
          <Link href={`/${params.locale}/rent-agreement` as Route}>Rent agreements</Link>
          <span>/</span>
          <span>{d.data.id}</span>
        </nav>
        <Link href={`/${params.locale}/rent-agreement` as Route} className="ra-button-ghost">
          <ArrowLeft size={16} aria-hidden="true" />
          Back
        </Link>
      </div>

      <header className="ra-page-header">
        <div>
          <h1 className="ra-page-title">{planLabel(d.data.plan_id)} agreement</h1>
          <p className="ra-page-copy">
            Draft {d.data.id}. Complete the required sections, then move to checkout.
          </p>
        </div>
        <StatusBadge status={d.data.status} />
      </header>

      <div className="ra-workspace">
        <section className="ra-panel" aria-labelledby="agreement-summary-title">
          <div className="ra-panel-header">
            <h2 id="agreement-summary-title" className="ra-panel-title">
              Agreement progress
            </h2>
            {d.data.current_step === 7 ? (
              <Link href={`${base}/checkout` as Route} className="ra-button">
                Continue to checkout
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            ) : (
              <Link href={`${base}/step/${d.data.current_step}` as Route} className="ra-button">
                Continue step {d.data.current_step}
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            )}
          </div>
          <div className="ra-panel-body">
            <dl className="ra-summary-list">
              <div className="ra-summary-row">
                <dt>Plan</dt>
                <dd>{planLabel(d.data.plan_id)}</dd>
              </div>
              <div className="ra-summary-row">
                <dt>Completed</dt>
                <dd>
                  {completedCount} of {seq.length} sections
                </dd>
              </div>
              <div className="ra-summary-row">
                <dt>Monthly rent</dt>
                <dd>{formatRupees(d.data.rent_amount_paise)}</dd>
              </div>
              <div className="ra-summary-row">
                <dt>Stamp duty</dt>
                <dd>{formatRupees(d.data.stamp_duty_paise)}</dd>
              </div>
              <div className="ra-summary-row">
                <dt>Updated</dt>
                <dd>{formatDateTime(d.data.updated_at)}</dd>
              </div>
            </dl>
          </div>
        </section>

        <aside className="ra-step-rail" aria-label="Agreement steps">
          <div className="ra-step-rail-header">
            <h2 className="ra-panel-title">Sections</h2>
            <p className="ra-hint">Premium agreements include signatures before review.</p>
          </div>
          <ol className="ra-step-list">
            {seq.map((s) => {
              const done = Boolean(d.data!.step_validated_at?.[String(s)]);
              const active = s === d.data!.current_step;
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
