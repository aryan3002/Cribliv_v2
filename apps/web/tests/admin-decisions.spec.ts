import { expect, test, type APIRequestContext } from "@playwright/test";
import { loginAsRole, setSessionOnPage } from "./utils/auth";

function getApiBaseUrl() {
  const raw = process.env.E2E_API_BASE_URL || "http://localhost:4000/v1";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

async function createPendingListing(request: APIRequestContext, title: string) {
  const owner = await loginAsRole(request, "owner");
  const createResponse = await request.post(`${getApiBaseUrl()}/owner/listings`, {
    headers: {
      Authorization: `Bearer ${owner.access_token}`
    },
    data: {
      listing_type: "flat_house",
      title,
      rent: 21000,
      location: {
        city: "noida",
        address_line1: "Sector 62"
      },
      property_fields: {
        bhk: 2,
        bathrooms: 1,
        area_sqft: 800
      }
    }
  });
  expect(createResponse.ok()).toBeTruthy();
  const createJson = await createResponse.json();
  const listingId = createJson?.data?.listing_id as string;
  expect(listingId).toBeTruthy();

  const submitResponse = await request.post(
    `${getApiBaseUrl()}/owner/listings/${listingId}/submit`,
    {
      headers: {
        Authorization: `Bearer ${owner.access_token}`
      },
      data: {
        agree_terms: true
      }
    }
  );
  expect(submitResponse.ok()).toBeTruthy();

  return listingId;
}

async function createVerificationAttempt(request: APIRequestContext) {
  const owner = await loginAsRole(request, "owner");
  const listingId = await createPendingListing(
    request,
    `Verification Listing ${Date.now().toString()}`
  );

  const response = await request.post(`${getApiBaseUrl()}/owner/verification/video`, {
    headers: {
      Authorization: `Bearer ${owner.access_token}`
    },
    data: {
      listing_id: listingId,
      artifact_blob_path: "verification-artifacts/video-selfie.mp4",
      vendor_reference: `ver-${Date.now().toString()}`
    }
  });
  expect(response.ok()).toBeTruthy();
}

test.describe("Admin decision flows", () => {
  test("reject listing requires reason", async ({ page, request }) => {
    const title = `Reject Listing ${Date.now().toString()}`;
    await createPendingListing(request, title);

    const adminSession = await loginAsRole(request, "admin");
    await setSessionOnPage(page, adminSession);

    await page.goto("/en/admin");
    await expect(page.getByRole("heading", { name: /admin dashboard/i })).toBeVisible();

    const card = page.locator(".queue-card", { hasText: title }).first();
    await expect(card).toBeVisible();

    await card.getByRole("button", { name: /reject/i }).click();
    await expect(card.getByText(/please provide a reason/i)).toBeVisible();

    await card.locator("textarea.reason-input").fill("Policy mismatch");
    await card.getByRole("button", { name: /reject/i }).click();
    await expect(card).toHaveCount(0);
  });

  test("pause listing requires reason", async ({ page, request }) => {
    const title = `Pause Listing ${Date.now().toString()}`;
    await createPendingListing(request, title);

    const adminSession = await loginAsRole(request, "admin");
    await setSessionOnPage(page, adminSession);

    await page.goto("/en/admin");
    await expect(page.getByRole("heading", { name: /admin dashboard/i })).toBeVisible();

    const card = page.locator(".queue-card", { hasText: title }).first();
    await expect(card).toBeVisible();

    await card.getByRole("button", { name: /pause/i }).click();
    await expect(card.getByText(/please provide a reason/i)).toBeVisible();

    await card.locator("textarea.reason-input").fill("Temporarily paused");
    await card.getByRole("button", { name: /pause/i }).click();
    await expect(card).toHaveCount(0);
  });

  test("verification queue shows API-backed attempts", async ({ page, request }) => {
    await createVerificationAttempt(request);

    const adminSession = await loginAsRole(request, "admin");
    await setSessionOnPage(page, adminSession);

    await page.goto("/en/admin");
    await expect(page.getByRole("heading", { name: /admin dashboard/i })).toBeVisible();

    const verificationTab = page.getByRole("tab", { name: /verification review/i });
    await verificationTab.click();
    await expect(verificationTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(/video liveness/i).first()).toBeVisible();
  });
});
