import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { SavedIcon } from "../saved-icon";
import { adjustShortlistCount, __resetShortlistCountForTests } from "../../../lib/shortlist-count";
// Namespace import used only to spy on subscribeShortlistCount in the
// unmount test below — everything else in this file drives the real store
// through its named exports.
import * as shortlistCountStore from "../../../lib/shortlist-count";
import { fetchApi } from "../../../lib/api";

// SavedIcon reads the shared store from lib/shortlist-count.ts rather than
// fetching independently (see that module's header comment), and resolves
// its auth token exactly like ListingCardHeart. These tests run against the
// REAL shortlist-count.ts and client-auth.ts — seeded through a real
// localStorage polyfill, same technique as lib/__tests__/shortlist-count.test.ts
// — so "badge updates live" below is a genuine store->component integration
// check, not an echo of a mock. Only next-auth/react (needs a SessionProvider
// we don't want to stand up) and lib/api's fetchApi (the network boundary)
// are mocked.

const state = vi.hoisted(() => ({
  session: {
    status: "unauthenticated" as "authenticated" | "unauthenticated" | "loading",
    data: null as { accessToken?: string } | null
  }
}));

vi.mock("next-auth/react", () => ({
  useSession: () => state.session
}));

vi.mock("../../../lib/api", () => ({
  fetchApi: vi.fn()
}));

// Same in-memory Storage polyfill as welcome-credits-modal.test.tsx and
// lib/__tests__/shortlist-count.test.ts — this repo's jsdom environment
// leaves window.localStorage undefined rather than providing a real Storage.
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

function seedGuestShortlist(count: number) {
  const ids = Array.from({ length: count }, (_, i) => `listing-${i}`);
  window.localStorage.setItem("cribliv:guest-shortlist", JSON.stringify(ids));
}

beforeEach(() => {
  installLocalStorage();
  __resetShortlistCountForTests();
  window.localStorage.clear();
  state.session = { status: "unauthenticated", data: null };
  vi.mocked(fetchApi).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SavedIcon", () => {
  it("renders the shortlist link with no badge while the count is still undetermined", () => {
    // Mirrors real app startup: next-auth's useSession() starts "loading",
    // so the mount effect's ListingCardHeart-style guard must not resolve a
    // token or refresh yet, leaving the shared store's null undetermined.
    state.session = { status: "loading", data: null };

    render(<SavedIcon locale="en" />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/en/shortlist");
    expect(screen.queryByTestId("saved-icon-badge")).not.toBeInTheDocument();
    expect(link).toHaveAccessibleName("Saved");
  });

  it("renders no badge when the determined count is zero", () => {
    seedGuestShortlist(0);

    render(<SavedIcon locale="en" />);

    expect(screen.queryByTestId("saved-icon-badge")).not.toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAccessibleName("Saved");
  });

  it("shows the exact count in the badge", () => {
    seedGuestShortlist(3);

    render(<SavedIcon locale="en" />);

    expect(screen.getByTestId("saved-icon-badge")).toHaveTextContent("3");
  });

  it("shows the count unadorned at the 9 boundary (not 9+)", () => {
    seedGuestShortlist(9);

    render(<SavedIcon locale="en" />);

    expect(screen.getByTestId("saved-icon-badge")).toHaveTextContent("9");
  });

  it("shows 9+ once the count exceeds 9", () => {
    seedGuestShortlist(12);

    render(<SavedIcon locale="en" />);

    expect(screen.getByTestId("saved-icon-badge")).toHaveTextContent("9+");
  });

  it("updates the badge live when adjustShortlistCount fires", () => {
    seedGuestShortlist(2);

    render(<SavedIcon locale="en" />);
    expect(screen.getByTestId("saved-icon-badge")).toHaveTextContent("2");

    // The real optimistic-nudge path ListingCardHeart calls on every save/
    // unsave tap — this is the store->badge half of that path (see brief).
    act(() => {
      adjustShortlistCount(1);
    });

    expect(screen.getByTestId("saved-icon-badge")).toHaveTextContent("3");
  });

  it("includes the count in the aria-label", () => {
    seedGuestShortlist(5);

    render(<SavedIcon locale="en" />);

    expect(screen.getByRole("link")).toHaveAccessibleName("Saved (5)");
  });

  it("keeps the exact count in the aria-label even once the badge clamps to 9+", () => {
    // The "9+" clamp is a visual space-saving device for the small badge —
    // it must not leak into the accessible name, which has no such
    // constraint and should stay maximally informative.
    seedGuestShortlist(12);

    render(<SavedIcon locale="en" />);

    expect(screen.getByRole("link")).toHaveAccessibleName("Saved (12)");
  });

  it("resolves the stored auth token over the NextAuth token and fetches the authenticated count", async () => {
    window.localStorage.setItem(
      "cribliv:auth-session",
      JSON.stringify({ access_token: "acc_test123" })
    );
    // A different NextAuth token is also present, to pin precedence: the
    // stored session must win, exactly like ListingCardHeart's
    // `stored?.access_token ?? nextAuthToken`.
    state.session = { status: "authenticated", data: { accessToken: "wrong-token" } };
    vi.mocked(fetchApi).mockResolvedValueOnce({
      items: [{ id: "a" }, { id: "b" }],
      total: 7
    });

    render(<SavedIcon locale="en" />);

    await screen.findByText("7");
    expect(fetchApi).toHaveBeenCalledWith("/shortlist", {
      headers: { Authorization: "Bearer acc_test123" }
    });
  });

  it("builds the href and localized aria-label for the hi locale", () => {
    seedGuestShortlist(5);

    render(<SavedIcon locale="hi" />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/hi/shortlist");
    expect(link).toHaveAccessibleName("सेव किए (5)");
  });

  it("unsubscribes from the shortlist count store on unmount (no state-update warning)", () => {
    // Two independent checks, because React 18 does not reliably print the
    // classic "state update on an unmounted component" warning any more
    // (empirically confirmed: deleting the effect's cleanup return still
    // left this suite's console silent) — a console.error spy alone would
    // not have caught a broken cleanup. So this pins the actual mechanism
    // (the unsubscribe function the store handed back gets called) as well
    // as the symptom the brief describes.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const originalSubscribe = shortlistCountStore.subscribeShortlistCount;
    const unsubscribeSpy = vi.fn();
    vi.spyOn(shortlistCountStore, "subscribeShortlistCount").mockImplementation((listener) => {
      const realUnsubscribe = originalSubscribe(listener);
      return () => {
        unsubscribeSpy();
        realUnsubscribe();
      };
    });
    seedGuestShortlist(2);

    const { unmount } = render(<SavedIcon locale="en" />);
    expect(screen.getByTestId("saved-icon-badge")).toHaveTextContent("2");
    expect(unsubscribeSpy).not.toHaveBeenCalled();

    unmount();
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);

    // Belt and suspenders: confirm a post-unmount store update is also
    // silent in this component's actual runtime behaviour, not just that
    // the cleanup function was invoked.
    act(() => {
      adjustShortlistCount(5);
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
