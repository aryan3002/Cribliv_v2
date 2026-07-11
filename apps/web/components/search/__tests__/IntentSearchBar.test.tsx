import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const push = vi.fn();
const fetchMock = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { IntentSearchBar } from "../IntentSearchBar";

beforeEach(() => {
  push.mockClear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    return {
      ok: true,
      json: async () =>
        url.includes("/dictionary")
          ? { data: { cities: ["lucknow"], localities: ["gomti-nagar"] } }
          : { data: { total: 12 } }
    };
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("IntentSearchBar", () => {
  it("shows parsed chips and a matching count while the user types", async () => {
    render(<IntentSearchBar locale="en" segment="homes" params={{}} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), {
      target: { value: "2BHK Lucknow under 20k" }
    });

    expect(await screen.findByRole("button", { name: "Remove 2 BHK" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Remove Lucknow" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Remove up to Rs. 20k" })).toBeVisible();
    expect(await screen.findByText("12 homes match")).toBeVisible();
  });

  it("removes a parsed filter from the next search", async () => {
    render(<IntentSearchBar locale="en" segment="homes" params={{ sort: "verified" }} />);
    const input = screen.getByRole("textbox", { name: "Search" });

    fireEvent.change(input, { target: { value: "2BHK Lucknow under 20k" } });
    fireEvent.click(await screen.findByRole("button", { name: "Remove 2 BHK" }));
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(push).toHaveBeenCalledWith("/en/search?sort=verified&city=lucknow&max_rent=20000");
  });

  it("routes an explicit PG request to the PG search surface", async () => {
    render(<IntentSearchBar locale="en" segment="homes" params={{}} />);
    const input = screen.getByRole("textbox", { name: "Search" });

    fireEvent.change(input, { target: { value: "PG in Lucknow under 10k" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/en/pg?city=lucknow&max_rent=10000"));
  });

  it("does not leave a stale loading message when the count request fails", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/dictionary")) {
        return {
          ok: true,
          json: async () => ({ data: { cities: ["lucknow"], localities: [] } })
        };
      }
      throw new Error("API unavailable");
    });

    render(<IntentSearchBar locale="en" segment="homes" params={{}} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), {
      target: { value: "2BHK Lucknow" }
    });

    expect(await screen.findByText("Match count unavailable")).toBeVisible();
  });
});
