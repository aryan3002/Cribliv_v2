"use client";
import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "./use-api-client";
import { RentAgreementApi } from "../api/endpoints";
import type { PlanCatalogEntry } from "../api/types";

export function usePlans() {
  const client = useApiClient();
  return useQuery({
    queryKey: ["rent-agreement", "plans"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const r = await client.request<PlanCatalogEntry[]>(RentAgreementApi.plans());
      return r.data;
    }
  });
}
