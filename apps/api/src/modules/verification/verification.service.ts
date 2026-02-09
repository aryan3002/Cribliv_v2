import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { AppStateService } from "../../common/app-state.service";
import { DatabaseService } from "../../common/database.service";

@Injectable()
export class VerificationService {
  constructor(
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Inject(DatabaseService) private readonly database: DatabaseService
  ) {}

  async submitVideo(
    ownerId: string,
    input: { listing_id: string; artifact_blob_path: string; vendor_reference?: string }
  ) {
    if (this.database.isEnabled()) {
      const listing = await this.database.query<{ id: string }>(
        `
        SELECT id::text
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
          'pending',
          $6::jsonb
        )
        RETURNING id::text
        `,
        [
          ownerId,
          input.listing_id,
          input.vendor_reference ?? null,
          JSON.stringify({ artifact_blob_path: input.artifact_blob_path }),
          93,
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

      return { attempt_id: inserted.rows[0].id, result: "pending" };
    }

    const listing = this.appState.listings.get(input.listing_id);
    if (!listing || listing.ownerUserId !== ownerId) {
      throw new NotFoundException({ code: "not_found", message: "Listing not found" });
    }

    const attempt = {
      id: randomUUID(),
      user_id: ownerId,
      listing_id: input.listing_id,
      verification_type: "video_liveness",
      vendor_reference: input.vendor_reference ?? null,
      liveness_score: 93,
      threshold: 85,
      result: "pass",
      created_at: new Date().toISOString()
    };

    this.appState.verificationAttempts.push(attempt);
    listing.verificationStatus = "pending";
    return { attempt_id: attempt.id, result: "pending" };
  }

  async submitElectricity(
    ownerId: string,
    input: { listing_id: string; consumer_id: string; address_text: string }
  ) {
    if (this.database.isEnabled()) {
      const listing = await this.database.query<{ id: string; city: string }>(
        `
        SELECT l.id::text, c.slug AS city
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

      const score = input.address_text.toLowerCase().includes(listing.rows[0].city) ? 90 : 70;
      const result = score >= 85 ? "pass" : "manual_review";

      const inserted = await this.database.query<{ id: string }>(
        `
        INSERT INTO verification_attempts(
          user_id,
          listing_id,
          verification_type,
          submitted_payload,
          address_match_score,
          threshold,
          result,
          artifact_paths
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          'electricity_bill_match',
          $3::jsonb,
          $4,
          85.00,
          $5::verification_result,
          $6::jsonb
        )
        RETURNING id::text
        `,
        [
          ownerId,
          input.listing_id,
          JSON.stringify({ consumer_id: input.consumer_id, address_text: input.address_text }),
          score,
          result,
          JSON.stringify([])
        ]
      );

      await this.database.query(
        `
        UPDATE listings
        SET verification_status = $2::verification_status, updated_at = now()
        WHERE id = $1::uuid
        `,
        [input.listing_id, result === "pass" ? "verified" : "pending"]
      );

      return {
        attempt_id: inserted.rows[0].id,
        address_match_score: score,
        result
      };
    }

    const listing = this.appState.listings.get(input.listing_id);
    if (!listing || listing.ownerUserId !== ownerId) {
      throw new NotFoundException({ code: "not_found", message: "Listing not found" });
    }

    const score = input.address_text.toLowerCase().includes(listing.city) ? 90 : 70;
    const result = score >= 85 ? "pass" : "manual_review";

    const attempt = {
      id: randomUUID(),
      user_id: ownerId,
      listing_id: input.listing_id,
      verification_type: "electricity_bill_match",
      consumer_id: input.consumer_id,
      address_match_score: score,
      threshold: 85,
      result,
      created_at: new Date().toISOString()
    };

    this.appState.verificationAttempts.push(attempt);

    if (result === "pass") {
      listing.verificationStatus = "verified";
    }

    return {
      attempt_id: attempt.id,
      address_match_score: score,
      result
    };
  }

  async status(ownerId: string, listingId: string) {
    if (this.database.isEnabled()) {
      const listing = await this.database.query<{
        verification_status: "unverified" | "pending" | "verified" | "failed";
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
        result: "pending" | "pass" | "fail" | "manual_review";
        created_at: string;
      }>(
        `
        SELECT
          id::text,
          verification_type::text,
          vendor_reference,
          liveness_score,
          address_match_score,
          threshold,
          result::text,
          created_at::text
        FROM verification_attempts
        WHERE listing_id = $1::uuid
        ORDER BY created_at DESC
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

    const attempts = this.appState.verificationAttempts.filter((a) => a.listing_id === listingId);
    return {
      overall_status: listing.verificationStatus,
      attempts
    };
  }
}
