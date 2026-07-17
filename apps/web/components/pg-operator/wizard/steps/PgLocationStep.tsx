"use client";
import { Dispatch, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { MapPin, Navigation, X } from "lucide-react";
import { PgWizardState, PgWizardAction } from "@/lib/pg-wizard-state";
import { useGooglePlaces } from "@/lib/google-places";
import { ensureMapsLoaded } from "@/lib/google-maps";
import { CRIBLMAP_DARK_STYLE } from "@/lib/map-styles";
import { trackPgFunnel } from "@/lib/pg-funnel";
import { getPgNearby, listCityLocalities, type PgCityLocality } from "@/lib/pg-operator-api";
import { CITIES } from "@/components/listing-wizard/types";
import SectionCard from "../shared/SectionCard";
import styles from "../shared/pg-wizard.module.css";

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

function NearbyTags({
  label,
  fieldKey,
  items,
  dispatch
}: {
  label: string;
  fieldKey: "metro" | "college" | "office";
  items: string[];
  dispatch: Dispatch<PgWizardAction>;
}) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const t = draft.trim();
    if (!t) return;
    dispatch({ type: "SET_FIELD", path: `pg_details.nearby.${fieldKey}`, value: [...items, t] });
    setDraft("");
  };
  const remove = (it: string) =>
    dispatch({
      type: "SET_FIELD",
      path: `pg_details.nearby.${fieldKey}`,
      value: items.filter((x) => x !== it)
    });

  return (
    <div>
      <span className={styles.fieldLabel} style={{ textTransform: "capitalize" }}>
        Nearby {label}
      </span>
      <div className={styles.tagInputWrap}>
        <input
          className={styles.tagInput}
          aria-label={`add ${label}`}
          value={draft}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          placeholder={`Type a ${label} and press Enter`}
        />
      </div>
      {items.length > 0 && (
        <div className={styles.tagList}>
          {items.map((it) => (
            <span key={it} className={styles.tag}>
              {it}
              <button
                type="button"
                className={styles.tagRemove}
                aria-label={`remove ${it}`}
                onClick={() => remove(it)}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
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
  const [error, setError] = useState<string | null>(null);
  const [snapHint, setSnapHint] = useState<string | null>(null);
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
    if (best && best.slug !== localitySlug) {
      if (!localitySlug) setF("property.locality_slug", best.slug);
      setSnapHint(best.name_en);
    }
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
  const nearbyCache = useRef(
    new Map<string, { metro: string[]; college: string[]; office: string[] }>()
  );
  const nearbyTimer = useRef<ReturnType<typeof setTimeout>>();

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

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !citySlug) return;
    const centroid = CITY_CENTROIDS[citySlug];
    if (centroid) {
      map.panTo(centroid);
      map.setZoom(12);
    }
  }, [citySlug]);

  useEffect(() => {
    if (!localitySlug) return;
    const locality = localities.find((item) => item.slug === localitySlug);
    if (!locality || locality.lat == null || locality.lng == null) return;
    setF("property.lat", locality.lat);
    setF("property.lng", locality.lng);
    placePin(locality.lat, locality.lng);
    mapInstanceRef.current?.setZoom(14);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localitySlug]);

  // Sync marker when lat/lng change externally (autocomplete select, draft
  // hydration, drag). Moves the marker only — never commits — so no loop.
  useEffect(() => {
    if (lat == null || lng == null || !mapInstanceRef.current) return;
    placePin(lat, lng);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  useEffect(() => {
    if (lat == null || lng == null || !accessToken) return;
    const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
    clearTimeout(nearbyTimer.current);
    nearbyTimer.current = setTimeout(async () => {
      let nearby = nearbyCache.current.get(key);
      if (!nearby) {
        nearby = await getPgNearby(accessToken, lat, lng);
        nearbyCache.current.set(key, nearby);
      }
      const current = state.draft.pg_details?.nearby ?? {};
      const keep = (existing: string[] | undefined, found: string[]) =>
        existing?.length ? existing : found;
      dispatch({
        type: "SET_FIELD",
        path: "pg_details.nearby",
        value: {
          metro: keep(current.metro, nearby.metro),
          college: keep(current.college, nearby.college),
          office: keep(current.office, nearby.office)
        }
      });
    }, 700);
    return () => clearTimeout(nearbyTimer.current);
  }, [accessToken, lat, lng, state.draft.pg_details?.nearby, dispatch]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SectionCard
        title="Where is your PG?"
        subtitle="Pick the city and locality, then drop a precise pin."
        icon={<MapPin size={20} />}
      >
        <div className={styles.row2}>
          <div>
            <span className={styles.fieldLabel}>City</span>
            <select
              className={styles.select}
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
          </div>
          <div>
            <span className={styles.fieldLabel}>Locality</span>
            <select
              className={styles.select}
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
          </div>
        </div>

        <div style={{ position: "relative" }}>
          <span className={styles.fieldLabel}>Address / area</span>
          <input
            className={styles.textInput}
            aria-label="address search"
            value={addressInput}
            onChange={onAddressInput}
            onFocus={() => predictions.length > 0 && setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            placeholder="Search a street, building or area"
            autoComplete="off"
          />
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

        <div ref={mapRef} className={styles.map} aria-label="property location map" />
        {(d.property as any)?.formatted_address ? (
          <p className={styles.mapHint}>
            <MapPin size={13} /> {(d.property as any).formatted_address}
          </p>
        ) : (
          <p className={styles.mapHint}>
            <Navigation size={13} /> Tap the map or search above to drop your pin.
          </p>
        )}
        {snapHint && (
          <p className={styles.mapHint}>
            <MapPin size={13} /> Nearest locality: {snapHint}
          </p>
        )}
        {error && (
          <p role="alert" style={{ color: "var(--pw-danger)", fontSize: 13, fontWeight: 600 }}>
            {error}
          </p>
        )}
      </SectionCard>

      <SectionCard
        title="What's nearby?"
        subtitle="Landmarks help tenants find you, optional but recommended."
        icon={<Navigation size={20} />}
      >
        <p className={styles.mapHint}>Auto-filled from map — edit as needed.</p>
        <NearbyTags
          label="metro"
          fieldKey="metro"
          items={state.draft.pg_details?.nearby?.metro ?? []}
          dispatch={dispatch}
        />
        <NearbyTags
          label="college"
          fieldKey="college"
          items={state.draft.pg_details?.nearby?.college ?? []}
          dispatch={dispatch}
        />
        <NearbyTags
          label="office"
          fieldKey="office"
          items={state.draft.pg_details?.nearby?.office ?? []}
          dispatch={dispatch}
        />
      </SectionCard>
    </div>
  );
}
