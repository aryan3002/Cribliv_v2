import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: {
    status: "authenticated" as const,
    data: {
      accessToken: "acc_test",
      walletBalance: 10,
      promotionalCredits: {
        remaining: 7,
        expiresAt: "2026-10-11T08:30:00.000Z"
      },
      user: {
        id: "tenant-1",
        phone: "+919999999902",
        role: "tenant" as const,
        preferredLanguage: "en" as const
      }
    }
  },
  push: vi.fn()
}));

vi.mock("next-auth/react", () => ({
  useSession: () => state.session,
  signOut: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push })
}));

import TenantDashboardPage from "../../app/[locale]/tenant/dashboard/page";
import { SessionBanner } from "../session-banner";
import { SettingsClient } from "../settings-client";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  state.push.mockReset();
});

describe("promotional credit expiry placements", () => {
  it("renders the session expiry beneath the tenant dashboard balance", () => {
    render(<TenantDashboardPage params={{ locale: "en" }} />);

    expect(screen.getByText("7 promotional credits expire 11 October 2026")).toBeInTheDocument();
  });

  it("renders the session expiry under the session banner badges", () => {
    render(<SessionBanner locale="en" />);

    expect(screen.getByText("7 promotional credits expire 11 October 2026")).toBeInTheDocument();
  });

  it("renders settings expiry from the independently fetched profile snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            id: "tenant-1",
            role: "tenant",
            phone_e164: "+919999999902",
            full_name: null,
            preferred_language: "en",
            whatsapp_opt_in: false,
            wallet_balance: 10,
            promotional_credits_remaining: 6,
            promotional_credits_expires_at: "2026-12-03T08:30:00.000Z"
          }
        })
      })
    );

    render(<SettingsClient locale="en" />);

    await waitFor(() => {
      expect(screen.getByText("6 promotional credits expire 3 December 2026")).toBeInTheDocument();
    });
    expect(screen.queryByText(/^7 promotional credits expire/)).not.toBeInTheDocument();
  });
});
