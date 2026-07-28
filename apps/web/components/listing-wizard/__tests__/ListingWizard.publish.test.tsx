import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ListingWizard } from "../ListingWizard";
import { createOwnerListing, submitOwnerListing, updateOwnerListing } from "../../../lib/owner-api";
import { publishListingOnBehalf } from "../../../lib/admin-api";
import { ApiError } from "../../../lib/api";
import { EMPTY_FORM } from "../types";

/**
 * Focused coverage for ListingWizard's publish branch (Task 9) — the money
 * path that hands a listing, and in admin mode its callback number, to a
 * real owner.
 *
 * There is no existing ListingWizard test file, and driving the real
 * six-step wizard to Review would require mounting LocationStep's Google
 * Maps mini-map (see LocationStep.test.tsx's `installGoogleGlobal` setup)
 * just to satisfy validateStep(1)'s required `city` field — none of which
 * the publish branch itself exercises. Instead we seed the wizard's own
 * sessionStorage draft: the exact key (`cribliv:wizard-draft[:admin]`) and
 * shape (`{ form, step }`) the component's own "resume a saved draft" effect
 * reads on mount (ListingWizard.tsx), with a form that satisfies
 * handleSubmitListing's own field-level gate (rent, city, title) and lands
 * directly on step 5 (Review). This exercises the real hydration effect, the
 * real step===5-gated owner-handoff markup, and the real handleSubmitListing
 * branch — it does not re-test per-step navigation/validation, which is
 * already covered by validateStep.test.ts.
 */

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams()
}));

let sessionState: {
  data: { accessToken: string | null; user: { id: string; name: string } } | null;
} = {
  data: { accessToken: "test-access-token", user: { id: "admin-1", name: "Admin One" } }
};

vi.mock("next-auth/react", () => ({
  useSession: () => sessionState,
  signOut: vi.fn()
}));

// VoiceCoPilot sets up realtime audio/WebSocket state on mount; MobileMayaShell
// is its always-mounted wrapper (rendered whenever the realtime flag is on,
// regardless of wizard step). Neither is relevant to the publish branch.
vi.mock("../VoiceCoPilot", () => ({ VoiceCoPilot: () => null }));
vi.mock("../MobileMayaShell", () => ({
  MobileMayaShell: ({ children }: any) => <>{children}</>
}));

vi.mock("../../../lib/owner-api", async () => {
  const actual =
    await vi.importActual<typeof import("../../../lib/owner-api")>("../../../lib/owner-api");
  return {
    ...actual,
    createOwnerListing: vi.fn(),
    updateOwnerListing: vi.fn(),
    submitOwnerListing: vi.fn()
  };
});

vi.mock("../../../lib/admin-api", () => ({
  publishListingOnBehalf: vi.fn()
}));

const createOwnerListingMock = vi.mocked(createOwnerListing);
const updateOwnerListingMock = vi.mocked(updateOwnerListing);
const submitOwnerListingMock = vi.mocked(submitOwnerListing);
const publishListingOnBehalfMock = vi.mocked(publishListingOnBehalf);

// Satisfies handleSubmitListing's own allErrors gate (validateStep 0-3: rent,
// city, title required) without ever mounting BasicsStep/LocationStep/
// TitleDescriptionStep — see file-level comment.
const VALID_REVIEW_FORM = {
  ...EMPTY_FORM,
  monthly_rent: "25000",
  city: "lucknow",
  title: "Sunlit 2BHK near the metro station"
};

function seedReviewStepDraft(mode: "admin" | "owner") {
  const key = mode === "admin" ? "cribliv:wizard-draft:admin" : "cribliv:wizard-draft";
  window.sessionStorage.setItem(key, JSON.stringify({ form: VALID_REVIEW_FORM, step: 5 }));
}

describe("ListingWizard publish branch", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    createOwnerListingMock.mockReset();
    updateOwnerListingMock.mockReset();
    submitOwnerListingMock.mockReset();
    publishListingOnBehalfMock.mockReset();
    sessionState = {
      data: { accessToken: "test-access-token", user: { id: "admin-1", name: "Admin One" } }
    };
  });

  it("admin mode: blocks publish and shows a visible error when the owner phone is empty", async () => {
    seedReviewStepDraft("admin");
    createOwnerListingMock.mockResolvedValue({ listingId: "draft-1", status: "draft" });

    render(<ListingWizard locale="en" mode="admin" onPublished={vi.fn()} />);

    const submitButton = await screen.findByRole("button", { name: /submit for review/i });
    fireEvent.click(submitButton);

    expect(await screen.findByText(/enter the owner's phone number/i)).toBeInTheDocument();
    // The draft save itself is allowed to go through (so the admin's other
    // entries aren't lost on a blocked publish), but the hand-off call must not.
    expect(createOwnerListingMock).toHaveBeenCalledTimes(1);
    expect(publishListingOnBehalfMock).not.toHaveBeenCalled();
  });

  it("admin mode: publishes with the freshly created draft id, not the stale listingId snapshot", async () => {
    seedReviewStepDraft("admin");
    createOwnerListingMock.mockResolvedValue({ listingId: "draft-xyz-789", status: "draft" });
    publishListingOnBehalfMock.mockResolvedValue({
      ownerUserId: "owner-9",
      ownerPhone: "+919956729103"
    });
    const onPublished = vi.fn();

    render(<ListingWizard locale="en" mode="admin" onPublished={onPublished} />);

    const phoneInput = await screen.findByLabelText(/owner's phone/i);
    fireEvent.change(phoneInput, { target: { value: "9956729103" } });
    fireEvent.click(screen.getByRole("button", { name: /submit for review/i }));

    await waitFor(() => expect(publishListingOnBehalfMock).toHaveBeenCalledTimes(1));
    // Asserting the literal id, not expect.anything(): listingId (React state)
    // is still null at this point on a first-ever submit — only draftId (the
    // local variable holding createOwnerListing's response) carries the real
    // id. If ListingWizard.tsx regresses to passing `listingId` here instead
    // of `draftId`, this call becomes (accessToken, null, ...) and the
    // assertion below fails.
    expect(publishListingOnBehalfMock).toHaveBeenCalledWith(
      "test-access-token",
      "draft-xyz-789",
      "9956729103",
      undefined
    );
    expect(submitOwnerListingMock).not.toHaveBeenCalled();
    await waitFor(() => expect(onPublished).toHaveBeenCalledWith("draft-xyz-789"));
  });

  // Finding 3 (2026-07-28 review): friendlyApiMessage used to map every 400
  // to a generic "couldn't save your draft" string, regardless of mode. On
  // the admin publish path that's actively wrong for invalid_phone /
  // cannot_transfer_to_admin / target_blocked / pg_not_supported — it blames
  // a draft save that already succeeded and tells the worker to retry
  // "at the end", which fails identically every time on the same
  // business-rule rejection. Admin-mode 400s must now surface the server's
  // own ApiError.message instead.
  it("admin mode: surfaces the server's own message for a business-rule 400, not the generic draft-save text", async () => {
    seedReviewStepDraft("admin");
    createOwnerListingMock.mockResolvedValue({ listingId: "draft-1", status: "draft" });
    publishListingOnBehalfMock.mockRejectedValue(
      new ApiError("That number belongs to an admin account", {
        status: 400,
        code: "cannot_transfer_to_admin"
      })
    );

    render(<ListingWizard locale="en" mode="admin" onPublished={vi.fn()} />);

    const phoneInput = await screen.findByLabelText(/owner's phone/i);
    fireEvent.change(phoneInput, { target: { value: "9876543210" } });
    fireEvent.click(screen.getByRole("button", { name: /submit for review/i }));

    expect(await screen.findByText("That number belongs to an admin account")).toBeInTheDocument();
    expect(screen.queryByText(/couldn't save your draft right now/i)).not.toBeInTheDocument();
  });

  it("owner mode: a business-rule 400 during submit still shows the generic draft-save text, not the raw server message", async () => {
    seedReviewStepDraft("owner");
    createOwnerListingMock.mockResolvedValue({ listingId: "draft-owner-2", status: "draft" });
    submitOwnerListingMock.mockRejectedValue(
      new ApiError("some internal validation code", { status: 400, code: "validation_error" })
    );

    render(<ListingWizard locale="en" mode="owner" onPublished={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /submit for review/i }));

    expect(await screen.findByText(/couldn't save your draft right now/i)).toBeInTheDocument();
    expect(screen.queryByText("some internal validation code")).not.toBeInTheDocument();
  });

  it("owner mode: calls submitOwnerListing and never publishListingOnBehalf", async () => {
    seedReviewStepDraft("owner");
    createOwnerListingMock.mockResolvedValue({ listingId: "draft-owner-1", status: "draft" });
    submitOwnerListingMock.mockResolvedValue({
      listingId: "draft-owner-1",
      status: "pending_review"
    });
    const onPublished = vi.fn();

    render(<ListingWizard locale="en" mode="owner" onPublished={onPublished} />);

    const submitButton = await screen.findByRole("button", { name: /submit for review/i });
    // Owner mode never renders the hand-off card at all.
    expect(screen.queryByLabelText(/owner's phone/i)).not.toBeInTheDocument();
    fireEvent.click(submitButton);

    await waitFor(() =>
      expect(submitOwnerListingMock).toHaveBeenCalledWith("test-access-token", "draft-owner-1")
    );
    expect(publishListingOnBehalfMock).not.toHaveBeenCalled();
    await waitFor(() => expect(onPublished).toHaveBeenCalledWith("draft-owner-1"));
  });
});
