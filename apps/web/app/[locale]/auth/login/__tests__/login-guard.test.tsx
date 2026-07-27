import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// ── Mocks ────────────────────────────────────────────────────────────────────

// useSession returns whatever the current test set on `__session`.
let __session: { status: "authenticated" | "unauthenticated" | "loading"; data: unknown } = {
  status: "unauthenticated",
  data: null
};

// vi.hoisted: these are called directly inside vi.mock factories below, which
// are hoisted above this file's own top-level code — a plain `const x = vi.fn()`
// referenced from inside those factories would hit Vitest's "cannot access
// before initialization" hoisting guard. vi.hoisted runs before that hoisting
// so the reference is always safe.
const { signInMock, getSessionMock, saveFullNameMock } = vi.hoisted(() => ({
  signInMock: vi.fn(),
  getSessionMock: vi.fn(),
  saveFullNameMock: vi.fn()
}));

vi.mock("next-auth/react", () => ({
  useSession: () => __session,
  signIn: signInMock,
  getSession: getSessionMock
}));

// The login page reads `from`/`tab` off the query string.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("")
}));

// Brand lockup pulls in next/image — not relevant to the guard; stub it out.
vi.mock("../../../../../components/brand/brand-lockup", () => ({
  BrandLockup: () => null
}));

// Step 3 renders the real NameCaptureForm (Task 7), which calls this on
// submit. Mocked for the same reason name-capture-modal.test.tsx mocks it:
// keeps the suite from ever making a real network call. hasName,
// markNamePromptDismissed and namePromptDismissKey stay real — the guard
// suppression and the skip/save exits depend on their actual behaviour.
vi.mock("../../../../../lib/name-capture", async () => {
  const actual = await vi.importActual<typeof import("../../../../../lib/name-capture")>(
    "../../../../../lib/name-capture"
  );
  return {
    ...actual,
    saveFullName: saveFullNameMock
  };
});

import LoginPage from "../page";
import { namePromptDismissKey } from "../../../../../lib/name-capture";

// jsdom's window.location isn't spy-able; stub it wholesale so the guard's
// window.location.replace(...) is observable, and so plain `href` assignments
// (the two step-3 exits) are readable back afterwards.
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

  signInMock.mockReset();
  getSessionMock.mockReset();
  saveFullNameMock.mockReset();
  saveFullNameMock.mockResolvedValue(undefined);
  window.sessionStorage.clear();

  // Only handleSendOtp (step 1 -> 2) calls fetch; dev_otp auto-fills the OTP
  // field so the flow can reach Verify without simulating typing it in.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { challenge_id: "chal_1", dev_otp: "123456" } })
    }))
  );
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

// ── Step 3: name capture, and the guard suppression that keeps it alive ─────

/**
 * Drives the real phone -> OTP -> verify flow so `step` and `status` change
 * exactly the way they do in production: signIn() (mocked here) flips
 * useSession()'s status to "authenticated" mid-handleVerify — before
 * setStep(3) runs — same as the real NextAuth timing the login page's own
 * comments describe. A synthetic shortcut that set `step` to 3 directly
 * without also flipping status would never exercise the guard at all, since
 * both guards only act when status === "authenticated".
 */
async function verifyIntoNameStep(sessionUser: { id: string; role: string; name: string | null }) {
  signInMock.mockResolvedValue({ error: null });
  // The flip happens here, not inside signIn(): handleVerify's own
  // getSession() call is what the real timing races against (the comment
  // above that call in page.tsx notes getSession() itself races the cookie
  // write). Flipping __session as this resolves — synchronously, in the same
  // tick as the setStep(3) a few lines later in page.tsx — reproduces "status
  // is already authenticated by the render where step becomes 3" without
  // fabricating an earlier, unrelated intermediate render at step === 2 that
  // no implementation could suppress (flipping inside signIn() instead would
  // do exactly that — verified by hand, it fails even with the guard fix).
  getSessionMock.mockImplementation(async () => {
    __session = { status: "authenticated", data: { user: sessionUser } };
    return { user: sessionUser, accessToken: "acc_test_token" };
  });

  render(<LoginPage />);

  fireEvent.change(screen.getByLabelText(/mobile number/i), {
    target: { value: "9876543210" }
  });
  fireEvent.click(screen.getByRole("button", { name: /continue with otp/i }));

  // dev_otp auto-fills a 6-digit code, so Verify is already enabled once step
  // 2 mounts.
  await screen.findByLabelText(/one-time password/i);

  fireEvent.click(screen.getByRole("button", { name: /verify & sign in/i }));
}

describe("login page — name-capture step (step 3)", () => {
  it("renders the name step instead of redirecting for a nameless tenant", async () => {
    await verifyIntoNameStep({ id: "user-1", role: "tenant", name: null });

    expect(await screen.findByTestId("name-capture-input")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /what should we call you/i })).toBeInTheDocument();

    // The landmine this task exists to fix: without suppressing both the
    // effect guard and the render-time "already authenticated" gate, this
    // step would have been torn down / never shown, and replace() would have
    // fired the moment status flipped to authenticated.
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("does not divert a nameless admin — admins are excluded from the prompt", async () => {
    await verifyIntoNameStep({ id: "admin-1", role: "admin", name: null });

    await waitFor(() => {
      expect(window.location.href).toBe("/en/admin");
    });
    expect(screen.queryByTestId("name-capture-input")).not.toBeInTheDocument();
  });

  it("navigates to the pending destination and marks the prompt dismissed on skip", async () => {
    await verifyIntoNameStep({ id: "user-2", role: "tenant", name: null });
    await screen.findByTestId("name-capture-input");

    fireEvent.click(screen.getByTestId("name-capture-skip"));

    await waitFor(() => {
      expect(window.location.href).toBe("/en");
    });
    expect(window.sessionStorage.getItem(namePromptDismissKey("user-2"))).not.toBeNull();
  });

  it("navigates to the pending destination after saving a name", async () => {
    await verifyIntoNameStep({ id: "user-3", role: "owner", name: null });
    await screen.findByTestId("name-capture-input");

    fireEvent.change(screen.getByTestId("name-capture-input"), {
      target: { value: "Asha Devi" }
    });
    fireEvent.click(screen.getByTestId("name-capture-submit"));

    await waitFor(() => {
      expect(saveFullNameMock).toHaveBeenCalledWith("acc_test_token", "Asha Devi");
    });
    await waitFor(() => {
      expect(window.location.href).toBe("/en/owner/dashboard");
    });
  });
});
