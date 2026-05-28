"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "./use-api-client";
import { RentAgreementApi } from "../api/endpoints";

export function useBackStep() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { agreementId: string; step: number }) =>
      (
        await client.request<{ current_step: number }>(
          RentAgreementApi.backStep(input.agreementId, input.step)
        )
      ).data,
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["rent-agreement", "drafts", "one", v.agreementId] });
    }
  });
}
