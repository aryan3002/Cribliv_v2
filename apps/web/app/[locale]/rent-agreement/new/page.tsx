"use client";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useState } from "react";
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
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">New rent agreement</h1>
      <PlanPicker value={pick} onChange={setPick} />
      {createDraft.isError && (
        <p className="text-red-700 text-sm">
          {(createDraft.error as { code?: string }).code ?? "Error"}
        </p>
      )}
      <button
        onClick={submit}
        disabled={createDraft.isPending}
        className="px-3 py-1 border rounded bg-blue-600 text-white disabled:opacity-50"
      >
        {createDraft.isPending ? "Creating…" : "Create draft"}
      </button>
    </div>
  );
}
