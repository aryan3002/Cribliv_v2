"use client";
import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "./use-api-client";
import { RentAgreementApi } from "../api/endpoints";
import type { StateEntry } from "../api/types";

export function useStates() {
  const client = useApiClient();
  return useQuery({
    queryKey: ["rent-agreement", "states"],
    staleTime: 60 * 60_000,
    queryFn: async () => (await client.request<StateEntry[]>(RentAgreementApi.states())).data
  });
}
