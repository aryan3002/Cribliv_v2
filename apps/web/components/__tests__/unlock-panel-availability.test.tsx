import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UnlockContactPanel } from "../unlock-contact-panel";

// Mirrors the `useFlag` mocking pattern established in
// unlock-contact-purchase.test.tsx / listing-card-availability.test.tsx.
// ff_callback_leads defaults ON here specifically so the "flag off" case
// below proves the unavailable branch's absence falls back to the
// *callback* flow's "Request Callback" label (not just any legacy label) —
// this is the sharpest test of "the unavailable branch takes precedence".
const { flagState } = vi.hoisted(() => ({
  flagState: { ff_unavailable_listings: true, ff_callback_leads: true } as Record<string, boolean>
}));

vi.mock("../../lib/feature-flags", () => ({
  useFlag: (flag: string) => Boolean(flagState[flag])
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { accessToken: "session-tok", user: { name: "Tenant" } },
    status: "authenticated"
  })
}));

const { joinAvailabilityWaitlistMock } = vi.hoisted(() => ({
  joinAvailabilityWaitlistMock: vi.fn()
}));

vi.mock("../../lib/availability-api", () => ({
  joinAvailabilityWaitlist: joinAvailabilityWaitlistMock
}));

function jsonOk(data: unknown) {
  return Promise.resolve({ ok: true, json: async () => ({ data }) });
}

function routeFetch(
  routes: Array<{
    match: (url: string, init?: RequestInit) => boolean;
    respond: (init?: RequestInit) => Promise<unknown>;
  }>
) {
  return vi.fn((url: string, init?: RequestInit) => {
    const route = routes.find((r) => r.match(String(url), init));
    // Unmocked calls resolve harmlessly instead of throwing — e.g. a stray
    // /wallet fetch would mean the isUnavailable wallet-skip regressed; we
    // want that to surface as a wrong-state assertion failure below, not a
    // noisy unhandled rejection that masks the real bug.
    if (!route) {
      return jsonOk({});
    }
    return route.respond(init);
  });
}

function shortlistRoute() {
  return {
    match: (url: string, init?: RequestInit) =>
      url.includes("/shortlist") && (!init?.method || init.method === "GET"),
    respond: () => jsonOk({ items: [], total: 0 })
  };
}

beforeEach(() => {
  flagState.ff_unavailable_listings = true;
  flagState.ff_callback_leads = true;
  joinAvailabilityWaitlistMock.mockReset();
  vi.stubGlobal("fetch", routeFetch([shortlistRoute()]));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UnlockContactPanel — unavailable listing calm-swap (ff_unavailable_listings)", () => {
  it("shows Notify when available instead of Request Callback when unavailable and the flag is on", async () => {
    render(<UnlockContactPanel listingId="L1" locale="en" isAvailable={false} waitlistCount={0} />);

    expect(
      await screen.findByRole("button", { name: /notify when available/i })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /request callback/i })).not.toBeInTheDocument();
    // waitlistCount is 0 — no social-proof line yet.
    expect(screen.queryByText(/people are waiting/i)).not.toBeInTheDocument();
  });

  it("keeps Request Callback and hides Notify when available when the flag is off, even if unavailable", async () => {
    flagState.ff_unavailable_listings = false;

    render(<UnlockContactPanel listingId="L2" locale="en" isAvailable={false} waitlistCount={3} />);

    expect(await screen.findByRole("button", { name: /request callback/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /notify when available/i })
    ).not.toBeInTheDocument();
  });

  it("does not show the unavailable branch when is_available is true, even with the flag on", async () => {
    render(<UnlockContactPanel listingId="L3" locale="en" isAvailable={true} />);

    expect(await screen.findByRole("button", { name: /request callback/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /notify when available/i })
    ).not.toBeInTheDocument();
  });

  it("reaches the joined success state when a logged-in user taps Notify when available", async () => {
    joinAvailabilityWaitlistMock.mockResolvedValue({ status: "waiting", already_on_list: false });

    render(<UnlockContactPanel listingId="L4" locale="en" isAvailable={false} waitlistCount={2} />);

    const notifyBtn = await screen.findByRole("button", { name: /notify when available/i });
    fireEvent.click(notifyBtn);

    await waitFor(() =>
      expect(joinAvailabilityWaitlistMock).toHaveBeenCalledWith("session-tok", "L4", "en")
    );
    expect(await screen.findByText(/you're on the list/i)).toBeInTheDocument();
    // The ask is fulfilled — the Notify button disappears, not just relabels.
    expect(
      screen.queryByRole("button", { name: /notify when available/i })
    ).not.toBeInTheDocument();
  });

  it("shows the already-on-the-waitlist message when the API reports already_on_list", async () => {
    joinAvailabilityWaitlistMock.mockResolvedValue({ status: "waiting", already_on_list: true });

    render(<UnlockContactPanel listingId="L5" locale="en" isAvailable={false} />);
    fireEvent.click(await screen.findByRole("button", { name: /notify when available/i }));

    expect(await screen.findByText(/already.*waitlist/i)).toBeInTheDocument();
  });

  it("shows a social-proof line when waitlist_count is greater than zero", async () => {
    render(<UnlockContactPanel listingId="L6" locale="en" isAvailable={false} waitlistCount={7} />);

    expect(await screen.findByText(/7 people are waiting/i)).toBeInTheDocument();
  });

  it("does not fake a joined state on a failed join request", async () => {
    joinAvailabilityWaitlistMock.mockRejectedValue(new Error("network down"));

    render(<UnlockContactPanel listingId="L7" locale="en" isAvailable={false} />);
    fireEvent.click(await screen.findByRole("button", { name: /notify when available/i }));

    await screen.findByText(/network down/i);
    expect(screen.queryByText(/you're on the list/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/already.*waitlist/i)).not.toBeInTheDocument();
  });

  it("keeps the Save button available in the unavailable branch", async () => {
    render(<UnlockContactPanel listingId="L8" locale="en" isAvailable={false} />);
    expect(await screen.findByRole("button", { name: /^save$/i })).toBeInTheDocument();
  });
});
