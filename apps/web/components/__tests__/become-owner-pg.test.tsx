import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ── Mocks ────────────────────────────────────────────────────────────────────

const push = vi.fn();
const signInMock = vi.fn();
const requestRoleUpgradeMock = vi.fn();
const updateSessionMock = vi.fn();

let __sessionState: {
  status: "authenticated" | "unauthenticated" | "loading";
  data: unknown;
} = { status: "unauthenticated", data: null };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/"
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ ...__sessionState, update: updateSessionMock }),
  signIn: (...args: unknown[]) => signInMock(...args)
}));

vi.mock("../../lib/owner-api", () => ({
  requestRoleUpgrade: (...args: unknown[]) => requestRoleUpgradeMock(...args)
}));

import { BecomeOwnerClient } from "../become-owner-client";

function setAuthSession(role?: string, accessToken: string | null = "tok_abc") {
  __sessionState = {
    status: "authenticated",
    data: {
      accessToken,
      user: role ? { role, name: "Test" } : { name: "Test" }
    }
  };
}

beforeEach(() => {
  push.mockReset();
  signInMock.mockReset();
  requestRoleUpgradeMock.mockReset();
  updateSessionMock.mockReset();
  __sessionState = { status: "unauthenticated", data: null };
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("become-owner PG tile", () => {
  it("redirects to /pg-operator/become on PG submit (and does NOT call requestRoleUpgrade)", () => {
    setAuthSession(undefined);
    render(<BecomeOwnerClient locale="en" />);

    // The two tiles are <button type="button"> labelled "Property Owner" and
    // "PG Operator". Pick the PG tile (which sets `selected = pg_operator`).
    fireEvent.click(screen.getByRole("button", { name: /PG Operator/i }));

    // The submit button label is dynamic: "Get PG Operator access →"
    fireEvent.click(screen.getByRole("button", { name: /Get PG Operator access/i }));

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/en/pg-operator/become");
    expect(requestRoleUpgradeMock).not.toHaveBeenCalled();
  });

  it("owner tile still calls requestRoleUpgrade with (accessToken, 'owner')", async () => {
    setAuthSession(undefined, "tok_owner");
    requestRoleUpgradeMock.mockResolvedValue({
      status: "granted",
      role: "owner",
      requested_role: "owner",
      request_id: "req_1"
    });

    render(<BecomeOwnerClient locale="en" />);

    // Owner tile is selected by default; click submit directly.
    fireEvent.click(screen.getByRole("button", { name: /Get Property Owner access/i }));

    await waitFor(() => {
      expect(requestRoleUpgradeMock).toHaveBeenCalledTimes(1);
    });
    expect(requestRoleUpgradeMock).toHaveBeenCalledWith("tok_owner", "owner");
    // The owner success path should NOT redirect to /pg-operator/become.
    expect(push).not.toHaveBeenCalledWith("/en/pg-operator/become");
  });

  it("user with role=pg_operator sees the 'already a PG Operator' branch (no form rendered)", () => {
    setAuthSession("pg_operator");
    render(<BecomeOwnerClient locale="en" />);

    // The early-return branch renders an "already a PG Operator" headline and
    // a Dashboard link — the role tiles + submit button are NOT rendered.
    expect(screen.getByText(/already a PG Operator/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Get PG Operator access/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Get Property Owner access/i })).toBeNull();
    // Sanity: nothing pushed, nothing called.
    expect(push).not.toHaveBeenCalled();
    expect(requestRoleUpgradeMock).not.toHaveBeenCalled();
  });

  it("unauthenticated user sees the sign-in prompt (no form, no router push)", () => {
    // __sessionState already reset to unauthenticated in beforeEach.
    render(<BecomeOwnerClient locale="en" />);

    expect(screen.getByText(/Sign in to get started/i)).toBeInTheDocument();
    // Login link points at the auth flow with the correct callback.
    const loginLink = screen.getByRole("link", { name: /Login \/ Sign up/i });
    expect(loginLink.getAttribute("href")).toBe("/auth/login?from=/en/become-owner");
    // No form, so no tile/submit buttons rendered, no router activity.
    expect(screen.queryByRole("button", { name: /Get .* access/i })).toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(requestRoleUpgradeMock).not.toHaveBeenCalled();
  });
});
