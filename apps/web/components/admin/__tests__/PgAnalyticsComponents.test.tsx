import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PgListingFunnel } from "../PgListingFunnel";
import { PgListingQuality } from "../PgListingQuality";
import { PgVoiceMetrics } from "../PgVoiceMetrics";
import type { PgListingAnalytics } from "../../../lib/admin-api";

const DATA: PgListingAnalytics = {
  range_days: 30,
  funnel: {
    wizard_started: 100,
    step_completed_by_step: { "1": 70, "2": 50 },
    submitted: 35,
    published: 25,
    abandoned: 40
  },
  conversion: 0.35,
  publish_conversion: 0.25,
  median_time_to_publish_sec: 540,
  by_source: { manual: 80, voice: 20 },
  quality: {
    geocode_rate: 0.6,
    avg_photos: 4.5,
    missing_field_heatmap: [
      { field: "house_rules", count: 12 },
      { field: "amenities", count: 8 }
    ]
  },
  voice: { sessions: 20, completion_rate: 0.65, fallback_rate: 0.75 },
  score_health: {
    active_pg: 50,
    with_score: 47,
    without_score: 3,
    avg_composite: 0.62,
    distribution: [
      { bucket: "high", count: 18 },
      { bucket: "mid", count: 22 },
      { bucket: "low", count: 10 }
    ]
  }
};

describe("PgListingFunnel", () => {
  it("renders conversion %, stages and source split", () => {
    render(<PgListingFunnel data={DATA} />);
    expect(screen.getByText("35%")).toBeTruthy(); // conversion
    expect(screen.getByTestId("stage-started")).toBeTruthy();
    expect(screen.getByTestId("stage-published")).toBeTruthy();
    expect(screen.getByText(/manual/i)).toBeTruthy();
  });
});

describe("PgListingQuality", () => {
  it("renders geocode rate, score distribution and missing-field heatmap", () => {
    render(<PgListingQuality data={DATA} />);
    expect(screen.getByText("60%")).toBeTruthy(); // geocode rate
    expect(screen.getByTestId("dist-high")).toBeTruthy();
    expect(screen.getByTestId("missing-house_rules")).toBeTruthy();
  });
});

describe("PgVoiceMetrics", () => {
  it("renders sessions, completion and fallback", () => {
    render(<PgVoiceMetrics data={DATA} />);
    expect(screen.getAllByText("20").length).toBeGreaterThan(0); // sessions
    expect(screen.getByText("65%")).toBeTruthy(); // completion
    expect(screen.getByText("75%")).toBeTruthy(); // fallback
  });
});
