import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PgScoreMeter from "../PgScoreMeter";
import type { PgListingPayload, PgScoreSignals } from "@cribliv/shared-types";

vi.mock("framer-motion", () => ({
  motion: {
    circle: ({ children, initial: _i, animate: _a, transition: _t, ...rest }: any) => (
      <circle {...rest}>{children}</circle>
    ),
    span: ({ children, initial: _i, animate: _a, transition: _t, ...rest }: any) => (
      <span {...rest}>{children}</span>
    )
  }
}));

const base: PgListingPayload = {
  property: { display_name: "Test PG", city_slug: "lucknow" },
  pg_details: { total_beds: 4 },
  room_types: []
} as any;

const lowSignals: PgScoreSignals = {
  verification_status: "unverified",
  has_exact_geo: false,
  photo_count: 0
};

describe("PgScoreMeter", () => {
  it("renders SVG ring with score label", () => {
    render(<PgScoreMeter payload={base} signals={lowSignals} onGoToStep={() => {}} />);
    expect(screen.getByRole("img", { name: /score: \d+ out of 100/i })).toBeInTheDocument();
  });

  it("shows recommendations for an incomplete listing", () => {
    render(<PgScoreMeter payload={base} signals={lowSignals} onGoToStep={() => {}} />);
    expect(screen.getByText(/boost your score/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
  });

  it("calls onGoToStep with the correct step when a rec is clicked", () => {
    const onGoToStep = vi.fn();
    render(<PgScoreMeter payload={base} signals={lowSignals} onGoToStep={onGoToStep} />);
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[0]);
    expect(onGoToStep).toHaveBeenCalledWith(expect.any(Number));
  });

  it("does not show recommendations for a fully complete listing", () => {
    const full: PgListingPayload = {
      property: { display_name: "Full PG", city_slug: "lucknow", lat: 26.8, lng: 80.9 },
      pg_details: {
        total_beds: 10,
        gender_policy: "boys",
        tenant_type: "students",
        security_deposit_paise: 5_000_000,
        house_rules: {
          smoking: false,
          alcohol: false,
          non_veg: true,
          pets: false,
          cooking_in_room: false
        },
        meals: { provided: true },
        amenities: {
          core: ["wifi", "hot_water", "power_backup", "cctv", "security_guard"],
          room: ["study_table"]
        }
      },
      room_types: [
        {
          sharing: "single",
          ac: true,
          monthly_rent_paise: 800_000,
          vacancy_count: 2,
          security_deposit_paise: 1_500_000
        }
      ]
    } as any;
    const fullSig: PgScoreSignals = {
      verification_status: "verified",
      has_exact_geo: true,
      photo_count: 10
    };
    render(<PgScoreMeter payload={full} signals={fullSig} onGoToStep={() => {}} />);
    expect(screen.queryByText(/boost your score/i)).not.toBeInTheDocument();
  });

  it("higher photo count raises the composite score", () => {
    const { rerender } = render(
      <PgScoreMeter
        payload={base}
        signals={{ ...lowSignals, photo_count: 0 }}
        onGoToStep={() => {}}
      />
    );
    const lowLabel = screen
      .getByRole("img", { name: /score: (\d+) out of 100/i })
      .getAttribute("aria-label")!;
    const lowScore = parseInt(lowLabel.match(/score: (\d+)/i)![1], 10);

    rerender(
      <PgScoreMeter
        payload={base}
        signals={{ ...lowSignals, photo_count: 8 }}
        onGoToStep={() => {}}
      />
    );
    const highLabel = screen
      .getByRole("img", { name: /score: (\d+) out of 100/i })
      .getAttribute("aria-label")!;
    const highScore = parseInt(highLabel.match(/score: (\d+)/i)![1], 10);

    expect(highScore).toBeGreaterThan(lowScore);
  });
});
