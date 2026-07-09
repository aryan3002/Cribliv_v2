import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("../voice-search-button", () => ({ VoiceSearchButton: () => null }));
vi.mock("../../lib/google-places", () => ({
  useGooglePlaces: () => ({
    predictions: [],
    fetchPredictions: vi.fn(),
    getPlaceDetails: vi.fn(),
    clearPredictions: vi.fn(),
    enabled: false
  })
}));

import { SearchHero } from "../search-hero";

beforeEach(() => push.mockClear());

describe("SearchHero Homes|PG toggle", () => {
  it("routes to /pg when PG segment is selected", () => {
    render(<SearchHero locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: /^PG$/i }));
    const input = screen.getByLabelText(/agentic search/i);
    fireEvent.change(input, { target: { value: "lucknow" } });
    fireEvent.submit(input.closest("form")!);
    expect(push).toHaveBeenCalledWith(expect.stringContaining("/en/pg"));
  });

  it("defaults to Homes (routes to /search)", () => {
    render(<SearchHero locale="en" />);
    const input = screen.getByLabelText(/agentic search/i);
    fireEvent.change(input, { target: { value: "2bhk noida" } });
    fireEvent.submit(input.closest("form")!);
    expect(push).toHaveBeenCalledWith(expect.stringContaining("/en/search"));
  });

  it("routes a known city in Homes mode as a canonical city param only", async () => {
    render(<SearchHero locale="en" />);
    const input = screen.getByLabelText(/agentic search/i);
    fireEvent.change(input, { target: { value: "Noida" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith(expect.stringContaining("/en/search?"));
    });
    const href = push.mock.calls.at(-1)?.[0] as string;
    expect(href).toContain("city=noida");
    expect(href).not.toContain("q=Noida");
  });

  it("routes a city SUGGESTION to /pg (not /search) when PG is toggled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes("/suggest")) {
          return {
            ok: true,
            json: async () => ({
              data: [
                { type: "city", label: "Lucknow", value: "lucknow" },
                {
                  type: "listing",
                  label: "Joginder PG",
                  value: "pg-1",
                  city_slug: "lucknow",
                  rent: 2121,
                  verified: true,
                  locality_label: "Gomti Nagar",
                  cover_url: null
                }
              ]
            })
          };
        }
        if (u.includes("/preview")) {
          return { ok: true, json: async () => ({ data: null }) };
        }
        return { ok: true, json: async () => ({ data: { cities: [], localities: [] } }) };
      })
    );

    render(<SearchHero locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: /^PG$/i }));
    fireEvent.change(screen.getByLabelText(/agentic search/i), { target: { value: "lucknow" } });

    // Scope to the autocomplete dropdown (role=listbox) so we don't match the
    // smart-parser chip strip that may also contain "Lucknow".
    const listbox = await screen.findByRole("listbox");
    const cityRow = within(listbox).getByRole("button", { name: /Lucknow/i });
    fireEvent.click(cityRow);

    expect(push).toHaveBeenCalledWith(expect.stringContaining("/en/pg"));
    expect(push).toHaveBeenCalledWith(expect.stringContaining("city=lucknow"));
    expect(push).not.toHaveBeenCalledWith(expect.stringContaining("/en/search"));
  });

  it("routes a PG LISTING suggestion to /pg/[city]/[id] in PG mode", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes("/suggest")) {
          return {
            ok: true,
            json: async () => ({
              data: [
                {
                  type: "listing",
                  label: "Joginder PG",
                  value: "pg-1",
                  city_slug: "lucknow",
                  rent: 2121,
                  verified: true,
                  locality_label: "Gomti Nagar",
                  cover_url: null
                }
              ]
            })
          };
        }
        if (u.includes("/preview")) return { ok: true, json: async () => ({ data: null }) };
        return { ok: true, json: async () => ({ data: { cities: [], localities: [] } }) };
      })
    );

    render(<SearchHero locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: /^PG$/i }));
    fireEvent.change(screen.getByLabelText(/agentic search/i), { target: { value: "joginder" } });

    const listbox = await screen.findByRole("listbox");
    fireEvent.click(within(listbox).getByRole("button", { name: /Joginder PG/i }));

    expect(push).toHaveBeenCalledWith("/en/pg/lucknow/pg-1");
  });

  it("does not render hardcoded PG fallback inventory when suggest returns empty", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/pg/suggest")) {
        return { ok: true, json: async () => ({ data: [] }) };
      }
      return { ok: true, json: async () => ({ data: { cities: [], localities: [] } }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SearchHero locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: /^PG$/i }));
    fireEvent.change(screen.getByLabelText(/agentic search/i), { target: { value: "Noida" } });

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/pg/suggest"))).toBe(true);
    });
    expect(screen.queryByText(/860 listings/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sector 62/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("requests PG locality preview with the suggestion city slug", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/pg/suggest")) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                type: "locality",
                label: "Sector 62, noida",
                value: "sector-62",
                city_slug: "noida",
                listing_count: 0
              }
            ]
          })
        };
      }
      if (u.includes("/pg/preview")) {
        return {
          ok: true,
          json: async () => ({
            data: {
              type: "locality",
              slug: "sector-62",
              name: "Sector 62",
              city_slug: "noida",
              listing_count: 0,
              rent_band: null,
              verified_pct: null,
              avg_bhk: null,
              sharing: [],
              sample_photos: []
            }
          })
        };
      }
      return { ok: true, json: async () => ({ data: { cities: [], localities: [] } }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SearchHero locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: /^PG$/i }));
    fireEvent.change(screen.getByLabelText(/agentic search/i), { target: { value: "sector 62" } });

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => {
          const u = String(url);
          return (
            u.includes("/pg/preview") &&
            u.includes("type=locality") &&
            u.includes("value=sector-62") &&
            u.includes("city=noida")
          );
        })
      ).toBe(true);
    });
    expect(screen.queryByText(/72 listings/i)).not.toBeInTheDocument();
  });

  it("refreshes locality preview city identity when first locality slug repeats across cities", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/pg/suggest")) {
        if (u.includes("q=phase1")) {
          return {
            ok: true,
            json: async () => ({
              data: [
                {
                  type: "locality",
                  label: "Sector 62, noida",
                  value: "sector-62",
                  city_slug: "noida",
                  listing_count: 0
                }
              ]
            })
          };
        }
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                type: "locality",
                label: "Sector 62, gurgaon",
                value: "sector-62",
                city_slug: "gurgaon",
                listing_count: 0
              }
            ]
          })
        };
      }
      if (u.includes("/pg/preview")) {
        const city = new URL(u).searchParams.get("city");
        return {
          ok: true,
          json: async () => ({
            data: {
              type: "locality",
              slug: "sector-62",
              name: "Sector 62",
              city_slug: city,
              listing_count: 0,
              rent_band: null,
              verified_pct: null,
              avg_bhk: null,
              sharing: [],
              sample_photos: []
            }
          })
        };
      }
      return { ok: true, json: async () => ({ data: { cities: [], localities: [] } }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SearchHero locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: /^PG$/i }));
    const input = screen.getByLabelText(/agentic search/i);

    fireEvent.change(input, { target: { value: "phase1" } });
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => {
          const u = String(url);
          return u.includes("/pg/preview") && u.includes("value=sector-62") && u.includes("city=noida");
        })
      ).toBe(true);
    });

    fireEvent.change(input, { target: { value: "phase2" } });
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => {
          const u = String(url);
          return (
            u.includes("/pg/preview") &&
            u.includes("value=sector-62") &&
            u.includes("city=gurgaon")
          );
        })
      ).toBe(true);
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
