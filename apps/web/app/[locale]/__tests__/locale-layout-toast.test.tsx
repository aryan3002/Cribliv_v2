import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LocaleLayout from "../layout";
import { useToast } from "@/components/ui/toast/use-toast";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  usePathname: () => "/en"
}));
// NamePromptProvider (mounted in the real layout, unmocked below since this
// test cares about the real ToastProvider wiring) calls useSession() itself,
// which throws outside a <SessionProvider>. Stub it unauthenticated so the
// ambient prompt stays closed and this test's own concern is undisturbed.
vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "unauthenticated", data: null })
}));
vi.mock("../../../components/locale-chrome", () => ({
  LocaleChrome: ({ children }: { children: ReactNode }) => <div>{children}</div>
}));
vi.mock("../../../components/analytics/pageview-tracker", () => ({
  PageviewTracker: () => null
}));
vi.mock("../../../components/welcome-credits-modal", () => ({
  WelcomeCreditsModal: () => null
}));

function ToastProbe() {
  useToast();
  return <span>Toast context available</span>;
}

describe("LocaleLayout", () => {
  it("provides toast context to locale route children", () => {
    render(
      <LocaleLayout params={{ locale: "en" }}>
        <ToastProbe />
      </LocaleLayout>
    );

    expect(screen.getByText("Toast context available")).toBeInTheDocument();
  });
});
