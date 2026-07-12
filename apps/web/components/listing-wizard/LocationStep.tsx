"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { WizardForm, StepError } from "./types";
import { CITIES } from "./types";
import { useGooglePlaces } from "../../lib/google-places";
import { ensureMapsLoaded } from "../../lib/google-maps";
import { CRIBLMAP_DARK_STYLE } from "../../lib/map-styles";

interface Props {
  form: WizardForm;
  errors: StepError[];
  updateField: <K extends keyof WizardForm>(key: K, value: WizardForm[K]) => void;
  aiFillingFields?: Set<string>;
}

/* ── City inference from Google Places formatted_address ─────────────── */
const CITY_ALIASES: Record<string, string> = {
  "new delhi": "delhi",
  delhi: "delhi",
  gurugram: "gurugram",
  gurgaon: "gurugram",
  noida: "noida",
  "greater noida": "noida",
  ghaziabad: "ghaziabad",
  faridabad: "faridabad",
  chandigarh: "chandigarh",
  jaipur: "jaipur",
  lucknow: "lucknow"
};

function inferCityFromAddress(address: string): string | null {
  const lower = address.toLowerCase();
  for (const [alias, slug] of Object.entries(CITY_ALIASES)) {
    if (lower.includes(alias)) return slug;
  }
  return null;
}

/* ── Mini-map styling ────────────────────────────────────────────────
 * The mini-map intentionally does NOT use a Cloud Map ID. With a mapId
 * set, Google's SDK ignores `styles` and uses the Cloud-configured
 * styling — which only works when the API key and Map ID belong to the
 * same Cloud project. Inline `CRIBLMAP_DARK_STYLE` is project-agnostic
 * and reliable. The trade-off is that AdvancedMarkerElement isn't
 * available, so we use a legacy Marker with an inline SVG icon. */

/* ── Component ──────────────────────────────────────────────────────── */

export function LocationStep({ form, errors, updateField, aiFillingFields }: Props) {
  const {
    predictions,
    fetchPredictions,
    getPlaceDetails,
    clearPredictions,
    enabled,
    loading: placesLoading,
    error: placesError,
    noResults
  } = useGooglePlaces({
    types: ["locality", "sublocality", "neighborhood", "route", "street_address"],
    debounce: 280
  });

  const [showDropdown, setShowDropdown] = useState(false);
  const [localityInput, setLocalityInput] = useState(form.locality);
  // True once a place-details lookup for a chosen suggestion fails — the
  // locality text is kept, but the owner is told no pin was placed.
  const [detailsError, setDetailsError] = useState(false);
  const placesUnavailable = !enabled || placesError === "unavailable";
  const dropdownRef = useRef<HTMLDivElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // Sync localityInput when form.locality changes externally (voice, edit mode)
  useEffect(() => {
    setLocalityInput(form.locality);
  }, [form.locality]);

  /* ── Mini-map initialization ──────────────────────────────────────── */
  const initMiniMap = useCallback(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    if (typeof google === "undefined") return;

    const lat = form.lat ?? 28.6139;
    const lng = form.lng ?? 77.209;

    // Inline styles only — no mapId — guarantees CRIBLMAP_DARK_STYLE is applied.
    const mapOptions: google.maps.MapOptions = {
      center: { lat, lng },
      zoom: form.lat ? 15 : 11,
      disableDefaultUI: true,
      zoomControl: true,
      zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_BOTTOM },
      gestureHandling: "cooperative",
      clickableIcons: false,
      styles: CRIBLMAP_DARK_STYLE
    };

    const map = new google.maps.Map(mapContainerRef.current, mapOptions);
    mapRef.current = map;

    // Re-trigger resize whenever the container size changes (entry animation,
    // window resize, sidebar toggle). Prevents partial-tile / gray-canvas render.
    const observer = new ResizeObserver(() => {
      google.maps.event.trigger(map, "resize");
      const c = map.getCenter();
      if (c) map.setCenter(c);
    });
    observer.observe(mapContainerRef.current);
    resizeObserverRef.current = observer;

    // Click-to-place
    map.addListener("click", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const newLat = e.latLng.lat();
      const newLng = e.latLng.lng();
      placePin(newLat, newLng, map);
      updateField("lat", newLat);
      updateField("lng", newLng);
    });

    // If coordinates already exist (edit mode), place pin immediately
    if (form.lat !== null && form.lng !== null) {
      placePin(form.lat, form.lng, map);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    ensureMapsLoaded().then(() => {
      initMiniMap();
    });
    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
    };
  }, [initMiniMap]);

  /* ── Pin placement (legacy Marker, draggable) ─────────────────────── */
  function placePin(lat: number, lng: number, map?: google.maps.Map) {
    const activeMap = map ?? mapRef.current;
    if (!activeMap || typeof google === "undefined") return;

    if (markerRef.current) {
      markerRef.current.setMap(null);
    }

    // Inline SVG teardrop icon styled like the wizard brand
    const pinSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
        <defs>
          <filter id="czPinShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.5"/>
            <feOffset dy="2"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <path filter="url(#czPinShadow)" fill="#0066FF" stroke="#ffffff" stroke-width="2"
          d="M18 2 C9 2 3 9 3 17 C3 27 18 42 18 42 S33 27 33 17 C33 9 27 2 18 2 Z"/>
        <circle cx="18" cy="17" r="5" fill="#ffffff"/>
      </svg>`;

    const marker = new google.maps.Marker({
      map: activeMap,
      position: { lat, lng },
      draggable: true,
      icon: {
        url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(pinSvg)}`,
        size: new google.maps.Size(36, 44),
        scaledSize: new google.maps.Size(36, 44),
        anchor: new google.maps.Point(18, 42)
      },
      animation: google.maps.Animation.DROP
    });
    marker.addListener("dragend", (e: google.maps.MapMouseEvent) => {
      if (e.latLng) {
        updateField("lat", e.latLng.lat());
        updateField("lng", e.latLng.lng());
      }
    });
    markerRef.current = marker;

    activeMap.panTo({ lat, lng });
    activeMap.setZoom(15);
  }

  /* ── Place selection ──────────────────────────────────────────────── */
  async function handlePlaceSelect(placeId: string, description: string) {
    setShowDropdown(false);
    clearPredictions();
    setDetailsError(false);

    const details = await getPlaceDetails(placeId);
    const localityName = details?.name ?? description.split(",")[0] ?? description;

    setLocalityInput(localityName);
    updateField("locality", localityName);

    if (details) {
      updateField("lat", details.geometry.lat);
      updateField("lng", details.geometry.lng);

      // Smart city auto-fill — a valid suggestion replaces a stale/inconsistent
      // city so the pair never disagrees, not only when the city is empty.
      const inferred = inferCityFromAddress(details.formatted_address);
      if (inferred && inferred !== form.city) updateField("city", inferred);

      placePin(details.geometry.lat, details.geometry.lng);
    } else {
      // Details lookup failed: keep the typed locality but make it explicit that
      // no pin was placed rather than silently implying one was.
      setDetailsError(true);
    }
  }

  /* ── Close dropdown on outside click ─────────────────────────────── */
  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  /* ── Helpers ─────────────────────────────────────────────────────── */
  function fillCls(field: string) {
    return aiFillingFields?.has(field) ? " cz-fill" : "";
  }
  function err(field: string) {
    return errors.find((e) => e.field === field)?.message;
  }

  const hasPinnedLocation = form.lat !== null && form.lng !== null;

  return (
    <div className="cz-card cz-fade cz-fade--2">
      <div className="cz-card__eyebrow">Step 2</div>
      <h2 className="cz-card__title">Property location</h2>
      <p className="cz-card__intent">
        Pin your property on the map so tenants can discover it while browsing.
      </p>

      <div className="cz-row">
        {/* City */}
        <div className="cz-field">
          <label className="cz-label" htmlFor="cz-city">
            City
          </label>
          <select
            id="cz-city"
            className={`cz-select${fillCls("city")}`}
            value={form.city}
            onChange={(e) => updateField("city", e.target.value)}
          >
            <option value="">Pick a city…</option>
            {CITIES.map((city) => (
              <option key={city} value={city.toLowerCase()}>
                {city}
              </option>
            ))}
          </select>
          {err("city") ? <p className="cz-error">{err("city")}</p> : null}
        </div>

        {/* Locality with Places Autocomplete */}
        <div className="cz-field" ref={dropdownRef} style={{ position: "relative" }}>
          <label className="cz-label" htmlFor="cz-locality">
            Locality
            {hasPinnedLocation && (
              <span className="cz-loc-badge">
                <span className="cz-loc-badge__dot" />
                pinned
              </span>
            )}
          </label>
          <input
            id="cz-locality"
            className={`cz-input${fillCls("locality")}`}
            value={localityInput}
            onChange={(e) => {
              const val = e.target.value;
              setLocalityInput(val);
              updateField("locality", val);
              setDetailsError(false);
              // Clear pin when user manually edits
              if (form.lat !== null) {
                updateField("lat", null);
                updateField("lng", null);
              }
              if (enabled && val.length >= 2) {
                fetchPredictions(val);
                setShowDropdown(true);
              } else {
                setShowDropdown(false);
              }
            }}
            onFocus={() => {
              if (predictions.length > 0) setShowDropdown(true);
            }}
            placeholder="Search: Indiranagar, DLF Phase 3 …"
            autoComplete="off"
          />

          {/* Dropdown */}
          {showDropdown && predictions.length > 0 && (
            <div className="cz-places-dropdown">
              {predictions.map((p) => (
                <button
                  key={p.place_id}
                  type="button"
                  className="cz-places-dropdown__item"
                  onClick={() => handlePlaceSelect(p.place_id, p.description)}
                >
                  <span className="cz-places-dropdown__icon">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                  </span>
                  <span className="cz-places-dropdown__text">
                    <span className="cz-places-dropdown__main">
                      {p.structured_formatting.main_text}
                    </span>
                    <span className="cz-places-dropdown__sub">
                      {p.structured_formatting.secondary_text}
                    </span>
                  </span>
                </button>
              ))}
              <div className="cz-places-dropdown__powered">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                Powered by Google
              </div>
            </div>
          )}

          {/* Field-level status: keep the owner informed instead of a dead field */}
          {placesUnavailable ? (
            <p className="cz-help cz-help--warn">
              Locality search is unavailable right now. Type your locality and drop the pin on the
              map below.
            </p>
          ) : detailsError ? (
            <p className="cz-help cz-help--warn">
              We couldn&apos;t place the pin automatically. Drop the pin on the map below to set the
              location.
            </p>
          ) : placesLoading ? (
            <p className="cz-help">Searching localities…</p>
          ) : noResults && localityInput.trim().length >= 2 ? (
            <p className="cz-help">
              No matches found. Keep typing, or click the map to drop a pin.
            </p>
          ) : null}
        </div>
      </div>

      {/* Mini-map — always visible, slides to show pin when coordinates set */}
      <div
        className={`cz-minimap${hasPinnedLocation ? " cz-minimap--visible" : ""}`}
        aria-label="Property location preview"
      >
        <div className="cz-minimap__header">
          <span className="cz-minimap__title">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
              <line x1="8" y1="2" x2="8" y2="18" />
              <line x1="16" y1="6" x2="16" y2="22" />
            </svg>
            Map preview
          </span>
          {hasPinnedLocation && (
            <span className="cz-minimap__coords">
              {form.lat!.toFixed(4)}°N, {form.lng!.toFixed(4)}°E
            </span>
          )}
        </div>
        <div className="cz-minimap__canvas" ref={mapContainerRef} />
        <p className="cz-minimap__hint">
          {hasPinnedLocation
            ? "Drag the pin to fine-tune your property's exact location"
            : "Select a locality above, or click the map to drop a pin"}
        </p>
      </div>

      {/* Remaining fields */}
      <div className="cz-row" style={{ marginTop: 24 }}>
        <div className="cz-field">
          <label className="cz-label" htmlFor="cz-landmark">
            Nearest landmark
          </label>
          <input
            id="cz-landmark"
            className={`cz-input${fillCls("landmark")}`}
            value={form.landmark}
            onChange={(e) => updateField("landmark", e.target.value)}
            placeholder="Near Huda City Centre Metro"
          />
        </div>

        <div className="cz-field">
          <label className="cz-label" htmlFor="cz-pincode">
            Pincode
          </label>
          <input
            id="cz-pincode"
            className={`cz-input cz-input--numeric${fillCls("pincode")}`}
            value={form.pincode}
            onChange={(e) => updateField("pincode", e.target.value)}
            placeholder="122002"
            maxLength={6}
            inputMode="numeric"
            pattern="[0-9]*"
          />
        </div>
      </div>

      <div className="cz-field cz-field--full" style={{ marginTop: 24 }}>
        <label className="cz-label" htmlFor="cz-address">
          Full address
        </label>
        <textarea
          id="cz-address"
          className={`cz-textarea${fillCls("address")}`}
          value={form.address}
          onChange={(e) => updateField("address", e.target.value)}
          placeholder="House number, street, sector: anything that helps a verifier reach the door."
          rows={2}
        />
        <p className="cz-help">Kept private. Tenants only see locality + landmark.</p>
      </div>
    </div>
  );
}
