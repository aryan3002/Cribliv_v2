"use client";

import { useEffect, useRef } from "react";
import { useMapDispatch, type AlertZone } from "./useMapState";
import { fetchApi } from "../../../lib/api";

export function useAlertZones(isAuthenticated: boolean) {
  const dispatch = useMapDispatch();
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || fetchedRef.current) return;
    fetchedRef.current = true;

    fetchApi<AlertZone[]>("/map/alert-zones")
      .then((zones) => {
        dispatch({ type: "SET_ALERT_ZONES", zones });
      })
      .catch(() => {});
  }, [isAuthenticated, dispatch]);
}
