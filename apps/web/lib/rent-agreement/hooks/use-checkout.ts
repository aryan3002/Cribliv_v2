"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "./use-api-client";
import { RentAgreementApi } from "../api/endpoints";
import type { CheckoutResponse, Provider } from "../api/types";

export function useCheckout() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      agreementId: string;
      provider: Provider;
      idempotencyKey: string;
    }) =>
      (
        await client.request<CheckoutResponse>(
          RentAgreementApi.checkout(
            input.agreementId,
            { provider: input.provider },
            input.idempotencyKey
          )
        )
      ).data,
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["rent-agreement", "drafts", "one", v.agreementId] });
    }
  });
}
