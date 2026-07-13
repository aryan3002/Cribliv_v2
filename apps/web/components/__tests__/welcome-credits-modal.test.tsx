import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({
  pathname: "/en",
  reducedMotion: false,
  session: {
    status: "authenticated" as "authenticated" | "unauthenticated" | "loading",
    data: {
      isNewUser: true,
      signupReward: {
        creditsGranted: 10,
        expiresAt: "2026-10-11T08:30:00.000Z"
      },
      user: {
        id: "u1",
        role: "tenant"
      }
    } as Record<string, any> | null
  }
}));

const analytics = vi.hoisted(() => ({
  trackEvent: vi.fn()
}));

vi.mock("next-auth/react", () => ({
  useSession: () => state.session
}));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname
}));

vi.mock("framer-motion", async () => {
  const React = await import("react");
  const motionElement = <T extends HTMLElement>(tag: "div" | "span") => {
    const MockMotionElement = React.forwardRef<T, React.HTMLAttributes<T>>(
      ({ children, ...props }, ref) => {
        const {
          initial: _initial,
          animate: _animate,
          transition: _transition,
          ...domProps
        } = props as React.HTMLAttributes<T> & {
          initial?: unknown;
          animate?: unknown;
          transition?: unknown;
        };
        return React.createElement(tag, { ...domProps, ref }, children);
      }
    );
    MockMotionElement.displayName = `MockMotion${tag}`;
    return MockMotionElement;
  };
  return {
    motion: {
      div: motionElement<HTMLDivElement>("div"),
      span: motionElement<HTMLSpanElement>("span")
    },
    useReducedMotion: () => state.reducedMotion
  };
});

vi.mock("../../lib/analytics", () => ({
  trackEvent: analytics.trackEvent
}));

import { WelcomeCreditsModal } from "../welcome-credits-modal";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
    clear: () => values.clear(),
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    }
  };
}

function installLocalStorage() {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: createStorage()
  });
}

function installMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" && state.reducedMotion,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    })
  });
}

function installAnimationFrame() {
  let timestamp = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    return window.setTimeout(() => {
      timestamp += 100;
      callback(timestamp);
    }, 0);
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
}

function renderModal(locale: "en" | "hi" = "en") {
  return render(<WelcomeCreditsModal locale={locale} />);
}

beforeEach(() => {
  vi.useFakeTimers();
  state.pathname = "/en";
  state.reducedMotion = false;
  state.session.status = "authenticated";
  state.session.data = {
    isNewUser: true,
    signupReward: {
      creditsGranted: 10,
      expiresAt: "2026-10-11T08:30:00.000Z"
    },
    user: {
      id: "u1",
      role: "tenant"
    }
  };
  analytics.trackEvent.mockReset();
  installLocalStorage();
  window.localStorage.clear();
  document.body.style.overflow = "";
  installMatchMedia();
  installAnimationFrame();
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.body.style.overflow = "";
  document.body.focus();
});

describe("WelcomeCreditsModal", () => {
  it("renders the backend amount in a number-only token and the localized expiry date", () => {
    renderModal();

    const token = screen.getByTestId("welcome-credit-count");
    expect(token).toHaveTextContent(/^0$/);
    expect(token).not.toHaveTextContent(/free credits/i);

    act(() => {
      vi.runAllTimers();
    });

    expect(token).toHaveTextContent(/^10$/);
    const rewardLabel = screen.getByText("Free credits added");
    expect(rewardLabel).toBeInTheDocument();
    expect(token).not.toContainElement(rewardLabel);
    expect(screen.getByText("Use by 11 October 2026")).toBeInTheDocument();
    expect(analytics.trackEvent).toHaveBeenCalledWith("welcome_credits_shown", {
      credits_granted: 10,
      days_valid: 90,
      experience_version: "reward_reveal_v2"
    });
  });

  it.each([
    ["missing reward", undefined],
    ["zero reward", { creditsGranted: 0, expiresAt: null }]
  ])("does not open for %s", (_label, signupReward) => {
    state.session.data = {
      isNewUser: true,
      signupReward,
      user: { id: "u1", role: "tenant" }
    };

    renderModal();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
    expect(analytics.trackEvent).not.toHaveBeenCalled();
  });

  it("uses the canonical backend amount instead of a frontend signup-credit literal", () => {
    state.session.data = {
      isNewUser: true,
      signupReward: {
        creditsGranted: 17,
        expiresAt: "2027-01-02T23:30:00.000-05:00"
      },
      user: { id: "u1", role: "admin" }
    };

    renderModal();

    act(() => {
      vi.runAllTimers();
    });

    expect(screen.getByTestId("welcome-credit-count")).toHaveTextContent(/^17$/);
    expect(screen.getByText("17 credits added to your wallet")).toBeInTheDocument();
    expect(screen.getByText("Use by 3 January 2027")).toBeInTheDocument();
  });

  it("uses the same role-independent reward copy for owner-side accounts", () => {
    state.session.data = {
      isNewUser: true,
      signupReward: {
        creditsGranted: 10,
        expiresAt: "2026-10-11T08:30:00.000Z"
      },
      user: { id: "u1", role: "owner" }
    };

    renderModal();

    expect(screen.getByRole("heading", { name: "Welcome to Cribliv" })).toBeInTheDocument();
    expect(
      screen.getByText("Your home search starts with a little more freedom.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/tenant leads/i)).not.toBeInTheDocument();
  });

  it("does not invent an expiry date when the canonical reward date is absent", () => {
    state.session.data = {
      isNewUser: true,
      signupReward: {
        creditsGranted: 10,
        expiresAt: null
      },
      user: { id: "u1", role: "tenant" }
    };

    renderModal();

    expect(screen.queryByText(/^Use by /)).not.toBeInTheDocument();
  });

  it("suppresses the reward on auth routes without consuming the local marker", () => {
    state.pathname = "/en/auth/login";

    renderModal();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
  });

  it("renders the final amount immediately when reduced motion is requested", () => {
    state.reducedMotion = true;

    renderModal();

    expect(screen.getByTestId("welcome-credit-count")).toHaveTextContent("10");
  });

  it("focuses the heading, traps Tab between controls, and restores focus after close", () => {
    const prior = document.createElement("button");
    prior.textContent = "Prior focus";
    document.body.appendChild(prior);
    prior.focus();

    renderModal();

    const heading = screen.getByRole("heading", { name: "Welcome to Cribliv" });
    const close = screen.getByRole("button", { name: "Close reward" });
    const cta = screen.getByRole("button", { name: "Start finding homes" });
    expect(heading).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();

    cta.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();

    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(cta).toHaveFocus();

    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(prior).toHaveFocus();
    prior.remove();
  });

  it("dismisses with Escape and reports the escape reason", () => {
    renderModal();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(analytics.trackEvent).toHaveBeenCalledWith("welcome_credits_dismissed", {
      reason: "escape"
    });
  });

  it("dismisses only when the overlay itself is clicked", () => {
    renderModal();

    fireEvent.click(screen.getByRole("heading", { name: "Welcome to Cribliv" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("welcome-reward-overlay"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(analytics.trackEvent).toHaveBeenCalledWith("welcome_credits_dismissed", {
      reason: "overlay"
    });
  });

  it("dismisses from the visible close icon and reports the close reason", () => {
    renderModal();

    const close = screen.getByRole("button", { name: "Close reward" });
    expect(close).toHaveClass("welcome-reward__close");
    expect(close.querySelector("svg")).toBeInTheDocument();
    fireEvent.click(close);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(analytics.trackEvent).toHaveBeenCalledWith("welcome_credits_dismissed", {
      reason: "close"
    });
  });

  it("tracks the CTA separately and closes without a dismissal event", () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Start finding homes" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(analytics.trackEvent).toHaveBeenCalledWith("welcome_credits_cta_clicked", {
      credits_granted: 10,
      experience_version: "reward_reveal_v2"
    });
    expect(analytics.trackEvent).not.toHaveBeenCalledWith(
      "welcome_credits_dismissed",
      expect.anything()
    );
  });

  it("preserves an existing body overflow value and marks storage after mounting", () => {
    document.body.style.overflow = "clip";

    renderModal();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");
    expect(window.localStorage.getItem("cribliv:welcome-credits-shown:u1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close reward" }));
    expect(document.body.style.overflow).toBe("clip");
  });

  it("keeps sparse edge particles and the grid out of the accessibility tree", () => {
    renderModal();

    expect(screen.getByTestId("welcome-reward-grid")).toHaveAttribute("aria-hidden", "true");
    const particles = screen.getByTestId("welcome-reward-particles");
    expect(particles).toHaveAttribute("aria-hidden", "true");

    const pieces = screen.getAllByTestId("welcome-reward-particle");
    expect(pieces.length).toBeLessThanOrEqual(8);
    for (const piece of pieces) {
      expect(piece.className).toMatch(/welcome-reward__particle--edge-/);
    }
  });
});
