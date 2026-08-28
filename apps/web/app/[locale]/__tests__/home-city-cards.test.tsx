import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockDynamic({ children }: { children?: React.ReactNode }) {
      return <>{children ?? null}</>;
    }
}));

vi.mock("../../../lib/api", () => ({
  fetchApi: vi.fn(async (url: string) => {
    if (url.includes("/listings/search/map")) return [];
    if (url.includes("city=delhi")) return { items: [], total: 1, page: 1, page_size: 1 };
    if (url.includes("city=gurugram")) return { items: [], total: 2, page: 1, page_size: 1 };
    if (url.includes("city=lucknow")) return { items: [], total: 10, page: 1, page_size: 1 };
    return { items: [], total: 0, page: 1, page_size: 1 };
  })
}));

import HomePage from "../page";

describe("homepage city cards", () => {
  it("renders map-art cards only for cities with live inventory and chips for the rest", async () => {
    const ui = await HomePage({ params: { locale: "en" } });
    const { container } = render(ui);

    // 3 cities have inventory → 3 cards, map art + affordances intact
    expect(container.querySelectorAll(".home-city-card")).toHaveLength(3);
    expect(container.querySelectorAll(".home-city-card__map")).toHaveLength(3);
    expect(container.querySelectorAll(".home-city-card__arrow")).toHaveLength(3);

    const delhiCard = screen.getByRole("link", { name: /Delhi/i });
    const mapLayer = delhiCard.querySelector<HTMLElement>(".home-city-card__map");
    expect(mapLayer).toBeTruthy();
    expect(mapLayer?.style.backgroundImage).toContain("/images/cities/delhi-map.jpg");
    expect(delhiCard.querySelector(".home-city-card__status-dot--live")).toBeTruthy();
    expect(delhiCard.textContent).toContain("1 live rental");

    // zero-inventory cities collapse into "Expanding next" chips
    const soonRow = container.querySelector(".home-city-soon");
    expect(soonRow).toBeTruthy();
    expect(soonRow?.textContent).toContain("Expanding next");
    expect(soonRow?.textContent).toContain("Noida");
    expect(soonRow?.textContent).toContain("Ghaziabad");
    expect(soonRow?.querySelectorAll(".home-city-soon__chip")).toHaveLength(6);
    expect(container.textContent).not.toContain("Browse city");
  });
});
