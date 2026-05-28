import { Injectable } from "@nestjs/common";
import {
  LivenessProviderResponse,
  ProviderCallContext,
  VerificationProviderError,
  VideoVerificationInput
} from "./provider.types";
import {
  assertVerificationProviderConfig,
  readVerificationProviderConfig
} from "./provider.config";

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function normalizeProviderResult(raw: string | undefined): LivenessProviderResponse["result"] {
  const normalized = raw?.toLowerCase() ?? "";
  if (
    normalized === "pass" ||
    normalized === "approved" ||
    normalized === "verified" ||
    normalized === "success"
  ) {
    return "pass";
  }
  if (normalized === "fail" || normalized === "failed" || normalized === "rejected") {
    return "fail";
  }
  return "manual_review";
}

function safeNumber(raw: unknown, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

@Injectable()
export class LivenessProvider {
  constructor() {
    assertVerificationProviderConfig();
  }

  evaluate(
    context: ProviderCallContext,
    input: VideoVerificationInput
  ): Promise<LivenessProviderResponse> {
    const config = readVerificationProviderConfig();
    const reference = input.vendorReference?.trim() || `live_${context.listingId}`;
    const hint = `${input.vendorReference ?? ""} ${input.artifactBlobPath}`.toLowerCase();

    if (hint.includes("timeout")) {
      throw new VerificationProviderError("Liveness provider timeout", {
        code: "provider_timeout",
        retryable: true
      });
    }

    if (hint.includes("error")) {
      throw new VerificationProviderError("Liveness provider error", {
        code: "provider_error",
        retryable: true
      });
    }

    if (hint.includes("fail")) {
      return Promise.resolve({
        provider: config.liveness.providerName,
        providerReference: reference,
        providerResultCode: "liveness_fail",
        result: "fail",
        reviewReason: "face_liveness_not_verified",
        livenessScore: 42,
        retryable: false,
        requestPayload: {
          listing_id: context.listingId,
          owner_id: context.ownerId,
          artifact_blob_path: input.artifactBlobPath,
          vendor_reference: input.vendorReference ?? null
        },
        responsePayload: {
          code: "liveness_fail",
          score: 42,
          decision: "fail"
        }
      });
    }

    if (hint.includes("manual")) {
      return Promise.resolve({
        provider: config.liveness.providerName,
        providerReference: reference,
        providerResultCode: "liveness_manual_review",
        result: "manual_review",
        reviewReason: "insufficient_signal_quality",
        livenessScore: 74,
        retryable: false,
        requestPayload: {
          listing_id: context.listingId,
          owner_id: context.ownerId,
          artifact_blob_path: input.artifactBlobPath,
          vendor_reference: input.vendorReference ?? null
        },
        responsePayload: {
          code: "liveness_manual_review",
          score: 74,
          decision: "manual_review"
        }
      });
    }

    if (!config.enabled) {
      return Promise.resolve({
        provider: config.liveness.providerName,
        providerReference: reference,
        providerResultCode: "liveness_pass",
        result: "pass",
        livenessScore: 93,
        retryable: false,
        requestPayload: {
          listing_id: context.listingId,
          owner_id: context.ownerId,
          artifact_blob_path: input.artifactBlobPath,
          vendor_reference: input.vendorReference ?? null
        },
        responsePayload: {
          code: "liveness_pass",
          score: 93,
          decision: "pass"
        }
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    return fetch(config.liveness.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.liveness.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        listing_id: context.listingId,
        owner_id: context.ownerId,
        artifact_blob_path: input.artifactBlobPath,
        vendor_reference: input.vendorReference ?? null
      }),
      signal: controller.signal
    })
      .then(async (response) => {
        const responsePayload = (await response.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        if (!response.ok) {
          throw new VerificationProviderError("Liveness provider HTTP error", {
            code: `provider_http_${response.status}`,
            retryable: response.status >= 500 || response.status === 429
          });
        }

        const result = normalizeProviderResult(
          firstString(
            responsePayload.result,
            responsePayload.decision,
            responsePayload.status,
            responsePayload.outcome
          )
        );
        const providerResultCode =
          firstString(responsePayload.result_code, responsePayload.code) ?? `liveness_${result}`;
        const reviewReason = firstString(responsePayload.review_reason, responsePayload.reason);
        const livenessScore = safeNumber(
          responsePayload.liveness_score ?? responsePayload.score ?? responsePayload.confidence,
          result === "pass" ? 90 : result === "fail" ? 35 : 70
        );
        const providerReference =
          firstString(
            responsePayload.provider_reference,
            responsePayload.reference_id,
            responsePayload.id
          ) ?? reference;

        return {
          provider: config.liveness.providerName,
          providerReference,
          providerResultCode,
          result,
          reviewReason,
          retryable: false,
          livenessScore,
          requestPayload: {
            listing_id: context.listingId,
            owner_id: context.ownerId,
            artifact_blob_path: input.artifactBlobPath,
            vendor_reference: input.vendorReference ?? null
          },
          responsePayload
        };
      })
      .catch((error: unknown) => {
        if (error instanceof VerificationProviderError) {
          throw error;
        }
        if (error instanceof Error && error.name === "AbortError") {
          throw new VerificationProviderError("Liveness provider timeout", {
            code: "provider_timeout",
            retryable: true
          });
        }
        throw new VerificationProviderError("Liveness provider network error", {
          code: "provider_network_error",
          retryable: true
        });
      })
      .finally(() => clearTimeout(timeout));
  }
}
