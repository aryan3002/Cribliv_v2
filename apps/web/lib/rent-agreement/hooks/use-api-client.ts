"use client";
import { useMemo } from "react";
import { ApiClient } from "../api/client";
import { useAuth } from "../auth/auth-provider";
import { getApiBaseUrl } from "../../api";

export function useApiClient(): ApiClient {
  const auth = useAuth();
  return useMemo(() => new ApiClient(getApiBaseUrl(), () => auth.getAccessToken()), [auth]);
}
