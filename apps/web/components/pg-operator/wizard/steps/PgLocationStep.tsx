"use client";
import { Dispatch, useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { PgWizardState, PgWizardAction } from "@/lib/pg-wizard-state";
import { useGooglePlaces } from "@/lib/google-places";
import { ensureMapsLoaded } from "@/lib/google-maps";
import { CRIBLMAP_DARK_STYLE } from "@/lib/map-styles";
import { trackPgFunnel } from "@/lib/pg-funnel";
import { createPgProperty, listCityLocalities, type PgCityLocality } from "@/lib/pg-operator-api";
import { CITIES } from "@/components/listing-wizard/types";

// Slug-ify a city display name (e.g. "New Delhi" → "new-delhi")
function toSlug(city: string) {
  return city.toLowerCase().replace(/\s+/g, "-");
}

// Default centroids per city slug for map initialisation before a pin is set
const CITY_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  delhi: { lat: 28.6139, lng: 77.209 },
  gurugram: { lat: 28.4595, lng: 77.0266 },
  noida: { lat: 28.5355, lng: 77.391 },
  ghaziabad: { lat: 28.6692, lng: 77.4538 },
  faridabad: { lat: 28.4089, lng: 77.3178 },
  chandigarh: { lat: 30.7333, lng: 76.7794 },
  jaipur: { lat: 26.9124, lng: 75.7873 },
  lucknow: { lat: 26.8467, lng: 80.9462 }
};

interface Props {
  state: PgWizardState;
  dispatch: Dispatch<PgWizardAction>;
  locale: string;
  accessToken: string | null;
}

export default function PgLocationStep({ state, dispatch, accessToken }: Props) {
  const d = state.draft;
  const setF = (path: string, value: unknown) => dispatch({ type: "SET_FIELD", path, value });

  const citySlug = d.property?.city_slug ?? "";
  const localitySlug = d.property?.locality_slug ?? "";
  const lat = (d.property as any)?.lat as number | null | undefined;
  const lng = (d.property as any)?.lng as number | null | undefined;

  const [addressInput, setAddressInput] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const geocodedRef = useRef(false);

  // Canonical localities for the selected city — the SAME set used by locality
  // search, SEO landing pages and CriblMaps. The operator MUST pick from this
  // set (we never persist free Places text), so every PG is findable.
  const [localities, setLocalities] = useState<PgCityLocality[]>([]);
  useEffect(() => {
    if (!citySlug) {
      setLocalities([]);
      return;
    }
    let active = true;
    listCityLocalities(citySlug)
      .then((r) => active && setLocalities(r.items ?? []))
      .catch(() => active && setLocalities([]));
    return () => {
      active = false;
    };
  }, [citySlug]);

  // Snap a geocoded point to the nearest canonical locality (Euclidean on
  // lat/lng — adequate at city scale). Keeps the stored locality_slug canonical
  // even when the operator searches a precise street address via Places.
  function snapNearestLocality(pointLat: number, pointLng: number) {
    let best: PgCityLocality | null = null;
    let bestD = Infinity;
    for (const loc of localities) {
      if (loc.lat == null || loc.lng == null) continue;
      const dLat = loc.lat - pointLat;
      const dLng = loc.lng - pointLng;
      const dist = dLat * dLat + dLng * dLng;
      if (dist < bestD) {
        bestD = dist;
        best = loc;
      }
    }
    if (best) setF("property.locality_slug", best.slug);
  }

  // NOTE: Google's getPlacePredictions rejects mixing `establishment` with
  // address types (→ INVALID_REQUEST → zero predictions). Use the same
  // address-only set the owner wizard uses.
  const { predictions, fetchPredictions, getPlaceDetails, clearPredictions } = useGooglePlaces({
    types: ["locality", "sublocality", "neighborhood", "route", "street_address"]
  });

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);

  // City select → update city_slug
  const onCityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setF("property.city_slug", e.target.value);
  };

  // Address input → fetch predictions
  const onAddressInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setAddressInput(val);
    if (val.length >= 2) {
      fetchPredictions(val);
      setShowDropdown(true);
    } else {
      clearPredictions();
      setShowDropdown(false);
    }
  };

  // Select a prediction
  const onSelectPrediction = async (placeId: string, description: string) => {
    setAddressInput(description);
    setShowDropdown(false);
    clearPredictions();

    const details = await getPlaceDetails(placeId);
    if (!details) return;

    setF("property.lat", details.geometry.lat);
    setF("property.lng", details.geometry.lng);
    setF("property.formatted_address", details.formatted_address);
    placePin(details.geometry.lat, details.geometry.lng);
    snapNearestLocality(details.geometry.lat, details.geometry.lng);

    // Geocode resolved funnel event (fire once per session)
    if (!geocodedRef.current) {
      geocodedRef.current = true;
      void trackPgFunnel({
        event_type: "geocode_resolved",
        source: "manual",
        step_no: 2,
        draft_id: state.draftId
      });
    }
  };

  // Place / move the draggable marker. Does NOT commit to state — callers do
  // (avoids a setF → re-render → effect → setF loop). Mirrors owner LocationStep.
  function placePin(newLat: number, newLng: number) {
    const map = mapInstanceRef.current;
    if (!map || typeof google === "undefined") return;
    const pos = { lat: newLat, lng: newLng };
    if (markerRef.current) {
      markerRef.current.setPosition(pos);
    } else {
      const marker = new google.maps.Marker({ map, position: pos, draggable: true });
      marker.addListener("dragend", () => {
        const p = marker.getPosition();
        if (!p) return;
        setF("property.lat", p.lat());
        setF("property.lng", p.lng());
        snapNearestLocality(p.lat(), p.lng());
      });
      markerRef.current = marker;
    }
    map.panTo(pos);
  }

  // Initialise map client-side only. Legacy draggable Marker (no mapId, so the
  // dark style applies) + ResizeObserver to avoid gray/partial tiles while the
  // step is sized inside the framer-motion entry animation.
  useEffect(() => {
    let observer: ResizeObserver | null = null;
    ensureMapsLoaded().then(() => {
      if (typeof google === "undefined" || !mapRef.current || mapInstanceRef.current) return;
      const centroid = CITY_CENTROIDS[citySlug] ?? CITY_CENTROIDS.lucknow;
      const center = lat != null && lng != null ? { lat, lng } : centroid;

      const map = new google.maps.Map(mapRef.current, {
        center,
        zoom: lat != null ? 15 : 12,
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: "cooperative",
        clickableIcons: false,
        styles: CRIBLMAP_DARK_STYLE
      });
      mapInstanceRef.current = map;

      observer = new ResizeObserver(() => {
        google.maps.event.trigger(map, "resize");
        const c = map.getCenter();
        if (c) map.setCenter(c);
      });
      observer.observe(mapRef.current);

      // Click-to-place pin
      map.addListener("click", (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;
        const clickLat = e.latLng.lat();
        const clickLng = e.latLng.lng();
        placePin(clickLat, clickLng);
        setF("property.lat", clickLat);
        setF("property.lng", clickLng);
        snapNearestLocality(clickLat, clickLng);
      });

      // Existing coords (resume / hydration) → drop pin immediately
      if (lat != null && lng != null) placePin(lat, lng);
    });
    return () => observer?.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync marker when lat/lng change externally (autocomplete select, draft
  // hydration, drag). Moves the marker only — never commits — so no loop.
  useEffect(() => {
    if (lat == null || lng == null || !mapInstanceRef.current) return;
    placePin(lat, lng);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  return (
    <section className="pgo-stagger">
      <div className="pgo-form-section">
        <div className="pgo-section-header">
          <div className="pgo-section-header__icon">
            <MapPin size={20} />
          </div>
          <div className="pgo-section-header__text">
            <span className="pgo-overline">Location</span>
            <span className="pgo-heading pgo-heading--xs">Where is your PG?</span>
          </div>
        </div>

        {/* City select */}
        <div className="pgo-field">
          <select
            className="pgo-field__input"
            aria-label="city"
            value={citySlug}
            onChange={onCityChange}
          >
            <option value="">Select city</option>
            {CITIES.map((city) => (
              <option key={city} value={toSlug(city)}>
                {city}
              </option>
            ))}
          </select>
          <label className="pgo-field__label">City</label>
          <span className="pgo-field__bar" />
        </div>

        {/* Canonical locality select — drives locality search, SEO & CriblMaps.
            Auto-filled from the geocoded pin; operator can confirm/override. */}
        <div className="pgo-field">
          <select
            className="pgo-field__input"
            aria-label="locality"
            value={localitySlug}
            disabled={!citySlug || localities.length === 0}
            onChange={(e) => setF("property.locality_slug", e.target.value)}
          >
            <option value="">{citySlug ? "Select locality" : "Select a city first"}</option>
            {localities.map((loc) => (
              <option key={loc.slug} value={loc.slug}>
                {loc.name_en}
              </option>
            ))}
          </select>
          <label className="pgo-field__label">Locality</label>
          <span className="pgo-field__bar" />
        </div>

        {/* Address autocomplete */}
        <div className="pgo-field" style={{ position: "relative" }}>
          <input
            className="pgo-field__input"
            aria-label="address search"
            value={addressInput}
            onChange={onAddressInput}
            onFocus={() => predictions.length > 0 && setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            placeholder=" "
            autoComplete="off"
          />
          <label className="pgo-field__label">Address / area</label>
          <span className="pgo-field__bar" />
          {showDropdown && predictions.length > 0 && (
            <ul className="pgo-autocomplete-dropdown" role="listbox">
              {predictions.map((p) => (
                <li
                  key={p.place_id}
                  role="option"
                  aria-selected={false}
                  className="pgo-autocomplete-item"
                  onMouseDown={() => onSelectPrediction(p.place_id, p.description)}
                >
                  <span className="pgo-autocomplete-item__main">
                    {p.structured_formatting.main_text}
                  </span>
                  <span className="pgo-autocomplete-item__secondary">
                    {p.structured_formatting.secondary_text}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Geocoded address display */}
        {(d.property as any)?.formatted_address && (
          <p className="pgo-caption" style={{ marginTop: 4 }}>
            <MapPin size={12} style={{ display: "inline", marginRight: 4 }} />
            {(d.property as any).formatted_address}
          </p>
        )}
      </div>

      {/* Map */}
      <div
        ref={mapRef}
        style={{ width: "100%", height: 260, borderRadius: 12, marginTop: 16 }}
        aria-label="property location map"
      />

      {error && (
        <p role="alert" className="pgo-error-msg" style={{ marginTop: 8 }}>
          {error}
        </p>
      )}

      <div className="pgo-step-nav">
        <button
          className="pgo-btn pgo-btn--secondary"
          type="button"
          onClick={() => dispatch({ type: "GOTO_STEP", step: 1 })}
        >
          Back
        </button>
        <button
          className="pgo-btn pgo-btn--primary pgo-btn--lg"
          type="button"
          disabled={busy || !citySlug || !localitySlug}
          onClick={async () => {
            if (!citySlug) {
              setError("Select a city first.");
              return;
            }
            if (!localitySlug) {
              setError("Select a locality so tenants can find your PG.");
              return;
            }
            setError(null);
            // Create property on the server the first time (if not yet created)
            if (!state.pgPropertyId) {
              if (!accessToken) {
                setError("Sign in required.");
                return;
              }
              setBusy(true);
              try {
                const prop = await createPgProperty({
                  idempotencyKey: crypto.randomUUID(),
                  token: accessToken,
                  input: {
                    display_name: d.property?.display_name ?? "My PG",
                    city_slug: citySlug,
                    ...(d.property?.locality_slug
                      ? { locality_slug: d.property.locality_slug }
                      : {}),
                    ...(d.property?.total_floors ? { total_floors: d.property.total_floors } : {}),
                    ...((d.property as any)?.lat != null ? { lat: (d.property as any).lat } : {}),
                    ...((d.property as any)?.lng != null ? { lng: (d.property as any).lng } : {})
                  }
                });
                dispatch({ type: "SET_PG_PROPERTY_ID", pgPropertyId: prop.id });
              } catch (e) {
                const err = e as Error & { code?: string };
                setError(
                  err.code === "multi_property_not_enabled"
                    ? "You already have a property registered. Refresh and try again."
                    : err.message
                );
                setBusy(false);
                return;
              }
              setBusy(false);
            }
            dispatch({ type: "GOTO_STEP", step: 3 });
          }}
        >
          {busy ? (
            <>
              Saving
              <span className="pgo-loading-dots">
                <span />
                <span />
                <span />
              </span>
            </>
          ) : (
            "Next"
          )}
        </button>
      </div>
    </section>
  );
}
