import { Injectable } from "@nestjs/common";
import {
  ElectricityProviderResponse,
  ElectricityVerificationInput,
  ProviderCallContext,
  VerificationProviderError
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

function normalizeProviderResult(raw: string | undefined): ElectricityProviderResponse["result"] {
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
export class ElectricityProvider {
  constructor() {
    assertVerificationProviderConfig();
  }

  evaluate(
    context: ProviderCallContext,
    input: ElectricityVerificationInput
  ): Promise<ElectricityProviderResponse> {
    const config = readVerificationProviderConfig();
    const normalizedAddress = input.addressText.toLowerCase();
    const normalizedConsumer = input.consumerId.toLowerCase();

    if (normalizedConsumer.includes("timeout")) {
      throw new VerificationProviderError("Electricity provider timeout", {
        code: "provider_timeout",
        retryable: true
      });
    }

    if (normalizedConsumer.includes("error")) {
      throw new VerificationProviderError("Electricity provider error", {
        code: "provider_error",
        retryable: true
      });
    }

    if (normalizedAddress.includes("fraud") || normalizedAddress.includes("mismatch-hard")) {
      return Promise.resolve({
        provider: config.electricity.providerName,
        providerReference: `bill_${context.listingId}_${input.consumerId}`,
        providerResultCode: "address_fail",
        result: "fail",
        reviewReason: "address_match_below_threshold",
        addressMatchScore: 35,
        retryable: false,
        requestPayload: {
          listing_id: context.listingId,
          owner_id: context.ownerId,
          consumer_id: input.consumerId,
          address_text: input.addressText,
          city_slug: input.citySlug,
          bill_artifact_blob_path: input.billArtifactBlobPath ?? null
        },
        responsePayload: {
          code: "address_fail",
          score: 35,
          decision: "fail"
        }
      });
    }

    if (normalizedAddress.includes("manual")) {
      return Promise.resolve({
        provider: config.electricity.providerName,
        providerReference: `bill_${context.listingId}_${input.consumerId}`,
        providerResultCode: "address_manual_review",
        result: "manual_review",
        reviewReason: "address_similarity_uncertain",
        addressMatchScore: 70,
        retryable: false,
        requestPayload: {
          listing_id: context.listingId,
          owner_id: context.ownerId,
          consumer_id: input.consumerId,
          address_text: input.addressText,
          city_slug: input.citySlug,
          bill_artifact_blob_path: input.billArtifactBlobPath ?? null
        },
        responsePayload: {
          code: "address_manual_review",
          score: 70,
          decision: "manual_review"
        }
      });
    }

    if (!config.enabled) {
      const result = normalizedAddress.includes(input.citySlug.toLowerCase())
        ? "pass"
        : "manual_review";
      const addressMatchScore = result === "pass" ? 90 : 70;
      return Promise.resolve({
        provider: config.electricity.providerName,
        providerReference: `bill_${context.listingId}_${input.consumerId}`,
        providerResultCode: result === "pass" ? "address_pass" : "address_manual_review",
        result,
        reviewReason: result === "pass" ? undefined : "address_similarity_uncertain",
        addressMatchScore,
        retryable: false,
        requestPayload: {
          listing_id: context.listingId,
          owner_id: context.ownerId,
          consumer_id: input.consumerId,
          address_text: input.addressText,
          city_slug: input.citySlug,
          bill_artifact_blob_path: input.billArtifactBlobPath ?? null
        },
        responsePayload: {
          code: result === "pass" ? "address_pass" : "address_manual_review",
          score: addressMatchScore,
          decision: result
        }
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    return fetch(config.electricity.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.electricity.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        listing_id: context.listingId,
        owner_id: context.ownerId,
        consumer_id: input.consumerId,
        address_text: input.addressText,
        city_slug: input.citySlug,
        bill_artifact_blob_path: input.billArtifactBlobPath ?? null
      }),
      signal: controller.signal
    })
      .then(async (response) => {
        const responsePayload = (await response.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        if (!response.ok) {
          throw new VerificationProviderError("Electricity provider HTTP error", {
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
          firstString(responsePayload.result_code, responsePayload.code) ?? `address_${result}`;
        const reviewReason = firstString(responsePayload.review_reason, responsePayload.reason);
        const addressMatchScore = safeNumber(
          responsePayload.address_match_score ??
            responsePayload.match_score ??
            responsePayload.score,
          result === "pass" ? 90 : result === "fail" ? 35 : 70
        );
        const providerReference =
          firstString(
            responsePayload.provider_reference,
            responsePayload.reference_id,
            responsePayload.id
          ) ?? `bill_${context.listingId}_${input.consumerId}`;

        return {
          provider: config.electricity.providerName,
          providerReference,
          providerResultCode,
          result,
          reviewReason,
          retryable: false,
          addressMatchScore,
          requestPayload: {
            listing_id: context.listingId,
            owner_id: context.ownerId,
            consumer_id: input.consumerId,
            address_text: input.addressText,
            city_slug: input.citySlug,
            bill_artifact_blob_path: input.billArtifactBlobPath ?? null
          },
          responsePayload
        };
      })
      .catch((error: unknown) => {
        if (error instanceof VerificationProviderError) {
          throw error;
        }
        if (error instanceof Error && error.name === "AbortError") {
          throw new VerificationProviderError("Electricity provider timeout", {
            code: "provider_timeout",
            retryable: true
          });
        }
        throw new VerificationProviderError("Electricity provider network error", {
          code: "provider_network_error",
          retryable: true
        });
      })
      .finally(() => clearTimeout(timeout));
  }
}
