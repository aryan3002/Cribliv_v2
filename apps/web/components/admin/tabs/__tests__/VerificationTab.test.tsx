import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/admin-api", () => ({
  fetchAdminVerifications: vi.fn(),
  decideAdminVerification: vi.fn(),
  fetchAdminVerificationDetail: vi.fn(),
  fetchVerificationArtifactLink: vi.fn()
}));

import { VerificationTab } from "../VerificationTab";
import { fetchAdminVerifications, fetchAdminVerificationDetail } from "../../../../lib/admin-api";

const mockedList = vi.mocked(fetchAdminVerifications);
const mockedDetail = vi.mocked(fetchAdminVerificationDetail);

const listItem = {
  id: "V1",
  listingId: "L1",
  userId: "U1234567890",
  verificationType: "video_liveness" as const,
  result: "manual_review" as const,
  machineResult: "manual_review" as const,
  addressMatchScore: undefined,
  livenessScore: 82,
  provider: "mock",
  providerReference: "lv_9",
  providerResultCode: "LOW_CONFIDENCE",
  reviewReason: "below",
  retryable: true,
  threshold: 85,
  createdAt: "2026-07-12T10:00:00.000Z"
};

const detail = {
  attempt_id: "V1",
  kind: "video_liveness",
  result: "manual_review",
  liveness_score: 82,
  address_match_score: null,
  threshold: 85,
  provider: "mock",
  provider_reference: "lv_9",
  provider_result_code: "LOW_CONFIDENCE",
  review_reason: "below",
  retryable: true,
  artifact_available: true,
  created_at: "2026-07-12T10:05:00.000Z",
  listing: { id: "L1", title: "2BHK", address: "142, 5th Cross" },
  owner: {
    id: "O1",
    name: "Ramesh Kumar",
    phone: "+919876543210",
    whatsapp_opt_in: true,
    member_since: null
  }
};

describe("VerificationTab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens the detail view when a row is clicked and jumps to the listing", async () => {
    mockedList.mockResolvedValueOnce({ items: [listItem], total: 1 } as any);
    mockedDetail.mockResolvedValueOnce(detail as any);
    const onOpenListing = vi.fn();

    render(
      <VerificationTab
        accessToken="tok"
        onToast={vi.fn()}
        onCountChange={vi.fn()}
        onOpenListing={onOpenListing}
      />
    );

    await waitFor(() => expect(screen.getByText(/live 82/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/live 82/));

    await waitFor(() =>
      expect(screen.getByText(/back to verification queue/i)).toBeInTheDocument()
    );
    await waitFor(() => expect(screen.getByText("2BHK")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /open full listing/i }));
    expect(onOpenListing).toHaveBeenCalledWith("L1");
  });
});
