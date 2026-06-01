import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Voice orb is the only client-only piece; mock it so the shell renders deterministically.
vi.mock("@/components/pg-operator/voice/PgVoiceOrb", () => ({
  __esModule: true,
  default: () => <div data-testid="voice-orb-stub" />
}));

// next/navigation for the shell's hydration
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));

import PgWizardClient from "../PgWizardClient";

beforeEach(() => {
  sessionStorage.clear();
});

describe("PgWizardClient", () => {
  it("renders the step indicator at step 1 by default (Property & Identity)", () => {
    render(
      <PgWizardClient
        locale="en"
        accessToken="tok"
        operatorUserId="00000000-0000-0000-0000-000000000001"
      />
    );
    // 4.6 UI promoted the step title from h2 → h1 (it's the primary page heading).
    expect(
      screen.getByRole("heading", { name: /property.*identity/i, level: 1 })
    ).toBeInTheDocument();
    // step indicator should show step 1 as current
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("aria-current", "step");
  });

  it("hydrates from sessionStorage if a saved draft exists", () => {
    sessionStorage.setItem(
      "pg-wizard-draft-v1",
      JSON.stringify({
        draft: { property: { display_name: "Saved PG", city_slug: "blr" } },
        ui: { sharing_options: ["double"] }
      })
    );
    render(
      <PgWizardClient
        locale="en"
        accessToken="tok"
        operatorUserId="00000000-0000-0000-0000-000000000001"
      />
    );
    expect(screen.getByLabelText(/property name/i)).toHaveValue("Saved PG");
    expect(screen.getByLabelText(/^city$/i)).toHaveValue("blr");
  });

  it("seeds the property block when existingPgPropertyId + seed are provided", async () => {
    render(
      <PgWizardClient
        locale="en"
        accessToken="tok"
        operatorUserId="00000000-0000-0000-0000-000000000001"
        existingPgPropertyId="prop-1"
        existingPropertySeed={{ display_name: "Existing Acme PG" }}
      />
    );
    await waitFor(() =>
      expect(screen.getByLabelText(/property name/i)).toHaveValue("Existing Acme PG")
    );
  });

  it("renders the voice orb (full-pipeline ready)", () => {
    render(
      <PgWizardClient
        locale="en"
        accessToken="tok"
        operatorUserId="00000000-0000-0000-0000-000000000001"
      />
    );
    expect(screen.getByTestId("voice-orb-stub")).toBeInTheDocument();
  });

  it("persists wizard state into sessionStorage on every change", async () => {
    render(
      <PgWizardClient
        locale="en"
        accessToken="tok"
        operatorUserId="00000000-0000-0000-0000-000000000001"
      />
    );
    // After mount, the first effect runs and writes initial state
    await waitFor(() => {
      const saved = sessionStorage.getItem("pg-wizard-draft-v1");
      expect(saved).toBeTruthy();
      const parsed = JSON.parse(saved!);
      expect(parsed).toHaveProperty("draft");
      expect(parsed).toHaveProperty("ui");
    });
  });
});
