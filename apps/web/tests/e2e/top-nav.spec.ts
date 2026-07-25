// apps/web/tests/e2e/top-nav.spec.ts
//
// End-to-end gate for the rebuilt top nav (Task 11, final task of the slice):
// server-built panel data (lib/nav/nav-model.ts), the desktop hover mega-menu
// (NavMenuBar/NavPanelView), the mobile hamburger accordion
// (MobileNavSections) and the Saved heart badge (SavedIcon). Every piece
// already has unit/component coverage — see apps/web/lib/nav/__tests__/ and
// apps/web/components/header/__tests__/ — this file's only job is to prove
// the assembled thing survives in a real browser.
//
// Real link labels/hrefs are pulled from lib/nav/nav-model.ts itself rather
// than hand-copied, so this spec can never silently drift from the panels it
// is testing. Value-importing the model is fine HERE — a test file never
// ships to a browser bundle (see nav-menu-bar.test.tsx's identical note on
// this, and header.composition.test.tsx / mobile-nav-sections.test.tsx doing
// the same thing).
//
// Desktop panels only mount at >= 900px (Header's DESKTOP_MEDIA_QUERY), so
// the desktop block below pins the viewport at 1280x800; the mobile block
// pins 375x812, where NavMenuBar's panels never mount at all and
// MobileNavSections inside the hamburger sheet is the only way to reach
// these links.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { buildPgPanel, buildRentPanel } from "../../lib/nav/nav-model";
import type { NavLink, NavPanel } from "../../lib/nav/types";
import { loginAsRole, setSessionOnPage } from "../utils/auth";

function apiBaseUrl() {
  const raw = process.env.E2E_API_BASE_URL || "http://localhost:4000/v1";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

// nav-model defaults every locale route to city=lucknow (lib/nav/nav-data.ts's
// DEFAULT_NAV_CITY) — matching that here is what makes these the exact links
// the real header renders on "/en".
const RENT_PANEL = buildRentPanel("en", "lucknow");
const PG_PANEL = buildPgPanel("en", "lucknow");

function requiredLink(panel: NavPanel, columnTitle: string, label: string): NavLink {
  const link = panel.columns
    .find((c) => c.title === columnTitle)
    ?.links.find((l) => l.label === label);
  if (!link) {
    throw new Error(
      `nav-model.ts no longer has "${label}" under "${columnTitle}" in the "${panel.id}" panel — ` +
        "update this spec to match the real data."
    );
  }
  return link;
}

// Real Rent link (Property type column) — also nav-model.test.ts's own pinned
// example: /en/search with city=lucknow and bhk=2 (param order not asserted,
// only presence — surfaceHref doesn't promise an order).
const TWO_BHK = requiredLink(RENT_PANEL, "Property type", "2 BHK flats");
// Real PG-only link — proves the panel that swapped in is actually PG's, not
// just "a" panel.
const SINGLE_SHARING = requiredLink(PG_PANEL, "By sharing", "Single sharing");

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });

/**
 * Hovers a trigger via a single raw `mouse.move` rather than
 * `locator.hover()`.
 *
 * Investigated finding: `locator.hover()` on these triggers is genuinely
 * flaky here — reproducibly (10+ manual repro runs), the Rent panel closes
 * correctly on Escape and then silently reopens ~110-120ms later
 * (NavMenuBar's OPEN_DELAY_MS). Monkey-patching `window.setTimeout` proved a
 * fresh 120ms timer gets scheduled from NavMenuBar's own `onMouseEnter`
 * handler shortly around Escape-time, i.e. `hoverOpen` genuinely runs again —
 * but capture-phase listeners for every mouse/pointer enter/leave/over/out
 * event, on both the trigger and `document`, recorded NOTHING in that
 * window, so the exact browser mechanism re-invoking it is unconfirmed (not
 * a focus()-driven re-hover: disabling NavMenuBar's `close()` focus() call
 * didn't stop it; not early-page-load/font-swap timing: waiting 2s +
 * `document.fonts.ready` before interacting didn't stop it either).
 * What IS confirmed: swapping `locator.hover()` for one `page.mouse.move()`
 * to the same coordinates made the reopen stop, cleanly, every time (10+
 * repro runs incl. the click-to-open path). That isolates it to
 * `locator.hover()`'s own actionability/retry machinery reacting to the
 * panel's open CSS animation (nav-panel-in) — a real user's mouse doesn't
 * behave like a scripted retry loop, so this reads as a test-methodology
 * artifact rather than a reachable product bug. See the Task 11 report for
 * the full investigation log.
 */
async function hoverTrigger(page: Page, trigger: Locator): Promise<void> {
  const box = await trigger.boundingBox();
  if (!box) throw new Error("trigger has no bounding box to hover");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe("top nav — desktop mega-menu", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("hovering Rent opens a panel with its real links", async ({ page }) => {
    await page.goto("/en");
    const rentTrigger = primaryNav(page).getByRole("button", { name: "Rent", exact: true });

    await hoverTrigger(page, rentTrigger);

    // Scoped to the Primary nav landmark, not a bare page-wide role query:
    // the homepage hero also has its own unrelated `role="group"` (the
    // Homes/PG "Search type" toggle), so an unscoped query is ambiguous
    // (Playwright strict-mode violation) as soon as that hero control mounts.
    const panel = primaryNav(page).getByRole("group");
    await expect(panel).toBeVisible();
    await expect(rentTrigger).toHaveAttribute("aria-expanded", "true");
    await expect(panel.getByRole("link", { name: TWO_BHK.label, exact: true })).toHaveAttribute(
      "href",
      TWO_BHK.href
    );
  });

  test("moving to PG swaps the open panel", async ({ page }) => {
    await page.goto("/en");
    const rentTrigger = primaryNav(page).getByRole("button", { name: "Rent", exact: true });
    const pgTrigger = primaryNav(page).getByRole("button", { name: "PG & Co-living", exact: true });
    const panel = primaryNav(page).getByRole("group");

    await hoverTrigger(page, rentTrigger);
    await expect(panel.getByRole("link", { name: TWO_BHK.label, exact: true })).toBeVisible();

    await hoverTrigger(page, pgTrigger);

    await expect(pgTrigger).toHaveAttribute("aria-expanded", "true");
    await expect(rentTrigger).toHaveAttribute("aria-expanded", "false");
    await expect(
      panel.getByRole("link", { name: SINGLE_SHARING.label, exact: true })
    ).toBeVisible();
    await expect(panel.getByRole("link", { name: TWO_BHK.label, exact: true })).toHaveCount(0);
  });

  test("Escape closes the open panel", async ({ page }) => {
    await page.goto("/en");
    const rentTrigger = primaryNav(page).getByRole("button", { name: "Rent", exact: true });

    await hoverTrigger(page, rentTrigger);
    await expect(primaryNav(page).getByRole("group")).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(primaryNav(page).getByRole("group")).toHaveCount(0);
    await expect(rentTrigger).toHaveAttribute("aria-expanded", "false");
  });

  test("a panel link navigates to a URL carrying its real filter params", async ({ page }) => {
    await page.goto("/en");
    const rentTrigger = primaryNav(page).getByRole("button", { name: "Rent", exact: true });

    await hoverTrigger(page, rentTrigger);
    await primaryNav(page)
      .getByRole("group")
      .getByRole("link", { name: TWO_BHK.label, exact: true })
      .click();

    await expect(page).toHaveURL(/\/en\/search\?/);
    // Belt-and-suspenders on the actual product requirement (the real
    // filters survive onto the URL), independent of param order.
    expect(page.url()).toContain("city=lucknow");
    expect(page.url()).toContain("bhk=2");
  });
});

test.describe("top nav — mobile hamburger sheet", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("exposes the same real Rent links as the desktop panel", async ({ page }) => {
    await page.goto("/en");

    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();

    await menu.getByRole("button", { name: "Rent", exact: true }).click();

    await expect(menu.getByRole("link", { name: TWO_BHK.label, exact: true })).toHaveAttribute(
      "href",
      TWO_BHK.href
    );
  });
});

interface SeedListingSummary {
  id: string;
  title: string;
}

interface ListingsSearchResponse {
  data: { items: SeedListingSummary[]; total: number };
}

test.describe("top nav — Saved badge", () => {
  test("appears after hearting a listing", async ({ page, request }) => {
    const tenant = await loginAsRole(request, "tenant");

    // Discover the seeded flat_house listing's id (a fresh randomUUID() every
    // server boot — see AppStateService's constructor) and reset this
    // tenant's shortlist state for it first, so the test starts from a known
    // "not yet saved" baseline even when re-run locally against an
    // already-running (reuseExistingServer) in-memory API — same idempotency
    // spirit as unavailable-listing.spec.ts's availability-switch reset.
    const searchRes = await request.get(`${apiBaseUrl()}/listings/search?listing_type=flat_house`);
    expect(searchRes.ok()).toBeTruthy();
    const searchJson = (await searchRes.json()) as ListingsSearchResponse;
    const seedListing = searchJson.data.items.find((item) => item.title === "2BHK near Cyber City");
    expect(
      seedListing,
      "seed listing '2BHK near Cyber City' not found — has app-state.service.ts's seed data changed?"
    ).toBeTruthy();

    await request.delete(`${apiBaseUrl()}/shortlist/${seedListing!.id}`, {
      headers: { Authorization: `Bearer ${tenant.access_token}` }
    });

    await setSessionOnPage(page, tenant);
    await page.goto("/en/search");

    const card = page.locator("article", { hasText: "2BHK near Cyber City" });
    await expect(card).toBeVisible();
    await expect(page.getByTestId("saved-icon-badge")).toHaveCount(0);

    await card.getByRole("button", { name: "Save", exact: true }).click();

    const badge = page.getByTestId("saved-icon-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText("1");
  });
});
