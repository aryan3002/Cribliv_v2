import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockDynamic({ children }: { children?: ReactNode }) {
      return <>{children ?? null}</>;
    }
}));

vi.mock("../../../lib/api", () => ({
  fetchApi: vi.fn(async (url: string) => {
    if (url.includes("/listings/search/popular-localities")) return [];
    return { items: [], total: 0, page: 1, page_size: 20 };
  })
}));

import HomePage from "../page";

describe("homepage how it works section", () => {
  it("uses an editorial three-column layout instead of boxed cards", async () => {
    render(await HomePage({ params: { locale: "en" } }));

    const section = screen.getByTestId("home-how-it-works");
    const steps = screen.getAllByTestId("home-how-it-works-step");

    expect(section).toHaveClass("home-section--editorial");
    expect(section.querySelector(".hiw")).toHaveClass("hiw--editorial");
    expect(section.querySelector(".hiw")).not.toHaveClass("hiw--boxed");
    expect(steps).toHaveLength(3);
    expect(steps.map((step) => step.querySelector(".hiw-num")?.textContent)).toEqual([
      "01",
      "02",
      "03"
    ]);
    expect(screen.getByText("Search Naturally")).toBeInTheDocument();
    expect(screen.getByText("Verified Listings")).toBeInTheDocument();
    expect(screen.getByText("Connect & Move")).toBeInTheDocument();
  });
});
