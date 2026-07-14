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

const verificationFixtures = {
  mp4: Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x14]), Buffer.from("ftypisom")])
};

async function uploadVerificationArtifact(
  request: APIRequestContext,
  accessToken: string,
  input: {
    listingId: string;
    kind: "video_liveness" | "electricity_bill";
    contentType: string;
    fileName: string;
    content: Buffer;
  }
) {
  const presignResponse = await request.post(
    `${getApiBaseUrl()}/owner/verification/artifacts/presign`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      data: {
        listing_id: input.listingId,
        kind: input.kind,
        content_type: input.contentType,
        size_bytes: input.content.length,
        file_name: input.fileName
      }
    }
  );
  expect(presignResponse.ok()).toBeTruthy();
  const presignJson = await presignResponse.json();
  const uploadToken = presignJson?.data?.upload_token as string;
  const uploadUrl = presignJson?.data?.upload_url as string;
  const blobPath = presignJson?.data?.blob_path as string;
  expect(uploadToken).toBeTruthy();
  expect(uploadUrl).toBeTruthy();
  expect(blobPath).toBeTruthy();

  const multipartResponse = await request.post(`${getApiBaseUrl()}${uploadUrl}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    multipart: {
      upload_token: uploadToken,
      file: {
        name: input.fileName,
        mimeType: input.contentType,
        buffer: input.content
      }
    }
  });
  expect(multipartResponse.ok()).toBeTruthy();

  const completeResponse = await request.post(
    `${getApiBaseUrl()}/owner/verification/artifacts/complete`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      data: {
        listing_id: input.listingId,
        upload_token: uploadToken,
        blob_path: blobPath
      }
    }
  );
  expect(completeResponse.ok()).toBeTruthy();

  return blobPath;
}

async function createVerificationAttempt(request: APIRequestContext) {
  const owner = await loginAsRole(request, "owner");
  const listingId = await createPendingListing(
    request,
    `Verification Listing ${Date.now().toString()}`
  );
  const artifactBlobPath = await uploadVerificationArtifact(request, owner.access_token, {
    listingId,
    kind: "video_liveness",
    contentType: "video/mp4",
    fileName: "video-selfie.mp4",
    content: verificationFixtures.mp4
  });

  const response = await request.post(`${getApiBaseUrl()}/owner/verification/video`, {
    headers: {
      Authorization: `Bearer ${owner.access_token}`
    },
    data: {
      listing_id: listingId,
      artifact_blob_path: artifactBlobPath,
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
    const adminNav = page.getByRole("navigation", { name: /admin navigation/i });
    await expect(adminNav).toBeVisible();
    await adminNav.getByRole("button", { name: /^listing review$/i }).click();
    await expect(page.getByRole("heading", { name: /listing review/i })).toBeVisible();

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
    const adminNav = page.getByRole("navigation", { name: /admin navigation/i });
    await expect(adminNav).toBeVisible();
    await adminNav.getByRole("button", { name: /^listing review$/i }).click();
    await expect(page.getByRole("heading", { name: /listing review/i })).toBeVisible();

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
    const adminNav = page.getByRole("navigation", { name: /admin navigation/i });
    await expect(adminNav).toBeVisible();

    await adminNav.getByRole("button", { name: /^verifications$/i }).click();
    await expect(page.getByRole("heading", { name: /verification review/i })).toBeVisible();
    await expect(page.getByText(/video liveness/i).first()).toBeVisible();
  });
});
