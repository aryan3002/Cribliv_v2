import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchAdminPgManageRequests = vi.fn();
const approveAdminPgManageRequest = vi.fn();
const rejectAdminPgManageRequest = vi.fn();

vi.mock("../../../../lib/pg-operations-api", () => ({
  fetchAdminPgManageRequests: (...args: unknown[]) => fetchAdminPgManageRequests(...args),
  approveAdminPgManageRequest: (...args: unknown[]) => approveAdminPgManageRequest(...args),
  rejectAdminPgManageRequest: (...args: unknown[]) => rejectAdminPgManageRequest(...args)
}));

import { ManagePgRequestsTab } from "../ManagePgRequestsTab";

const PENDING_REQUEST = {
  id: "request-pending",
  listing_id: "listing-pending",
  operator_id: "operator-1",
  status: "pending" as const,
  reason: null,
  decision_notes: null,
  managed_property_id: null,
  created_at: "2026-07-12T10:00:00.000Z",
  updated_at: "2026-07-12T10:00:00.000Z",
  listing_title: "Sunrise PG",
  operator_name: "Asha Singh",
  operator_phone: "+919999999901"
};

describe("ManagePgRequestsTab", () => {
  const onToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchAdminPgManageRequests.mockResolvedValue({ items: [PENDING_REQUEST] });
  });

  it("loads the pending queue and reloads it with the selected status filter", async () => {
    render(<ManagePgRequestsTab accessToken="admin-token" onToast={onToast} />);

    expect(await screen.findByText("Sunrise PG")).toBeInTheDocument();
    expect(fetchAdminPgManageRequests).toHaveBeenCalledWith("pending", "admin-token");

    fireEvent.click(screen.getByRole("button", { name: "Approved" }));

    await waitFor(() => {
      expect(fetchAdminPgManageRequests).toHaveBeenLastCalledWith("approved", "admin-token");
    });
  });

  it("approves a request with notes, confirms the decision, and refreshes the queue", async () => {
    approveAdminPgManageRequest.mockResolvedValue({});
    render(<ManagePgRequestsTab accessToken="admin-token" onToast={onToast} />);

    await screen.findByText("Sunrise PG");
    fireEvent.change(screen.getByRole("textbox", { name: "Decision notes for Sunrise PG" }), {
      target: { value: "  Verified documents  " }
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(approveAdminPgManageRequest).toHaveBeenCalledWith(
        "request-pending",
        { notes: "Verified documents" },
        "admin-token"
      );
    });
    expect(onToast).toHaveBeenCalledWith("Manage PG request approved", "trust");
    await waitFor(() => expect(fetchAdminPgManageRequests).toHaveBeenCalledTimes(2));
  });

  it("rejects a request with notes, confirms the decision, and refreshes the queue", async () => {
    rejectAdminPgManageRequest.mockResolvedValue({});
    render(<ManagePgRequestsTab accessToken="admin-token" onToast={onToast} />);

    await screen.findByText("Sunrise PG");
    fireEvent.change(screen.getByRole("textbox", { name: "Decision notes for Sunrise PG" }), {
      target: { value: "  Listing details are incomplete  " }
    });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() => {
      expect(rejectAdminPgManageRequest).toHaveBeenCalledWith(
        "request-pending",
        { notes: "Listing details are incomplete" },
        "admin-token"
      );
    });
    expect(onToast).toHaveBeenCalledWith("Manage PG request rejected", "trust");
    await waitFor(() => expect(fetchAdminPgManageRequests).toHaveBeenCalledTimes(2));
  });
});
