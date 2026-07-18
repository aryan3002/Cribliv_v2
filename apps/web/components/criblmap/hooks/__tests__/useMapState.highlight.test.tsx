import { describe, it, expect } from "vitest";
import { mapReducer, initialMapState } from "../useMapState";

describe("highlight channel", () => {
  it("SET_HIGHLIGHT stores the ids", () => {
    const s = mapReducer(initialMapState, { type: "SET_HIGHLIGHT", pinIds: ["a", "b"] });
    expect(s.highlightedPinIds).toEqual(["a", "b"]);
  });
  it("CLEAR_HIGHLIGHT resets to null", () => {
    const s1 = mapReducer(initialMapState, { type: "SET_HIGHLIGHT", pinIds: ["a"] });
    const s2 = mapReducer(s1, { type: "CLEAR_HIGHLIGHT" });
    expect(s2.highlightedPinIds).toBeNull();
  });
  it("SET_PINS preserves the highlight", () => {
    const s1 = mapReducer(initialMapState, { type: "SET_HIGHLIGHT", pinIds: ["a"] });
    const s2 = mapReducer(s1, { type: "SET_PINS", pins: [] });
    expect(s2.highlightedPinIds).toEqual(["a"]);
  });
});
