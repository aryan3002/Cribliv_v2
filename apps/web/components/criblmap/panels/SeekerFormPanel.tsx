"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  MapPinPlus,
  Loader2,
  AlertCircle,
  LogIn,
  Sparkles,
  ExternalLink,
  Home
} from "lucide-react";
import { useMapState, useMapDispatch } from "../hooks/useMapState";
import { fetchApi, buildSearchQuery, ApiError } from "../../../lib/api";
import { readAuthSession } from "../../../lib/client-auth";
import { haversineKm } from "../../../lib/geo";
import { listingHref } from "../../../lib/listing-href";

interface SeekerFormPanelProps {
  locale: string;
}

const BHK_OPTIONS = [1, 2, 3, 4];
const MOVE_IN_OPTIONS = [
  { value: "immediate", label: "ASAP" },
  { value: "within_month", label: "Within 1 month" },
  { value: "within_3_months", label: "Within 3 months" },
  { value: "flexible", label: "Flexible" }
];
const RADIUS_OPTIONS = [
  { value: 500, label: "500 m" },
  { value: 1000, label: "1 km" },
  { value: 2000, label: "2 km" },
  { value: 3000, label: "3 km" }
];

/* ── Auth detection — accepts either next-auth session OR the legacy
 *  localStorage token written by the in-panel OTP flow. Mirrors the
 *  pattern used by UnlockContactPanel. */
function useAccessToken(): { token: string | null; status: "loading" | "ready" } {
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

/* ── Live match preview — bbox approximation around the seeker's pin
 *  using the requested radius. Counts visible map pins that satisfy the
 *  budget / BHK / type filter set so the seeker sees demand-side value
 *  BEFORE committing to a pin drop. */
interface MatchPin {
  id: string;
  title: string;
  monthly_rent: number;
  bhk: number | null;
  listing_type: string;
  verification_status: string;
  furnishing: string | null;
  cover_photo: string | null;
  lat: number;
  lng: number;
  city: string;
  locality: string | null;
  locality_slug: string | null;
}
function radiusToBboxDelta(lat: number, radiusM: number): { dLat: number; dLng: number } {
  const dLat = radiusM / 111_000; // 1° lat ≈ 111 km everywhere
  const dLng = radiusM / (111_000 * Math.cos((lat * Math.PI) / 180));
  return { dLat, dLng };
}

export function SeekerFormPanel({ locale }: SeekerFormPanelProps) {
  const { center } = useMapState();
  const dispatch = useMapDispatch();
  const { token, status: authStatus } = useAccessToken();

  const [budgetMin, setBudgetMin] = useState(5000);
  const [budgetMax, setBudgetMax] = useState(25000);
  const [bhkPreference, setBhkPreference] = useState<number[]>([2]);
  const [moveIn, setMoveIn] = useState("flexible");
  const [listingType, setListingType] = useState("flat_house");
  const [note, setNote] = useState("");
  const [radiusM, setRadiusM] = useState(1000);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [extractedTags, setExtractedTags] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  /* ─── Live match preview ───────────────────────────────────────── */
  const [matches, setMatches] = useState<MatchPin[]>([]);
  const [matchLoading, setMatchLoading] = useState(false);
  const matchAbortRef = useRef<AbortController | null>(null);
  const matchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matchKey = useMemo(
    () =>
      JSON.stringify({
        lat: center.lat.toFixed(4),
        lng: center.lng.toFixed(4),
        radiusM,
        budgetMax,
        bhkPreference: [...bhkPreference].sort(),
        listingType
      }),
    [center.lat, center.lng, radiusM, budgetMax, bhkPreference, listingType]
  );

  useEffect(() => {
    // Debounce — the user is usually scrubbing budget inputs.
    if (matchTimerRef.current) clearTimeout(matchTimerRef.current);
    matchTimerRef.current = setTimeout(() => {
      matchAbortRef.current?.abort();
      const controller = new AbortController();
      matchAbortRef.current = controller;
      setMatchLoading(true);

      const { dLat, dLng } = radiusToBboxDelta(center.lat, radiusM);
      const params: Record<string, string | number | boolean | undefined> = {
        sw_lat: center.lat - dLat,
        sw_lng: center.lng - dLng,
        ne_lat: center.lat + dLat,
        ne_lng: center.lng + dLng,
        limit: 50,
        ...(budgetMax > 0 && { max_rent: budgetMax }),
        ...(listingType === "pg" || listingType === "flat_house"
          ? { listing_type: listingType }
          : {}),
        // Single-BHK filter supported by the map endpoint; for multi-select
        // we'll post-filter on the client below.
        ...(bhkPreference.length === 1 ? { bhk: bhkPreference[0] } : {})
      };

      fetchApi<MatchPin[]>(`/listings/search/map?${buildSearchQuery(params)}`, {
        signal: controller.signal
      })
        .then((pins) => {
          if (controller.signal.aborted) return;
          // Hard-filter: budget_min + multi-BHK + true circle (Haversine) cull
          const filtered = pins.filter((p) => {
            if (p.monthly_rent > budgetMax) return false;
            if (budgetMin > 0 && p.monthly_rent < budgetMin) return false;
            if (bhkPreference.length > 0 && p.bhk != null && !bhkPreference.includes(p.bhk))
              return false;
            const km = haversineKm({ lat: center.lat, lng: center.lng }, p);
            return km * 1000 <= radiusM;
          });
          setMatches(filtered);
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setMatches([]);
        })
        .finally(() => setMatchLoading(false));
    }, 300);

    return () => {
      if (matchTimerRef.current) clearTimeout(matchTimerRef.current);
    };
  }, [matchKey, center.lat, center.lng, radiusM, budgetMax, budgetMin, bhkPreference, listingType]);

  const toggleBhk = useCallback((bhk: number) => {
    setBhkPreference((prev) =>
      prev.includes(bhk) ? prev.filter((b) => b !== bhk) : [...prev, bhk]
    );
  }, []);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    if (!token) {
      setErrorMsg("Sign in to drop a search pin.");
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);

    try {
      const created = await fetchApi<{ id: string; tags: string[] }>("/map/seekers", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          lat: center.lat,
          lng: center.lng,
          budget_min: budgetMin,
          budget_max: budgetMax,
          bhk_preference: bhkPreference,
          move_in: moveIn,
          listing_type: listingType,
          note: note || undefined,
          radius_m: radiusM
        })
      });
      setExtractedTags(Array.isArray(created?.tags) ? created.tags : []);
      setSubmitted(true);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 403) {
          setErrorMsg("Your session expired. Sign in again to drop a pin.");
        } else if (err.status === 400) {
          setErrorMsg(err.message ?? "Some details look off. Check your inputs and try again.");
        } else {
          setErrorMsg(err.message ?? "Couldn't drop the pin. Try again in a moment.");
        }
      } else {
        setErrorMsg("Network error. Check your connection and retry.");
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    submitting,
    token,
    center,
    budgetMin,
    budgetMax,
    bhkPreference,
    moveIn,
    listingType,
    note,
    radiusM
  ]);

  /* ─── Success state ────────────────────────────────────────────── */
  if (submitted) {
    const listFilter = buildSearchQuery({
      lat: center.lat,
      lng: center.lng,
      radius_m: radiusM,
      ...(budgetMax > 0 && { max_rent: budgetMax }),
      ...(bhkPreference.length === 1 && { bhk: bhkPreference[0] }),
      ...(listingType === "pg" || listingType === "flat_house" ? { listing_type: listingType } : {})
    });
    return (
      <div className="cmap-seeker-form">
        <div className="cmap-seeker-form__success">
          <MapPinPlus size={32} />
          <h3>Search pin dropped</h3>
          <p>
            Active for 30 days within{" "}
            <strong>{radiusM >= 1000 ? `${radiusM / 1000} km` : `${radiusM} m`}</strong>. Owners in
            this area will see your requirement.
          </p>
        </div>

        {extractedTags.length > 0 && (
          <div className="cmap-seeker-form__tags-card">
            <div className="cmap-seeker-form__tags-head">
              <Sparkles size={14} />
              <span>We picked up from your note</span>
            </div>
            <div className="cmap-seeker-form__tag-chips">
              {extractedTags.map((t) => (
                <span key={t} className="cmap-seeker-form__tag-chip">
                  {t.replace(/-/g, " ")}
                </span>
              ))}
            </div>
          </div>
        )}

        {matches.length > 0 && (
          <div className="cmap-seeker-form__matches">
            <div className="cmap-seeker-form__matches-head">
              <Sparkles size={14} />
              <span>
                <strong>{matches.length}</strong> {matches.length === 1 ? "listing" : "listings"}{" "}
                already match
              </span>
            </div>
            <div className="cmap-seeker-form__matches-list">
              {matches.slice(0, 4).map((m) => (
                <Link
                  key={m.id}
                  href={listingHref(locale, m)}
                  className="cmap-seeker-form__match-card"
                >
                  {m.cover_photo ? (
                    <img
                      src={m.cover_photo}
                      alt=""
                      className="cmap-seeker-form__match-photo"
                      loading="lazy"
                    />
                  ) : (
                    <span className="cmap-seeker-form__match-photo cmap-seeker-form__match-photo--placeholder">
                      <Home size={16} />
                    </span>
                  )}
                  <span className="cmap-seeker-form__match-body">
                    <span className="cmap-seeker-form__match-rent">
                      ₹{m.monthly_rent.toLocaleString("en-IN")}
                      <span className="cmap-seeker-form__match-rent-unit">/mo</span>
                    </span>
                    <span className="cmap-seeker-form__match-title">{m.title}</span>
                  </span>
                  {m.verification_status === "verified" && (
                    <span className="cmap-seeker-form__match-verified">✓</span>
                  )}
                </Link>
              ))}
            </div>
            <Link
              href={`/${locale}/search?${listFilter}`}
              className="cmap-listing__cta cmap-listing__cta--secondary"
            >
              <ExternalLink size={14} /> View all matching listings
            </Link>
          </div>
        )}

        <button
          className="cmap-listing__cta cmap-listing__cta--secondary"
          onClick={() => dispatch({ type: "DESELECT_PIN" })}
        >
          Back to map
        </button>
      </div>
    );
  }

  /* ─── Unauthenticated state ─────────────────────────────────────── */
  if (authStatus === "ready" && !token) {
    return (
      <div className="cmap-seeker-form">
        <div className="cmap-seeker-form__intro">
          <MapPinPlus size={20} />
          <p>Drop a search pin to let owners know what you&apos;re looking for in this area.</p>
        </div>
        <div className="cmap-seeker-form__auth-required">
          <LogIn size={16} />
          <span>You need an account to drop a pin — keeps the demand signal honest.</span>
        </div>
        <Link
          href={`/auth/login?from=${encodeURIComponent("/" + locale + "/map")}`}
          className="cmap-listing__cta cmap-listing__cta--primary"
        >
          <LogIn size={14} /> Sign in to continue
        </Link>
      </div>
    );
  }

  /* ─── Form ──────────────────────────────────────────────────────── */
  return (
    <div className="cmap-seeker-form">
      <div className="cmap-seeker-form__intro">
        <MapPinPlus size={20} />
        <p>Drop a search pin to let owners know what you&apos;re looking for in this area.</p>
      </div>

      {/* Live match preview chip — updates as filters change */}
      <div
        className={`cmap-seeker-form__live-match${matches.length > 0 ? " cmap-seeker-form__live-match--has" : ""}`}
        role="status"
        aria-live="polite"
      >
        <Sparkles size={14} />
        {matchLoading && matches.length === 0 ? (
          <span>Searching nearby listings…</span>
        ) : matches.length === 0 ? (
          <span>No listings match yet — your pin tells owners to post.</span>
        ) : (
          <span>
            <strong>{matches.length}</strong>{" "}
            {matches.length === 1 ? "listing matches" : "listings match"} right now within{" "}
            {radiusM >= 1000 ? `${radiusM / 1000} km` : `${radiusM} m`}
          </span>
        )}
      </div>

      <div className="cmap-seeker-form__field">
        <label>Budget Range</label>
        <div className="cmap-seeker-form__budget">
          <div className="cmap-seeker-form__budget-input">
            <span>₹</span>
            <input
              type="number"
              value={budgetMin}
              onChange={(e) => setBudgetMin(Number(e.target.value))}
              min={0}
              step={1000}
            />
          </div>
          <span className="cmap-seeker-form__budget-sep">to</span>
          <div className="cmap-seeker-form__budget-input">
            <span>₹</span>
            <input
              type="number"
              value={budgetMax}
              onChange={(e) => setBudgetMax(Number(e.target.value))}
              min={1000}
              step={1000}
            />
          </div>
        </div>
      </div>

      <div className="cmap-seeker-form__field">
        <label>Search radius</label>
        <div className="cmap-seeker-form__chips">
          {RADIUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`cmap-filter-chip${radiusM === opt.value ? " cmap-filter-chip--active" : ""}`}
              onClick={() => setRadiusM(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="cmap-seeker-form__field">
        <label>BHK Preference</label>
        <div className="cmap-seeker-form__chips">
          {BHK_OPTIONS.map((bhk) => (
            <button
              key={bhk}
              className={`cmap-filter-chip${bhkPreference.includes(bhk) ? " cmap-filter-chip--active" : ""}`}
              onClick={() => toggleBhk(bhk)}
            >
              {bhk} BHK
            </button>
          ))}
        </div>
      </div>

      <div className="cmap-seeker-form__field">
        <label>Move-in Timing</label>
        <div className="cmap-seeker-form__chips">
          {MOVE_IN_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`cmap-filter-chip${moveIn === opt.value ? " cmap-filter-chip--active" : ""}`}
              onClick={() => setMoveIn(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="cmap-seeker-form__field">
        <label>Type</label>
        <div className="cmap-seeker-form__chips">
          <button
            className={`cmap-filter-chip${listingType === "flat_house" ? " cmap-filter-chip--active" : ""}`}
            onClick={() => setListingType("flat_house")}
          >
            Flat / House
          </button>
          <button
            className={`cmap-filter-chip${listingType === "pg" ? " cmap-filter-chip--active" : ""}`}
            onClick={() => setListingType("pg")}
          >
            PG
          </button>
        </div>
      </div>

      <div className="cmap-seeker-form__field">
        <label>Note (optional)</label>
        <textarea
          className="cmap-seeker-form__textarea"
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 200))}
          placeholder="e.g. Family with 2 kids, need parking, pet-friendly..."
          rows={3}
          maxLength={200}
        />
        <span className="cmap-seeker-form__char-count">{note.length}/200</span>
      </div>

      {errorMsg && (
        <div className="cmap-seeker-form__error" role="alert">
          <AlertCircle size={14} />
          <span>{errorMsg}</span>
        </div>
      )}

      <button
        className="cmap-listing__cta cmap-listing__cta--primary"
        onClick={handleSubmit}
        disabled={submitting || authStatus === "loading"}
      >
        {submitting ? <Loader2 size={14} className="cmap-spin" /> : <MapPinPlus size={14} />}
        {submitting ? "Dropping pin…" : "Drop Search Pin"}
      </button>
    </div>
  );
}
