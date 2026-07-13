import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/lib/pg-funnel", () => ({ trackPgFunnel: vi.fn() }));

const api = vi.hoisted(() => ({
  createPgListing: vi.fn(() => Promise.resolve({ listing_id: "NEW", status: "draft" })),
  updatePgListing: vi.fn(() => Promise.resolve({ listing_id: "L1", status: "pending_review" })),
  submitPgListing: vi.fn(() => Promise.resolve({ listing_id: "NEW", status: "pending_review" }))
}));
vi.mock("@/lib/pg-operator-api", () => api);

const owner = vi.hoisted(() => ({
  presignListingPhotos: vi.fn(),
  completeListingPhotos: vi.fn(),
  reorderListingPhotos: vi.fn(() => Promise.resolve({ updatedCount: 0, items: [] }))
}));
vi.mock("@/lib/owner-api", () => owner);

import PgReviewStep from "../PgReviewStep";

function completePhoto(i: number) {
  return {
    clientUploadId: `existing-${i}`,
    file: new File([], "x"),
    previewUrl: `https://cdn/p${i}.jpg`,
    sizeBytes: 0,
    contentType: "image/jpeg",
    sortOrder: i,
    isCover: i === 0,
    status: "complete" as const,
    photoId: `ph-${i}`,
    blobPath: `pg/L1/p${i}.jpg`
  };
}

function makeState() {
  return {
    draft: {
      title: "Edited Boys PG",
      property: { display_name: "Edited PG", city_slug: "blr" },
      pg_details: { total_beds: 8 },
      room_types: [{ sharing: "double", ac: true, monthly_rent_paise: 900000, vacancy_count: 2 }]
    },
    ui: {},
    currentStep: 7,
    undoStack: [],
    submitting: false,
    pendingPhotos: [0, 1, 2, 3].map(completePhoto)
  } as any;
}

beforeEach(() => {
  api.createPgListing.mockClear();
  api.updatePgListing.mockClear();
  api.submitPgListing.mockClear();
  owner.presignListingPhotos.mockReset();
  owner.completeListingPhotos.mockReset();
  owner.reorderListingPhotos.mockClear();
  // Happy defaults for the create-mode upload path (each id maps to an upload URL
  // + blob path). Overridden per-test for failure cases.
  owner.presignListingPhotos.mockResolvedValue({
    uploads: [0, 1, 2, 3].map((i) => ({
      clientUploadId: `existing-${i}`,
      uploadUrl: `https://az/up/${i}`,
      blobPath: `pg/NEW/p${i}.jpg`
    }))
  } as any);
  owner.completeListingPhotos.mockResolvedValue({ photoIds: ["a", "b", "c", "d"] } as any);
  // putToAzure() uses fetch(); a 200 lets the upload phase succeed.
  global.fetch = vi.fn(() => Promise.resolve({ ok: true } as any));
  push.mockClear();
});

describe("PgReviewStep — edit mode save", () => {
  it("calls updatePgListing (NOT createPgListing) and routes to ?updated=1", async () => {
    render(
      <PgReviewStep
        state={makeState()}
        dispatch={vi.fn()}
        locale="en"
        accessToken="tok"
        editListingId="L1"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /submit for review/i }));

    await waitFor(() => expect(api.updatePgListing).toHaveBeenCalledTimes(1));
    expect(api.updatePgListing).toHaveBeenCalledWith(
      expect.objectContaining({ id: "L1", token: "tok" })
    );
    expect(api.createPgListing).not.toHaveBeenCalled();
    // all 4 photos are existing (have photoId) → nothing re-uploaded
    expect(owner.presignListingPhotos).not.toHaveBeenCalled();
    // ≥2 persisted photos → order is re-affirmed
    expect(owner.reorderListingPhotos).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/en/pg-operator/listings/L1?updated=1"));
  });

  it("create mode still calls createPgListing (no editListingId)", async () => {
    render(<PgReviewStep state={makeState()} dispatch={vi.fn()} locale="en" accessToken="tok" />);
    fireEvent.click(screen.getByRole("button", { name: /submit for review/i }));
    await waitFor(() => expect(api.createPgListing).toHaveBeenCalledTimes(1));
    expect(api.updatePgListing).not.toHaveBeenCalled();
  });

  it("create mode: uploads photos THEN submits for review, routes to ?published=1", async () => {
    render(<PgReviewStep state={makeState()} dispatch={vi.fn()} locale="en" accessToken="tok" />);
    fireEvent.click(screen.getByRole("button", { name: /submit for review/i }));

    await waitFor(() => expect(api.submitPgListing).toHaveBeenCalledTimes(1));
    // Submit happens only AFTER the photos are persisted — the whole point of the fix.
    expect(owner.completeListingPhotos).toHaveBeenCalledTimes(1);
    expect(api.submitPgListing).toHaveBeenCalledWith("NEW", "tok");
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/en/pg-operator/listings/NEW?published=1")
    );
  });

  it("create mode: photo upload failure leaves a DRAFT and never submits for review", async () => {
    owner.presignListingPhotos.mockRejectedValueOnce(new Error("azure down"));
    render(<PgReviewStep state={makeState()} dispatch={vi.fn()} locale="en" accessToken="tok" />);
    fireEvent.click(screen.getByRole("button", { name: /submit for review/i }));

    await waitFor(() => expect(api.createPgListing).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/en/pg-operator/listings/NEW?draft=1&photoError=1")
    );
    // The listing stays a draft — it must NOT enter the admin review queue.
    expect(api.submitPgListing).not.toHaveBeenCalled();
  });
});
