"use client";
import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "./use-api-client";
import { RentAgreementApi } from "../api/endpoints";
import { useFlag } from "../flags/flags-provider";
import type { StatusResponse } from "../api/types";
import { isTerminal } from "../state/status-machine";

export function useStatusPoll(id: string | null, options: { enabled?: boolean } = {}) {
  const client = useApiClient();
  const intervalMs = useFlag("rent_agreement_status_poll_interval_ms");
  return useQuery({
    queryKey: ["rent-agreement", "drafts", "one", id, "status"],
    enabled: !!id && (options.enabled ?? true),
    refetchInterval: (query) => {
      const data = query.state.data as StatusResponse | undefined;
      if (data && isTerminal(data.status)) return false;
      return intervalMs;
    },
    queryFn: async () => (await client.request<StatusResponse>(RentAgreementApi.status(id!))).data
  });
}
