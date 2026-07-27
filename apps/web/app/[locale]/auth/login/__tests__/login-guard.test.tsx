import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";

// ── Mocks ────────────────────────────────────────────────────────────────────

// useSession returns whatever the current test set on `__session`. It is also
// reactive — sessionListeners lets a test force every subscribed component to
// re-render the instant the session changes, via setSessionAndNotify below.
// That is what the earlier-flip regression test needs: a render where
// `status` has already flipped to "authenticated" but the component's own
// `step` state has not yet reached 3 (real NextAuth's signIn() broadcasts a
// session update to every useSession() consumer the moment it completes,
// independent of anything the calling component's own state does — this
// mirrors that). Tests that only need the value at the FIRST render (nearly
// all of them) are unaffected: they can keep assigning `__session = {...}`
// directly before calling render(), exactly as before.
let __session: { status: "authenticated" | "unauthenticated" | "loading"; data: unknown } = {
  status: "unauthenticated",
  data: null
};
const sessionListeners = new Set<() => void>();
function setSessionAndNotify(next: typeof __session) {
  __session = next;
  sessionListeners.forEach((listener) => listener());
}

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
  useSession: () =>
    useSyncExternalStore(
      (onStoreChange: () => void) => {
        sessionListeners.add(onStoreChange);
        return () => sessionListeners.delete(onStoreChange);
      },
      () => __session
    ),
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
  // Defensive: RTL auto-unmounts between tests (registered afterEach(cleanup),
  // since this file imports from "@testing-library/react" not "/pure"), which
  // already runs each useSyncExternalStore subscription's own unsubscribe —
  // this just guarantees no listener ever leaks across tests even if that
  // didn't happen.
  sessionListeners.clear();
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
 * the way they do in production under the MILDER of two possible timings:
 * status flips to "authenticated" when handleVerify's own getSession() call
 * resolves — in the same tick as the setStep(3) call a few lines later in
 * page.tsx — so status and step change together, in the same render. This
 * ordering never needed verifyingRef: the old `step === 3`-only guards
 * already handled it correctly, which is why it's the one this suite
 * originally covered.
 *
 * The HARDER, real-NextAuth ordering — signIn() itself flips status to
 * "authenticated" a full render before getSession() even starts, let alone
 * resolves — is covered separately below by
 * verifyIntoNameStepWithEarlierFlip(). That ordering is what actually broke
 * the login page in a real browser (see .superpowers/sdd/task-13-report.md)
 * and is what verifyingRef exists to fix. A synthetic shortcut that set
 * `step` to 3 directly without also flipping status would never exercise
 * either guard at all, since both guards only act when
 * status === "authenticated".
 */
async function verifyIntoNameStep(sessionUser: { id: string; role: string; name: string | null }) {
  signInMock.mockResolvedValue({ error: null });
  // The flip happens here, not inside signIn(): handleVerify's own
  // getSession() call is what the real timing races against (the comment
  // above that call in page.tsx notes getSession() itself races the cookie
  // write). Flipping __session as this resolves — synchronously, in the same
  // tick as the setStep(3) a few lines later in page.tsx — reproduces "status
  // is already authenticated by the render where step becomes 3" without
  // fabricating the earlier, harder ordering that verifyIntoNameStepWithEarlierFlip
  // covers below.
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

// ── The earlier, real-NextAuth flip ordering — the actual bug ──────────────

/**
 * Drives the same phone -> OTP -> verify flow as verifyIntoNameStep, but
 * reproduces the HARDER ordering: signIn() itself flips useSession()'s status
 * to "authenticated" — via setSessionAndNotify, which forces every subscribed
 * component to re-render immediately — before handleVerify's subsequent
 * getSession() call even starts, let alone resolves or reaches setStep(3).
 *
 * This is not a synthetic edge case: it is real NextAuth's own documented
 * behaviour (signIn() broadcasts the new session to every useSession()
 * consumer as part of its own completion) and is exactly what the E2E suite
 * hit in a real browser (.superpowers/sdd/task-13-report.md) — the render
 * where status is already "authenticated" but `step` is still 1 is one full
 * render earlier than anything verifyIntoNameStep above can produce, because
 * that helper only flips __session inside getSession(), which resolves in
 * the same tick as setStep(3).
 */
async function verifyIntoNameStepWithEarlierFlip(sessionUser: {
  id: string;
  role: string;
  name: string | null;
}) {
  signInMock.mockImplementation(async () => {
    setSessionAndNotify({ status: "authenticated", data: { user: sessionUser } });
    return { error: null };
  });
  getSessionMock.mockResolvedValue({ user: sessionUser, accessToken: "acc_test_token" });

  render(<LoginPage />);

  fireEvent.change(screen.getByLabelText(/mobile number/i), {
    target: { value: "9876543210" }
  });
  fireEvent.click(screen.getByRole("button", { name: /continue with otp/i }));

  await screen.findByLabelText(/one-time password/i);

  fireEvent.click(screen.getByRole("button", { name: /verify & sign in/i }));
}

describe("login page — earlier session-flip ordering (regression)", () => {
  it("renders the name step and does not redirect when status flips to authenticated before getSession() resolves", async () => {
    await verifyIntoNameStepWithEarlierFlip({ id: "user-5", role: "tenant", name: null });

    expect(await screen.findByTestId("name-capture-input")).toBeInTheDocument();

    // This is the actual regression check: on the render where signIn()
    // flipped status but handleVerify had not yet reached setStep(3), `step`
    // was still 1. Both guards would have fired under `step === 3` alone —
    // verifyingRef (set synchronously before signIn() is ever called) is what
    // stands them down here instead.
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
