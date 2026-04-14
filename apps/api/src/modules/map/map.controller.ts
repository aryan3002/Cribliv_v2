import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  ForbiddenException,
  BadRequestException
} from "@nestjs/common";
import { MapService } from "./map.service";
import { ok } from "../../common/response";
import { AuthGuard } from "../../common/auth.guard";

@Controller("map")
export class MapController {
  constructor(private readonly mapService: MapService) {}

  /* ─── Phase 2: Area Stats ──────────────────────────────────────── */

  @Get("stats")
  async getAreaStats(
    @Query()
    query: {
      sw_lat: string;
      sw_lng: string;
      ne_lat: string;
      ne_lng: string;
      listing_type?: string;
    }
  ) {
    return ok(
      await this.mapService.getAreaStats(
        Number(query.sw_lng),
        Number(query.sw_lat),
        Number(query.ne_lng),
        Number(query.ne_lat),
        query.listing_type
      )
    );
  }

  /* ─── Phase 2: Metro Stations ──────────────────────────────────── */

  @Get("metro")
  async getMetroStations(@Query("city") city?: string) {
    return ok(await this.mapService.getMetroStations(city ?? "delhi"));
  }

  /* ─── Phase 3: Seeker Pins ─────────────────────────────────────── */

  @Get("seekers")
  async getSeekerPins(
    @Query()
    query: {
      sw_lat: string;
      sw_lng: string;
      ne_lat: string;
      ne_lng: string;
    }
  ) {
    return ok(
      await this.mapService.getSeekerPins(
        Number(query.sw_lat),
        Number(query.sw_lng),
        Number(query.ne_lat),
        Number(query.ne_lng)
      )
    );
  }

  @Post("seekers")
  @UseGuards(AuthGuard)
  async createSeekerPin(
    @Req() req: { user?: { id?: string; role?: string } },
    @Body()
    body: {
      lat: number;
      lng: number;
      city?: string;
      budget_min?: number;
      budget_max: number;
      bhk_preference?: number[];
      move_in?: string;
      listing_type?: string;
      note?: string;
    }
  ) {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException("Authentication required");
    if (!body.budget_max || !body.lat || !body.lng) {
      throw new BadRequestException("lat, lng, and budget_max are required");
    }

    return ok(
      await this.mapService.createSeekerPin(userId, body.lat, body.lng, {
        city: body.city,
        budget_min: body.budget_min,
        budget_max: body.budget_max,
        bhk_preference: body.bhk_preference,
        move_in: body.move_in,
        listing_type: body.listing_type,
        note: body.note
      })
    );
  }

  @Delete("seekers/:id")
  @UseGuards(AuthGuard)
  async deleteSeekerPin(@Req() req: { user?: { id?: string } }, @Param("id") pinId: string) {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException("Authentication required");
    const deleted = await this.mapService.deleteSeekerPin(userId, pinId);
    return ok({ deleted });
  }

  @Get("seekers/near-listing")
  async seekersNearListing(@Query("listing_id") listingId: string) {
    if (!listingId) throw new BadRequestException("listing_id is required");
    return ok(await this.mapService.seekersNearListing(listingId));
  }

  /* ─── Phase 4: Locality Insight ────────────────────────────────── */

  @Get("locality-insight")
  async getLocalityInsight(
    @Query()
    query: {
      lat: string;
      lng: string;
      city?: string;
      locale?: string;
    }
  ) {
    if (!query.lat || !query.lng) throw new BadRequestException("lat and lng are required");
    return ok(
      await this.mapService.getLocalityInsight(
        Number(query.lat),
        Number(query.lng),
        query.city ?? "delhi",
        query.locale ?? "en"
      )
    );
  }

  /* ─── Phase 5: Alert Zones ─────────────────────────────────────── */

  @Get("alert-zones")
  @UseGuards(AuthGuard)
  async getAlertZones(@Req() req: { user?: { id?: string } }) {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException("Authentication required");
    return ok(await this.mapService.getAlertZones(userId));
  }

  @Post("alert-zones")
  @UseGuards(AuthGuard)
  async createAlertZone(
    @Req() req: { user?: { id?: string } },
    @Body()
    body: {
      sw_lat: number;
      sw_lng: number;
      ne_lat: number;
      ne_lng: number;
      label?: string;
      filters?: Record<string, unknown>;
      notify_whatsapp?: boolean;
      notify_email?: boolean;
    }
  ) {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException("Authentication required");
    return ok(await this.mapService.createAlertZone(userId, body));
  }

  @Delete("alert-zones/:id")
  @UseGuards(AuthGuard)
  async deleteAlertZone(@Req() req: { user?: { id?: string } }, @Param("id") zoneId: string) {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException("Authentication required");
    const deleted = await this.mapService.deleteAlertZone(userId, zoneId);
    return ok({ deleted });
  }
}
