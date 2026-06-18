import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

// Voice orb is the only client-only piece; mock it so the shell renders deterministically.
vi.mock("@/components/pg-operator/voice/PgVoiceOrb", () => ({
  __esModule: true,
  default: () => <div data-testid="voice-orb-stub" />
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));

const apiMocks = vi.hoisted(() => ({
  putPgDraft: vi.fn(() => Promise.resolve({ draft_id: "d1", updated_at: "t" })),
  getPgDraft: vi.fn(() => Promise.reject(new Error("no draft"))),
  getPgListingEditPayload: vi.fn(),
  getPgListingDetail: vi.fn(() => Promise.resolve({ photoItems: [] })),
  createPgListing: vi.fn(),
  updatePgListing: vi.fn()
}));
vi.mock("@/lib/pg-operator-api", () => apiMocks);

vi.mock("@/lib/pg-funnel", () => ({ trackPgFunnel: vi.fn(), setPgFunnelToken: vi.fn() }));

import PgWizardClient from "../PgWizardClient";

beforeEach(() => {
  sessionStorage.clear();
  apiMocks.putPgDraft.mockClear();
  apiMocks.getPgListingEditPayload.mockReset();
  apiMocks.getPgListingDetail.mockReset();
  apiMocks.getPgListingDetail.mockResolvedValue({ photoItems: [] } as any);
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
    // PgStepIndicator renders a <nav aria-label="Wizard progress"> of clickable
    // <button> step pills (not an <ol>/<li> list); the active step carries
    // aria-current="step". Scope to that nav and assert step 1 is current.
    const stepNav = screen.getByRole("navigation", { name: /wizard progress/i });
    const steps = within(stepNav).getAllByRole("button");
    expect(steps[0]).toHaveAttribute("aria-current", "step");
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

  it("edit mode: shows loading skeleton while API calls are in flight (no blank-field flash)", async () => {
    // Without editHydrating state, showWizard starts true and renders the wizard
    // with empty fields immediately. With editHydrating, a skeleton is shown
    // instead until both API calls resolve.
    let resolvePayload!: (v: any) => void;
    let resolveDetail!: (v: any) => void;
    apiMocks.getPgListingEditPayload.mockReturnValue(
      new Promise((res) => {
        resolvePayload = res;
      })
    );
    apiMocks.getPgListingDetail.mockReturnValue(
      new Promise((res) => {
        resolveDetail = res;
      })
    );

    render(
      <PgWizardClient
        locale="en"
        accessToken="tok"
        operatorUserId="00000000-0000-0000-0000-000000000001"
        editListingId="L1"
      />
    );

    // While in-flight: loading skeleton must be visible, property name field must not.
    expect(screen.getByTestId("edit-loading-skeleton")).toBeInTheDocument();
    expect(screen.queryByLabelText(/property name/i)).not.toBeInTheDocument();

    // After resolving: wizard renders with the hydrated data.
    resolvePayload({
      property: { display_name: "Loaded PG", city_slug: "blr" },
      pg_details: { total_beds: 4 },
      room_types: []
    });
    resolveDetail({ photoItems: [], verification_status: null, has_exact_geo: false });
    await waitFor(() =>
      expect(screen.queryByTestId("edit-loading-skeleton")).not.toBeInTheDocument()
    );
  });

  it("edit mode: fires getPgListingEditPayload and getPgListingDetail concurrently (not sequentially)", async () => {
    // With sequential awaits the second call only fires after the first resolves.
    // With Promise.all both are fired before either resolves.
    // Test: block both promises and verify both were called.
    let resolvePayload!: (v: any) => void;
    let resolveDetail!: (v: any) => void;
    apiMocks.getPgListingEditPayload.mockReturnValue(
      new Promise((res) => {
        resolvePayload = res;
      })
    );
    apiMocks.getPgListingDetail.mockReturnValue(
      new Promise((res) => {
        resolveDetail = res;
      })
    );

    render(
      <PgWizardClient
        locale="en"
        accessToken="tok"
        operatorUserId="00000000-0000-0000-0000-000000000001"
        editListingId="L1"
      />
    );

    // Both must be called before either resolves — proves concurrent dispatch.
    await waitFor(() => {
      expect(apiMocks.getPgListingEditPayload).toHaveBeenCalledWith("L1", "tok");
      expect(apiMocks.getPgListingDetail).toHaveBeenCalledWith("L1", "tok");
    });

    // Clean up: resolve the promises so React can settle.
    resolvePayload({
      property: { display_name: "PG", city_slug: "blr" },
      pg_details: { total_beds: 4 },
      room_types: []
    });
    resolveDetail({ photoItems: [], verification_status: null, has_exact_geo: false });
  });

  it("edit mode: hydrates from the edit endpoint and does NOT autosave a draft", async () => {
    apiMocks.getPgListingEditPayload.mockResolvedValue({
      title: "Edited Boys PG",
      property: { display_name: "Edited PG", city_slug: "blr" },
      pg_details: { total_beds: 8 },
      room_types: [{ sharing: "double", ac: true, monthly_rent_paise: 900000, vacancy_count: 2 }]
    } as any);

    render(
      <PgWizardClient
        locale="en"
        accessToken="tok"
        operatorUserId="00000000-0000-0000-0000-000000000001"
        editListingId="L1"
      />
    );

    // hydrated straight into the wizard (no entry chooser), fields populated
    await waitFor(() => expect(screen.getByLabelText(/property name/i)).toHaveValue("Edited PG"));
    expect(apiMocks.getPgListingEditPayload).toHaveBeenCalledWith("L1", "tok");
    // a committed listing must NEVER write a pg_listing_drafts row
    expect(apiMocks.putPgDraft).not.toHaveBeenCalled();
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
