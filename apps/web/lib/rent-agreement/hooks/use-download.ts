"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "./use-api-client";
import { RentAgreementApi } from "../api/endpoints";
import type { DownloadResponse } from "../api/types";

export function useDownload() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { agreementId: string }) =>
      (await client.request<DownloadResponse>(RentAgreementApi.download(input.agreementId))).data,
    onSuccess: (_d, v) => {
      // Refresh the draft so download_count / max_downloads reflect the claim.
      qc.invalidateQueries({ queryKey: ["rent-agreement", "drafts", "one", v.agreementId] });
    }
  });
}
