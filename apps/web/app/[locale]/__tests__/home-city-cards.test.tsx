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
    if (url.includes("popular-localities")) return [];
    if (url.includes("city=delhi")) return { items: [], total: 1, page: 1, page_size: 1 };
    if (url.includes("city=gurugram")) return { items: [], total: 2, page: 1, page_size: 1 };
    if (url.includes("city=lucknow")) return { items: [], total: 10, page: 1, page_size: 1 };
    return { items: [], total: 0, page: 1, page_size: 1 };
  })
}));

import HomePage from "../page";

describe("homepage city cards", () => {
  it("keeps city map imagery while exposing the lighter card affordances", async () => {
    const ui = await HomePage({ params: { locale: "en" } });
    const { container } = render(ui);

    const delhiCard = screen.getByRole("link", { name: /Delhi/i });
    const mapLayer = delhiCard.querySelector<HTMLElement>(".home-city-card__map");

    expect(mapLayer).toBeTruthy();
    expect(mapLayer?.style.backgroundImage).toContain("/images/cities/delhi-map.jpg");
    expect(delhiCard.querySelector(".home-city-card__arrow")).toBeTruthy();
    expect(delhiCard.querySelector(".home-city-card__status-dot--live")).toBeTruthy();

    expect(container.querySelectorAll(".home-city-card__map")).toHaveLength(8);
    expect(container.querySelectorAll(".home-city-card__arrow")).toHaveLength(8);
  });
});
