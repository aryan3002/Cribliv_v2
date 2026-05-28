import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { AppStateService } from "../../common/app-state.service";
import { DatabaseService } from "../../common/database.service";
import { logTelemetry } from "../../common/telemetry";
import { readFeatureFlags } from "../../config/feature-flags";
import { ElectricityProvider } from "./providers/electricity.provider";
import { LivenessProvider } from "./providers/liveness.provider";
import {
  ElectricityProviderResponse,
  LivenessProviderResponse,
  VerificationProviderError
} from "./providers/provider.types";

type VerificationResult = "pending" | "pass" | "fail" | "manual_review";
type VerificationStatus = "unverified" | "pending" | "verified" | "failed";

@Injectable()
export class VerificationService {
  constructor(
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(LivenessProvider) private readonly livenessProvider: LivenessProvider,
    @Inject(ElectricityProvider) private readonly electricityProvider: ElectricityProvider
  ) {}

  async submitVideo(
    ownerId: string,
    input: { listing_id: string; artifact_blob_path: string; vendor_reference?: string }
  ) {
    if (this.database.isEnabled()) {
      const listing = await this.database.query<{
        id: string;
        verification_status: VerificationStatus;
      }>(
        `
        SELECT id::text, verification_status::text
        FROM listings
        WHERE id = $1::uuid
          AND owner_user_id = $2::uuid
        LIMIT 1
        `,
        [input.listing_id, ownerId]
      );

      if (!listing.rowCount) {
        throw new NotFoundException({ code: "not_found", message: "Listing not found" });
      }

      const providerResult = await this.getVideoProviderResult(ownerId, input);
      const inserted = await this.database.query<{ id: string }>(
        `
        INSERT INTO verification_attempts(
          user_id,
          listing_id,
          verification_type,
          vendor_reference,
          submitted_payload,
          liveness_score,
          threshold,
          result,
          failure_reason,
          artifact_paths
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          'video_liveness',
          $3,
          $4::jsonb,
          $5,
          85.00,
          $6::verification_result,
          $7,
          $8::jsonb
        )
        RETURNING id::text
        `,
        [
          ownerId,
          input.listing_id,
          providerResult.providerReference ?? input.vendor_reference ?? null,
          JSON.stringify({ artifact_blob_path: input.artifact_blob_path }),
          providerResult.livenessScore,
          providerResult.result,
          providerResult.reviewReason ?? null,
          JSON.stringify([input.artifact_blob_path])
        ]
      );

      await this.database.query(
        `
        UPDATE listings
        SET verification_status = 'pending', updated_at = now()
        WHERE id = $1::uuid
        `,
        [input.listing_id]
      );

      await this.insertProviderLog({
        attemptId: inserted.rows[0].id,
        listingId: input.listing_id,
        verificationType: "video_liveness",
        provider: providerResult.provider,
        providerReference: providerResult.providerReference,
        providerResultCode: providerResult.providerResultCode,
        result: providerResult.result,
        reviewReason: providerResult.reviewReason,
        retryable: providerResult.retryable,
        requestPayload: providerResult.requestPayload,
        responsePayload: providerResult.responsePayload
      });

      logTelemetry("verification.video_submitted", {
        listing_id: input.listing_id,
        owner_id: ownerId,
        provider: providerResult.provider,
        result: providerResult.result
      });
      logTelemetry("verification.status_transition", {
        listing_id: input.listing_id,
        previous_status: listing.rows[0].verification_status,
        new_status: "pending",
        source: "automated_verification"
      });

      return {
        attempt_id: inserted.rows[0].id,
        result: providerResult.result,
        machine_result: providerResult.result,
        liveness_score: providerResult.livenessScore,
        provider: providerResult.provider,
        provider_reference: providerResult.providerReference ?? null,
        provider_result_code: providerResult.providerResultCode,
        review_reason: providerResult.reviewReason ?? null,
        retryable: Boolean(providerResult.retryable)
      };
    }

    const listing = this.appState.listings.get(input.listing_id);
    if (!listing || listing.ownerUserId !== ownerId) {
      throw new NotFoundException({ code: "not_found", message: "Listing not found" });
    }

    const providerResult = await this.getVideoProviderResult(ownerId, input);
    const attempt = {
      id: randomUUID(),
      user_id: ownerId,
      listing_id: input.listing_id,
      verification_type: "video_liveness",
      vendor_reference: providerResult.providerReference ?? input.vendor_reference ?? null,
      liveness_score: providerResult.livenessScore,
      threshold: 85,
      result: providerResult.result,
      provider: providerResult.provider,
      provider_reference: providerResult.providerReference ?? null,
      provider_result_code: providerResult.providerResultCode,
      review_reason: providerResult.reviewReason ?? null,
      retryable: Boolean(providerResult.retryable),
      created_at: new Date().toISOString()
    };

    this.appState.verificationAttempts.push(attempt);
    const previousStatus = listing.verificationStatus;
    listing.verificationStatus = "pending";
    logTelemetry("verification.status_transition", {
      listing_id: input.listing_id,
      previous_status: previousStatus,
      new_status: "pending",
      source: "automated_verification",
      mode: "in_memory"
    });

    return {
      attempt_id: attempt.id,
      result: attempt.result,
      machine_result: attempt.result,
      liveness_score: attempt.liveness_score,
      provider: attempt.provider,
      provider_reference: attempt.provider_reference,
      provider_result_code: attempt.provider_result_code,
      review_reason: attempt.review_reason,
      retryable: attempt.retryable
    };
  }

  async submitElectricity(
    ownerId: string,
    input: {
      listing_id: string;
      consumer_id: string;
      address_text: string;
      bill_artifact_blob_path?: string;
    }
  ) {
    if (this.database.isEnabled()) {
      const listing = await this.database.query<{
        id: string;
        city: string;
        verification_status: VerificationStatus;
      }>(
        `
        SELECT l.id::text, c.slug AS city, l.verification_status::text
        FROM listings l
        JOIN listing_locations ll ON ll.listing_id = l.id
        JOIN cities c ON c.id = ll.city_id
        WHERE l.id = $1::uuid
          AND l.owner_user_id = $2::uuid
        LIMIT 1
        `,
        [input.listing_id, ownerId]
      );

      if (!listing.rowCount) {
        throw new NotFoundException({ code: "not_found", message: "Listing not found" });
      }

      const providerResult = await this.getElectricityProviderResult(ownerId, {
        ...input,
        city_slug: listing.rows[0].city
      });

      const inserted = await this.database.query<{ id: string }>(
        `
        INSERT INTO verification_attempts(
          user_id,
          listing_id,
          verification_type,
          vendor_reference,
          submitted_payload,
          address_match_score,
          threshold,
          result,
          failure_reason,
          artifact_paths
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          'electricity_bill_match',
          $3,
          $4::jsonb,
          $5,
          85.00,
          $6::verification_result,
          $7,
          $8::jsonb
        )
        RETURNING id::text
        `,
        [
          ownerId,
          input.listing_id,
          providerResult.providerReference ?? null,
          JSON.stringify({
            consumer_id: input.consumer_id,
            address_text: input.address_text
          }),
          providerResult.addressMatchScore,
          providerResult.result,
          providerResult.reviewReason ?? null,
          JSON.stringify(input.bill_artifact_blob_path ? [input.bill_artifact_blob_path] : [])
        ]
      );

      await this.database.query(
        `
        UPDATE listings
        SET verification_status = 'pending', updated_at = now()
        WHERE id = $1::uuid
        `,
        [input.listing_id]
      );

      await this.insertProviderLog({
        attemptId: inserted.rows[0].id,
        listingId: input.listing_id,
        verificationType: "electricity_bill_match",
        provider: providerResult.provider,
        providerReference: providerResult.providerReference,
        providerResultCode: providerResult.providerResultCode,
        result: providerResult.result,
        reviewReason: providerResult.reviewReason,
        retryable: providerResult.retryable,
        requestPayload: providerResult.requestPayload,
        responsePayload: providerResult.responsePayload
      });

      logTelemetry("verification.electricity_submitted", {
        listing_id: input.listing_id,
        owner_id: ownerId,
        provider: providerResult.provider,
        result: providerResult.result
      });
      logTelemetry("verification.status_transition", {
        listing_id: input.listing_id,
        previous_status: listing.rows[0].verification_status,
        new_status: "pending",
        source: "automated_verification"
      });

      return {
        attempt_id: inserted.rows[0].id,
        address_match_score: providerResult.addressMatchScore,
        result: providerResult.result,
        machine_result: providerResult.result,
        provider: providerResult.provider,
        provider_reference: providerResult.providerReference ?? null,
        provider_result_code: providerResult.providerResultCode,
        review_reason: providerResult.reviewReason ?? null,
        retryable: Boolean(providerResult.retryable)
      };
    }

    const listing = this.appState.listings.get(input.listing_id);
    if (!listing || listing.ownerUserId !== ownerId) {
      throw new NotFoundException({ code: "not_found", message: "Listing not found" });
    }

    const providerResult = await this.getElectricityProviderResult(ownerId, {
      ...input,
      city_slug: listing.city
    });

    const attempt = {
      id: randomUUID(),
      user_id: ownerId,
      listing_id: input.listing_id,
      verification_type: "electricity_bill_match",
      consumer_id: input.consumer_id,
      address_match_score: providerResult.addressMatchScore,
      threshold: 85,
      result: providerResult.result,
      provider: providerResult.provider,
      provider_reference: providerResult.providerReference ?? null,
      provider_result_code: providerResult.providerResultCode,
      review_reason: providerResult.reviewReason ?? null,
      retryable: Boolean(providerResult.retryable),
      created_at: new Date().toISOString()
    };

    this.appState.verificationAttempts.push(attempt);
    const previousStatus = listing.verificationStatus;
    listing.verificationStatus = "pending";
    logTelemetry("verification.status_transition", {
      listing_id: input.listing_id,
      previous_status: previousStatus,
      new_status: "pending",
      source: "automated_verification",
      mode: "in_memory"
    });

    return {
      attempt_id: attempt.id,
      address_match_score: attempt.address_match_score,
      result: attempt.result,
      machine_result: attempt.result,
      provider: attempt.provider,
      provider_reference: attempt.provider_reference,
      provider_result_code: attempt.provider_result_code,
      review_reason: attempt.review_reason,
      retryable: attempt.retryable
    };
  }

  async status(ownerId: string, listingId: string) {
    if (this.database.isEnabled()) {
      const listing = await this.database.query<{
        verification_status: VerificationStatus;
      }>(
        `
        SELECT verification_status::text
        FROM listings
        WHERE id = $1::uuid
          AND owner_user_id = $2::uuid
        LIMIT 1
        `,
        [listingId, ownerId]
      );

      if (!listing.rowCount || !listing.rows[0]) {
        throw new NotFoundException({ code: "not_found", message: "Listing not found" });
      }

      const attemptsResult = await this.database.query<{
        id: string;
        verification_type: "video_liveness" | "electricity_bill_match";
        vendor_reference: string | null;
        liveness_score: number | null;
        address_match_score: number | null;
        threshold: number;
        result: VerificationResult;
        created_at: string;
        provider: string | null;
        provider_reference: string | null;
        provider_result_code: string | null;
        review_reason: string | null;
        retryable: boolean | null;
        machine_result: VerificationResult | null;
      }>(
        `
        SELECT
          va.id::text,
          va.verification_type::text,
          va.vendor_reference,
          va.liveness_score,
          va.address_match_score,
          va.threshold,
          va.result::text,
          va.created_at::text,
          vpl.provider,
          vpl.provider_reference,
          vpl.provider_result_code,
          vpl.review_reason,
          vpl.retryable,
          vpl.result::text AS machine_result
        FROM verification_attempts va
        LEFT JOIN LATERAL (
          SELECT provider, provider_reference, provider_result_code, review_reason, retryable, result
          FROM verification_provider_logs
          WHERE attempt_id = va.id
          ORDER BY created_at DESC
          LIMIT 1
        ) vpl ON true
        WHERE va.listing_id = $1::uuid
        ORDER BY va.created_at DESC
        `,
        [listingId]
      );

      return {
        overall_status: listing.rows[0].verification_status,
        attempts: attemptsResult.rows
      };
    }

    const listing = this.appState.listings.get(listingId);
    if (!listing || listing.ownerUserId !== ownerId) {
      throw new NotFoundException({ code: "not_found", message: "Listing not found" });
    }

    const attempts = this.appState.verificationAttempts
      .filter((a) => a.listing_id === listingId)
      .map((attempt) => ({
        ...attempt,
        machine_result: (attempt.machine_result as VerificationResult | undefined) ?? attempt.result
      }));
    return {
      overall_status: listing.verificationStatus,
      attempts
    };
  }

  private async getVideoProviderResult(
    ownerId: string,
    input: { listing_id: string; artifact_blob_path: string; vendor_reference?: string }
  ): Promise<LivenessProviderResponse> {
    const flags = readFeatureFlags();
    const fallback = this.videoHeuristicFallback(ownerId, input, "fallback_heuristic");

    if (!flags.ff_real_verification_provider) {
      return {
        ...fallback,
        providerResultCode: "real_provider_disabled",
        retryable: false
      };
    }

    try {
      return await this.livenessProvider.evaluate(
        { listingId: input.listing_id, ownerId },
        {
          artifactBlobPath: input.artifact_blob_path,
          vendorReference: input.vendor_reference
        }
      );
    } catch (error) {
      if (error instanceof VerificationProviderError) {
        logTelemetry("verification.provider_fallback", {
          listing_id: input.listing_id,
          flow: "video_liveness",
          provider_error_code: error.code,
          retryable: error.retryable
        });
        return this.videoProviderErrorFallback(
          ownerId,
          input,
          error.code,
          error.retryable,
          error.message
        );
      }

      logTelemetry("verification.provider_fallback", {
        listing_id: input.listing_id,
        flow: "video_liveness",
        provider_error_code: "unknown_provider_error",
        retryable: true
      });
      return this.videoProviderErrorFallback(
        ownerId,
        input,
        "unknown_provider_error",
        true,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private async getElectricityProviderResult(
    ownerId: string,
    input: {
      listing_id: string;
      consumer_id: string;
      address_text: string;
      city_slug: string;
      bill_artifact_blob_path?: string;
    }
  ): Promise<ElectricityProviderResponse> {
    const flags = readFeatureFlags();
    const fallback = this.electricityHeuristicFallback(ownerId, input, "fallback_heuristic");

    if (!flags.ff_real_verification_provider) {
      return {
        ...fallback,
        providerResultCode: "real_provider_disabled",
        retryable: false
      };
    }

    try {
      return await this.electricityProvider.evaluate(
        { listingId: input.listing_id, ownerId },
        {
          consumerId: input.consumer_id,
          addressText: input.address_text,
          citySlug: input.city_slug,
          billArtifactBlobPath: input.bill_artifact_blob_path
        }
      );
    } catch (error) {
      if (error instanceof VerificationProviderError) {
        logTelemetry("verification.provider_fallback", {
          listing_id: input.listing_id,
          flow: "electricity_bill_match",
          provider_error_code: error.code,
          retryable: error.retryable
        });
        return this.electricityProviderErrorFallback(
          ownerId,
          input,
          error.code,
          error.retryable,
          error.message
        );
      }

      logTelemetry("verification.provider_fallback", {
        listing_id: input.listing_id,
        flow: "electricity_bill_match",
        provider_error_code: "unknown_provider_error",
        retryable: true
      });
      return this.electricityProviderErrorFallback(
        ownerId,
        input,
        "unknown_provider_error",
        true,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private videoHeuristicFallback(
    ownerId: string,
    input: { listing_id: string; artifact_blob_path: string; vendor_reference?: string },
    code: string
  ): LivenessProviderResponse {
    return {
      provider: "heuristic_fallback",
      providerReference: input.vendor_reference ?? `video_${input.listing_id}`,
      providerResultCode: code,
      result: "pass",
      livenessScore: 93,
      requestPayload: {
        owner_id: ownerId,
        listing_id: input.listing_id,
        artifact_blob_path: input.artifact_blob_path
      },
      responsePayload: {
        score: 93,
        decision: "pass"
      }
    };
  }

  private electricityHeuristicFallback(
    ownerId: string,
    input: { listing_id: string; consumer_id: string; address_text: string; city_slug: string },
    code: string
  ): ElectricityProviderResponse {
    const score = input.address_text.toLowerCase().includes(input.city_slug.toLowerCase())
      ? 90
      : 70;
    const result: "pass" | "manual_review" = score >= 85 ? "pass" : "manual_review";

    return {
      provider: "heuristic_fallback",
      providerReference: `electricity_${input.listing_id}_${input.consumer_id}`,
      providerResultCode: code,
      result,
      reviewReason: result === "pass" ? undefined : "address_similarity_uncertain",
      addressMatchScore: score,
      requestPayload: {
        owner_id: ownerId,
        listing_id: input.listing_id,
        consumer_id: input.consumer_id,
        address_text: input.address_text,
        city_slug: input.city_slug
      },
      responsePayload: {
        score,
        decision: result
      }
    };
  }

  private videoProviderErrorFallback(
    ownerId: string,
    input: { listing_id: string; artifact_blob_path: string; vendor_reference?: string },
    code: string,
    retryable: boolean,
    errorMessage: string
  ): LivenessProviderResponse {
    return {
      provider: process.env.LIVENESS_PROVIDER_NAME?.trim() || "liveness_provider",
      providerReference: input.vendor_reference ?? `video_${input.listing_id}`,
      providerResultCode: code,
      result: "manual_review",
      reviewReason: `provider_fallback:${code}`,
      livenessScore: 0,
      retryable,
      requestPayload: {
        owner_id: ownerId,
        listing_id: input.listing_id,
        artifact_blob_path: input.artifact_blob_path
      },
      responsePayload: {
        provider_error: errorMessage
      }
    };
  }

  private electricityProviderErrorFallback(
    ownerId: string,
    input: { listing_id: string; consumer_id: string; address_text: string; city_slug: string },
    code: string,
    retryable: boolean,
    errorMessage: string
  ): ElectricityProviderResponse {
    return {
      provider: process.env.ELECTRICITY_PROVIDER_NAME?.trim() || "electricity_provider",
      providerReference: `electricity_${input.listing_id}_${input.consumer_id}`,
      providerResultCode: code,
      result: "manual_review",
      reviewReason: `provider_fallback:${code}`,
      addressMatchScore: 0,
      retryable,
      requestPayload: {
        owner_id: ownerId,
        listing_id: input.listing_id,
        consumer_id: input.consumer_id,
        address_text: input.address_text,
        city_slug: input.city_slug
      },
      responsePayload: {
        provider_error: errorMessage
      }
    };
  }

  private maskSensitiveValue(key: string, value: unknown): unknown {
    if (value === null || value === undefined) {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.maskSensitiveValue(key, item));
    }
    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const masked: Record<string, unknown> = {};
      for (const [childKey, childValue] of Object.entries(obj)) {
        masked[childKey] = this.maskSensitiveValue(childKey, childValue);
      }
      return masked;
    }
    if (typeof value !== "string") {
      return value;
    }

    const normalizedKey = key.toLowerCase();
    if (normalizedKey.includes("consumer")) {
      const tail = value.slice(-4);
      return tail ? `***${tail}` : "***";
    }
    if (normalizedKey.includes("address")) {
      return value ? `[redacted_address_${value.length}]` : value;
    }
    if (
      normalizedKey.includes("owner") ||
      normalizedKey.includes("user") ||
      normalizedKey.includes("person") ||
      normalizedKey.includes("name")
    ) {
      return value ? "[redacted_person]" : value;
    }

    return value;
  }

  private maskPayload(payload: Record<string, unknown>) {
    return this.maskSensitiveValue("root", payload) as Record<string, unknown>;
  }

  private async insertProviderLog(input: {
    attemptId: string;
    listingId: string;
    verificationType: "video_liveness" | "electricity_bill_match";
    provider: string;
    providerReference?: string;
    providerResultCode: string;
    result: VerificationResult;
    reviewReason?: string;
    retryable?: boolean;
    requestPayload: Record<string, unknown>;
    responsePayload: Record<string, unknown>;
  }) {
    if (!this.database.isEnabled()) {
      return;
    }

    const maskedRequestPayload = this.maskPayload(input.requestPayload);
    const maskedResponsePayload = this.maskPayload(input.responsePayload);

    await this.database.query(
      `
      INSERT INTO verification_provider_logs(
        attempt_id,
        listing_id,
        verification_type,
        provider,
        provider_reference,
        provider_result_code,
        result,
        review_reason,
        retryable,
        request_payload,
        response_payload
      )
      VALUES (
        $1::uuid,
        $2::uuid,
        $3::verification_type,
        $4,
        $5,
        $6,
        $7::verification_result,
        $8,
        $9,
        $10::jsonb,
        $11::jsonb
      )
      `,
      [
        input.attemptId,
        input.listingId,
        input.verificationType,
        input.provider,
        input.providerReference ?? null,
        input.providerResultCode,
        input.result,
        input.reviewReason ?? null,
        Boolean(input.retryable),
        JSON.stringify(maskedRequestPayload),
        JSON.stringify(maskedResponsePayload)
      ]
    );
  }
}
