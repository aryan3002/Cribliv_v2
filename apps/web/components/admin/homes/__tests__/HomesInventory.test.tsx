import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminHomesListResponse } from "@cribliv/shared-types";

vi.mock("../../../../lib/admin-api", () => ({
  fetchAdminHomes: vi.fn(),
  fetchAdminHomeDetail: vi.fn()
}));
vi.mock("../../../../lib/admin-home-url", () => ({
  adminHomePublicUrl: (publicPath: string) => `https://cribliv.com${publicPath}`,
  copyAdminHomeUrl: vi.fn()
}));

import { fetchAdminHomeDetail, fetchAdminHomes } from "../../../../lib/admin-api";
import { copyAdminHomeUrl } from "../../../../lib/admin-home-url";
import { AdminHomesTab } from "../AdminHomesTab";

const mockedFetchAdminHomes = vi.mocked(fetchAdminHomes);
const mockedFetchAdminHomeDetail = vi.mocked(fetchAdminHomeDetail);
const mockedCopyAdminHomeUrl = vi.mocked(copyAdminHomeUrl);
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

const homeRow = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "2BHK in Gomti Nagar",
  city_slug: "lucknow",
  city_name: "Lucknow",
  locality_name: "Gomti Nagar",
  monthly_rent: 22000,
  owner_id: "O1",
  owner_name: "Ramesh Gupta",
  owner_phone_masked: "XXXXXXXX9901",
  status: "active" as const,
  cover_photo_url: null,
  views_30d: 428,
  leads_30d: 14,
  open_leads: 4,
  conversion_rate: 14 / 428,
  updated_at: "2026-07-15T08:00:00.000Z",
  public_path: "/en/listing/11111111-1111-4111-8111-111111111111"
};

const homeListFixture: AdminHomesListResponse = {
  items: [homeRow],
  total: 1,
  page: 1,
  page_size: 25 as const,
  filters: { status: "active" as const, city: null, q: null, sort: "leads" as const },
  available_cities: [{ slug: "lucknow", name: "Lucknow", count: 1 }],
  summary: { active_homes: 1, views_30d: 428, leads_30d: 14, needs_attention: 1 }
};

const emptyActiveHomeListFixture: AdminHomesListResponse = {
  ...homeListFixture,
  items: [],
  total: 0,
  available_cities: [],
  summary: { active_homes: 0, views_30d: 0, leads_30d: 0, needs_attention: 0 }
};

function renderHomes() {
  return render(
    <AdminHomesTab
      accessToken="tok"
      onOpenListingReview={vi.fn()}
      onOpenLeadCenter={vi.fn()}
      onToast={vi.fn()}
    />
  );
}

describe("AdminHomesTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetchAdminHomes.mockResolvedValue(homeListFixture);
    mockedFetchAdminHomeDetail.mockImplementation(() => new Promise<never>(() => undefined));
  });

  afterEach(() => {
    if (originalMatchMedia) {
      Object.defineProperty(window, "matchMedia", originalMatchMedia);
    } else {
      Reflect.deleteProperty(window, "matchMedia");
    }
  });

  it("loads active homes with leads sort by default", async () => {
    renderHomes();

    await waitFor(() =>
      expect(fetchAdminHomes).toHaveBeenCalledWith("tok", {
        status: "active",
        sort: "leads",
        page: 1,
        page_size: 25
      })
    );
  });

  it("renders agreed columns and copies without opening the workspace", async () => {
    renderHomes();

    await screen.findByText("2BHK in Gomti Nagar");
    expect(screen.getByRole("columnheader", { name: "Views 30d" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Leads 30d" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /copy public url/i }));
    expect(mockedCopyAdminHomeUrl).toHaveBeenCalledWith(
      "/en/listing/11111111-1111-4111-8111-111111111111"
    );
    expect(mockedFetchAdminHomeDetail).not.toHaveBeenCalled();
  });

  it("opens an active inventory row public page without opening the workspace", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderHomes();

    await screen.findByText("2BHK in Gomti Nagar");
    fireEvent.click(screen.getByRole("button", { name: /open public page/i }));
    expect(open).toHaveBeenCalledWith(
      "https://cribliv.com/en/listing/11111111-1111-4111-8111-111111111111",
      "_blank",
      "noopener,noreferrer"
    );
    expect(mockedFetchAdminHomeDetail).not.toHaveBeenCalled();
  });

  it("does not open the workspace when keyboard events originate from a row action", async () => {
    renderHomes();

    const copyButton = await screen.findByRole("button", { name: /copy public url/i });
    fireEvent.keyDown(copyButton, { key: "Enter" });

    expect(
      screen.queryByRole("button", { name: "Back to verified homes" })
    ).not.toBeInTheDocument();
  });

  it("resets page one when filters change and shows all verified from empty active state", async () => {
    mockedFetchAdminHomes.mockResolvedValue(emptyActiveHomeListFixture);
    renderHomes();

    fireEvent.click(await screen.findByRole("button", { name: "Show all verified" }));
    await waitFor(() =>
      expect(mockedFetchAdminHomes).toHaveBeenLastCalledWith(
        "tok",
        expect.objectContaining({ status: "all", page: 1 })
      )
    );
  });

  it("preserves filters and page after opening a workspace and returning", async () => {
    mockedFetchAdminHomes.mockResolvedValue({
      ...homeListFixture,
      items: [{ ...homeRow, status: "paused" }]
    });
    renderHomes();

    fireEvent.change(await screen.findByLabelText("Home status"), {
      target: { value: "paused" }
    });
    await screen.findByText("paused");
    fireEvent.click(screen.getByText("2BHK in Gomti Nagar"));
    fireEvent.click(await screen.findByRole("button", { name: "Back to verified homes" }));

    await waitFor(() =>
      expect(mockedFetchAdminHomes).toHaveBeenLastCalledWith(
        "tok",
        expect.objectContaining({ status: "paused" })
      )
    );
    await screen.findByText("2BHK in Gomti Nagar");
    expect(screen.getByLabelText("Home status")).toHaveValue("paused");
  });

  it("forwards search, city, sort, and page-size changes and resets page one", async () => {
    renderHomes();

    fireEvent.change(await screen.findByLabelText("Search verified homes"), {
      target: { value: "gomti" }
    });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "lucknow" } });
    fireEvent.change(screen.getByLabelText("Sort homes"), { target: { value: "views" } });
    fireEvent.change(screen.getByLabelText("Rows per page"), { target: { value: "50" } });

    await waitFor(
      () =>
        expect(mockedFetchAdminHomes).toHaveBeenLastCalledWith(
          "tok",
          expect.objectContaining({
            q: "gomti",
            city: "lucknow",
            sort: "views",
            page: 1,
            page_size: 50
          })
        ),
      { timeout: 1_000 }
    );
  });

  it("removes stale rows while a changed query is loading", async () => {
    let resolveNext: ((value: typeof homeListFixture) => void) | undefined;
    mockedFetchAdminHomes.mockResolvedValueOnce(homeListFixture).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveNext = resolve;
        })
    );
    renderHomes();
    await screen.findByText("2BHK in Gomti Nagar");

    fireEvent.change(screen.getByLabelText("Home status"), {
      target: { value: "archived" }
    });

    expect(await screen.findByLabelText("Loading verified homes")).toBeInTheDocument();
    expect(screen.queryByText("2BHK in Gomti Nagar")).not.toBeInTheDocument();
    resolveNext?.({
      ...homeListFixture,
      items: [{ ...homeRow, status: "archived" }],
      filters: { ...homeListFixture.filters, status: "archived" }
    });
    await screen.findByText("2BHK in Gomti Nagar");
  });

  it("uses explicit named controls to open the workspace", async () => {
    renderHomes();

    const openWorkspace = await screen.findByRole("button", {
      name: "Open 2BHK in Gomti Nagar workspace"
    });
    fireEvent.click(openWorkspace);

    expect(
      await screen.findByRole("button", { name: "Back to verified homes" })
    ).toBeInTheDocument();
  });

  it.each(["paused", "archived"] as const)(
    "shows no public URL actions for %s inventory rows",
    async (status) => {
      mockedFetchAdminHomes.mockResolvedValue({
        ...homeListFixture,
        items: [{ ...homeRow, status }]
      });
      renderHomes();

      expect(await screen.findByText("Not publicly available")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /copy public url/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /open public page/i })).not.toBeInTheDocument();
    }
  );

  it("preserves listing ID and updated date in mobile records", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      })
    });
    renderHomes();

    await screen.findByText("11111111...");
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
  });
});
