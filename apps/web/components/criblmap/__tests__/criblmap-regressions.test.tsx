import { useEffect } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MapResultsRail } from "../MapResultsRail";
import { BottomBar } from "../BottomBar";
import { TopBar } from "../TopBar";
import { useAlertZones } from "../hooks/useAlertZones";
import {
  initialMapState,
  mapReducer,
  MapStateProvider,
  useMapDispatch,
  type MapPin,
  type SeekerPin
} from "../hooks/useMapState";
import { SeekerFormPanel } from "../panels/SeekerFormPanel";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" })
}));
vi.mock("../../../lib/client-auth", () => ({
  readAuthSession: () => null
}));

const basePin: MapPin = {
  id: "11111111-1111-1111-1111-111111111111",
  lat: 26.86,
  lng: 80.94,
  title: "Gomti PG",
  monthly_rent: 12000,
  listing_type: "pg",
  bhk: null,
  verification_status: "verified",
  furnishing: "fully_furnished",
  cover_photo: null,
  city: "lucknow",
  locality: "Gomti Nagar",
  locality_slug: "gomti-nagar"
};

function SeedPins({ pins }: { pins: MapPin[] }) {
  const dispatch = useMapDispatch();
  useEffect(() => {
    dispatch({ type: "SET_PINS", pins });
  }, [dispatch, pins]);
  return null;
}

function SeedDemand({ pins }: { pins: SeekerPin[] }) {
  const dispatch = useMapDispatch();
  useEffect(() => {
    dispatch({ type: "TOGGLE_DEMAND_VIEW" });
    dispatch({ type: "SET_SEEKER_PINS", pins });
  }, [dispatch, pins]);
  return null;
}

function AlertZoneProbe({ token }: { token: string | null }) {
  useAlertZones(token);
  return null;
}

describe("CriblMap regressions", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [] })
      }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clears a selected pin when refreshed pins no longer contain it", () => {
    const selected = mapReducer(initialMapState, {
      type: "SELECT_PIN",
      pinId: basePin.id
    });

    const next = mapReducer(selected, {
      type: "SET_PINS",
      pins: [{ ...basePin, id: "22222222-2222-2222-2222-222222222222" }]
    });

    expect(next.selectedPinId).toBeNull();
    expect(next.panelContent).toEqual({ type: "none" });
  });

  it("renders result locality and uses accurate details copy", async () => {
    render(
      <MapStateProvider>
        <SeedPins pins={[basePin]} />
        <MapResultsRail locale="en" map={null} />
      </MapStateProvider>
    );

    expect(await screen.findByText(/Gomti Nagar/i)).toBeTruthy();
    expect(screen.getByText(/View details/i)).toBeTruthy();
    expect(screen.queryByText(/Request to book/i)).toBeNull();
  });

  it("renders a single rail empty state for zero listings", () => {
    render(
      <MapStateProvider>
        <MapResultsRail locale="en" map={null} />
      </MapStateProvider>
    );

    expect(screen.getAllByText(/No listings in this area/i)).toHaveLength(1);
  });

  it("sends bearer auth when fetching alert zones", async () => {
    render(
      <MapStateProvider>
        <AlertZoneProbe token="acc_map" />
      </MapStateProvider>
    );

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const headers = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]
      ?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer acc_map");
  });

  it("links unauthenticated seeker pin users to the real auth route", async () => {
    render(
      <MapStateProvider>
        <SeekerFormPanel locale="en" />
      </MapStateProvider>
    );

    const link = await screen.findByRole("link", { name: /sign in to continue/i });
    expect(link).toHaveAttribute("href", "/auth/login?from=%2Fen%2Fmap");
  });

  it("labels fallback demand as estimated instead of active seekers", async () => {
    const estimatedPin: SeekerPin = {
      id: "estimated_11111111-1111-1111-1111-111111111111",
      lat: 26.86,
      lng: 80.94,
      budget_min: 9000,
      budget_max: 13200,
      bhk_preference: [],
      move_in: "flexible",
      listing_type: "pg",
      note: null,
      radius_m: 900,
      tags: [],
      created_at: "2026-07-03T00:00:00.000Z",
      source: "estimated"
    };

    render(
      <MapStateProvider>
        <SeedPins pins={[basePin]} />
        <SeedDemand pins={[estimatedPin]} />
        <BottomBar />
      </MapStateProvider>
    );

    expect(await screen.findByText(/estimated demand area/i)).toBeTruthy();
    expect(screen.queryByText(/active seeker/i)).toBeNull();
  });

  it("searches local Cribliv map places without Google Places", async () => {
    const onPlaceSelect = vi.fn();

    render(
      <MapStateProvider>
        <TopBar locale="en" onPlaceSelect={onPlaceSelect} />
      </MapStateProvider>
    );

    fireEvent.change(screen.getByPlaceholderText(/search locality/i), {
      target: { value: "gomti" }
    });
    const matches = await screen.findAllByRole("button", { name: /gomti nagar/i });
    fireEvent.click(matches[0]);

    expect(onPlaceSelect).toHaveBeenCalledWith(26.8648, 81.0085);
  });
});
