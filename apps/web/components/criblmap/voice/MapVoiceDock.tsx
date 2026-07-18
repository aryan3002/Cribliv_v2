"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMapState, useMapDispatch, type MapPin } from "../hooks/useMapState";
import { useMapCamera } from "../MapCameraController";
import { useHoldToTalk } from "./useHoldToTalk";
import { buildMapIntent } from "../../../lib/map-intent";
import { partitionPins, type PartitionResult } from "../../../lib/map-post-filter";
import { computeNegotiationDoors, type Door } from "../../../lib/map-negotiation";
import type { IntentChip, ClientFilter } from "../../../lib/map-intent-types";
import { IntentChips } from "./IntentChips";
import { MapResultsSheet, type Snap } from "./MapResultsSheet";
import { NegotiationDoors } from "./NegotiationDoors";
import { DemandCaptureSheet } from "./DemandCaptureSheet";
import { VoiceOrb } from "../../listing-wizard/VoiceOrb";
import { mapVoice } from "../../../lib/map-voice-analytics";
import { fetchApi, buildSearchQuery } from "../../../lib/api";
import { t, type Locale } from "../../../lib/i18n";
import "./orb-tokens.css";
import "./voice-map.css";

// Mirrors useMapPins.ts's private MapPinResponse shape (that interface isn't
// exported). Task 19 correction F: the negotiation-door fetch below
// deliberately queries WITHOUT max_rent/verified_only, so it needs its own
// copy of the raw API row shape rather than reusing useMapPins' internals.
interface MapPinResponse {
  id: string;
  lat: number;
  lng: number;
  title: string;
  monthly_rent: number;
  listing_type: string;
  bhk: number | null;
  verification_status: string;
  furnishing: string | null;
  cover_photo: string | null;
  city: string;
  locality: string | null;
  locality_slug: string | null;
}

function roundCoord(value: number): number {
  return Number(value.toFixed(5));
}

export function MapVoiceDock({ locale }: { locale: Locale }) {
  const { pins, filters, viewport } = useMapState();
  const dispatch = useMapDispatch();
  const camera = useMapCamera();

  const [caption, setCaption] = useState("");
  const [chips, setChips] = useState<IntentChip[]>([]);
  const [clientFilters, setClientFilters] = useState<ClientFilter[]>([]);
  const [snap, setSnap] = useState<Snap>("peek");
  const [partition, setPartition] = useState<PartitionResult | null>(null);
  const [doors, setDoors] = useState<Door[]>([]);
  const [captureFor, setCaptureFor] = useState<IntentChip | null>(null);

  const applyTranscript = useCallback(
    (transcript: string) => {
      const intent = buildMapIntent({ transcript });
      // Localize the "can't filter yet" reason surfaced by unsupported chips
      // (map-intent.ts is a pure, locale-less lib module, so the orchestrator
      // is where locale-aware copy gets attached — correction D).
      const localizedChips = intent.chips.map((chip) =>
        chip.status === "unsupported" ? { ...chip, reason: t(locale, "mvCantFilterYet") } : chip
      );
      setChips(localizedChips);
      setClientFilters(intent.clientFilters);

      mapVoice.transcript(
        transcript,
        intent.chips.filter((c) => c.status === "applied").map((c) => c.label),
        intent.chips.filter((c) => c.status === "unsupported").map((c) => c.label)
      );

      if (intent.camera) {
        camera.flyTo(intent.camera);
        const placeChip = intent.chips.find((c) => c.kind === "locality" || c.kind === "city");
        mapVoice.cameraFly(String(placeChip?.label ?? ""), intent.camera.kind);
      }

      // Merge, never replace — SET_FILTERS overwrites the whole filters
      // object, so a bare `intent.serverFilters` would silently drop any
      // filter set by a previous utterance or the filter drawer (correction E).
      dispatch({ type: "SET_FILTERS", filters: { ...filters, ...intent.serverFilters } });
      // MapResultsSheet only renders its body (chips/doors/capture) when
      // snap !== "peek" — a query just produced exactly that content, so
      // auto-expand to reveal it instead of leaving the sheet collapsed.
      setSnap("half");
    },
    [camera, dispatch, filters, locale]
  );

  // Re-partition once pins settle (state.pins updates asynchronously via
  // useMapPins' debounced fetch upstream in map-view.tsx, driven by the
  // SET_FILTERS dispatch above landing in `filters`).
  useEffect(() => {
    if (chips.length === 0) {
      setPartition(null);
      return;
    }
    const part = partitionPins(pins, clientFilters);
    setPartition(part);
    dispatch({ type: "SET_HIGHLIGHT", pinIds: part.matchedIds });
    mapVoice.result(part.count, part.isComplete);
  }, [pins, clientFilters, chips.length, dispatch]);

  // Negotiation doors (Task 19 correction F — "critical honesty fix").
  // `pins` above is whatever useMapPins last fetched, and that fetch sends
  // max_rent/verified_only as HARD server filters — so listings above the
  // current rent cap never reach `pins` at all. Feeding that same set into
  // computeNegotiationDoors would make "stretch budget" silently always
  // compute a 0 gain. So once the honest match count is truthfully zero, do
  // a SEPARATE fetch of this viewport with max_rent/verified_only dropped,
  // purely to power the doors (never written back into state.pins).
  // negotiationKeyRef guards against refiring the fetch on every render —
  // it only refires when the actual query (filters/clientFilters/viewport)
  // changes, not merely when `partition` gets a new object identity.
  const negotiationKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!partition) return;
    if (partition.count !== 0) {
      setDoors([]);
      negotiationKeyRef.current = null;
      return;
    }

    const key = JSON.stringify({ filters, clientFilters, viewport });
    if (negotiationKeyRef.current === key) return;
    negotiationKeyRef.current = key;

    const controller = new AbortController();
    let cancelled = false;

    async function loadDoors() {
      let negotiationPins: MapPin[] = [];
      try {
        if (viewport) {
          const query = buildSearchQuery({
            sw_lat: roundCoord(viewport.sw_lat),
            sw_lng: roundCoord(viewport.sw_lng),
            ne_lat: roundCoord(viewport.ne_lat),
            ne_lng: roundCoord(viewport.ne_lng),
            limit: 500,
            ...(filters.bhk && { bhk: filters.bhk }),
            ...(filters.listing_type && { listing_type: filters.listing_type })
          });
          const data = await fetchApi<MapPinResponse[]>(`/listings/search/map?${query}`, {
            signal: controller.signal
          });
          negotiationPins = data.map((p) => ({ ...p }));
        }
      } catch {
        // Network/abort failure — fall through with an empty set so the
        // always-present "subscribe" door still renders (correction F).
        negotiationPins = [];
      }
      if (cancelled) return;
      const computed = computeNegotiationDoors({
        pins: negotiationPins,
        serverFilters: filters,
        clientFilters
      });
      setDoors(computed);
      mapVoice.negotiationShown(computed.map((d) => d.id));
    }

    loadDoors();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [partition, filters, clientFilters, viewport]);

  const speech = useHoldToTalk({
    lang: locale === "hi" ? "hi-IN" : "en-IN",
    onInterim: setCaption,
    onFinal: (transcript) => {
      setCaption(transcript);
      applyTranscript(transcript);
    }
  });

  const mayaLine = useMemo(() => {
    if (chips.length === 0 || !partition) return t(locale, "mvHoldToSpeak");
    if (partition.count === 0) return t(locale, "mvNoneHere");
    const countLine = `${partition.count} ${partition.count === 1 ? "home" : "homes"}`;
    return partition.isComplete ? `${countLine}. ${t(locale, "mvThatsEverything")}` : countLine;
  }, [chips.length, partition, locale]);

  // computeNegotiationDoors (a pure, locale-less lib) bakes in an English
  // "Text me when one lists" label for the always-present subscribe door.
  // Overriding it here is what makes the door read "Notify me" in either
  // language instead of always English.
  const localizedDoors = useMemo(
    () => doors.map((d) => (d.id === "subscribe" ? { ...d, label: t(locale, "mvNotifyMe") } : d)),
    [doors, locale]
  );

  const captureLocality = useMemo(() => {
    const hit = clientFilters.find((f) => f.kind === "locality");
    return hit && hit.kind === "locality" ? hit.value : undefined;
  }, [clientFilters]);

  const handleDoorPick = useCallback(
    (door: Door) => {
      if (door.id === "subscribe") {
        setCaptureFor(chips[0] ?? null);
        return;
      }
      if (!door.relaxed) return;
      dispatch({ type: "SET_FILTERS", filters: { ...filters, ...door.relaxed.serverFilters } });
      // Doors like "loosen furnishing" only change the client-side filter —
      // without also applying door.relaxed.clientFilters here, picking that
      // door would dispatch a no-op SET_FILTERS and nothing would happen.
      setClientFilters(door.relaxed.clientFilters);
    },
    [dispatch, filters, chips]
  );

  return (
    <>
      <MapResultsSheet mayaLine={mayaLine} snap={snap} onSnapChange={setSnap}>
        {chips.length > 0 && <IntentChips chips={chips} onBell={setCaptureFor} />}
        {doors.length > 0 && <NegotiationDoors doors={localizedDoors} onPick={handleDoorPick} />}
        {captureFor && (
          <DemandCaptureSheet
            prefill={{
              filters: { ...filters },
              locality: captureLocality,
              unmet: captureFor.label
            }}
            onDone={() => {
              // DemandCaptureSheet only renders the "Done" control after a
              // successful postDemandSignal, so this is a reliable proxy for
              // "a signal was actually captured" — the funnel-completion
              // counterpart to mapVoice.negotiationShown's funnel-entry event.
              mapVoice.demandCapture({
                filters: { ...filters },
                locality: captureLocality,
                unmet: captureFor.label
              });
              setCaptureFor(null);
            }}
          />
        )}
      </MapResultsSheet>

      <div className="mv-dock">
        {caption && <div className="mv-dock__caption">{caption}</div>}
        {speech.supported ? (
          // VoiceOrb renders its own <button class="cz-orb-wrap">, so the
          // hold trigger itself must NOT be a <button> (no button-in-button —
          // correction B). role="button" + tabIndex/key handlers restore the
          // interactive semantics a real button would give for free.
          <div
            className="maya-orb-wrap mv-dock__orb"
            role="button"
            tabIndex={0}
            aria-label={
              speech.state === "listening" ? t(locale, "mvListening") : t(locale, "mvHoldToSpeak")
            }
            onPointerDown={() => {
              // Re-entrancy guard (correction C): a second pointerdown while
              // already listening (e.g. a stray touch) must not restart it.
              if (speech.state !== "listening") {
                mapVoice.holdStart();
                speech.start();
              }
            }}
            onPointerUp={() => speech.stop()}
            onPointerLeave={() => speech.stop()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (speech.state !== "listening") {
                  mapVoice.holdStart();
                  speech.start();
                }
              }
            }}
            onKeyUp={(e) => {
              if (e.key === "Enter" || e.key === " ") speech.stop();
            }}
          >
            <VoiceOrb
              state={speech.state === "listening" ? "listening" : "idle"}
              userLevel={0}
              assistantLevel={0}
              size={52}
            />
          </div>
        ) : (
          <form
            className="mv-dock__fallback"
            onSubmit={(e) => {
              e.preventDefault();
              const value = (new FormData(e.currentTarget).get("q") as string) ?? "";
              mapVoice.fallbackText();
              if (value.trim()) applyTranscript(value.trim());
            }}
          >
            <input
              name="q"
              className="mv-capture__input"
              placeholder={t(locale, "mvTypeInstead")}
            />
          </form>
        )}
      </div>
    </>
  );
}
