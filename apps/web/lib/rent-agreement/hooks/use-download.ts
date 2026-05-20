"use client";
import { useMutation } from "@tanstack/react-query";
import { useApiClient } from "./use-api-client";
import { RentAgreementApi } from "../api/endpoints";
import type { DownloadResponse } from "../api/types";

export function useDownload() {
  const client = useApiClient();
  return useMutation({
    mutationFn: async (input: { agreementId: string }) =>
      (await client.request<DownloadResponse>(RentAgreementApi.download(input.agreementId))).data
  });
}
