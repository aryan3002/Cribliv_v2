import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  requestRoleUpgrade: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn()
}));

vi.mock("@/lib/owner-api", () => ({ requestRoleUpgrade: mocks.requestRoleUpgrade }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh })
}));

import PgBecomeClient from "../PgBecomeClient";

beforeEach(() => {
  mocks.requestRoleUpgrade.mockReset();
  mocks.push.mockReset();
  mocks.refresh.mockReset();
});

describe("PgBecomeClient", () => {
  it("tenant + granted: calls requestRoleUpgrade(token, role) then refresh then push", async () => {
    mocks.requestRoleUpgrade.mockResolvedValueOnce({
      status: "granted",
      role: "pg_operator",
      requested_role: "pg_operator",
      request_id: null
    });
    render(<PgBecomeClient locale="en" currentRole="tenant" accessToken="tok-123" />);
    expect(screen.getByRole("heading", { name: /setting up/i })).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.requestRoleUpgrade).toHaveBeenCalledWith("tok-123", "pg_operator")
    );
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/en/pg-operator/dashboard"));
  });

  it("tenant + already_granted: treats as success, routes to dashboard", async () => {
    mocks.requestRoleUpgrade.mockResolvedValueOnce({
      status: "already_granted",
      role: "pg_operator",
      requested_role: "pg_operator",
      request_id: null
    });
    render(<PgBecomeClient locale="en" currentRole="tenant" accessToken="tok" />);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/en/pg-operator/dashboard"));
  });

  it("tenant + pending: shows 'request submitted' page, does NOT redirect", async () => {
    mocks.requestRoleUpgrade.mockResolvedValueOnce({
      status: "pending",
      requested_role: "pg_operator",
      request_id: "req-1"
    });
    render(<PgBecomeClient locale="en" currentRole="tenant" accessToken="tok" />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /under review|being reviewed/i })
      ).toBeInTheDocument()
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("owner: shows multi-role-V1.5 message and does NOT call requestRoleUpgrade", async () => {
    render(<PgBecomeClient locale="en" currentRole="owner" accessToken="tok" />);
    // 4.6 UI split the copy across heading + paragraph; assert on the heading.
    expect(
      screen.getByRole("heading", { name: /already manage properties|multi.*role/i })
    ).toBeInTheDocument();
    expect(mocks.requestRoleUpgrade).not.toHaveBeenCalled();
  });

  it("pg_operator: redirects straight to dashboard", async () => {
    render(<PgBecomeClient locale="en" currentRole="pg_operator" accessToken="tok" />);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/en/pg-operator/dashboard"));
    expect(mocks.requestRoleUpgrade).not.toHaveBeenCalled();
  });

  it("no access token: skips RPC and surfaces sign-in prompt", async () => {
    render(<PgBecomeClient locale="en" currentRole="tenant" accessToken={null} />);
    expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();
    expect(mocks.requestRoleUpgrade).not.toHaveBeenCalled();
  });

  it("on grant failure surfaces a retry button", async () => {
    mocks.requestRoleUpgrade.mockRejectedValueOnce(new Error("network down"));
    render(<PgBecomeClient locale="en" currentRole="tenant" accessToken="tok" />);
    await waitFor(() => expect(screen.getByText(/network down|try again/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /retry|try again/i })).toBeInTheDocument();
  });
});
