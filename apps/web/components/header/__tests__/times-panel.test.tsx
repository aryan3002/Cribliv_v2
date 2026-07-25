import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NavPanel } from "../../../lib/nav/types";

vi.mock("../../../lib/nav/times-posts", () => ({
  loadTimesPosts: vi.fn()
}));
import { loadTimesPosts } from "../../../lib/nav/times-posts";
import { TimesPanel } from "../times-panel";

const asMock = loadTimesPosts as unknown as ReturnType<typeof vi.fn>;

const DESKS_PANEL: NavPanel = {
  id: "times",
  columns: [
    {
      title: "Desks",
      links: [
        { label: "Data Reports", href: "/en/blog/category/data-reports" },
        { label: "Local Guides", href: "/en/blog/category/local-guides" },
        { label: "Tenancy", href: "/en/blog/category/tenancy" },
        { label: "Market Updates", href: "/en/blog/category/market-updates" }
      ]
    }
  ]
};

const HI_DESKS_PANEL: NavPanel = {
  id: "times",
  columns: [
    {
      title: "डेस्क",
      links: [{ label: "डेटा रिपोर्ट", href: "/hi/blog/category/data-reports" }]
    }
  ]
};

const POSTS = [
  { slug: "rent-report-2026", title: "Lucknow Rent Report 2026", category: "data-reports" },
  { slug: "gomti-nagar-guide", title: "Gomti Nagar Locality Guide", category: null }
];

/** Never settles — for assertions that must hold before the request resolves. */
function pendingForever() {
  return new Promise(() => {});
}

describe("TimesPanel", () => {
  // Braces are load-bearing — see times-posts.test.ts / the /api/nav/times
  // route test for why a concise arrow here would turn mockReset()'s return
  // value into a teardown callback that re-invokes the mock.
  beforeEach(() => {
    asMock.mockReset();
  });

  it("renders the desks immediately, without waiting on the posts request", () => {
    asMock.mockReturnValue(pendingForever());
    render(<TimesPanel locale="en" panel={DESKS_PANEL} onNavigate={() => {}} />);

    for (const link of DESKS_PANEL.columns[0]!.links) {
      expect(screen.getByRole("link", { name: link.label })).toHaveAttribute("href", link.href);
    }
  });

  it("fetches on mount — the panel only mounts on hover, so mounting is the trigger", () => {
    asMock.mockReturnValue(pendingForever());
    render(<TimesPanel locale="en" panel={DESKS_PANEL} onNavigate={() => {}} />);

    expect(asMock).toHaveBeenCalledTimes(1);
  });

  it('renders no "Latest" column before the posts request resolves', () => {
    asMock.mockReturnValue(pendingForever());
    render(<TimesPanel locale="en" panel={DESKS_PANEL} onNavigate={() => {}} />);

    expect(screen.queryByText("Latest")).not.toBeInTheDocument();
  });

  it("renders the posts once the request resolves, each linking to /{locale}/blog/{slug}", async () => {
    asMock.mockResolvedValue(POSTS);
    render(<TimesPanel locale="en" panel={DESKS_PANEL} onNavigate={() => {}} />);

    expect(await screen.findByText("Latest")).toBeInTheDocument();
    for (const post of POSTS) {
      expect(screen.getByRole("link", { name: post.title })).toHaveAttribute(
        "href",
        `/en/blog/${post.slug}`
      );
    }
  });

  it("stays desks-only when the posts request resolves empty", async () => {
    asMock.mockResolvedValue([]);
    render(<TimesPanel locale="en" panel={DESKS_PANEL} onNavigate={() => {}} />);

    // No positive UI change to `findBy*` here — desks-only is also the
    // pre-resolution state — so flush the resolved (empty) promise through
    // the effect's state update explicitly before asserting on its absence.
    await act(async () => {
      await asMock.mock.results[0]!.value;
    });

    expect(screen.queryByText("Latest")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Data Reports" })).toBeInTheDocument();
  });

  it("uses the Hindi desk labels the panel prop was built with, for hi", () => {
    asMock.mockReturnValue(pendingForever());
    render(<TimesPanel locale="hi" panel={HI_DESKS_PANEL} onNavigate={() => {}} />);

    expect(screen.getByRole("link", { name: "डेटा रिपोर्ट" })).toBeInTheDocument();
    expect(screen.getByText("डेस्क")).toBeInTheDocument();
  });

  it('shows the "Latest" heading translated for hi', async () => {
    asMock.mockResolvedValue(POSTS);
    render(<TimesPanel locale="hi" panel={HI_DESKS_PANEL} onNavigate={() => {}} />);

    expect(await screen.findByText("नवीनतम")).toBeInTheDocument();
  });

  it("calls onNavigate when a desk link is clicked", async () => {
    const onNavigate = vi.fn();
    asMock.mockReturnValue(pendingForever());
    render(<TimesPanel locale="en" panel={DESKS_PANEL} onNavigate={onNavigate} />);

    await userEvent.click(screen.getAllByRole("link")[0]!);
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("calls onNavigate when a post link is clicked", async () => {
    const onNavigate = vi.fn();
    asMock.mockResolvedValue(POSTS);
    render(<TimesPanel locale="en" panel={DESKS_PANEL} onNavigate={onNavigate} />);

    const postLink = await screen.findByRole("link", { name: POSTS[0]!.title });
    await userEvent.click(postLink);
    expect(onNavigate).toHaveBeenCalledOnce();
  });
});
