import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../tabs/LiveOpsTab", () => ({
  LiveOpsTab: () => <div data-testid="live-tab" />
}));

vi.mock("../../tabs/SeoProgrammaticPages", () => ({
  SeoProgrammaticPages: ({ accessToken }: { accessToken: string }) => (
    <div data-testid="seo-tab">seo:{accessToken}</div>
  )
}));

import { AdminShell } from "../AdminShell";

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("AdminShell SEO tab", () => {
  it("navigates to the Programmatic SEO tab", async () => {
    render(<AdminShell accessToken="tok" />);

    fireEvent.click(screen.getByRole("button", { name: /programmatic seo/i }));

    expect(await screen.findByTestId("seo-tab")).toHaveTextContent("seo:tok");
  });
});
