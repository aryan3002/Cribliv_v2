import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ListingHealthCard from "../ListingHealthCard";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-29T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

const BASE_EXTRA = {
  search_appearances_7d: 0,
  ctr_7d: 0,
  interest_rate_7d: 0,
  trend_7d: [] as any[]
};

describe("ListingHealthCard", () => {
  it("renders the status badge", () => {
    render(
      <ListingHealthCard
        data={{
          listing_id: "L1",
          status: "live",
          views_7d: 120,
          contact_unlocks_7d: 8,
          last_updated: "2026-05-29T00:00:00Z",
          ...BASE_EXTRA
        }}
      />
    );
    expect(screen.getByText(/live/)).toBeInTheDocument();
  });

  it("shows views and contact unlocks", () => {
    render(
      <ListingHealthCard
        data={{
          listing_id: "L1",
          status: "live",
          views_7d: 120,
          contact_unlocks_7d: 8,
          last_updated: "2026-05-29T00:00:00Z",
          ...BASE_EXTRA
        }}
      />
    );
    expect(screen.getAllByText("120").length).toBeGreaterThan(0);
    expect(screen.getAllByText("8").length).toBeGreaterThan(0);
  });

  it("formats last_updated <24h ago as 'today'", () => {
    render(
      <ListingHealthCard
        data={{
          listing_id: "L1",
          status: "live",
          views_7d: 0,
          contact_unlocks_7d: 0,
          last_updated: "2026-05-29T10:00:00Z",
          ...BASE_EXTRA
        }}
      />
    );
    expect(screen.getByText(/today/i)).toBeInTheDocument();
  });

  it("formats last_updated 24-48h ago as 'yesterday'", () => {
    render(
      <ListingHealthCard
        data={{
          listing_id: "L1",
          status: "live",
          views_7d: 0,
          contact_unlocks_7d: 0,
          last_updated: "2026-05-28T11:00:00Z",
          ...BASE_EXTRA
        }}
      />
    );
    expect(screen.getByText(/yesterday/i)).toBeInTheDocument();
  });

  it("formats older last_updated as 'N days ago'", () => {
    render(
      <ListingHealthCard
        data={{
          listing_id: "L1",
          status: "live",
          views_7d: 0,
          contact_unlocks_7d: 0,
          last_updated: "2026-05-22T12:00:00Z",
          ...BASE_EXTRA
        }}
      />
    );
    expect(screen.getByText(/7 days ago/i)).toBeInTheDocument();
  });

  it("encodes the status into a data-status attribute for styling", () => {
    const { container } = render(
      <ListingHealthCard
        data={{
          listing_id: "L1",
          status: "paused",
          views_7d: 0,
          contact_unlocks_7d: 0,
          last_updated: "2026-05-29T00:00:00Z",
          ...BASE_EXTRA
        }}
      />
    );
    expect(container.querySelector('[data-status="paused"]')).toBeInTheDocument();
  });
});
