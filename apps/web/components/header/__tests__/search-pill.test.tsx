import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SearchPill } from "../search-pill";

let pathname = "/en";
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => searchParams
}));

function linkText(): string {
  return screen.getByRole("link").textContent ?? "";
}

describe("SearchPill", () => {
  beforeEach(() => {
    pathname = "/en";
    searchParams = new URLSearchParams();
  });

  // Precedence branch 1: q wins outright, verbatim, and short-circuits the
  // rest of the precedence chain (a verbatim query may already mention a
  // budget, so max_rent must not also be appended here).
  it("uses q verbatim when present, ignoring bhk/city/max_rent", () => {
    searchParams = new URLSearchParams({
      q: "2bhk near cyber city",
      bhk: "3",
      city: "jaipur",
      max_rent: "50000"
    });
    render(<SearchPill locale="en" />);
    expect(linkText()).toBe("2bhk near cyber city");
  });

  // Precedence branch 2: bhk + locality/city, locality preferred over city
  // (more specific), matching the brief's own canonical example verbatim.
  it("composes bhk + locality (preferring locality over city) as '2 BHK in Gomti Nagar'", () => {
    searchParams = new URLSearchParams({ bhk: "2", locality: "gomti-nagar", city: "lucknow" });
    render(<SearchPill locale="en" />);
    expect(linkText()).toBe("2 BHK in Gomti Nagar");
  });

  it("composes bhk + city when no locality is present", () => {
    searchParams = new URLSearchParams({ bhk: "3", city: "jaipur" });
    render(<SearchPill locale="en" />);
    expect(linkText()).toBe("3 BHK in Jaipur");
  });

  it("shows bhk alone when neither locality nor city is present", () => {
    searchParams = new URLSearchParams({ bhk: "2" });
    render(<SearchPill locale="en" />);
    expect(linkText()).toBe("2 BHK");
  });

  it("shows the place alone when bhk is absent", () => {
    searchParams = new URLSearchParams({ city: "lucknow" });
    render(<SearchPill locale="en" />);
    expect(linkText()).toBe("Lucknow");
  });

  // Precedence branch 3: max_rent appended with a middle-dot separator, using
  // the brief's exact example.
  it("appends max_rent as '· Under ₹20k'", () => {
    searchParams = new URLSearchParams({ bhk: "2", city: "lucknow", max_rent: "20000" });
    render(<SearchPill locale="en" />);
    expect(linkText()).toBe("2 BHK in Lucknow · Under ₹20k");
  });

  // The brief's required "9 -> ₹9k" style-formatting check, exercised via a
  // max_rent-only URL (also proving max_rent alone counts as "recognised" and
  // renders without an orphan leading separator).
  it("formats max_rent=9000 as 'Under ₹9k' with no bhk/place present", () => {
    searchParams = new URLSearchParams({ max_rent: "9000" });
    render(<SearchPill locale="en" />);
    expect(linkText()).toBe("Under ₹9k");
  });

  // Required: an unrecognised (non-HUB_CITIES) slug renders its raw value,
  // title-cased, rather than blanking -- using a real multi-word slug so the
  // hyphen-splitting is genuinely exercised, not just a single-word capitalize.
  it("renders an unrecognised city slug title-cased rather than blanking", () => {
    searchParams = new URLSearchParams({ bhk: "1", city: "greater-noida" });
    render(<SearchPill locale="en" />);
    expect(linkText()).toBe("1 BHK in Greater Noida");
  });

  // Required: empty params fall back to the placeholder.
  it("falls back to the placeholder when no params are recognised", () => {
    render(<SearchPill locale="en" />);
    expect(linkText()).toBe("Search rentals");
  });

  // Required: Hindi placeholder selection -- real Devanagari, not a
  // transliteration or an English fallback.
  it("falls back to a real Hindi placeholder for locale=hi", () => {
    render(<SearchPill locale="hi" />);
    const text = linkText();
    expect(text).not.toBe("Search rentals");
    expect(text).toMatch(/[ऀ-ॿ]/);
  });

  it("links to /{locale}/search preserving current params on the /search route", () => {
    pathname = "/en/search";
    searchParams = new URLSearchParams({ bhk: "2", city: "lucknow" });
    render(<SearchPill locale="en" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/en/search?bhk=2&city=lucknow");
  });

  // Regression (final review I-3): the pill used to send /pg visitors to
  // /en/search?sharing=double. /search forces listing_type=flat_house and has
  // no sharing filter, so that silently swapped their PG results for
  // unfiltered flats. It must keep them on the PG surface.
  it("keeps the visitor on /{locale}/pg, preserving PG-only params", () => {
    pathname = "/en/pg";
    searchParams = new URLSearchParams({ sharing: "double" });
    render(<SearchPill locale="en" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/en/pg?sharing=double");
  });

  it("links to a bare /{locale}/pg on the PG route with no params", () => {
    pathname = "/en/pg";
    render(<SearchPill locale="en" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/en/pg");
  });

  // The other half of I-3: /pg params were not summarised at all, so a
  // filtered PG page showed the bare "Search rentals" placeholder.
  it("summarises PG sharing rather than falling back to the placeholder", () => {
    pathname = "/en/pg";
    searchParams = new URLSearchParams({ sharing: "double" });
    render(<SearchPill locale="en" />);
    expect(linkText()).toBe("Double sharing");
  });

  it("summarises gender, sharing, tenant type and place together on /pg", () => {
    pathname = "/en/pg";
    searchParams = new URLSearchParams({
      gender_policy: "girls",
      sharing: "single",
      tenant_type: "students",
      city: "lucknow",
      max_rent: "12000"
    });
    render(<SearchPill locale="en" />);
    expect(linkText()).toBe("Girls PG · Single sharing · For students in Lucknow · Under ₹12k");
  });

  // `bhk` is a flats-only param that /pg does not honour, so summarising it
  // there would describe a filter the results are not actually applying.
  it("ignores bhk on /pg and reads the PG vocabulary instead", () => {
    pathname = "/en/pg";
    searchParams = new URLSearchParams({ bhk: "2", sharing: "triple" });
    render(<SearchPill locale="en" />);
    expect(linkText()).toBe("Triple sharing");
  });

  // Closed vocabularies: an unrecognised value is skipped, not title-cased
  // into the header. `tenant_type=any` is the no-op default and adds nothing.
  it("skips unrecognised PG values and the no-op tenant_type=any", () => {
    pathname = "/en/pg";
    searchParams = new URLSearchParams({ sharing: "sextuple", tenant_type: "any" });
    render(<SearchPill locale="en" />);
    expect(linkText()).toBe("Search PGs");
  });

  it("falls back to a PG-specific placeholder on /pg, not 'Search rentals'", () => {
    pathname = "/en/pg";
    render(<SearchPill locale="en" />);
    expect(linkText()).toBe("Search PGs");
  });

  it("falls back to a real Hindi PG placeholder on /pg for locale=hi", () => {
    pathname = "/hi/pg";
    render(<SearchPill locale="hi" />);
    const text = linkText();
    expect(text).not.toBe("Search PGs");
    expect(text).toMatch(/[ऀ-ॿ]/);
  });

  // PG params on a NON-PG route must not be summarised or carried: /search
  // would ignore them, and the flats vocabulary is the right one there.
  it("does not read PG params on the /search route", () => {
    pathname = "/en/search";
    searchParams = new URLSearchParams({ sharing: "double", bhk: "2" });
    render(<SearchPill locale="en" />);
    expect(linkText()).toBe("2 BHK");
    expect(screen.getByRole("link")).toHaveAttribute("href", "/en/search?sharing=double&bhk=2");
  });

  it("links to a bare /{locale}/search when not on a search-like route, even if params are present", () => {
    pathname = "/en";
    searchParams = new URLSearchParams({ bhk: "2", city: "lucknow" });
    render(<SearchPill locale="en" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/en/search");
  });

  it("links to a bare /{locale}/search on a search-like route with no params", () => {
    pathname = "/en/search";
    render(<SearchPill locale="en" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/en/search");
  });
});
