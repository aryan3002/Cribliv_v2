import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockMapClient(props: Record<string, unknown>) {
      return <pre data-testid="map-props">{JSON.stringify(props)}</pre>;
    }
}));

import MapPage from "../page";

describe("MapPage URL hydration", () => {
  it("centers city deep links and hydrates near_metro", () => {
    render(
      <MapPage
        params={{ locale: "en" }}
        searchParams={{ city: "lucknow", near_metro: "true", listing_type: "pg" }}
      />
    );

    const props = JSON.parse(screen.getByTestId("map-props").textContent ?? "{}");
    expect(props.initialCity).toBe("lucknow");
    expect(props.initialFilters).toMatchObject({ near_metro: true, listing_type: "pg" });
    expect(props.initialCenter.lat).toBeCloseTo(26.825);
    expect(props.initialCenter.lng).toBeCloseTo(80.95);
    expect(props.initialZoom).toBe(12);
  });

  it("keeps explicit lat/lng ahead of city centroids", () => {
    render(
      <MapPage
        params={{ locale: "en" }}
        searchParams={{ city: "lucknow", lat: "28.61", lng: "77.2", zoom: "15" }}
      />
    );

    const props = JSON.parse(screen.getByTestId("map-props").textContent ?? "{}");
    expect(props.initialCenter).toEqual({ lat: 28.61, lng: 77.2 });
    expect(props.initialZoom).toBe(15);
  });
});
