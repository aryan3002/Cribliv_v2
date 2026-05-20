"use client";
import Link from "next/link";
import type { Route } from "next";
import { useDraft } from "@/lib/rent-agreement/hooks/use-draft";
import { sequenceFor } from "@/lib/rent-agreement/state/step-registry";
import { StatusBadge } from "../_components/StatusBadge";

export default function Page({ params }: { params: { locale: string; id: string } }) {
  const d = useDraft(params.id);
  if (d.isLoading) return <p>Loading…</p>;
  if (d.isError || !d.data) return <p>Draft not found.</p>;

  const base = `/${params.locale}/rent-agreement/${d.data.id}`;
  const seq = sequenceFor(d.data.plan_id);
  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-mono">{d.data.id}</h1>
        <StatusBadge status={d.data.status} />
      </header>
      <p className="text-sm text-gray-600">
        Plan: {d.data.plan_id} · Current step: {d.data.current_step}
      </p>
      <ol className="space-y-1">
        {seq.map((s) => (
          <li key={s}>
            <Link
              href={`${base}/step/${s}` as Route}
              className={`underline ${s === d.data!.current_step ? "font-bold" : ""}`}
            >
              Step {s}
            </Link>
            {d.data!.step_validated_at?.[String(s)] && (
              <span className="ml-2 text-xs text-green-700">✓</span>
            )}
          </li>
        ))}
      </ol>
      {d.data.current_step === 7 && (
        <Link
          href={`${base}/checkout` as Route}
          className="inline-block mt-2 px-3 py-1 bg-green-700 text-white rounded"
        >
          Continue to checkout
        </Link>
      )}
    </div>
  );
}
