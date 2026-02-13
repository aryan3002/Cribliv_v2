import { expect, test } from "@playwright/test";
import { loginAsRole, setSessionOnPage } from "./utils/auth";

test.describe("Owner assisted capture", () => {
  test.beforeEach(async ({ page, request }) => {
    const session = await loginAsRole(request, "owner");
    await setSessionOnPage(page, session);

    await page.addInitScript(() => {
      const fakeStream = {
        getTracks() {
          return [
            {
              stop() {
                return undefined;
              }
            }
          ];
        }
      };

      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async () => fakeStream
        }
      });

      class FakeMediaRecorder {
        static isTypeSupported() {
          return true;
        }

        mimeType: string;
        ondataavailable: ((event: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        state = "inactive";

        constructor(_: unknown, options?: { mimeType?: string }) {
          this.mimeType = options?.mimeType || "audio/webm";
        }

        start() {
          this.state = "recording";
          setTimeout(() => {
            this.ondataavailable?.({ data: new Blob(["fake-audio"], { type: this.mimeType }) });
          }, 10);
        }

        stop() {
          this.state = "inactive";
          setTimeout(() => this.onstop?.(), 10);
        }
      }

      Object.defineProperty(window, "MediaRecorder", {
        configurable: true,
        writable: true,
        value: FakeMediaRecorder
      });
    });
  });

  test("voice capture prefill confirms and hands off to wizard", async ({ page }) => {
    await page.route("**/v1/owner/listings/capture/extract", async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            transcript_echo: "Noida 2BHK rent 18000",
            draft_suggestion: {
              listing_type: "flat_house",
              title: "Voice Captured 2BHK",
              rent: 18000,
              location: {
                city: "noida",
                locality: "sector-62"
              },
              property_fields: {
                bhk: 2
              }
            },
            field_confidence_tier: {
              listing_type: "high",
              title: "high",
              rent: "medium",
              "location.city": "high",
              "location.locality": "medium",
              "property_fields.bhk": "high"
            },
            confirm_fields: ["listing_type", "rent", "location.city", "location.locality"],
            missing_required_fields: [],
            critical_warnings: []
          }
        })
      });
    });

    await page.goto("/en/owner/listings/new");
    await page.getByRole("button", { name: /describe property/i }).click();
    await page.getByRole("button", { name: /stop & continue/i }).click();

    await expect(page.getByRole("heading", { name: /assisted draft/i })).toBeVisible();
    await expect(page.getByText(/voice captured 2bhk/i)).toBeVisible();

    const confirmButtons = page.getByRole("button", { name: /^confirm$/i });
    while ((await confirmButtons.count()) > 0) {
      await confirmButtons.first().click();
    }

    await page.getByRole("button", { name: /continue to form/i }).click();
    await expect(page.getByRole("navigation", { name: /wizard progress/i })).toBeVisible();

    await page.getByRole("button", { name: /back/i }).click();
    await page.getByRole("button", { name: /back/i }).click();
    await expect(page.getByLabel(/listing title/i)).toHaveValue("Voice Captured 2BHK");
    await expect(page.getByLabel(/monthly rent/i)).toHaveValue("18000");
  });
});
