import { describe, it, expect, vi } from "vitest";
import { applyCameraIntent } from "../MapCameraController";

function mockMap() {
  return { panTo: vi.fn(), setZoom: vi.fn(), fitBounds: vi.fn() } as unknown as google.maps.Map & {
    panTo: ReturnType<typeof vi.fn>;
    setZoom: ReturnType<typeof vi.fn>;
    fitBounds: ReturnType<typeof vi.fn>;
  };
}

describe("applyCameraIntent", () => {
  it("center intent pans and zooms", () => {
    const m = mockMap();
    applyCameraIntent(m, { kind: "center", center: { lat: 26.8, lng: 81 }, zoom: 14 }, false);
    expect(m.panTo).toHaveBeenCalledWith({ lat: 26.8, lng: 81 });
    expect(m.setZoom).toHaveBeenCalledWith(14);
  });
  it("bounds intent fits", () => {
    vi.stubGlobal("google", { maps: { LatLngBounds: class {}, LatLng: class {} } });
    const m = mockMap();
    applyCameraIntent(
      m,
      { kind: "bounds", sw: { lat: 26, lng: 80 }, ne: { lat: 27, lng: 81 }, zoom: 13 },
      false
    );
    expect(m.fitBounds).toHaveBeenCalled();
  });
  it("null map is a no-op (no throw)", () => {
    expect(() =>
      applyCameraIntent(null, { kind: "center", center: { lat: 0, lng: 0 }, zoom: 10 }, false)
    ).not.toThrow();
  });
});
