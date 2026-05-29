import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import LeadsInbox from "../LeadsInbox";

describe("LeadsInbox", () => {
  it("renders 'No leads yet' empty state when leads array is empty", () => {
    render(<LeadsInbox leads={[]} />);
    expect(screen.getByText(/no leads yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("renders one li per lead", () => {
    render(
      <LeadsInbox
        leads={[
          {
            lead_id: "a",
            source: "search",
            status: "new",
            created_at: "2026-05-20T00:00:00Z",
            contact: { phone_masked: "+91 *****1212" }
          },
          {
            lead_id: "b",
            source: "map",
            status: "new",
            created_at: "2026-05-27T00:00:00Z",
            contact: { phone_masked: "+91 *****3434" }
          }
        ]}
      />
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("sorts leads newest first by created_at", () => {
    render(
      <LeadsInbox
        leads={[
          {
            lead_id: "old",
            source: "search",
            status: "new",
            created_at: "2026-05-20T00:00:00Z",
            contact: { phone_masked: "+91 *****1212" }
          },
          {
            lead_id: "new",
            source: "map",
            status: "new",
            created_at: "2026-05-27T00:00:00Z",
            contact: { phone_masked: "+91 *****3434" }
          }
        ]}
      />
    );
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText(/3434/)).toBeInTheDocument();
    expect(within(items[1]).getByText(/1212/)).toBeInTheDocument();
  });

  it("shows masked phone, source, and status for each lead", () => {
    render(
      <LeadsInbox
        leads={[
          {
            lead_id: "a",
            source: "search",
            status: "contacted",
            created_at: "2026-05-25T00:00:00Z",
            contact: { phone_masked: "+91 *****9999" }
          }
        ]}
      />
    );
    const item = screen.getByRole("listitem");
    expect(within(item).getByText(/9999/)).toBeInTheDocument();
    expect(within(item).getByText(/search/)).toBeInTheDocument();
    expect(within(item).getByText(/contacted/)).toBeInTheDocument();
  });

  it("renders the 'Leads' heading only when there are leads", () => {
    const { rerender } = render(<LeadsInbox leads={[]} />);
    expect(screen.queryByRole("heading", { name: /leads/i })).not.toBeInTheDocument();
    rerender(
      <LeadsInbox
        leads={[
          {
            lead_id: "x",
            source: "search",
            status: "new",
            created_at: "2026-05-27T00:00:00Z",
            contact: { phone_masked: "+91 *****1111" }
          }
        ]}
      />
    );
    expect(screen.getByRole("heading", { name: /leads/i })).toBeInTheDocument();
  });
});
