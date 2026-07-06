import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../tabs/LiveOpsTab", () => ({
  LiveOpsTab: () => <div data-testid="live-tab" />
}));

vi.mock("../../tabs/SearchPerformanceTab", () => ({
  SearchPerformanceTab: ({ accessToken }: { accessToken: string }) => (
    <div data-testid="search-performance-tab">sp:{accessToken}</div>
  )
}));

import { AdminShell } from "../AdminShell";

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("AdminShell Search Performance tab", () => {
  it("navigates to the Search Performance tab", async () => {
    render(<AdminShell accessToken="tok" />);

    fireEvent.click(screen.getByRole("button", { name: /search performance/i }));

    expect(await screen.findByTestId("search-performance-tab")).toHaveTextContent("sp:tok");
  });
});
