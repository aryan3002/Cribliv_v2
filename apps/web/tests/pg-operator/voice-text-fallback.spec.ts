import { test, expect } from "@playwright/test";
import { loginAsRole, setSessionOnPage } from "../utils/auth";

// This spec depends on the realtime LLM pipeline in voice-agent-pg being wired
// to emit `field_extracted` for plain text_input. If the pipeline isn't ready
// in your local stack, skip via PG_VOICE_E2E=0.
const VOICE_E2E_ENABLED = process.env.PG_VOICE_E2E !== "0";

test.describe.configure({ mode: "serial" });

test.describe("Voice text fallback populates the wizard", () => {
  test.skip(!VOICE_E2E_ENABLED, "PG_VOICE_E2E=0 — voice pipeline not wired locally");

  test("typing into Chaya fallback updates wizard total_beds", async ({ page, request }) => {
    const session = await loginAsRole(request, "pg_operator");
    await setSessionOnPage(page, session);

    await page.goto("/en/pg-operator/listings/new");

    // Open the voice orb → panel
    await page.getByRole("button", { name: /chaya|voice/i }).click();
    await expect(page.getByRole("dialog", { name: /chaya/i })).toBeVisible();

    // Type into the fallback input and send
    await page.getByLabel(/text input/i).fill("We have 12 beds in our PG");
    await page.getByRole("button", { name: /^send$/i }).click();

    // Wait for the voice-extraction → reducer → wizard field update
    await expect(page.getByLabel(/total beds/i)).toHaveValue("12", { timeout: 10_000 });
  });
});
