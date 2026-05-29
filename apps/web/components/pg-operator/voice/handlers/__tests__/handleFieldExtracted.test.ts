import { describe, it, expect, vi } from "vitest";
import { handleFieldExtracted } from "../handleFieldExtracted";

describe("handleFieldExtracted", () => {
  it("dispatches VOICE_EXTRACTED with field/value/confidence", () => {
    const dispatch = vi.fn();
    handleFieldExtracted(
      {
        field: "pg_details.gender_policy",
        value: "coed",
        confidence: 0.95,
        draft_id: "d1"
      },
      { dispatch }
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "VOICE_EXTRACTED",
      field: "pg_details.gender_policy",
      value: "coed",
      confidence: 0.95
    });
  });

  it("normalizes rupees → paise for *_paise field when value < ₹1,000", () => {
    const dispatch = vi.fn();
    handleFieldExtracted(
      {
        field: "room_types.0.monthly_rent_paise",
        value: 8500, // operator said 8500 but the agent transcribed as rupees instead of paise
        confidence: 0.8,
        draft_id: "d1"
      },
      { dispatch }
    );
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ value: 850000 }));
  });

  it("does NOT multiply already-paise values (≥100,000)", () => {
    const dispatch = vi.fn();
    handleFieldExtracted(
      {
        field: "room_types.0.monthly_rent_paise",
        value: 850000, // correct paise value
        confidence: 0.9,
        draft_id: "d1"
      },
      { dispatch }
    );
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ value: 850000 }));
  });

  it("does NOT multiply zero or negative values", () => {
    const dispatch = vi.fn();
    handleFieldExtracted(
      {
        field: "pg_details.maintenance_paise",
        value: 0,
        confidence: 0.9,
        draft_id: "d1"
      },
      { dispatch }
    );
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ value: 0 }));
  });

  it("does NOT multiply non-paise fields even when small", () => {
    const dispatch = vi.fn();
    handleFieldExtracted(
      {
        field: "pg_details.total_beds",
        value: 12,
        confidence: 0.95,
        draft_id: "d1"
      },
      { dispatch }
    );
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ value: 12 }));
  });

  it("passes a transcript line to onTranscriptLine when provided", () => {
    const dispatch = vi.fn();
    const onTranscriptLine = vi.fn();
    handleFieldExtracted(
      {
        field: "pg_details.total_beds",
        value: 12,
        confidence: 0.95,
        draft_id: "d1"
      },
      { dispatch, onTranscriptLine }
    );
    expect(onTranscriptLine).toHaveBeenCalledOnce();
    expect(onTranscriptLine.mock.calls[0][0]).toContain("total_beds");
    expect(onTranscriptLine.mock.calls[0][0]).toContain("12");
  });

  it("works without onTranscriptLine (it's optional)", () => {
    const dispatch = vi.fn();
    expect(() =>
      handleFieldExtracted(
        {
          field: "x",
          value: "y",
          confidence: 0.5,
          draft_id: "d1"
        },
        { dispatch }
      )
    ).not.toThrow();
  });
});
