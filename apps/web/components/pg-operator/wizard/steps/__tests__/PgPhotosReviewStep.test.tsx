import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useReducer } from "react";

const mocks = vi.hoisted(() => ({
  createPgListing: vi.fn(),
  presignListingPhotos: vi.fn(),
  completeListingPhotos: vi.fn(),
  push: vi.fn()
}));

vi.mock("@/lib/pg-operator-api", () => ({ createPgListing: mocks.createPgListing }));
vi.mock("@/lib/owner-api", () => ({
  presignListingPhotos: mocks.presignListingPhotos,
  completeListingPhotos: mocks.completeListingPhotos
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));

import { pgWizardReducer, initialPgWizardState } from "@/lib/pg-wizard-state";
import PgPhotosReviewStep from "../PgPhotosReviewStep";

beforeEach(() => {
  mocks.createPgListing.mockReset();
  mocks.push.mockReset();
  mocks.presignListingPhotos.mockReset();
  mocks.completeListingPhotos.mockReset();
  // Default photo upload stubs — succeed silently
  mocks.presignListingPhotos.mockResolvedValue({
    uploads: [1, 2, 3, 4].map((i) => ({
      clientUploadId: `id-${i}`,
      uploadUrl: "https://example.com/upload",
      blobPath: `photos/p${i}.jpg`
    }))
  });
  mocks.completeListingPhotos.mockResolvedValue({});
  // Mock global fetch for Azure blob PUT
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
});

function makePhoto(i: number) {
  return {
    clientUploadId: `id-${i}`,
    file: new File(["x"], `p${i}.jpg`, { type: "image/jpeg" }),
    previewUrl: "blob:x",
    sizeBytes: 1024,
    contentType: "image/jpeg",
    sortOrder: i - 1,
    isCover: i === 1
  };
}

function makeValidState() {
  return {
    ...initialPgWizardState(),
    draft: {
      property: { display_name: "Acme PG", city_slug: "blr" } as any,
      pg_details: { total_beds: 10 } as any,
      room_types: [
        { sharing: "double", ac: true, monthly_rent_paise: 800000, vacancy_count: 4 }
      ] as any
    },
    pgPropertyId: "prop-1",
    currentStep: 6,
    pendingPhotos: [1, 2, 3, 4].map(makePhoto)
  } as any;
}

function Harness({
  initState,
  accessToken = "tok" as string | null
}: {
  initState?: any;
  accessToken?: string | null;
}) {
  const [state, dispatch] = useReducer(pgWizardReducer, initState ?? initialPgWizardState());
  return (
    <PgPhotosReviewStep state={state} dispatch={dispatch} locale="en" accessToken={accessToken} />
  );
}

describe("PgPhotosReviewStep", () => {
  it("submits with Idempotency-Key + token + strict payload on Publish", async () => {
    mocks.createPgListing.mockResolvedValueOnce({ listing_id: "L-1", status: "draft" });
    render(<Harness initState={makeValidState()} />);
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));
    await waitFor(() => expect(mocks.createPgListing).toHaveBeenCalled());
    const args = mocks.createPgListing.mock.calls[0][0];
    expect(args.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(args.token).toBe("tok");
    expect(args.payload.property.display_name).toBe("Acme PG");
    expect(args.payload.property.city_slug).toBe("blr");
    expect((args.payload as any).room_config).toBeUndefined();
    expect((args.payload as any).sharing_options).toBeUndefined();
  });

  it("after publish, navigates to the listing detail page with ?published=1", async () => {
    mocks.createPgListing.mockResolvedValueOnce({ listing_id: "L-1", status: "draft" });
    render(<Harness initState={makeValidState()} />);
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith("/en/pg-operator/listings/L-1?published=1")
    );
  });

  it("disables Publish when required fields missing or no photos", () => {
    render(<Harness initState={{ ...initialPgWizardState(), currentStep: 6 }} />);
    const btn = screen.getByRole("button", { name: /publish/i });
    expect(btn).toBeDisabled();
  });

  it("surfaces 'No property' error with friendly message", async () => {
    const err: any = new Error("no_property: create a pg_property first");
    err.code = "no_property";
    mocks.createPgListing.mockRejectedValueOnce(err);
    render(<Harness initState={makeValidState()} />);
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/no property/i));
  });

  it("surfaces generic error message verbatim", async () => {
    mocks.createPgListing.mockRejectedValueOnce(new Error("network down"));
    render(<Harness initState={makeValidState()} />);
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/network down/));
  });

  it("blocks publish without accessToken", async () => {
    render(<Harness initState={makeValidState()} accessToken={null} />);
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/sign in required/i));
    expect(mocks.createPgListing).not.toHaveBeenCalled();
  });

  it("renders the review JSON pre-block showing the would-be payload", () => {
    render(<Harness initState={makeValidState()} />);
    // The <pre> should contain the property name
    const pre = document.querySelector("pre");
    expect(pre?.textContent).toContain("Acme PG");
    expect(pre?.textContent).toContain("blr");
  });

  it("disables Publish and shows hint with fewer than 4 photos", () => {
    // Use valid state but strip photos to trigger min-4 gate
    const stateNoPhotos = { ...makeValidState(), pendingPhotos: [] };
    render(<Harness initState={stateNoPhotos} />);
    const btn = screen.getByRole("button", { name: /publish/i });
    expect(btn).toBeDisabled();
    // Should show a hint about needing 4 photos
    expect(screen.getByText(/4 required/i)).toBeInTheDocument();
  });

  it("enables Publish with 4+ photos", () => {
    const stateWith4Photos = makeValidState(); // already has 4 photos
    render(<Harness initState={stateWith4Photos} />);
    const btn = screen.getByRole("button", { name: /publish/i });
    expect(btn).not.toBeDisabled();
    // Hint should not appear when photos are sufficient
    expect(screen.queryByText(/4 required/i)).not.toBeInTheDocument();
  });

  it("Back returns to step 5", () => {
    const initState = makeValidState();
    function H() {
      const [state, dispatch] = useReducer(pgWizardReducer, initState);
      return (
        <>
          <PgPhotosReviewStep state={state} dispatch={dispatch} locale="en" accessToken="tok" />
          <span data-testid="step">{state.currentStep}</span>
        </>
      );
    }
    render(<H />);
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(screen.getByTestId("step")).toHaveTextContent("6");
  });
});
