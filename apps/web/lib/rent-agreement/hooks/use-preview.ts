"use client";
import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "./use-api-client";
import { RentAgreementApi } from "../api/endpoints";

/**
 * Fetches the generated agreement PDF bytes for the in-page preview. This hits
 * GET /:id/preview — authenticated, but it does NOT consume a download. The
 * generated PDF is immutable, so the result is cached for the session.
 */
export function usePreview(id: string | null, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: ["rent-agreement", "drafts", "one", id, "preview"],
    enabled: !!id && enabled,
    staleTime: Infinity,
    queryFn: async () => client.requestBytes(RentAgreementApi.preview(id!))
  });
}
