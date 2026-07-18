import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MapStateProvider, useMapState } from "../../hooks/useMapState";
import { MapCameraProvider } from "../../MapCameraController";
import { MapVoiceDock } from "../MapVoiceDock";

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

function FiltersProbe() {
  const { filters } = useMapState();
  return <div data-testid="filters">{JSON.stringify(filters)}</div>;
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
});
