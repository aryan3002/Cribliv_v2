import { useEffect } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  initialMapState,
  mapReducer,
  MapStateProvider,
  useMapDispatch
} from "../hooks/useMapState";
import { SeekerFormPanel } from "../panels/SeekerFormPanel";

/* Authenticated seeker — a token is required to reach the "Drop Search Pin"
 * submit path. */
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" })
}));
vi.mock("../../../lib/client-auth", () => ({
  readAuthSession: () => ({ access_token: "acc_seeker" })
}));

describe("seeker draft reducer", () => {
  it("START_SEEKER_DRAFT drops the draft at the given center and opens the form", () => {
    const s = mapReducer(initialMapState, {
      type: "START_SEEKER_DRAFT",
      center: { lat: 28.5, lng: 77.1 }
    });
    expect(s.seekerDraft).toEqual({ lat: 28.5, lng: 77.1 });
    expect(s.panelContent).toEqual({ type: "seeker-form" });
  });

  it("SET_SEEKER_DRAFT_POSITION moves the draft to the dropped point", () => {
    const opened = mapReducer(initialMapState, {
      type: "START_SEEKER_DRAFT",
      center: { lat: 28.5, lng: 77.1 }
    });
    const moved = mapReducer(opened, {
      type: "SET_SEEKER_DRAFT_POSITION",
      lat: 28.42,
      lng: 77.05
    });
    expect(moved.seekerDraft).toEqual({ lat: 28.42, lng: 77.05 });
  });

  it("SET_SEEKER_RADIUS updates the shared radius", () => {
    const s = mapReducer(initialMapState, { type: "SET_SEEKER_RADIUS", radiusM: 2000 });
    expect(s.seekerRadiusM).toBe(2000);
  });

  it("DESELECT_PIN clears the draft so the next Seek starts fresh", () => {
    const opened = mapReducer(initialMapState, {
      type: "START_SEEKER_DRAFT",
      center: { lat: 28.5, lng: 77.1 }
    });
    const closed = mapReducer(opened, { type: "DESELECT_PIN" });
    expect(closed.seekerDraft).toBeNull();
  });

  it("switching the panel away from the seeker form clears the draft", () => {
    const opened = mapReducer(initialMapState, {
      type: "START_SEEKER_DRAFT",
      center: { lat: 28.5, lng: 77.1 }
    });
    const other = mapReducer(opened, {
      type: "SET_PANEL",
      panelContent: { type: "area-stats" }
    });
    expect(other.seekerDraft).toBeNull();
  });

  it("keeps the draft when re-selecting the seeker form panel", () => {
    const opened = mapReducer(initialMapState, {
      type: "START_SEEKER_DRAFT",
      center: { lat: 28.5, lng: 77.1 }
    });
    const same = mapReducer(opened, {
      type: "SET_PANEL",
      panelContent: { type: "seeker-form" }
    });
    expect(same.seekerDraft).toEqual({ lat: 28.5, lng: 77.1 });
  });
});

describe("seeker form submits the placed pin", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () =>
          String(url).includes("/map/seekers") ? { data: { id: "seek_1", tags: [] } } : { data: [] }
      }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function DraftSeeder() {
    const dispatch = useMapDispatch();
    useEffect(() => {
      // Open Seek at the map center, then simulate dragging the pin elsewhere.
      dispatch({ type: "START_SEEKER_DRAFT", center: { lat: 28.6139, lng: 77.209 } });
      dispatch({ type: "SET_SEEKER_DRAFT_POSITION", lat: 28.42, lng: 77.05 });
    }, [dispatch]);
    return null;
  }

  it("posts the dragged coordinate, not the map center", async () => {
    render(
      <MapStateProvider>
        <DraftSeeder />
        <SeekerFormPanel locale="en" />
      </MapStateProvider>
    );

    const submit = await screen.findByRole("button", { name: /drop search pin/i });
    fireEvent.click(submit);

    await waitFor(() => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      const post = fetchMock.mock.calls.find((c) => String(c[0]).includes("/map/seekers"));
      expect(post).toBeTruthy();
      const body = JSON.parse((post![1] as RequestInit).body as string);
      expect(body.lat).toBe(28.42);
      expect(body.lng).toBe(77.05);
    });
  });
});
