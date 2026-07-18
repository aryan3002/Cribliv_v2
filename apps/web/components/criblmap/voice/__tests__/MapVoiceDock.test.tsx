import { useEffect } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  MapStateProvider,
  useMapState,
  useMapDispatch,
  type MapPin
} from "../../hooks/useMapState";
import { MapCameraProvider } from "../../MapCameraController";
import { MapVoiceDock } from "../MapVoiceDock";
import { fetchApi } from "../../../../lib/api";

// The negotiation-door fallback fetch (Task 19 correction F) reads/writes
// through lib/api — mock it so this suite never touches the network, per
// the task's "keep it hermetic" instruction. buildSearchQuery stays real
// (pure), only fetchApi is replaced.
vi.mock("../../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/api")>();
  return {
    ...actual,
    fetchApi: vi.fn().mockResolvedValue([])
  };
});

// MapVoiceDock now calls useRouter() (a matched card's "unlock" routes to the
// listing page). jsdom has no App Router context, so stub it.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() })
}));

const fetchApiMock = vi.mocked(fetchApi);

beforeEach(() => {
  fetchApiMock.mockClear();
  fetchApiMock.mockResolvedValue([]);
});

function FiltersProbe() {
  const { filters } = useMapState();
  return <div data-testid="filters">{JSON.stringify(filters)}</div>;
}

// Dispatches SET_PINS on mount so a matched pin exists in real reducer state
// (useMapPins isn't mounted in these hermetic tests, so nothing else fills
// state.pins). Used to prove matched listings render as ListingReasonCards.
function PinSeeder({ pins }: { pins: MapPin[] }) {
  const dispatch = useMapDispatch();
  useEffect(() => {
    dispatch({ type: "SET_PINS", pins });
  }, [dispatch, pins]);
  return null;
}

// Seeds a viewport so the negotiation door-fetch (which is skipped when
// viewport is null) actually runs and we can inspect its query string.
function ViewportSeeder() {
  const dispatch = useMapDispatch();
  useEffect(() => {
    dispatch({
      type: "SET_VIEWPORT",
      viewport: { sw_lat: 26, sw_lng: 80, ne_lat: 27, ne_lng: 81 },
      zoom: 12,
      center: { lat: 26.5, lng: 80.5 }
    });
  }, [dispatch]);
  return null;
}

// Force the unsupported-speech path so the text fallback renders (jsdom has no SpeechRecognition).
describe("MapVoiceDock", () => {
  it("renders a text fallback when speech is unsupported and parses a typed query", async () => {
    render(
      <MapStateProvider>
        <MapCameraProvider map={null}>
          <MapVoiceDock locale="en" />
        </MapCameraProvider>
      </MapStateProvider>
    );
    const input = screen.getByPlaceholderText(/type/i);
    fireEvent.change(input, { target: { value: "2bhk under 20k" } });
    fireEvent.submit(input.closest("form")!);
    // a chip for the parsed BHK should appear
    expect(await screen.findByText(/2 BHK/i)).toBeTruthy();
  });

  it("merges intent-derived filters into existing filters instead of replacing them", async () => {
    render(
      <MapStateProvider initialFilters={{ verified_only: true }}>
        <MapCameraProvider map={null}>
          <FiltersProbe />
          <MapVoiceDock locale="en" />
        </MapCameraProvider>
      </MapStateProvider>
    );
    const input = screen.getByPlaceholderText(/type/i);
    fireEvent.change(input, { target: { value: "2bhk" } });
    fireEvent.submit(input.closest("form")!);

    await screen.findByText(/2 BHK/i);
    const probe = screen.getByTestId("filters");
    const filters = JSON.parse(probe.textContent ?? "{}");
    expect(filters.verified_only).toBe(true);
    expect(filters.bhk).toBe(2);
  });

  it("shows a localized subscribe door when nothing matches (no pins loaded in this hermetic test)", async () => {
    render(
      <MapStateProvider>
        <MapCameraProvider map={null}>
          <MapVoiceDock locale="en" />
        </MapCameraProvider>
      </MapStateProvider>
    );
    const input = screen.getByPlaceholderText(/type/i);
    fireEvent.change(input, { target: { value: "2bhk under 20k" } });
    fireEvent.submit(input.closest("form")!);

    // No pins are ever loaded in this test, so the match count is truthfully
    // zero — the negotiation-door honesty fix (correction F) should still
    // surface the always-present subscribe door, localized via mvNotifyMe.
    expect(await screen.findByText(/notify me/i)).toBeTruthy();
  });

  // FIX A — the door-fetch must KEEP verified_only/near_metro (only max_rent
  // is dropped). Otherwise computeNegotiationDoors counts listings the kept
  // filter will exclude on the real refetch → a "+N homes" door that delivers
  // +0, violating spec §8's "only show doors that yield +N > 0".
  it("keeps verified_only/near_metro (drops only max_rent) in the negotiation door-fetch", async () => {
    render(
      <MapStateProvider initialFilters={{ verified_only: true, near_metro: true }}>
        <MapCameraProvider map={null}>
          <ViewportSeeder />
          <MapVoiceDock locale="en" />
        </MapCameraProvider>
      </MapStateProvider>
    );
    const input = screen.getByPlaceholderText(/type/i);
    fireEvent.change(input, { target: { value: "2bhk under 20k" } });
    fireEvent.submit(input.closest("form")!);

    // Zero pins in state → truthful count 0 → the door-fetch fires.
    await waitFor(() => expect(fetchApiMock).toHaveBeenCalled());
    const path = String(fetchApiMock.mock.calls[0]?.[0] ?? "");
    expect(path).toMatch(/listings\/search\/map/);
    expect(path).toMatch(/verified_only=true/);
    expect(path).toMatch(/near_metro=true/);
    // max_rent must NOT be forwarded — stretch_budget needs above-cap inventory.
    expect(path).not.toMatch(/max_rent/);
  });

  // FIX B — matched listings must render as ListingReasonCards (the core
  // conversion surface: quoted-reason ledger + volunteered flaw). Seed a
  // matching pin into real reducer state and prove the card appears.
  it("renders matched pins as ListingReasonCards with a reason ledger", async () => {
    const matchingPin: MapPin = {
      id: "pin1",
      lat: 26.85,
      lng: 80.95,
      title: "Bright 2BHK",
      monthly_rent: 17000,
      listing_type: "flat_house",
      bhk: 2,
      verification_status: "verified",
      furnishing: "semi_furnished",
      cover_photo: null,
      city: "lucknow",
      locality: "Gomti Nagar",
      locality_slug: "gomti-nagar"
    };
    render(
      <MapStateProvider>
        <MapCameraProvider map={null}>
          <PinSeeder pins={[matchingPin]} />
          <MapVoiceDock locale="en" />
        </MapCameraProvider>
      </MapStateProvider>
    );
    const input = screen.getByPlaceholderText(/type/i);
    // "2bhk" produces only a server-side bhk chip → clientFilters is empty →
    // partitionPins matches every seeded pin, so the pin becomes a card.
    fireEvent.change(input, { target: { value: "2bhk" } });
    fireEvent.submit(input.closest("form")!);

    // The card renders the price and a ✓ ledger row for the applied 2 BHK chip.
    expect(await screen.findByText(/₹17,000/)).toBeTruthy();
    expect(await screen.findByText(/matching/i)).toBeTruthy();
  });
});
