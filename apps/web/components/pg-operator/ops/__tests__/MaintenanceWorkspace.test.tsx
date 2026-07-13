import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PgMaintenanceRequest } from "@cribliv/shared-types";

const { refresh, updateMaintenanceStatus, addMaintenanceComment, createResidenceMaintenance } =
  vi.hoisted(() => ({
    refresh: vi.fn(),
    updateMaintenanceStatus: vi.fn(),
    addMaintenanceComment: vi.fn(),
    createResidenceMaintenance: vi.fn()
  }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/pg-operations-api", () => ({
  updateMaintenanceStatus,
  addMaintenanceComment,
  createResidenceMaintenance,
  addResidenceMaintenanceComment: vi.fn()
}));

import MaintenanceWorkspace from "../MaintenanceWorkspace";

function ticket(overrides: Partial<PgMaintenanceRequest> = {}): PgMaintenanceRequest {
  return {
    id: "ticket-1",
    pg_property_id: "property-1",
    assignment_id: "assignment-1",
    created_by_user_id: "tenant-1",
    category: "Plumbing",
    description: "The bathroom tap is leaking.",
    photo_paths: [],
    status: "open",
    priority: null,
    closed_at: null,
    created_at: "2026-07-14T09:00:00.000Z",
    updated_at: "2026-07-14T09:00:00.000Z",
    comments: [],
    ...overrides
  };
}

describe("MaintenanceWorkspace", () => {
  beforeEach(() => {
    refresh.mockReset();
    updateMaintenanceStatus.mockReset();
    addMaintenanceComment.mockReset();
    createResidenceMaintenance.mockReset();
    updateMaintenanceStatus.mockResolvedValue(ticket({ status: "in_progress" }));
    addMaintenanceComment.mockResolvedValue({
      id: "comment-1",
      request_id: "ticket-1",
      author_user_id: "operator-1",
      author_role: "pg_operator",
      body: "On the way",
      attachments: [],
      created_at: "2026-07-14T10:00:00.000Z"
    });
    createResidenceMaintenance.mockResolvedValue(ticket({ id: "ticket-2" }));
  });

  it("only offers and submits valid operator status transitions", async () => {
    render(
      <MaintenanceWorkspace
        initialRequests={[ticket()]}
        mode="operator"
        propertyId="property-1"
        token="token-1"
      />
    );

    expect(screen.getByRole("button", { name: "Start work" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel ticket" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Resolve" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start work" }));

    await waitFor(() =>
      expect(updateMaintenanceStatus).toHaveBeenCalledWith(
        "property-1",
        "ticket-1",
        "in_progress",
        "token-1"
      )
    );
  });

  it("does not keep a hidden ticket selected after filtering", () => {
    render(
      <MaintenanceWorkspace
        initialRequests={[
          ticket(),
          ticket({ id: "ticket-2", category: "Electrical", status: "resolved" })
        ]}
        mode="operator"
        propertyId="property-1"
        token="token-1"
      />
    );

    expect(screen.getByRole("heading", { name: "Plumbing" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Filter tickets"), {
      target: { value: "resolved" }
    });

    expect(screen.queryByRole("heading", { name: "Plumbing" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Electrical" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start work" })).not.toBeInTheDocument();
  });

  it("requires a trimmed comment before submitting it", async () => {
    render(
      <MaintenanceWorkspace
        initialRequests={[ticket()]}
        mode="operator"
        propertyId="property-1"
        token="token-1"
      />
    );

    fireEvent.change(screen.getByLabelText("Add comment"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Send comment" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a comment before sending.");

    fireEvent.change(screen.getByLabelText("Add comment"), { target: { value: "  On the way  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send comment" }));

    await waitFor(() =>
      expect(addMaintenanceComment).toHaveBeenCalledWith(
        "property-1",
        "ticket-1",
        { body: "On the way" },
        "token-1",
        expect.any(String)
      )
    );
  });

  it("validates tenant tickets and sends a text-only payload", async () => {
    render(<MaintenanceWorkspace initialRequests={[]} mode="tenant" token="token-1" />);

    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Raise ticket" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a maintenance category.");

    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "  Plumbing " } });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "  The bathroom tap has been leaking since this morning. " }
    });
    fireEvent.click(screen.getByRole("button", { name: "Raise ticket" }));

    await waitFor(() =>
      expect(createResidenceMaintenance).toHaveBeenCalledWith(
        {
          category: "Plumbing",
          description: "The bathroom tap has been leaking since this morning."
        },
        "token-1",
        expect.any(String)
      )
    );
  });
});
