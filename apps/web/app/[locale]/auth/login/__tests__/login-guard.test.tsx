import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ── Mocks ────────────────────────────────────────────────────────────────────

// useSession returns whatever the current test set on `__session`.
let __session: { status: "authenticated" | "unauthenticated" | "loading"; data: unknown } = {
  status: "unauthenticated",
  data: null
};

vi.mock("next-auth/react", () => ({
  useSession: () => __session,
  signIn: vi.fn(),
  getSession: vi.fn()
}));

// The login page reads `from`/`tab` off the query string.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("")
}));

// Brand lockup pulls in next/image — not relevant to the guard; stub it out.
vi.mock("../../../../../components/brand/brand-lockup", () => ({
  BrandLockup: () => null
}));

import LoginPage from "../page";

// jsdom's window.location isn't spy-able; stub it wholesale so the guard's
// window.location.replace(...) is observable.
let replaceMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __session = { status: "unauthenticated", data: null };
  replaceMock = vi.fn();
  vi.stubGlobal("location", {
    href: "http://localhost/en/auth/login",
    origin: "http://localhost",
    pathname: "/en/auth/login",
    replace: replaceMock,
    assign: vi.fn()
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("login page — already-authenticated guard", () => {
  it("renders the login form when unauthenticated", () => {
    __session = { status: "unauthenticated", data: null };
    render(<LoginPage />);
    expect(screen.getByText(/continue with otp/i)).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("suppresses the form and redirects an already-authenticated owner", () => {
    __session = { status: "authenticated", data: { user: { role: "owner" } } };
    render(<LoginPage />);
    expect(screen.queryByText(/continue with otp/i)).not.toBeInTheDocument();
    expect(replaceMock).toHaveBeenCalledWith("/en/owner/dashboard");
  });

  it("redirects a tenant to the locale home", () => {
    __session = { status: "authenticated", data: { user: { role: "tenant" } } };
    render(<LoginPage />);
    expect(screen.queryByText(/continue with otp/i)).not.toBeInTheDocument();
    expect(replaceMock).toHaveBeenCalledWith("/en");
  });
});
