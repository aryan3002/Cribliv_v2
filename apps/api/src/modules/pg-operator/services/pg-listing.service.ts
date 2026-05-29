import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../../common/database.service";
import { AppStateService } from "../../../common/app-state.service";
import { OwnerService } from "../../owner/owner.service";
import { PgPropertiesService } from "./pg-properties.service";
import type { PgListingPayload } from "@cribliv/shared-types";

export interface HydrateOptions {
  idempotencyKey: string;
}

export interface ListingResult {
  /** OwnerService.createListing returns { listing_id, status }; normalize to id. */
  id: string;
  status: string;
  [k: string]: unknown;
}

/**
 * PG-specialised listing service. Composes OwnerService (for the base listing row +
 * photos) and writes pg_details + pg_room_types on top.
 *
 * Voice flow lands here via hydrateFromVoiceDraft(); replay-safe via
 * idempotency-key cache (state.pgVoiceIdempotency).
 */
@Injectable()
export class PgListingService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AppStateService) private readonly state: AppStateService,
    @Inject(OwnerService) private readonly owner: OwnerService,
    @Inject(PgPropertiesService) private readonly properties: PgPropertiesService
  ) {}

  async createDraft(
    operatorId: string,
    pgPropertyId: string,
    payload: PgListingPayload
  ): Promise<ListingResult> {
    const prop = await this.properties.getActiveProperty(operatorId);
    if (!prop || prop.id !== pgPropertyId) {
      throw new NotFoundException({
        code: "property_not_found",
        message: "property_not_found: pg_property not found for operator"
      });
    }
    if (!payload.room_types?.length) {
      throw new BadRequestException({
        code: "no_room_types",
        message: "no_room_types: at least one room type is required"
      });
    }

    const ownerDto = {
      listing_type: "pg" as const,
      pg_property_id: pgPropertyId,
      title: payload.property.display_name,
      rent: this.cheapestRentRupees(payload),
      location: {
        city: payload.property.city_slug,
        locality: payload.property.locality_slug ?? undefined
      }
    };
    const raw = (await this.owner.createListing(operatorId, ownerDto)) as Record<string, unknown>;
    // OwnerService returns { listing_id, status }; tests use mocks returning { id, status }.
    // Normalize both shapes.
    const listing: ListingResult = {
      id: (raw.id as string) ?? (raw.listing_id as string),
      status: (raw.status as string) ?? "draft",
      ...raw
    };
    await this.writePgDetails(listing.id, payload);
    await this.writeRoomTypes(listing.id, payload);
    return listing;
  }

  async hydrateFromVoiceDraft(draftId: string, opts: HydrateOptions): Promise<ListingResult> {
    const cached = this.state.getPgVoiceIdempotent(opts.idempotencyKey);
    if (cached) {
      return { id: cached, status: "draft" };
    }
    const draft = this.state.getPgListingDraft(draftId);
    if (!draft) {
      throw new NotFoundException({
        code: "draft_not_found",
        message: "draft_not_found: pg_listing_draft missing"
      });
    }
    const listing = await this.createDraft(
      draft.operator_user_id as string,
      draft.pg_property_id as string,
      draft.payload as PgListingPayload
    );
    this.state.updatePgListingDraftCommitted(draftId, listing.id);
    this.state.setPgVoiceIdempotent(opts.idempotencyKey, listing.id);
    return listing;
  }

  /** Cheapest room-type rent, expressed in rupees (OwnerService uses rupees for monthly_rent). */
  private cheapestRentRupees(p: PgListingPayload): number {
    const minPaise = Math.min(...p.room_types.map((rt) => rt.monthly_rent_paise));
    return Math.round(minPaise / 100);
  }

  private async writePgDetails(listingId: string, p: PgListingPayload): Promise<void> {
    if (!this.db.isEnabled()) return;
    const d = p.pg_details;
    await this.db.query(
      `INSERT INTO pg_details
         (listing_id, total_beds, gender_policy, tenant_type, notice_period_days, lock_in_months,
          security_deposit_paise, deposit_refundable_pct, electricity_mode, maintenance_paise,
          rent_due_day, payment_modes, late_fee_policy, price_negotiable, meals, meal_charges_paise,
          amenities, house_rules, nearby, onboarding_path)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'self_serve')
       ON CONFLICT (listing_id) DO UPDATE SET
          total_beds = EXCLUDED.total_beds`,
      [
        listingId,
        d.total_beds,
        d.gender_policy ?? null,
        d.tenant_type ?? null,
        d.notice_period_days ?? null,
        d.lock_in_months ?? null,
        d.security_deposit_paise ?? null,
        d.deposit_refundable_pct ?? null,
        d.electricity_mode ?? null,
        d.maintenance_paise ?? null,
        d.rent_due_day ?? null,
        JSON.stringify(d.payment_modes ?? []),
        d.late_fee_policy ? JSON.stringify(d.late_fee_policy) : null,
        d.price_negotiable ?? false,
        d.meals ? JSON.stringify(d.meals) : null,
        d.meal_charges_paise ?? null,
        JSON.stringify(d.amenities ?? {}),
        JSON.stringify(d.house_rules ?? {}),
        d.nearby ? JSON.stringify(d.nearby) : null
      ]
    );
  }

  private async writeRoomTypes(listingId: string, p: PgListingPayload): Promise<void> {
    if (!this.db.isEnabled()) return;
    for (const rt of p.room_types) {
      await this.db.query(
        `INSERT INTO pg_room_types
           (listing_id, sharing, ac, bathroom_kind, furnishing, room_size_sqft,
            monthly_rent_paise, vacancy_count, available_from)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (listing_id, sharing, ac, bathroom_kind, furnishing) DO UPDATE SET
            monthly_rent_paise = EXCLUDED.monthly_rent_paise,
            vacancy_count = EXCLUDED.vacancy_count,
            available_from = EXCLUDED.available_from`,
        [
          listingId,
          rt.sharing,
          rt.ac,
          rt.bathroom_kind ?? "attached_western",
          rt.furnishing ?? "semi_furnished",
          null,
          rt.monthly_rent_paise,
          rt.vacancy_count,
          rt.available_from ?? null
        ]
      );
    }
  }
}
