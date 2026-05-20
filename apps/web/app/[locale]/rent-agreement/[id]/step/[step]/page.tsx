"use client";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { StepForm } from "../../../_components/StepForm";
import { ValidationErrors } from "../../../_components/ValidationErrors";
import { useAdvanceStep } from "@/lib/rent-agreement/hooks/use-advance-step";

export default function Page({ params }: { params: { locale: string; id: string; step: string } }) {
  const router = useRouter();
  const step = Number(params.step);
  const advance = useAdvanceStep();

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

  return (
    <div className="space-y-3">
      <h2 className="font-semibold">Step {step}</h2>
      <StepForm step={step} agreementId={params.id} onSubmit={onSubmit} busy={advance.isPending} />
      <ValidationErrors error={advance.error} />
    </div>
  );
}
