"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useMapDispatch, type AlertZone } from "./useMapState";
import { fetchApi } from "../../../lib/api";
import { readAuthSession } from "../../../lib/client-auth";

export function useMapAccessToken(): { token: string | null; status: "loading" | "ready" } {
  const { data: nextAuthSession, status } = useSession();
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (status === "loading") return;
    const stored = readAuthSession();
    const nextAuthToken = (nextAuthSession as { accessToken?: string } | null)?.accessToken ?? null;
    setToken(stored?.access_token ?? nextAuthToken ?? null);
  }, [nextAuthSession, status]);

  return { token, status: status === "loading" ? "loading" : "ready" };
}

export function useAlertZones(accessToken: string | null) {
  const dispatch = useMapDispatch();
  const fetchedForTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!accessToken || fetchedForTokenRef.current === accessToken) return;
    fetchedForTokenRef.current = accessToken;

    fetchApi<AlertZone[]>("/map/alert-zones", {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
      .then((zones) => {
        dispatch({ type: "SET_ALERT_ZONES", zones });
      })
      .catch(() => {
        fetchedForTokenRef.current = null;
      });
  }, [accessToken, dispatch]);
}
