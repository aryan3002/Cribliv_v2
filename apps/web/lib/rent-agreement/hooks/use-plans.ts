"use client";
import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "./use-api-client";
import { RentAgreementApi } from "../api/endpoints";
import type { PlanCatalogEntry } from "../api/types";

/**
 * Caller may pass `initialData` when the plans catalog was already fetched
 * server-side (RSC prefetch). With initialData, TanStack Query treats the
 * query as fresh (no client-side fetch on first mount) until `staleTime`
 * elapses — so PlanPicker renders without the "Loading plans…" flash.
 */
export function usePlans(initialData?: PlanCatalogEntry[]) {
  const client = useApiClient();
  return useQuery({
    queryKey: ["rent-agreement", "plans"],
    staleTime: 5 * 60_000,
    initialData,
    queryFn: async () => {
      const r = await client.request<PlanCatalogEntry[]>(RentAgreementApi.plans());
      return r.data;
    }
  });
}
