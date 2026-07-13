import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VerificationClient } from "../verification-client";
import {
  fetchVerificationStatus,
  listOwnerListings,
  submitElectricityVerification,
  submitVideoVerification,
  uploadVerificationArtifact,
  type OwnerListingVm,
  type VerificationStatusVm
} from "../../../lib/owner-api";
import { trackEvent } from "../../../lib/analytics";

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      accessToken: "owner-token",
      user: { name: "Asha Owner", role: "owner" }
    },
    status: "authenticated"
  })
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams()
}));

vi.mock("../../../lib/analytics", () => ({
  trackEvent: vi.fn()
}));

vi.mock("../../../lib/owner-api", () => ({
  fetchVerificationStatus: vi.fn(),
  isVerificationUploadAbortError: vi.fn(
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name?: unknown }).name === "AbortError"
  ),
  listOwnerListings: vi.fn(),
  submitElectricityVerification: vi.fn(),
  submitVideoVerification: vi.fn(),
  uploadVerificationArtifact: vi.fn()
}));

const listOwnerListingsMock = vi.mocked(listOwnerListings);
const fetchVerificationStatusMock = vi.mocked(fetchVerificationStatus);
const submitVideoVerificationMock = vi.mocked(submitVideoVerification);
const submitElectricityVerificationMock = vi.mocked(submitElectricityVerification);
const uploadVerificationArtifactMock = vi.mocked(uploadVerificationArtifact);
const trackEventMock = vi.mocked(trackEvent);
const ownerWorkspaceCss = readFileSync(
  resolve(process.cwd(), "components/owner/owner-workspace.css"),
  "utf8"
);

function listing(overrides: Partial<OwnerListingVm> = {}): OwnerListingVm {
  return {
    id: "listing-1",
    title: "Koregaon Studio",
    city: "Pune",
    locality: "Koregaon Park",
    listingType: "flat_house",
    monthlyRent: 28000,
    status: "active",
    verificationStatus: "unverified",
    createdAt: "2026-07-11T00:00:00.000Z",
    ...overrides
  };
}

function verificationStatus(overrides: Partial<VerificationStatusVm> = {}): VerificationStatusVm {
  return {
    overallStatus: "unverified",
    attempts: [],
    ...overrides
  };
}

function videoFile() {
  return new File(
    [new Uint8Array([0x00, 0x00, 0x00, 0x14]), "ftypisom", new Uint8Array([0x00])],
    "video-proof.mp4",
    { type: "video/mp4", lastModified: 1234 }
  );
}

function billFile() {
  return new File(["%PDF-1.7\n"], "bill.pdf", {
    type: "application/pdf",
    lastModified: 1234
  });
}

async function renderClient(locale: "en" | "hi" = "en") {
  render(<VerificationClient locale={locale} />);
  await screen.findByRole("combobox", { name: /listing|लिस्टिंग/i });
}

beforeEach(() => {
  vi.clearAllMocks();
  listOwnerListingsMock.mockResolvedValue({
    items: [listing()],
    total: 1
  });
  fetchVerificationStatusMock.mockResolvedValue(verificationStatus());
  uploadVerificationArtifactMock.mockResolvedValue({
    blobPath: "listing-1/verification/video_liveness/video-proof.mp4"
  });
  submitVideoVerificationMock.mockResolvedValue({
    attemptId: "attempt-video",
    result: "pending",
    machineResult: "pending",
    provider: "mock_liveness",
    providerReference: "lv-1",
    providerResultCode: "queued",
    reviewReason: null,
    retryable: false
  });
  submitElectricityVerificationMock.mockResolvedValue({
    attemptId: "attempt-bill",
    result: "manual_review",
    machineResult: "manual_review",
    addressMatchScore: 71,
    provider: "mock_electricity",
    providerReference: "el-1",
    providerResultCode: "queued",
    reviewReason: null,
    retryable: true
  });
});

describe("VerificationClient", () => {
  it("shows only one verification method at a time on mobile", async () => {
    await renderClient();

    expect(screen.getByRole("heading", { name: /video verification/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /electricity verification/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /electricity bill/i }));

    expect(screen.getByRole("heading", { name: /electricity verification/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /video verification/i })).toBeNull();
  });

  it("uploads video before submitting its blob path", async () => {
    await renderClient();

    fireEvent.change(screen.getByLabelText(/upload verification video/i), {
      target: { files: [videoFile()] }
    });

    await waitFor(() =>
      expect(uploadVerificationArtifactMock).toHaveBeenCalledWith(
        "owner-token",
        expect.objectContaining({
          listingId: "listing-1",
          kind: "video_liveness",
          file: expect.objectContaining({ name: "video-proof.mp4", type: "video/mp4" })
        })
      )
    );

    fireEvent.click(screen.getByRole("button", { name: /submit video verification/i }));

    await waitFor(() =>
      expect(submitVideoVerificationMock).toHaveBeenCalledWith("owner-token", {
        listingId: "listing-1",
        artifactBlobPath: "listing-1/verification/video_liveness/video-proof.mp4",
        vendorReference: undefined
      })
    );
    expect(trackEventMock).toHaveBeenCalledWith("verification_video_submitted", {
      attempt_id: "attempt-video",
      result: "pending"
    });
  });

  it("aborts an in-flight video upload when the file is removed", async () => {
    let uploadSignal: AbortSignal | undefined;
    uploadVerificationArtifactMock.mockImplementationOnce(
      async (_token, input: Parameters<typeof uploadVerificationArtifact>[1]) => {
        uploadSignal = input.signal;
        return new Promise<{ blobPath: string }>((_resolve, reject) => {
          input.signal?.addEventListener("abort", () => {
            const error = new Error("Upload aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      }
    );

    await renderClient();

    fireEvent.change(screen.getByLabelText(/upload verification video/i), {
      target: { files: [videoFile()] }
    });

    await waitFor(() => expect(uploadSignal).toBeDefined());
    expect(uploadSignal?.aborted).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /remove/i }));

    await waitFor(() => expect(uploadSignal?.aborted).toBe(true));
    expect(screen.getByText(/no file selected/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("uploads an optional electricity bill before submission", async () => {
    uploadVerificationArtifactMock.mockResolvedValueOnce({
      blobPath: "listing-1/verification/electricity_bill/bill.pdf"
    });

    await renderClient();

    fireEvent.click(screen.getByRole("button", { name: /electricity bill/i }));
    fireEvent.change(screen.getByLabelText(/consumer id/i), {
      target: { value: "CA1234567" }
    });
    fireEvent.change(screen.getByLabelText(/address text/i), {
      target: { value: "Koregaon Park, Pune" }
    });
    fireEvent.change(screen.getByLabelText(/upload electricity bill/i), {
      target: { files: [billFile()] }
    });

    await waitFor(() =>
      expect(uploadVerificationArtifactMock).toHaveBeenCalledWith(
        "owner-token",
        expect.objectContaining({
          listingId: "listing-1",
          kind: "electricity_bill",
          file: expect.objectContaining({ name: "bill.pdf", type: "application/pdf" })
        })
      )
    );

    fireEvent.click(screen.getByRole("button", { name: /submit electricity verification/i }));

    await waitFor(() =>
      expect(submitElectricityVerificationMock).toHaveBeenCalledWith("owner-token", {
        listingId: "listing-1",
        consumerId: "CA1234567",
        addressText: "Koregaon Park, Pune",
        billArtifactBlobPath: "listing-1/verification/electricity_bill/bill.pdf"
      })
    );
  });

  it("renders current status before method controls", async () => {
    fetchVerificationStatusMock.mockResolvedValueOnce(
      verificationStatus({
        overallStatus: "pending",
        attempts: [
          {
            id: "attempt-1",
            verificationType: "video_liveness",
            result: "manual_review",
            machineResult: "manual_review",
            livenessScore: 76,
            addressMatchScore: null,
            provider: "mock_liveness",
            providerReference: "live-ref-1",
            providerResultCode: "queued",
            reviewReason: "Needs clearer video",
            retryable: true,
            threshold: 85,
            createdAt: "2026-07-12T08:30:00.000Z"
          }
        ]
      })
    );

    await renderClient();

    const currentStatus = await screen.findByTestId("verification-current-status");
    const methods = screen.getByTestId("verification-methods");

    expect(currentStatus.compareDocumentPosition(methods)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(within(currentStatus).getByText(/verification in progress/i)).toBeInTheDocument();
    expect(within(currentStatus).getByText(/mock_liveness/i)).toBeInTheDocument();
  });

  it("renders submission history without fixed-width overflow", async () => {
    fetchVerificationStatusMock.mockResolvedValueOnce(
      verificationStatus({
        overallStatus: "pending",
        attempts: [
          {
            id: "attempt-1",
            verificationType: "electricity_bill_match",
            result: "manual_review",
            machineResult: "manual_review",
            livenessScore: null,
            addressMatchScore: 71,
            provider: "mock_electricity",
            providerReference:
              "electricity-provider-reference-with-a-very-long-unbroken-value-1234567890",
            providerResultCode: "queued_for_manual_review",
            reviewReason: "Address match needs admin review",
            retryable: true,
            threshold: 85,
            createdAt: "2026-07-12T08:30:00.000Z"
          }
        ]
      })
    );

    await renderClient();

    const history = await screen.findByTestId("verification-history");
    expect(history).toHaveTextContent(/submission history/i);
    expect(history).toHaveTextContent(/electricity-provider-reference/i);
    expect(ownerWorkspaceCss).toMatch(/\.ovc-history__item\s*\{[^}]*min-width:\s*0;/s);
    expect(ownerWorkspaceCss).toMatch(/\.ovc-history__value\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
  });
});
