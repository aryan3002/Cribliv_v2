import { Inject, Injectable, Logger } from "@nestjs/common";
import { AppStateService } from "../../common/app-state.service";
import { DatabaseService } from "../../common/database.service";
import { toBlobUrl } from "../../common/photo-url";
import { VerificationArtifactSasIssuer } from "./verification-artifact-sas.issuer";

export interface AdminListingPhoto {
  url: string | null;
  is_cover: boolean;
  sort_order: number;
  moderation_status: string;
}

export interface AdminReviewOwner {
  id: string;
  name: string | null;
  phone: string | null;
  whatsapp_opt_in: boolean;
  preferred_language: string | null;
  role: string;
  is_blocked: boolean;
  member_since: string | null;
  active_listings: number;
  report_count: number;
}

export interface AdminReviewEvidence {
  attempt_id: string;
  kind: string; // verification_type
  result: string;
  liveness_score: number | null;
  address_match_score: number | null;
  threshold: number;
  provider: string | null;
  provider_result_code: string | null;
  review_reason: string | null;
  artifact_available: boolean;
  created_at: string;
}

export interface AdminListingDetail {
  listing: Record<string, unknown>;
  location: Record<string, unknown> | null;
  owner: AdminReviewOwner;
  photos: AdminListingPhoto[];
  pg: { details: Record<string, unknown> | null; rooms: Record<string, unknown>[] } | null;
  verification: AdminReviewEvidence[];
}

export interface AdminVerificationDetail {
  attempt_id: string;
  kind: string;
  result: string;
  liveness_score: number | null;
  address_match_score: number | null;
  threshold: number;
  provider: string | null;
  provider_reference: string | null;
  provider_result_code: string | null;
  review_reason: string | null;
  retryable: boolean | null;
  artifact_available: boolean;
  created_at: string;
  listing: { id: string | null; title: string | null; address: string | null };
  owner: {
    id: string;
    name: string | null;
    phone: string | null;
    whatsapp_opt_in: boolean;
    member_since: string | null;
  };
}

@Injectable()
export class AdminReviewService {
  private readonly logger = new Logger(AdminReviewService.name);
  private static readonly KIND_TO_TYPE: Record<string, string> = Object.assign(
    Object.create(null),
    {
      video_liveness: "video_liveness",
      electricity_bill: "electricity_bill_match"
    }
  );

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Inject(VerificationArtifactSasIssuer)
    private readonly sas: VerificationArtifactSasIssuer
  ) {}

  async getListingDetail(listingId: string): Promise<AdminListingDetail | null> {
    if (!this.database.isEnabled()) {
      return this.getListingDetailInMemory(listingId);
    }

    const main = await this.database.query<any>(
      `
      SELECT
        l.id::text, l.listing_type::text, l.title_en, l.title_hi,
        l.description_en, l.description_hi, l.status::text, l.verification_status::text,
        l.monthly_rent, l.security_deposit, l.available_from::text, l.furnishing::text,
        l.bhk, l.bathrooms, l.area_sqft, l.preferred_tenant::text, l.whatsapp_available,
        l.amenities, l.rules, l.created_at::text,
        ll.address_line1, ll.landmark, ll.pincode, ll.lat, ll.lng, ll.masked_address,
        loc.name_en AS locality_name, c.slug AS city_slug, c.name_en AS city_name,
        u.id::text AS owner_id, u.full_name AS owner_name, u.phone_e164 AS owner_phone,
        u.whatsapp_opt_in AS owner_whatsapp, u.preferred_language::text AS owner_language,
        u.role::text AS owner_role, u.is_blocked AS owner_blocked, u.created_at::text AS owner_created_at
      FROM listings l
      LEFT JOIN listing_locations ll ON ll.listing_id = l.id
      LEFT JOIN cities c ON c.id = ll.city_id
      LEFT JOIN localities loc ON loc.id = ll.locality_id
      JOIN users u ON u.id = l.owner_user_id
      WHERE l.id = $1::uuid
      `,
      [listingId]
    );
    const row = main.rows[0];
    if (!row) return null;

    const agg = await this.database.query<{ active_listings: number; report_count: number }>(
      `
      SELECT
        count(*) FILTER (WHERE status = 'active')::int AS active_listings,
        COALESCE(sum(report_count)::int, 0) AS report_count
      FROM listings WHERE owner_user_id = $1::uuid
      `,
      [row.owner_id]
    );

    const photos = await this.database.query<any>(
      `
      SELECT blob_path, is_cover, sort_order, moderation_status::text
      FROM listing_photos
      WHERE listing_id = $1::uuid AND moderation_status != 'rejected'
      ORDER BY is_cover DESC, sort_order ASC, created_at ASC
      `,
      [listingId]
    );

    let pg: AdminListingDetail["pg"] = null;
    if (row.listing_type === "pg") {
      const details = await this.database.query<any>(
        `
        SELECT total_beds, occupancy_type::text, gender_policy::text, tenant_type::text,
               food_included, curfew_time::text, attached_bathroom, notice_period_days,
               lock_in_months, electricity_mode::text, meals, house_rules, amenities
        FROM pg_details WHERE listing_id = $1::uuid
        `,
        [listingId]
      );
      const rooms = await this.database.query<any>(
        `
        SELECT sharing::text, ac, bathroom_kind::text, furnishing::text,
               monthly_rent_paise, vacancy_count, available_from::text
        FROM pg_room_types WHERE listing_id = $1::uuid
        ORDER BY monthly_rent_paise ASC
        `,
        [listingId]
      );
      pg = { details: details.rows[0] ?? null, rooms: rooms.rows };
    }

    const attempts = await this.database.query<any>(
      `
      SELECT DISTINCT ON (va.verification_type)
        va.id::text AS id, va.verification_type::text AS verification_type, va.result::text AS result,
        va.liveness_score, va.address_match_score, va.threshold, va.artifact_paths,
        va.created_at::text AS created_at,
        vpl.provider, vpl.provider_result_code, vpl.review_reason
      FROM verification_attempts va
      LEFT JOIN LATERAL (
        SELECT provider, provider_result_code, review_reason
        FROM verification_provider_logs
        WHERE attempt_id = va.id ORDER BY created_at DESC LIMIT 1
      ) vpl ON true
      WHERE va.listing_id = $1::uuid
      ORDER BY va.verification_type, va.created_at DESC
      `,
      [listingId]
    );

    return {
      listing: {
        id: row.id,
        listing_type: row.listing_type,
        title_en: row.title_en,
        title_hi: row.title_hi,
        description_en: row.description_en,
        description_hi: row.description_hi,
        status: row.status,
        verification_status: row.verification_status,
        monthly_rent: row.monthly_rent,
        security_deposit: row.security_deposit,
        available_from: row.available_from,
        furnishing: row.furnishing,
        bhk: row.bhk,
        bathrooms: row.bathrooms,
        area_sqft: row.area_sqft,
        preferred_tenant: row.preferred_tenant,
        whatsapp_available: row.whatsapp_available,
        amenities: row.amenities ?? [],
        rules: row.rules ?? {},
        created_at: row.created_at
      },
      location: {
        address_line1: row.address_line1,
        landmark: row.landmark,
        pincode: row.pincode,
        lat: row.lat,
        lng: row.lng,
        masked_address: row.masked_address,
        locality_name: row.locality_name,
        city_slug: row.city_slug,
        city_name: row.city_name
      },
      owner: {
        id: row.owner_id,
        name: row.owner_name,
        phone: row.owner_phone,
        whatsapp_opt_in: Boolean(row.owner_whatsapp),
        preferred_language: row.owner_language,
        role: row.owner_role,
        is_blocked: Boolean(row.owner_blocked),
        member_since: row.owner_created_at,
        active_listings: agg.rows[0]?.active_listings ?? 0,
        report_count: agg.rows[0]?.report_count ?? 0
      },
      photos: photos.rows.map((p) => ({
        url: toBlobUrl(p.blob_path),
        is_cover: Boolean(p.is_cover),
        sort_order: p.sort_order,
        moderation_status: p.moderation_status
      })),
      pg,
      verification: attempts.rows.map((a) => this.toEvidence(a))
    };
  }

  async getVerificationDetail(attemptId: string): Promise<AdminVerificationDetail | null> {
    if (!this.database.isEnabled()) return null;
    const res = await this.database.query<any>(
      `
      SELECT
        va.id::text AS id, va.listing_id::text AS listing_id, va.user_id::text AS user_id,
        va.verification_type::text AS verification_type, va.result::text AS result,
        va.liveness_score, va.address_match_score, va.threshold, va.artifact_paths,
        va.created_at::text AS created_at,
        vpl.provider, vpl.provider_reference, vpl.provider_result_code, vpl.review_reason, vpl.retryable,
        COALESCE(NULLIF(l.title_en, ''), NULLIF(l.title_hi, ''), 'Listing') AS listing_title,
        ll.address_line1 AS listing_address,
        u.full_name AS owner_name, u.phone_e164 AS owner_phone,
        u.whatsapp_opt_in AS owner_whatsapp, u.created_at::text AS owner_created_at
      FROM verification_attempts va
      LEFT JOIN LATERAL (
        SELECT provider, provider_reference, provider_result_code, review_reason, retryable
        FROM verification_provider_logs
        WHERE attempt_id = va.id ORDER BY created_at DESC LIMIT 1
      ) vpl ON true
      LEFT JOIN listings l ON l.id = va.listing_id
      LEFT JOIN listing_locations ll ON ll.listing_id = va.listing_id
      JOIN users u ON u.id = va.user_id
      WHERE va.id = $1::uuid
      `,
      [attemptId]
    );
    const a = res.rows[0];
    if (!a) return null;
    const paths = Array.isArray(a.artifact_paths) ? a.artifact_paths : [];
    return {
      attempt_id: a.id,
      kind: a.verification_type,
      result: a.result,
      liveness_score: a.liveness_score,
      address_match_score: a.address_match_score,
      threshold: Number(a.threshold),
      provider: a.provider ?? null,
      provider_reference: a.provider_reference ?? null,
      provider_result_code: a.provider_result_code ?? null,
      review_reason: a.review_reason ?? null,
      retryable: a.retryable ?? null,
      artifact_available: paths.length > 0,
      created_at: a.created_at,
      listing: { id: a.listing_id, title: a.listing_title, address: a.listing_address },
      owner: {
        id: a.user_id,
        name: a.owner_name,
        phone: a.owner_phone,
        whatsapp_opt_in: Boolean(a.owner_whatsapp),
        member_since: a.owner_created_at
      }
    };
  }

  async getVerificationArtifactLink(
    attemptId: string,
    kind: string,
    adminUserId: string
  ): Promise<{ url: string; expires_at: string } | null> {
    if (!this.database.isEnabled()) return null;
    const expectedType = AdminReviewService.KIND_TO_TYPE[kind];
    if (!expectedType) return null;

    const res = await this.database.query<{ verification_type: string; artifact_paths: unknown }>(
      `SELECT verification_type::text, artifact_paths FROM verification_attempts WHERE id = $1::uuid`,
      [attemptId]
    );
    const row = res.rows[0];
    if (!row || row.verification_type !== expectedType) return null;

    const paths = Array.isArray(row.artifact_paths) ? (row.artifact_paths as string[]) : [];
    const blobPath = paths[0];
    if (!blobPath) return null;

    const ttl = Number(process.env.VERIFICATION_ARTIFACT_SAS_TTL_SECONDS) || 600;
    const issued = this.sas.issue(blobPath, ttl);
    if (!issued) return null;

    this.logger.log(
      `admin ${adminUserId} viewed verification artifact attempt=${attemptId} kind=${kind}`
    );

    await this.database
      .query(
        `
        INSERT INTO admin_actions(admin_user_id, target_type, target_id, action, reason, before_state, after_state)
        VALUES ($1::uuid, 'verification_attempt', $2::uuid, 'verification_artifact_view'::admin_action_type, $3, null, null)
        `,
        [adminUserId, attemptId, `kind=${kind}`]
      )
      .catch(() => undefined); // admin_actions insert is best-effort; must not block the artifact link

    return { url: issued.url, expires_at: issued.expiresAt };
  }

  private toEvidence(a: any): AdminReviewEvidence {
    const paths = Array.isArray(a.artifact_paths) ? a.artifact_paths : [];
    return {
      attempt_id: a.id,
      kind: a.verification_type,
      result: a.result,
      liveness_score: a.liveness_score,
      address_match_score: a.address_match_score,
      threshold: Number(a.threshold),
      provider: a.provider ?? null,
      provider_result_code: a.provider_result_code ?? null,
      review_reason: a.review_reason ?? null,
      artifact_available: paths.length > 0,
      created_at: a.created_at
    };
  }

  private getListingDetailInMemory(listingId: string): AdminListingDetail | null {
    const l = this.appState.listings.get(listingId);
    if (!l) return null;
    const u = this.appState.users.get(l.ownerUserId);
    return {
      listing: {
        id: l.id,
        listing_type: l.listingType,
        title_en: l.title,
        title_hi: null,
        description_en: null,
        description_hi: null,
        status: l.status,
        verification_status: l.verificationStatus,
        monthly_rent: l.monthlyRent,
        security_deposit: null,
        available_from: null,
        furnishing: l.furnishing ?? null,
        bhk: null,
        bathrooms: null,
        area_sqft: null,
        preferred_tenant: null,
        whatsapp_available: false,
        amenities: l.amenities ?? [],
        rules: {},
        created_at: new Date(l.createdAt).toISOString()
      },
      location: { city_name: l.city ?? null, locality_name: l.locality ?? null } as any,
      owner: {
        id: l.ownerUserId,
        name: (u as any)?.full_name ?? null,
        phone: (u as any)?.phone ?? null,
        whatsapp_opt_in: Boolean((u as any)?.whatsapp_opt_in),
        preferred_language: (u as any)?.preferred_language ?? null,
        role: (u as any)?.role ?? "owner",
        is_blocked: false,
        member_since: null,
        active_listings: 0,
        report_count: 0
      },
      photos: [],
      pg: null,
      verification: []
    };
  }
}
