import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/admin-api", () => ({
  fetchAdminVerificationDetail: vi.fn(),
  fetchVerificationArtifactLink: vi.fn()
}));

import { VerificationReviewView } from "../VerificationReviewView";
import { fetchAdminVerificationDetail } from "../../../../lib/admin-api";

const mockedDetail = vi.mocked(fetchAdminVerificationDetail);

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

describe("VerificationReviewView", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders context and calls onOpenListing", async () => {
    mockedDetail.mockResolvedValueOnce(detail as any);
    const onOpenListing = vi.fn();
    render(
      <VerificationReviewView
        accessToken="tok"
        attemptId="V1"
        onBack={vi.fn()}
        onDecide={vi.fn()}
        busy={null}
        onToast={vi.fn()}
        onOpenListing={onOpenListing}
      />
    );
    await waitFor(() => expect(screen.getByText("2BHK")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /open full listing/i }));
    expect(onOpenListing).toHaveBeenCalledWith("L1");
  });
});
