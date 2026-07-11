"use client";

import { useEffect, useRef, useState } from "react";
import { Navigation, X, Sparkles } from "lucide-react";
import { useMapState, useMapDispatch, type LocalityReachability } from "./hooks/useMapState";
import { fetchApi } from "../../lib/api";

interface CommuteOverlayProps {
  map: google.maps.Map | null;
  showInput: boolean;
  onCloseInput: () => void;
}

const MIN_COMMUTE = 15;
const MAX_COMMUTE = 90;
const STEP_COMMUTE = 5;

/**
 * "Where Should I Live?" reverse-search controls.
 *
 *  - Office address input (Google Places autocomplete)
 *  - Max-commute slider (15..90 min, default 45)
 *  - Owns the fetch to /map/commute/reachability + dispatches results into
 *    map state so CommuteReachabilityLayer + ListingPinLayer can use them.
 *
 * Replaced the v1 8-km-circle overlay which drew bubbles around metro
 * stations without filtering listings or computing actual commute time —
 * see plan doc for the rationale.
 */
export function CommuteOverlay({ map, showInput, onCloseInput }: CommuteOverlayProps) {
  const { commuteOrigin, commuteMaxMinutes, commuteReachability, commuteReachabilityError, city } =
    useMapState();
  const dispatch = useMapDispatch();
  const originMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const [address, setAddress] = useState("");
  const [fetching, setFetching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const autocompleteListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Places autocomplete on the office input. */
  useEffect(() => {
    if (!showInput || !inputRef.current || typeof google === "undefined") return;

    autocompleteListenerRef.current?.remove();
    autocompleteListenerRef.current = null;
    autocompleteRef.current = new google.maps.places.Autocomplete(inputRef.current, {
      types: ["establishment", "geocode"],
      componentRestrictions: { country: "in" }
    });

    autocompleteListenerRef.current = autocompleteRef.current.addListener("place_changed", () => {
      const place = autocompleteRef.current?.getPlace();
      if (place?.geometry?.location) {
        const addr = place.formatted_address ?? place.name ?? "";
        setAddress(addr);
        dispatch({
          type: "SET_COMMUTE_ORIGIN",
          origin: {
            lat: place.geometry.location.lat(),
            lng: place.geometry.location.lng(),
            address: addr
          }
        });
        onCloseInput();
      }
    });

    return () => {
      autocompleteListenerRef.current?.remove();
      autocompleteListenerRef.current = null;
      autocompleteRef.current = null;
    };
  }, [showInput, dispatch, onCloseInput]);

  /* Render the office pin marker. */
  useEffect(() => {
    if (originMarkerRef.current) {
      originMarkerRef.current.map = null;
      originMarkerRef.current = null;
    }
    if (!map || !commuteOrigin) return;

    const el = document.createElement("div");
    el.className = "cmap-commute-origin";
    el.title = commuteOrigin.address;
    el.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="var(--brand)" stroke="white" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="white"/></svg>`;

    originMarkerRef.current = new google.maps.marker.AdvancedMarkerElement({
      map,
      position: { lat: commuteOrigin.lat, lng: commuteOrigin.lng },
      content: el,
      zIndex: 200
    });

    return () => {
      if (originMarkerRef.current) {
        originMarkerRef.current.map = null;
        originMarkerRef.current = null;
      }
    };
  }, [map, commuteOrigin]);

  /* Fetch reachability whenever office or city changes (debounced).
   * The slider does NOT re-fetch — it only re-colours existing data. */
  useEffect(() => {
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    if (!commuteOrigin || !city) {
      dispatch({ type: "SET_COMMUTE_REACHABILITY", reachability: null });
      return;
    }

    fetchTimerRef.current = setTimeout(() => {
      setFetching(true);
      const url = `/map/commute/reachability?office_lat=${commuteOrigin.lat}&office_lng=${commuteOrigin.lng}&city=${encodeURIComponent(city)}`;
      fetchApi<{ localities: LocalityReachability[] }>(url)
        .then((res) => {
          dispatch({
            type: "SET_COMMUTE_REACHABILITY",
            reachability: Array.isArray(res?.localities) ? res.localities : []
          });
        })
        .catch((err: unknown) => {
          // Treat fetch failures as a real error state — DON'T silently set
          // reachability to []. The empty array specifically means "API
          // confirmed no localities for this city"; an error means "we don't
          // know yet." Conflating the two told users "city has no metro"
          // when in fact the endpoint had 404'd / 500'd / dropped.
          const message =
            err instanceof Error && err.message
              ? err.message
              : "Couldn't reach the commute service";
          dispatch({ type: "SET_COMMUTE_REACHABILITY_ERROR", error: message });
        })
        .finally(() => setFetching(false));
    }, 300);

    return () => {
      if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    };
  }, [commuteOrigin, city, dispatch]);

  const reachableCount =
    commuteReachability?.filter((l) => l.total_minutes <= commuteMaxMinutes).length ?? 0;
  const unsupportedCity =
    !commuteReachabilityError && commuteReachability !== null && commuteReachability.length === 0;
  const hasError = Boolean(commuteReachabilityError);

  return (
    <>
      {showInput && (
        <div className="cmap-commute-input">
          <Navigation size={16} />
          <input
            ref={inputRef}
            type="text"
            className="cmap-topbar__input"
            style={{ borderRadius: 8, paddingLeft: 12, flex: 1 }}
            placeholder="Enter your office address…"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            autoFocus
          />
          <button className="cmap-panel__close" onClick={onCloseInput} aria-label="Close">
            <X size={14} />
          </button>
        </div>
      )}

      {commuteOrigin && !showInput && (
        <div className="cmap-commute-panel">
          <div className="cmap-commute-panel__header">
            <Navigation size={12} />
            <span className="cmap-commute-panel__address">
              {commuteOrigin.address.split(",")[0]}
            </span>
            <button
              onClick={() => dispatch({ type: "SET_COMMUTE_ORIGIN", origin: null })}
              aria-label="Clear commute"
              className="cmap-commute-panel__clear"
            >
              <X size={12} />
            </button>
          </div>

          <label className="cmap-commute-panel__slider-label">
            <span>Show places within</span>
            <strong>{commuteMaxMinutes} min</strong>
            <span>of work</span>
          </label>
          <input
            type="range"
            min={MIN_COMMUTE}
            max={MAX_COMMUTE}
            step={STEP_COMMUTE}
            value={commuteMaxMinutes}
            onChange={(e) =>
              dispatch({ type: "SET_COMMUTE_MAX_MINUTES", minutes: Number(e.target.value) })
            }
            className="cmap-commute-panel__slider"
          />

          <div className="cmap-commute-panel__result">
            {fetching ? (
              <>
                <Sparkles size={12} className="cmap-spin" />
                <span>Computing commute…</span>
              </>
            ) : hasError ? (
              <span className="cmap-commute-panel__result--warn">
                Commute service is unavailable right now. Try again in a moment.
              </span>
            ) : unsupportedCity ? (
              <span className="cmap-commute-panel__result--warn">
                Reverse search needs a city with metro data. Pick Delhi, Lucknow, Noida, Gurugram,
                or Jaipur.
              </span>
            ) : (
              <>
                <Sparkles size={12} />
                <span>
                  <strong>{reachableCount}</strong>{" "}
                  {reachableCount === 1 ? "neighbourhood" : "neighbourhoods"} within reach
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
