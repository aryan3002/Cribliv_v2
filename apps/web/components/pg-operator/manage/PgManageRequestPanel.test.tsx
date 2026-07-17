import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getManageRequest, requestManage } = vi.hoisted(() => ({
  getManageRequest: vi.fn(),
  requestManage: vi.fn()
}));

vi.mock("@/lib/pg-operations-api", () => ({
  getManageRequest,
  requestManage
}));

import { PgManageRequestPanel } from "./PgManageRequestPanel";

describe("PgManageRequestPanel", () => {
  beforeEach(() => {
    getManageRequest.mockReset();
    requestManage.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a manage request when the listing is unmanaged", async () => {
    getManageRequest.mockResolvedValueOnce({ status: "none" });
    requestManage.mockResolvedValueOnce({ id: "request-1", status: "pending" });

    render(<PgManageRequestPanel listingId="listing-1" locale="en" accessToken="token-1" />);

    const button = await screen.findByRole("button", { name: "Request Manage PG" });
    fireEvent.click(button);

    expect(requestManage).toHaveBeenCalledWith("listing-1", {}, "token-1", expect.any(String));
    expect(await screen.findByText("Manage PG request pending approval.")).toBeInTheDocument();
  });

  it("retains an idempotency key when a failed submission is retried", async () => {
    getManageRequest
      .mockResolvedValueOnce({ status: "none" })
      .mockResolvedValueOnce({ status: "none" });
    requestManage.mockRejectedValueOnce(new Error("Network unavailable")).mockResolvedValueOnce({
      id: "request-1",
      status: "pending"
    });

    render(<PgManageRequestPanel listingId="listing-1" locale="en" accessToken="token-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Request Manage PG" }));
    expect(await screen.findByText("Network unavailable")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    fireEvent.click(await screen.findByRole("button", { name: "Request Manage PG" }));

    await waitFor(() => expect(requestManage).toHaveBeenCalledTimes(2));
    expect(requestManage.mock.calls[0][3]).toEqual(expect.any(String));
    expect(requestManage.mock.calls[1][3]).toBe(requestManage.mock.calls[0][3]);
    expect(await screen.findByText("Manage PG request pending approval.")).toBeInTheDocument();
  });

  it("shows the managed property link after approval", async () => {
    getManageRequest.mockResolvedValueOnce({
      status: "approved",
      managed_property_id: "property-1"
    });

    render(<PgManageRequestPanel listingId="listing-1" locale="hi" accessToken="token-1" />);

    expect(await screen.findByRole("link", { name: "Open Manage PG" })).toHaveAttribute(
      "href",
      "/hi/pg-operator/properties/property-1"
    );
  });

  it("shows the rejection notes", async () => {
    getManageRequest.mockResolvedValueOnce({
      status: "rejected",
      request: { decision_notes: "Please complete verification first." }
    });

    render(<PgManageRequestPanel listingId="listing-1" locale="en" accessToken="token-1" />);

    expect(await screen.findByText("Please complete verification first.")).toBeInTheDocument();
    expect(screen.getByText("Contact support for help with your request.")).toBeInTheDocument();
  });
});
