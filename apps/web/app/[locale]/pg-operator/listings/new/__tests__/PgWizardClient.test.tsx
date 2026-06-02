import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Voice orb is the only client-only piece; mock it so the shell renders deterministically.
vi.mock("@/components/pg-operator/voice/PgVoiceOrb", () => ({
  __esModule: true,
  default: () => <div data-testid="voice-orb-stub" />
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));

vi.mock("@/lib/pg-operator-api", () => ({
  putPgDraft: vi.fn(() => Promise.resolve({ draft_id: "d1", updated_at: "t" })),
  getPgDraft: vi.fn(() => Promise.reject(new Error("no draft")))
}));

vi.mock("@/lib/pg-funnel", () => ({ trackPgFunnel: vi.fn(), setPgFunnelToken: vi.fn() }));

import PgWizardClient from "../PgWizardClient";

beforeEach(() => {
  sessionStorage.clear();
});

describe("PgWizardClient", () => {
  it("shows entry chooser for a new listing (no draftId or existingProperty)", () => {
    render(
      <PgWizardClient
        locale="en"
        accessToken="tok"
        operatorUserId="00000000-0000-0000-0000-000000000001"
      />
    );
    expect(screen.getByText(/type it myself/i)).toBeInTheDocument();
  });

  it("renders the step indicator at step 1 after selecting 'Type it myself'", async () => {
    render(
      <PgWizardClient
        locale="en"
        accessToken="tok"
        operatorUserId="00000000-0000-0000-0000-000000000001"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /type it myself/i }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /property.*identity/i, level: 1 })
      ).toBeInTheDocument()
    );
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("aria-current", "step");
  });

  it("shows wizard directly when existingPgPropertyId is set", async () => {
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

  it("hydrates from sessionStorage when wizard is shown via entry chooser", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: /type it myself/i }));
    await waitFor(() => expect(screen.getByLabelText(/property name/i)).toHaveValue("Saved PG"));
  });

  it("renders the voice orb when wizard is active", async () => {
    render(
      <PgWizardClient
        locale="en"
        accessToken="tok"
        operatorUserId="00000000-0000-0000-0000-000000000001"
        existingPgPropertyId="prop-1"
      />
    );
    await waitFor(() => expect(screen.getByTestId("voice-orb-stub")).toBeInTheDocument());
  });

  it("persists wizard state into sessionStorage on every change", async () => {
    render(
      <PgWizardClient
        locale="en"
        accessToken="tok"
        operatorUserId="00000000-0000-0000-0000-000000000001"
        existingPgPropertyId="prop-1"
      />
    );
    await waitFor(() => {
      const saved = sessionStorage.getItem("pg-wizard-draft-v1");
      expect(saved).toBeTruthy();
      const parsed = JSON.parse(saved!);
      expect(parsed).toHaveProperty("draft");
      expect(parsed).toHaveProperty("ui");
    });
  });
});
