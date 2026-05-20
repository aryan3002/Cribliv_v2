"use client";
import { useMutation } from "@tanstack/react-query";
import { useApiClient } from "./use-api-client";
import { RentAgreementApi } from "../api/endpoints";

export function usePatchStep() {
  const client = useApiClient();
  return useMutation({
    mutationFn: async (input: { agreementId: string; step: number; payload: unknown }) =>
      (
        await client.request<{ saved: true; current_step: number }>(
          RentAgreementApi.patchStep(input.agreementId, input.step, input.payload)
        )
      ).data
  });
}
