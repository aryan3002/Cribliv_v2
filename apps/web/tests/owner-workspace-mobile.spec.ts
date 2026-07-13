import { expect, test, type Locator, type Page } from "@playwright/test";
import { loginAsRole, setSessionOnPage } from "./utils/auth";

const OWNER_MOBILE_VIEWPORT = { width: 390, height: 844 };

test.use({ viewport: OWNER_MOBILE_VIEWPORT });

async function signInAsOwner(page: Page, request: Parameters<typeof loginAsRole>[0]) {
  const session = await loginAsRole(request, "owner");
  await setSessionOnPage(page, session);
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));

  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function expectCurrentlyWithinViewport(page: Page, locator: Locator, description: string) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box, `${description} should have a layout box`).not.toBeNull();
  expect(viewport, "viewport should be configured").not.toBeNull();
  expect(box!.y, `${description} should start in the first viewport`).toBeGreaterThanOrEqual(0);
  expect(
    box!.y + box!.height,
    `${description} should fit in the first viewport`
  ).toBeLessThanOrEqual(viewport!.height);
}

async function expectReachableAboveMobileNav(page: Page, locator: Locator, description: string) {
  await expect(locator).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await locator.scrollIntoViewIfNeeded();

  const result = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const nav = document.querySelector(".ows__mobile-nav");
    const navTop = nav?.getBoundingClientRect().top ?? window.innerHeight;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const topElement = document.elementFromPoint(centerX, centerY);

    return {
      bottom: rect.bottom,
      navTop,
      hitTargetReachable: topElement === element || element.contains(topElement)
    };
  });

  expect(result.bottom, `${description} should not sit below the fixed mobile nav`).toBeLessThan(
    result.navTop
  );
  expect(result.hitTargetReachable, `${description} should receive pointer events`).toBe(true);
}

async function expectHitTargetReachable(locator: Locator, description: string) {
  await expect(locator).toBeVisible();
  const reachable = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const topElement = document.elementFromPoint(centerX, centerY);

    return topElement === element || element.contains(topElement);
  });

  expect(reachable, `${description} should receive pointer events`).toBe(true);
}

async function expectListingGridClampsMinContent(page: Page) {
  const result = await page.evaluate(() => {
    const grid = document.querySelector(".dlx-grid--listings") as HTMLElement | null;
    if (!grid) return null;

    const containerWidth = grid.getBoundingClientRect().width;
    const probe = document.createElement("div");
    probe.style.whiteSpace = "nowrap";
    probe.textContent = "X".repeat(180);
    grid.appendChild(probe);
    grid.getBoundingClientRect();
    const firstTrack = parseFloat(getComputedStyle(grid).gridTemplateColumns.split(" ")[0]);
    probe.remove();

    return { containerWidth, firstTrack };
  });

  expect(result, "owner listings grid should render").not.toBeNull();
  expect(result!.firstTrack).toBeLessThanOrEqual(result!.containerWidth + 2);
}

function captureRuntimeErrors(page: Page) {
  const errors: string[] = [];

  page.on("pageerror", (error) => {
    errors.push(error.stack ?? error.message);
  });

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/failed to load resource/i.test(text)) return;
    if (/va\.vercel-scripts\.com\/v1\/script\.debug\.js/i.test(text)) return;
    errors.push(text);
  });

  return errors;
}

test.describe("Owner workspace mobile browser coverage", () => {
  test.beforeEach(async ({ page, request }) => {
    await signInAsOwner(page, request);
  });

  test("owner workspace navigation reaches every owner destination", async ({ page }) => {
    const destinations = [
      {
        label: "Overview",
        path: "/en/owner/dashboard",
        assertReady: async () =>
          expect(
            page.getByRole("heading", { name: /good (morning|afternoon|evening)/i })
          ).toBeVisible()
      },
      {
        label: "Listings",
        path: "/en/owner/listings",
        assertReady: async () =>
          expect(page.getByRole("heading", { name: /manage listings/i })).toBeVisible()
      },
      {
        label: "Add",
        path: "/en/owner/listings/new",
        assertReady: async () =>
          expect(page.getByRole("heading", { name: /create your listing/i })).toBeVisible()
      },
      {
        label: "Leads",
        path: "/en/owner/leads",
        assertReady: async () =>
          expect(page.getByRole("heading", { name: /your leads/i })).toBeVisible()
      },
      {
        label: "Verify",
        path: "/en/owner/verification",
        assertReady: async () =>
          expect(page.getByRole("heading", { name: /owner verification/i })).toBeVisible()
      }
    ];

    for (const destination of destinations) {
      await page.goto("/en/owner/dashboard");
      const mobileNav = page.getByRole("navigation", { name: /owner mobile navigation/i });
      await expect(mobileNav).toBeVisible();

      await mobileNav.getByRole("link", { name: new RegExp(destination.label, "i") }).click();
      await expect(page).toHaveURL(new RegExp(`${destination.path.replaceAll("/", "\\/")}$`));
      await destination.assertReady();
      await expectNoHorizontalOverflow(page);

      if (destination.path !== "/en/owner/listings/new") {
        await expect(
          page
            .getByRole("navigation", { name: /owner mobile navigation/i })
            .locator('[aria-current="page"]')
        ).toContainText(destination.label);
      }
    }
  });

  test("dashboard primary metrics and add action fit in the first viewport", async ({ page }) => {
    await page.goto("/en/owner/dashboard");

    await expect(page.getByTestId("overview-metric-active")).toBeVisible();
    await expect(page.getByTestId("overview-metric-leads-7d")).toBeVisible();

    await expectCurrentlyWithinViewport(
      page,
      page.getByRole("link", { name: /create listing/i }).first(),
      "dashboard add-listing action"
    );
    await expectCurrentlyWithinViewport(
      page,
      page.getByTestId("overview-metric-active"),
      "active-listings metric"
    );
    await expectCurrentlyWithinViewport(
      page,
      page.getByTestId("overview-metric-leads-7d"),
      "new-leads metric"
    );
    await expectNoHorizontalOverflow(page);
  });

  test("listings have no horizontal overflow and expose mobile actions", async ({ page }) => {
    await page.goto("/en/owner/listings");

    await expect(page.getByRole("heading", { name: /manage listings/i })).toBeVisible();
    await expect(page.locator(".lcl").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectListingGridClampsMinContent(page);

    const actionableCard = page.locator(".lcl", { hasText: "Premium PG in Noida Sector 62" });
    await expect(actionableCard).toBeVisible();
    await actionableCard.getByRole("button", { name: /more actions/i }).click();

    const sheet = page.getByRole("dialog", { name: /listing actions/i });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("link", { name: /edit/i })).toBeVisible();
    await expect(sheet.getByRole("link", { name: /verify listing/i })).toBeVisible();
    await expectHitTargetReachable(sheet, "listing actions sheet");
  });

  test("leads load without a runtime error and do not render a Kanban board", async ({ page }) => {
    const runtimeErrors = captureRuntimeErrors(page);

    await page.goto("/en/owner/leads");

    await expect(page.getByRole("heading", { name: /your leads/i })).toBeVisible();
    await expect(page.getByLabel(/mobile lead controls/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: /no leads yet/i })).toBeVisible();
    await expect(page.locator(".lk-board")).toHaveCount(0);
    await expect(page.locator("[data-rbd-droppable-id], [data-rbd-draggable-id]")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    expect(runtimeErrors).toEqual([]);
  });

  test("verification uses real file controls and keeps the submit action reachable", async ({
    page
  }) => {
    await page.goto("/en/owner/verification");

    await expect(page.getByRole("heading", { name: /owner verification/i })).toBeVisible();
    await expect(page.getByLabel(/^listing$/i)).not.toHaveValue("");

    const fileInput = page.locator('input[type="file"][accept*="video/mp4"]').first();
    await expect(fileInput).toHaveCount(1);
    await expect(page.getByText(/no file selected/i)).toBeVisible();

    await fileInput.setInputFiles({
      name: "owner-mobile-proof.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.concat([
        Buffer.from([0x00, 0x00, 0x00, 0x14]),
        Buffer.from("ftypisom"),
        Buffer.from([0x00])
      ])
    });

    await expect(page.getByText("owner-mobile-proof.mp4")).toBeVisible();
    await expect(page.getByText(/^ready$/i)).toBeVisible();

    const submitVideo = page.getByRole("button", { name: /submit video verification/i });
    await expect(submitVideo).toBeEnabled();
    await expectReachableAboveMobileNav(page, submitVideo, "video verification submit action");
    await expectNoHorizontalOverflow(page);
  });

  test("listing wizard hides owner bottom navigation", async ({ page }) => {
    await page.goto("/en/owner/listings/new");

    await expect(page.getByRole("heading", { name: /create your listing/i })).toBeVisible();
    await expect(page.getByTestId("owner-workspace-shell")).toHaveAttribute(
      "data-focus-flow",
      "true"
    );
    await expect(page.getByRole("navigation", { name: /owner mobile navigation/i })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });
});
