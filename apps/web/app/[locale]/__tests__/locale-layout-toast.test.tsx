import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LocaleLayout from "../layout";
import { useToast } from "@/components/ui/toast/use-toast";

vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
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
