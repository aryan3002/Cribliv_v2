import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/admin-api", () => ({
  fetchVerificationArtifactLink: vi.fn()
}));

import { VerificationEvidence } from "../VerificationEvidence";
import { fetchVerificationArtifactLink } from "../../../../lib/admin-api";

const mockedLink = vi.mocked(fetchVerificationArtifactLink);
const onToast = vi.fn();

describe("VerificationEvidence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the score and a load button, then renders a video on fetch", async () => {
    mockedLink.mockResolvedValueOnce({ url: "https://blob/clip.mp4", expiresAt: "t" });
    render(
      <VerificationEvidence
        accessToken="tok"
        onToast={onToast}
        items={[
          {
            attempt_id: "V1",
            kind: "video_liveness",
            result: "manual_review",
            score: 82,
            threshold: 85,
            provider_result_code: "LOW_CONFIDENCE",
            review_reason: "below",
            artifact_available: true
          }
        ]}
      />
    );
    expect(screen.getByText("82")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /play liveness video/i }));
    await waitFor(() => {
      expect(mockedLink).toHaveBeenCalledWith("tok", "V1", "video_liveness");
      expect(screen.getByTestId("evidence-video")).toBeInTheDocument();
    });
  });

  it("disables loading when no artifact is available", () => {
    render(
      <VerificationEvidence
        accessToken="tok"
        onToast={onToast}
        items={[
          {
            attempt_id: "V2",
            kind: "electricity_bill_match",
            result: "pass",
            score: 91,
            threshold: 85,
            provider_result_code: null,
            review_reason: null,
            artifact_available: false
          }
        ]}
      />
    );
    expect(screen.getByText(/no artifact uploaded/i)).toBeInTheDocument();
  });
});
