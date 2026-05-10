import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { AuthGuard } from "../../common/auth.guard";
import { ok } from "../../common/response";
import { AppStateService } from "../../common/app-state.service";
import { DatabaseService } from "../../common/database.service";
import { toBlobUrl } from "../../common/photo-url";

@Controller("shortlist")
@UseGuards(AuthGuard)
export class ShortlistController {
  constructor(
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Inject(DatabaseService) private readonly database: DatabaseService
  ) {}

  @Get()
  async list(@Req() req: { user: { id: string } }): Promise<any> {
    if (this.database.isEnabled()) {
      const result = await this.database.query<{
        listing_id: string;
        title: string;
        city: string;
        locality: string | null;
        listing_type: "flat_house" | "pg";
        monthly_rent: number;
        bhk: number | null;
        furnishing: string | null;
        area_sqft: number | null;
        verification_status: "unverified" | "pending" | "verified" | "failed";
        shortlisted_at: string;
        cover_photo: string | null;
      }>(
        `
        SELECT
          l.id::text AS listing_id,
          COALESCE(NULLIF(l.title_en, ''), NULLIF(l.title_hi, ''), 'Listing') AS title,
          c.slug AS city,
          loc.slug AS locality,
          l.listing_type::text,
          l.monthly_rent,
          l.bhk,
          l.furnishing::text,
          l.area_sqft,
          l.verification_status::text,
          s.created_at::text AS shortlisted_at,
          (
            SELECT lp.blob_path
            FROM listing_photos lp
            WHERE lp.listing_id = l.id
              AND lp.moderation_status != 'rejected'
            ORDER BY lp.is_cover DESC, lp.sort_order ASC, lp.created_at ASC
            LIMIT 1
          ) AS cover_photo
        FROM shortlists s
        JOIN listings l ON l.id = s.listing_id
        JOIN listing_locations ll ON ll.listing_id = l.id
        JOIN cities c ON c.id = ll.city_id
        LEFT JOIN localities loc ON loc.id = ll.locality_id
        WHERE s.tenant_user_id = $1::uuid
        ORDER BY s.created_at DESC
        `,
        [req.user.id]
      );

      return ok({
        items: result.rows.map((row) => ({
          id: row.listing_id,
          title: row.title,
          city: row.city,
          locality: row.locality,
          listing_type: row.listing_type,
          monthly_rent: Number(row.monthly_rent),
          bhk: row.bhk,
          furnishing: row.furnishing,
          area_sqft: row.area_sqft,
          verification_status: row.verification_status,
          shortlisted_at: row.shortlisted_at,
          cover_photo: row.cover_photo ? toBlobUrl(row.cover_photo) : null
        })),
        total: result.rowCount ?? 0
      });
    }

    const ids = [...(this.appState.shortlists.get(req.user.id) ?? new Set())];
    const items = ids
      .map((id) => this.appState.listings.get(id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    return ok({ items, total: items.length });
  }

  @Post()
  async add(@Req() req: { user: { id: string } }, @Body() body: { listing_id: string }) {
    if (this.database.isEnabled()) {
      const listing = await this.database.query<{ id: string }>(
        `
        SELECT id::text
        FROM listings
        WHERE id = $1::uuid
          AND status = 'active'
        LIMIT 1
        `,
        [body.listing_id]
      );

      if (!listing.rowCount) {
        throw new NotFoundException({ code: "listing_not_found", message: "Listing not found" });
      }

      const inserted = await this.database.query<{ id: string; created_at: string }>(
        `
        INSERT INTO shortlists(tenant_user_id, listing_id)
        VALUES ($1::uuid, $2::uuid)
        ON CONFLICT (tenant_user_id, listing_id) DO NOTHING
        RETURNING id::text, created_at::text
        `,
        [req.user.id, body.listing_id]
      );

      if (!inserted.rowCount || !inserted.rows[0]) {
        throw new ConflictException({
          code: "already_shortlisted",
          message: "Already shortlisted"
        });
      }

      return ok({
        shortlist_id: inserted.rows[0].id,
        listing_id: body.listing_id,
        created_at: inserted.rows[0].created_at
      });
    }

    const listing = this.appState.listings.get(body.listing_id);
    if (!listing) {
      throw new NotFoundException({ code: "listing_not_found", message: "Listing not found" });
    }

    const current = this.appState.shortlists.get(req.user.id) ?? new Set<string>();
    if (current.has(body.listing_id)) {
      throw new ConflictException({ code: "already_shortlisted", message: "Already shortlisted" });
    }

    current.add(body.listing_id);
    this.appState.shortlists.set(req.user.id, current);

    return ok({
      shortlist_id: `${req.user.id}:${body.listing_id}`,
      listing_id: body.listing_id,
      created_at: new Date().toISOString()
    });
  }

  @Delete(":listing_id")
  async remove(@Req() req: { user: { id: string } }, @Param("listing_id") listingId: string) {
    if (this.database.isEnabled()) {
      const deleted = await this.database.query(
        `
        DELETE FROM shortlists
        WHERE tenant_user_id = $1::uuid
          AND listing_id = $2::uuid
        `,
        [req.user.id, listingId]
      );

      if (!deleted.rowCount) {
        throw new NotFoundException({ code: "not_found", message: "Shortlist item not found" });
      }

      return ok({ success: true });
    }

    const current = this.appState.shortlists.get(req.user.id) ?? new Set<string>();
    current.delete(listingId);
    this.appState.shortlists.set(req.user.id, current);
    return ok({ success: true });
  }
}
