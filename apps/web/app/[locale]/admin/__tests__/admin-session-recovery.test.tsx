import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { UNAUTHORIZED_EVENT } from "../../../../lib/api";

/**
 * The admin portal used to render a full shell against a dead token: every
 * panel 401'd and nothing ever signed the user out, because NextAuth still
 * reported "authenticated". These cover the two recovery paths.
 */

const signOut = vi.fn();
const update = vi.fn(async () => null);
let sessionState: { data: unknown; status: string };

vi.mock("next-auth/react", () => ({
  useSession: () => ({ ...sessionState, update }),
  signOut: (...args: unknown[]) => signOut(...args)
}));

vi.mock("../../../../components/admin/shell/AdminShell", () => ({
  AdminShell: ({ accessToken }: { accessToken: string }) => (
    <div data-testid="shell">shell:{accessToken}</div>
  )
}));

// Imported after the mocks so the component picks them up.
const { default: AdminDashboardPage } = await import("../page");

function session(overrides: Record<string, unknown> = {}) {
  return {
    data: { accessToken: "acc_live", user: { role: "admin" }, ...overrides },
    status: "authenticated"
  };
}

beforeEach(() => {
  signOut.mockClear();
  update.mockClear();
  sessionState = session();
});

afterEach(() => vi.useRealTimers());

describe("admin session recovery", () => {
  it("renders the shell for a healthy session", () => {
    render(<AdminDashboardPage />);
    expect(screen.getByTestId("shell")).toHaveTextContent("acc_live");
    expect(signOut).not.toHaveBeenCalled();
  });

  it("re-reads the session when an admin call reports 401", async () => {
    render(<AdminDashboardPage />);

    act(() => {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    });

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    // A recoverable 401 must not log the admin out.
    expect(signOut).not.toHaveBeenCalled();
  });

  it("does not stampede the session endpoint when many panels fail at once", async () => {
    render(<AdminDashboardPage />);

    act(() => {
      for (let i = 0; i < 10; i += 1) {
        window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
      }
    });

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  });

  it("signs out when the refresh token was definitively rejected", async () => {
    sessionState = session({ error: "RefreshFailed" });

    render(<AdminDashboardPage />);

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(signOut).toHaveBeenCalledWith({
      callbackUrl: "/auth/login?reason=session-expired"
    });
    // And it must not keep rendering a surface that can only fail.
    expect(screen.queryByTestId("shell")).toBeNull();
  });

  it("signs out when the session cookie is gone", async () => {
    sessionState = { data: null, status: "unauthenticated" };

    render(<AdminDashboardPage />);

    await waitFor(() => expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/auth/login" }));
  });

  it("shows a loading state rather than a broken shell while resolving", () => {
    sessionState = { data: null, status: "loading" };

    render(<AdminDashboardPage />);

    expect(screen.getByText(/Loading admin/)).toBeInTheDocument();
    expect(screen.queryByTestId("shell")).toBeNull();
  });
});
