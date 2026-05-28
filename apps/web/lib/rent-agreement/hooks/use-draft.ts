"use client";
import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "./use-api-client";
import { RentAgreementApi } from "../api/endpoints";
import type { DraftFull } from "../api/types";

export function useDraft(id: string | null) {
  const client = useApiClient();
  return useQuery({
    queryKey: ["rent-agreement", "drafts", "one", id],
    enabled: !!id,
    queryFn: async () => (await client.request<DraftFull>(RentAgreementApi.getDraft(id!))).data
  });
}
