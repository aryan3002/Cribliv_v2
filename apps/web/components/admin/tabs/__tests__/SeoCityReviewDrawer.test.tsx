import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/admin-api", () => ({
  listCityLocalities: vi.fn(),
  listCityLandmarks: vi.fn(),
  listCityMetro: vi.fn(),
  setSeoCityEnabled: vi.fn()
}));

import { SeoCityReviewDrawer } from "../SeoCityReviewDrawer";
import {
  listCityLocalities,
  listCityLandmarks,
  listCityMetro,
  setSeoCityEnabled,
  type SeoCityConfigVm
} from "../../../../lib/admin-api";

const mockedLocalities = vi.mocked(listCityLocalities);
const mockedLandmarks = vi.mocked(listCityLandmarks);
const mockedMetro = vi.mocked(listCityMetro);
const mockedToggle = vi.mocked(setSeoCityEnabled);

const CITY: SeoCityConfigVm = {
  citySlug: "noida",
  nameEn: "Noida",
  programmaticEnabled: false,
  localityCount: 28,
  landmarkCount: 14,
  metroCount: 8,
  indexableCount: 16,
  enabledAt: null,
  notes: "pending review",
  updatedAt: "2026-07-03T02:00:00.000Z"
};

const LOCALITIES = [
  {
    slug: "sector-18",
    name_en: "Sector 18",
    name_hi: "सेक्टर 18",
    lat: 28.5697,
    lng: 77.3261,
    listing_count: 5
  },
  {
    slug: "sector-62",
    name_en: "Sector 62",
    name_hi: "सेक्टर 62",
    lat: 28.6273,
    lng: 77.3639,
    listing_count: 1
  }
];

const LANDMARKS = [
  {
    slug: "dlf-mall-of-india",
    name_en: "DLF Mall of India",
    name_hi: "डीएलएफ मॉल ऑफ इंडिया",
    type: "mall",
    lat: 28.5679,
    lng: 77.3261
  }
];

const METRO = [
  { station_name: "Botanical Garden", line_name: "Blue Line", lat: 28.5638, lng: 77.3347 }
];

function noop() {}

beforeEach(() => {
  vi.clearAllMocks();
  mockedLocalities.mockResolvedValue(LOCALITIES);
  mockedLandmarks.mockResolvedValue(LANDMARKS);
  mockedMetro.mockResolvedValue(METRO);
});

describe("SeoCityReviewDrawer", () => {
  it("renders nothing when city is null", () => {
    render(
      <SeoCityReviewDrawer
        city={null}
        accessToken="tok"
        onClose={noop}
        onToast={noop}
        onChanged={noop}
      />
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the localities tab rows with indexable flags and a preview link", async () => {
    render(
      <SeoCityReviewDrawer
        city={CITY}
        accessToken="tok"
        onClose={noop}
        onToast={noop}
        onChanged={noop}
      />
    );

    expect(await screen.findByText("Sector 18")).toBeInTheDocument();
    expect(screen.getByText("Sector 62")).toBeInTheDocument();
    expect(mockedLocalities).toHaveBeenCalledWith("noida");

    // listing_count 5 >= 3 -> indexable check
    const rows = screen.getAllByRole("row");
    const sector18Row = rows.find((r) => r.textContent?.includes("Sector 18"));
    const sector62Row = rows.find((r) => r.textContent?.includes("Sector 62"));
    expect(sector18Row?.textContent).toContain("✓");
    expect(sector62Row?.textContent).toContain("✗");

    const previewLinks = screen.getAllByRole("link", { name: /preview/i });
    const sector18Preview = previewLinks.find((l) => l.getAttribute("href")?.includes("sector-18"));
    expect(sector18Preview).toBeDefined();
    expect(sector18Preview?.getAttribute("href")).toContain("?adminPreview=1");
    expect(sector18Preview?.getAttribute("href")).toContain("/city/noida/sector-18");
    expect(sector18Preview?.getAttribute("target")).toBe("_blank");
    expect(sector18Preview?.getAttribute("rel")).toContain("noopener");
  });

  it("shows header info: name, badge, live counts, enabled date, notes", async () => {
    render(
      <SeoCityReviewDrawer
        city={CITY}
        accessToken="tok"
        onClose={noop}
        onToast={noop}
        onChanged={noop}
      />
    );

    expect(await screen.findByText("Sector 18")).toBeInTheDocument();
    expect(screen.getByText("Noida")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("28")).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("16")).toBeInTheDocument();
  });

  it("switches to the Landmarks tab and fetches landmark rows", async () => {
    render(
      <SeoCityReviewDrawer
        city={CITY}
        accessToken="tok"
        onClose={noop}
        onToast={noop}
        onChanged={noop}
      />
    );

    await screen.findByText("Sector 18");
    expect(mockedLandmarks).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^landmarks/i }));

    await waitFor(() => expect(mockedLandmarks).toHaveBeenCalledWith("noida"));
    expect(await screen.findByText("DLF Mall of India")).toBeInTheDocument();

    const previewLinks = screen.getAllByRole("link", { name: /preview/i });
    const landmarkPreview = previewLinks.find((l) =>
      l.getAttribute("href")?.includes("dlf-mall-of-india")
    );
    expect(landmarkPreview?.getAttribute("href")).toContain("/city/noida/near/dlf-mall-of-india");
    expect(landmarkPreview?.getAttribute("href")).toContain("?adminPreview=1");
  });

  it("switches to the Metro tab and fetches metro rows with a slugified preview link", async () => {
    render(
      <SeoCityReviewDrawer
        city={CITY}
        accessToken="tok"
        onClose={noop}
        onToast={noop}
        onChanged={noop}
      />
    );

    await screen.findByText("Sector 18");
    expect(mockedMetro).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^metro/i }));

    await waitFor(() => expect(mockedMetro).toHaveBeenCalledWith("noida"));
    expect(await screen.findByText("Botanical Garden")).toBeInTheDocument();
    expect(screen.getByText("Blue Line")).toBeInTheDocument();

    const previewLinks = screen.getAllByRole("link", { name: /preview/i });
    const metroPreview = previewLinks.find((l) => l.getAttribute("href")?.includes("/metro/"));
    expect(metroPreview?.getAttribute("href")).toContain("/city/noida/metro/botanical-garden");
    expect(metroPreview?.getAttribute("href")).toContain("?adminPreview=1");
  });

  it("filters localities by the search box", async () => {
    render(
      <SeoCityReviewDrawer
        city={CITY}
        accessToken="tok"
        onClose={noop}
        onToast={noop}
        onChanged={noop}
      />
    );

    await screen.findByText("Sector 18");
    const search = screen.getByPlaceholderText(/search/i);
    fireEvent.change(search, { target: { value: "62" } });

    expect(screen.queryByText("Sector 18")).not.toBeInTheDocument();
    expect(screen.getByText("Sector 62")).toBeInTheDocument();
  });

  it("shows an error state when a tab's fetch fails", async () => {
    mockedLandmarks.mockRejectedValueOnce(new Error("boom"));

    render(
      <SeoCityReviewDrawer
        city={CITY}
        accessToken="tok"
        onClose={noop}
        onToast={noop}
        onChanged={noop}
      />
    );

    await screen.findByText("Sector 18");
    fireEvent.click(screen.getByRole("button", { name: /^landmarks/i }));

    expect(await screen.findByText(/boom/i)).toBeInTheDocument();
  });

  it("prefills the notes textarea from the city's current notes", async () => {
    render(
      <SeoCityReviewDrawer
        city={CITY}
        accessToken="tok"
        onClose={noop}
        onToast={noop}
        onChanged={noop}
      />
    );

    await screen.findByText("Sector 18");
    const textarea = screen.getByRole("textbox", { name: /notes/i }) as HTMLTextAreaElement;
    expect(textarea.value).toBe("pending review");
  });

  it("typing a note and clicking Enable calls setSeoCityEnabled and refreshes", async () => {
    mockedToggle.mockResolvedValueOnce({
      ...CITY,
      programmaticEnabled: true,
      enabledAt: "2026-07-04T00:00:00.000Z"
    });
    const onToast = vi.fn();
    const onChanged = vi.fn();
    const onClose = vi.fn();

    render(
      <SeoCityReviewDrawer
        city={CITY}
        accessToken="tok"
        onClose={onClose}
        onToast={onToast}
        onChanged={onChanged}
      />
    );

    await screen.findByText("Sector 18");
    const textarea = screen.getByRole("textbox", { name: /notes/i });
    fireEvent.change(textarea, { target: { value: "looks good, approving" } });

    fireEvent.click(screen.getByRole("button", { name: /^enable noida$/i }));

    await waitFor(() => {
      expect(mockedToggle).toHaveBeenCalledWith("tok", "noida", true, "looks good, approving");
    });
    expect(onToast).toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("closes when Escape is pressed", async () => {
    const onClose = vi.fn();
    render(
      <SeoCityReviewDrawer
        city={CITY}
        accessToken="tok"
        onClose={onClose}
        onToast={noop}
        onChanged={noop}
      />
    );

    await screen.findByText("Sector 18");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("has a labelled close button", async () => {
    render(
      <SeoCityReviewDrawer
        city={CITY}
        accessToken="tok"
        onClose={noop}
        onToast={noop}
        onChanged={noop}
      />
    );

    await screen.findByText("Sector 18");
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });
});
