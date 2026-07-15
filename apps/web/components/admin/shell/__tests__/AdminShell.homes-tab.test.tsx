import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../tabs/LiveOpsTab", () => ({
  LiveOpsTab: () => <div data-testid="live-tab" />
}));

vi.mock("../../homes/AdminHomesTab", () => ({
  AdminHomesTab: ({ accessToken }: { accessToken: string }) => (
    <div data-testid="homes-tab">homes:{accessToken}</div>
  )
}));

import { AdminShell } from "../AdminShell";

describe("AdminShell Verified Homes tab", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("navigates to Verified Homes and renders the homes tab", async () => {
    render(<AdminShell accessToken="tok" />);

    fireEvent.click(screen.getByRole("button", { name: /verified homes/i }));

    expect(await screen.findByTestId("homes-tab")).toHaveTextContent("homes:tok");
  });

  it("offers a mobile section selector that can reach Verified Homes", async () => {
    render(<AdminShell accessToken="tok" />);

    fireEvent.change(screen.getByLabelText("Admin section"), {
      target: { value: "homes" }
    });

    expect(await screen.findByTestId("homes-tab")).toHaveTextContent("homes:tok");
  });
});
