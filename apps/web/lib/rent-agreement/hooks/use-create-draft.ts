"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "./use-api-client";
import { RentAgreementApi } from "../api/endpoints";
import type { DraftFull, Locale, PlanId } from "../api/types";

export interface CreateDraftInput {
  plan_id: PlanId;
  locale: Locale;
  idempotencyKey: string;
}

export function useCreateDraft() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateDraftInput) => {
      const r = await client.request<DraftFull>(
        RentAgreementApi.createDraft(
          { plan_id: input.plan_id, locale: input.locale },
          input.idempotencyKey
        )
      );
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rent-agreement", "drafts", "mine"] });
    }
  });
}
