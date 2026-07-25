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
import { buildPgPanel, buildRentPanel, buildTimesPanel } from "../../lib/nav/nav-model";
import type { NavLink, NavPanel } from "../../lib/nav/types";
import { t } from "../../lib/i18n";
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
// Times has no city — buildTimesPanel(locale) only, see nav-model.ts.
const TIMES_PANEL = buildTimesPanel("en");

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

/** Every link in a named column — same "fail loud if the model drifts" spirit as requiredLink. */
function requiredColumnLinks(panel: NavPanel, columnTitle: string): NavLink[] {
  const links = panel.columns.find((c) => c.title === columnTitle)?.links ?? [];
  if (links.length === 0) {
    throw new Error(
      `nav-model.ts no longer has a non-empty "${columnTitle}" column in the "${panel.id}" panel — ` +
        "update this spec to match the real data."
    );
  }
  return links;
}

// Real Rent link (Property type column) — also nav-model.test.ts's own pinned
// example: /en/search with city=lucknow and bhk=2 (param order not asserted,
// only presence — surfaceHref doesn't promise an order).
const TWO_BHK = requiredLink(RENT_PANEL, "Property type", "2 BHK flats");
// Real PG-only link — proves the panel that swapped in is actually PG's, not
// just "a" panel.
const SINGLE_SHARING = requiredLink(PG_PANEL, "By sharing", "Single sharing");
// The four blog_categories desks (lib/blog-desks.ts) — pulled live rather than
// hard-copied so a fifth desk (or a renamed one) can't silently go untested.
const TIMES_DESKS = requiredColumnLinks(TIMES_PANEL, "Desks");
// Same aria-label the rail itself renders (intent-chip-rail.tsx), pulled from
// the real i18n dictionary rather than hand-copied.
const CHIP_RAIL_LABEL = t("en", "navIntentRailLabel");

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

  test("hovering Cribliv Times opens a panel with the four desks", async ({ page }) => {
    await page.goto("/en");
    const timesTrigger = primaryNav(page).getByRole("button", { name: "Cribliv Times" });

    await hoverTrigger(page, timesTrigger);

    await expect(timesTrigger).toHaveAttribute("aria-expanded", "true");

    // Deliberately not `expect(panel).toBeVisible()` the way the Rent/PG
    // tests above check their panel container — scoping into it (a locator
    // never itself has to be visible) is fine, but asserting ITS visibility
    // is not, for a real, confirmed CSS reason:
    //
    // Times' panel body comes from NavMenuBar's `renderPanel` escape hatch
    // (nav-menu-bar.tsx), which puts role="group"/id/aria-labelledby on a
    // plain wrapper <div> with no class and therefore `position: static`.
    // Its only child is TimesPanel's own root, `.nav-panel.nav-panel--times`
    // (globals.css), which is `position: absolute`. An absolutely positioned
    // child contributes nothing to a static parent's layout box, so that
    // wrapper's own bounding box is 0x0 even though its content — the thing
    // a real visitor sees — is fully painted on screen. Confirmed with a
    // live getBoundingClientRect()/getComputedStyle() dump (S3 Task 4
    // report): wrapper `position: static`, rect 0x0; `.nav-panel--times`
    // `position: absolute`, rect 1280x208. Contrast NavPanelView's branch
    // (used by every other panel here): its own root IS the positioned,
    // correctly sized `.nav-panel` box, so `panel.toBeVisible()` is
    // meaningful for Rent/PG but would be a false negative here — it would
    // fail for a layout reason unrelated to whether the four desks render.
    // jsdom-based unit tests (nav-menu-bar.test.tsx, times-panel.test.tsx)
    // never compute real layout, so this never surfaced there — a real
    // browser is the only thing that can catch it, which is this file's
    // whole reason to exist. Reported, not fixed, as part of the slice gate;
    // not "papering over" it — the four-desks requirement below is checked
    // the honest way instead, against the content itself.
    const panel = primaryNav(page).getByRole("group");
    await expect(panel).toBeAttached();

    for (const desk of TIMES_DESKS) {
      const link = panel.getByRole("link", { name: desk.label, exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", desk.href);
    }
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

test.describe("top nav — intent chip rail (mobile)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("is visible on /search and scrolls horizontally", async ({ page }) => {
    await page.goto("/en/search");

    // components/header/intent-chip-rail.tsx: a plain server-rendered <nav>,
    // CSS-hidden at >= 900px (globals.css .intent-rail) and the only way a
    // phone-width visitor reaches Rent's intent links, since the desktop
    // mega-menu panels never mount below that breakpoint (header.tsx's
    // useDesktopNav) — same reason the hamburger sheet exists above.
    const rail = page.getByRole("navigation", { name: CHIP_RAIL_LABEL });
    await expect(rail).toBeVisible();

    // "Scrolls horizontally" has two parts: there must be more content than
    // fits (otherwise there is nothing to scroll), and a scroll gesture must
    // actually move it.
    const { scrollWidth, clientWidth } = await rail.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth
    }));
    expect(
      scrollWidth,
      "the rail's chips should overflow its own width at 375px — otherwise there is nothing to scroll"
    ).toBeGreaterThan(clientWidth);

    await rail.hover();
    await page.mouse.wheel(400, 0);

    await expect
      .poll(() => rail.evaluate((el) => el.scrollLeft), {
        message: "scrollLeft should advance after a horizontal wheel scroll over the rail"
      })
      .toBeGreaterThan(0);
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
