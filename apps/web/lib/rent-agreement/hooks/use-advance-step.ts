"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "./use-api-client";
import { RentAgreementApi } from "../api/endpoints";

export interface AdvanceStepInput {
  agreementId: string;
  step: number;
  payload: unknown;
}

export interface AdvanceStepResult {
  current_step: number;
  step_validated_at: Record<string, string>;
  terminal: boolean;
}

export function useAdvanceStep() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AdvanceStepInput) =>
      (
        await client.request<AdvanceStepResult>(
          RentAgreementApi.advanceStep(input.agreementId, input.step, input.payload)
        )
      ).data,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["rent-agreement", "drafts", "one", vars.agreementId] });
    }
  });
}
