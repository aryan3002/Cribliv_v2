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
 * Hovers a trigger. This used to be a raw `page.mouse.move()` workaround,
 * because `locator.hover()` reproducibly made the Rent panel reopen ~120ms
 * (NavMenuBar's OPEN_DELAY_MS) after Escape closed it, and the investigation
 * at the time could not find the mechanism — it was written off as
 * `locator.hover()`'s actionability/retry loop reacting to the panel's open
 * animation.
 *
 * It was not a harness artifact. The cause was a real product bug, found by
 * the final whole-branch review and fixed alongside this revert: Escape left
 * hover fully armed, so any `mouseenter` that arrived afterwards — and
 * `locator.hover()` issues one on every actionability retry — re-ran
 * `hoverOpen` and rescheduled the open. (`locator.hover()` re-hovered where a
 * single `mouse.move()` did not, which is why swapping them "fixed" it and
 * sent the original investigation down the harness path.) NavMenuBar now
 * latches hover off on Escape until the pointer leaves the bar, and the panel
 * no longer shifts the row's geometry when it opens.
 *
 * Kept as a helper purely so the call sites stay uniform.
 */
async function hoverTrigger(_page: Page, trigger: Locator): Promise<void> {
  await trigger.hover();
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

  // Regression for the reopen described on hoverTrigger above. The pointer
  // stays on the bar and twitches one pixel, which is what a resting hand
  // does; before the hover latch that single mouseenter rescheduled the open
  // and the dismissed panel came back ~120ms later.
  test("a panel dismissed with Escape stays closed under a resting pointer", async ({ page }) => {
    await page.goto("/en");
    const rentTrigger = primaryNav(page).getByRole("button", { name: "Rent", exact: true });

    await hoverTrigger(page, rentTrigger);
    await expect(primaryNav(page).getByRole("group")).toBeVisible();

    const box = await rentTrigger.boundingBox();
    if (!box) throw new Error("trigger has no bounding box");
    await page.keyboard.press("Escape");
    await expect(primaryNav(page).getByRole("group")).toHaveCount(0);

    // One-pixel tremor, then well past OPEN_DELAY_MS.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 1);
    await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2 + 1);
    await page.waitForTimeout(400);

    await expect(primaryNav(page).getByRole("group")).toHaveCount(0);
    await expect(rentTrigger).toHaveAttribute("aria-expanded", "false");
  });

  // I-1a: opening a panel must not change the row's geometry. The panel's
  // mount point used to be an ordinary flex item, so it contributed one
  // `.nav-center` gap (4px) purely by existing and slid every trigger 2px.
  test("opening a panel does not move the nav row", async ({ page }) => {
    await page.goto("/en/search?city=lucknow");
    const rentTrigger = primaryNav(page).getByRole("button", { name: "Rent", exact: true });

    const widthOf = () =>
      page.evaluate(() => {
        const el = document.querySelector(".nav-center");
        return el ? Math.round(el.getBoundingClientRect().width * 100) / 100 : null;
      });

    const closedBox = await rentTrigger.boundingBox();
    const closedWidth = await widthOf();

    await hoverTrigger(page, rentTrigger);
    await expect(primaryNav(page).getByRole("group")).toBeVisible();

    expect(await widthOf()).toBe(closedWidth);
    expect((await rentTrigger.boundingBox())?.x).toBe(closedBox?.x);
  });

  // I-2: Tab from an expanded trigger lands inside that trigger's own panel.
  // The panel used to render after all five triggers, so Tab went to the next
  // trigger (reporting aria-expanded="false") and took five presses to reach
  // the first panel link.
  test("Tab from an expanded trigger moves into its own panel", async ({ page }) => {
    await page.goto("/en");
    const rentTrigger = primaryNav(page).getByRole("button", { name: "Rent", exact: true });

    await hoverTrigger(page, rentTrigger);
    await expect(primaryNav(page).getByRole("group")).toBeVisible();

    await rentTrigger.focus();
    await page.keyboard.press("Tab");

    expect(await page.evaluate(() => !!document.activeElement?.closest(".nav-panel"))).toBe(true);
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

    // This panel's role="group" node used to have a 0x0 layout box: the
    // NavMenuBar `renderPanel` escape hatch (nav-menu-bar.tsx) put
    // id/role="group"/aria-labelledby on a plain wrapper <div> with no class
    // (position: static), while the actual positioned box was a *child* —
    // TimesPanel's own root, `.nav-panel.nav-panel--times` (globals.css),
    // `position: absolute`. An absolutely positioned child contributes
    // nothing to a static parent's auto layout size, so the wrapper
    // collapsed even though its content painted correctly on screen
    // (confirmed live: wrapper rect 0x0, `.nav-panel--times` rect 1280x208 —
    // see the S3 Task 4 gate report). Fixed by moving id/role/aria-labelledby
    // onto TimesPanel's own root instead (times-panel.tsx / nav-menu-bar.tsx),
    // matching NavPanelView's pattern below (used by Rent/PG), where the
    // ARIA-labelled node already IS the positioned `.nav-panel` node.
    //
    // `toBeVisible()` here — the same assertion the Rent/PG tests above use
    // on their own panel container — is itself the regression pin: before
    // the fix this was a real, reproducible failure (Playwright reported the
    // group "hidden" because of its 0x0 box), not a false negative. The
    // explicit width/height check below pins the actual geometry jsdom can
    // never compute (nav-menu-bar.test.tsx / times-panel.test.tsx cover the
    // DOM-structural side of this fix).
    const panel = primaryNav(page).getByRole("group");
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box?.width, "the group's own box should no longer be 0x0").toBeGreaterThan(0);
    expect(box?.height, "the group's own box should no longer be 0x0").toBeGreaterThan(0);

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
