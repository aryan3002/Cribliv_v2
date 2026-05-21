"use client";
import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "./use-api-client";
import { RentAgreementApi } from "../api/endpoints";
import type { DraftSummary } from "../api/types";

export function useMyDrafts() {
  const client = useApiClient();
  return useQuery({
    queryKey: ["rent-agreement", "drafts", "mine"],
    queryFn: async () => (await client.request<DraftSummary[]>(RentAgreementApi.myDrafts())).data
  });
}
