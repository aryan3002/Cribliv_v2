import { expect, test, type Locator, type Page } from "@playwright/test";
import { loginAsRole, loginWithOtp, setSessionOnPage } from "./utils/auth";

const OWNER_MOBILE_VIEWPORT = { width: 390, height: 844 };
const OWNER_DESKTOP_VIEWPORT = { width: 1440, height: 1000 };

test.use({ viewport: OWNER_MOBILE_VIEWPORT });

async function signInAsOwner(page: Page, request: Parameters<typeof loginAsRole>[0]) {
  const session = await loginAsRole(request, "owner");
  await setSessionOnPage(page, session);
  return session;
}

function getApiBaseUrl() {
  const raw = process.env.E2E_API_BASE_URL || "http://localhost:4000/v1";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
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

async function expectTextEntryControlsAtLeast16px(page: Page) {
  const offenders = await page.evaluate(() => {
    const textEntrySelector = [
      'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="color"])',
      "select",
      "textarea",
      '[contenteditable="true"]'
    ].join(",");

    return Array.from(document.querySelectorAll<HTMLElement>(textEntrySelector))
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      })
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id,
        name: element.getAttribute("name"),
        ariaLabel: element.getAttribute("aria-label"),
        placeholder: element.getAttribute("placeholder"),
        fontSize: Number.parseFloat(window.getComputedStyle(element).fontSize)
      }))
      .filter((entry) => entry.fontSize < 16);
  });

  expect(offenders).toEqual([]);
}

async function expectOwnerBottomNavLabelsInsideBounds(page: Page) {
  const failures = await page
    .getByRole("navigation", { name: /owner mobile navigation|मालिक मोबाइल नेविगेशन/i })
    .locator("a")
    .evaluateAll((links) =>
      links
        .map((link) => {
          const label = link.querySelector("span");
          if (!label) return null;
          const linkRect = link.getBoundingClientRect();
          const labelRect = label.getBoundingClientRect();
          return {
            text: label.textContent?.trim() ?? "",
            clipped:
              labelRect.left < linkRect.left - 1 ||
              labelRect.right > linkRect.right + 1 ||
              labelRect.top < linkRect.top - 1 ||
              labelRect.bottom > linkRect.bottom + 1 ||
              label.scrollWidth > label.clientWidth + 1
          };
        })
        .filter((entry): entry is { text: string; clipped: boolean } => Boolean(entry?.clipped))
    );

  expect(failures).toEqual([]);
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

type OwnerSession = Awaited<ReturnType<typeof loginAsRole>>;
type LeadApiRow = {
  id: string;
  listing_id: string;
  listing_title: string;
  tenant_name: string;
  tenant_phone_masked: string | null;
  status: "new" | "contacted" | "visit_scheduled" | "deal_done" | "lost";
};

async function createOwnerLeadViaContactUnlock(
  request: Parameters<typeof loginAsRole>[0],
  ownerSession: OwnerSession,
  suffix: string
): Promise<LeadApiRow> {
  const apiBaseUrl = getApiBaseUrl();
  const ownerHeaders = { Authorization: `Bearer ${ownerSession.access_token}` };

  const listingsResponse = await request.get(`${apiBaseUrl}/owner/listings`, {
    headers: ownerHeaders
  });
  expect(listingsResponse.ok()).toBeTruthy();
  const listingsJson = await listingsResponse.json();
  const listing = (listingsJson?.data?.items as Array<{ id: string; title?: string }>).find(
    (item) => item.title === "2BHK near Cyber City"
  );
  expect(listing?.id, "owner should have a seeded active listing for lead setup").toBeTruthy();

  const tenantPhone = `+9188${suffix.padStart(8, "0").slice(-8)}`;
  const tenantSession = await loginWithOtp(request, tenantPhone);
  const tenantHeaders = { Authorization: `Bearer ${tenantSession.access_token}` };
  const tenantName = `Mobile Lead Tenant ${suffix.slice(-4)}`;

  const profileResponse = await request.patch(`${apiBaseUrl}/users/me`, {
    headers: tenantHeaders,
    data: { full_name: tenantName }
  });
  expect(profileResponse.ok()).toBeTruthy();

  const unlockResponse = await request.post(`${apiBaseUrl}/tenant/contact-unlocks`, {
    headers: {
      ...tenantHeaders,
      "Idempotency-Key": `owner-mobile-lead-${suffix}`
    },
    data: { listing_id: listing!.id, source: "owner_mobile_e2e" }
  });
  expect(unlockResponse.ok()).toBeTruthy();

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const leadsResponse = await request.get(`${apiBaseUrl}/owner/leads?page_size=200`, {
      headers: ownerHeaders
    });
    expect(leadsResponse.ok()).toBeTruthy();
    const leadsJson = await leadsResponse.json();
    const lead = (leadsJson?.data?.items as LeadApiRow[]).find(
      (item) => item.listing_id === listing!.id && item.tenant_name === tenantName
    );
    if (lead) return lead;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error("Timed out waiting for owner lead created by authenticated contact unlock");
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
      await expect(page.locator("footer.footer")).toHaveCount(0);

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
    await expect(page.locator("[data-rfd-droppable-id], [data-rfd-draggable-id]")).toHaveCount(0);
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

  test("Hindi owner verification and leads keep mobile inputs and nav labels in bounds", async ({
    page
  }) => {
    await page.goto("/hi/owner/verification");

    await expect(page.getByRole("heading", { name: "ओनर वेरिफिकेशन" })).toBeVisible();
    await expect(page.getByLabel("लिस्टिंग")).toBeVisible();
    await expect(page.getByRole("heading", { name: "वीडियो वेरिफिकेशन" })).toBeVisible();
    await expect(page.getByText("फ़ाइल चुनें")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectTextEntryControlsAtLeast16px(page);
    await expectOwnerBottomNavLabelsInsideBounds(page);

    await page.goto("/hi/owner/leads");

    await expect(page.getByRole("heading", { name: "आपकी लीड्स" })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "लीड्स खोजें" })).toBeVisible();
    await expect(page.getByRole("group", { name: "स्टेटस से लीड फिल्टर करें" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectTextEntryControlsAtLeast16px(page);
    await expectOwnerBottomNavLabelsInsideBounds(page);
  });
});

test.describe("Owner workspace populated lead browser coverage", () => {
  test("mobile renders real lead cards and updates status without DnD", async ({
    page,
    request
  }, testInfo) => {
    const runtimeErrors = captureRuntimeErrors(page);
    const ownerSession = await signInAsOwner(page, request);
    const lead = await createOwnerLeadViaContactUnlock(
      request,
      ownerSession,
      `${Date.now()}${testInfo.retry}`
    );

    await page.goto("/en/owner/leads");

    await expect(page.getByRole("heading", { name: /your leads/i })).toBeVisible();
    await expect(page.locator(".lk-board")).toHaveCount(0);
    await expect(page.locator("[data-rfd-droppable-id], [data-rfd-draggable-id]")).toHaveCount(0);

    const card = page.locator(".lead-card", { hasText: lead.tenant_name }).first();
    await expect(card).toBeVisible();
    await expect(card.getByText(lead.listing_title)).toBeVisible();
    await expect(card.getByText(lead.tenant_name)).toBeVisible();
    await expect(card.getByText(lead.tenant_phone_masked ?? "")).toBeVisible();

    await card.getByRole("button", { name: /mark contacted/i }).click();
    await expect(card.getByText(/contacted/i)).toBeVisible();
    await expectNoHorizontalOverflow(page);

    expect(runtimeErrors).toEqual([]);
  });

  test.describe("desktop", () => {
    test.use({ viewport: OWNER_DESKTOP_VIEWPORT });

    test("renders a real lead in the Kanban board without runtime errors or overflow", async ({
      page,
      request
    }, testInfo) => {
      const runtimeErrors = captureRuntimeErrors(page);
      const ownerSession = await signInAsOwner(page, request);
      const lead = await createOwnerLeadViaContactUnlock(
        request,
        ownerSession,
        `${Date.now()}${testInfo.retry}`
      );

      await page.goto("/en/owner/leads");

      await expect(page.getByRole("heading", { name: /your leads/i })).toBeVisible();
      await expect(page.locator(".lk-board")).toBeVisible();
      await expect(page.locator(".lk-board [data-rfd-droppable-id]").first()).toBeAttached();

      const newColumn = page.locator(".lk-col", {
        has: page.getByRole("heading", { name: "New" })
      });
      const card = newColumn.locator(".lk-card", { hasText: lead.tenant_name }).first();
      await expect(card).toBeVisible();
      await expect(card.getByText(lead.listing_title)).toBeVisible();
      await expectNoHorizontalOverflow(page);

      expect(runtimeErrors).toEqual([]);
    });
  });
});
