import { Controller, Get, Param, Query, NotFoundException } from "@nestjs/common";
import { LandmarksService, type LandmarkType } from "./landmarks.service";
import { ok } from "../../common/response";

@Controller("landmarks")
export class LandmarksController {
  constructor(private readonly landmarks: LandmarksService) {}

  @Get(":citySlug")
  async list(@Param("citySlug") citySlug: string, @Query("type") type?: LandmarkType) {
    return ok({ items: await this.landmarks.listByCity(citySlug, type) });
  }

  @Get(":citySlug/:landmarkSlug")
  async getOne(@Param("citySlug") citySlug: string, @Param("landmarkSlug") landmarkSlug: string) {
    const landmark = await this.landmarks.findBySlug(citySlug, landmarkSlug);
    if (!landmark) throw new NotFoundException("Landmark not found");
    return ok(landmark);
  }

  @Get(":citySlug/:landmarkSlug/listings")
  async near(
    @Param("citySlug") citySlug: string,
    @Param("landmarkSlug") landmarkSlug: string,
    @Query("radius_km") radiusKm?: string,
    @Query("limit") limit?: string
  ) {
    const landmark = await this.landmarks.findBySlug(citySlug, landmarkSlug);
    if (!landmark) throw new NotFoundException("Landmark not found");
    const items = await this.landmarks.listingsNear(
      landmark,
      radiusKm ? Math.min(Number(radiusKm) || 2, 5) : 2,
      limit ? Math.min(Number(limit) || 24, 60) : 24
    );
    return ok({
      landmark: {
        slug: landmark.slug,
        name_en: landmark.name_en,
        name_hi: landmark.name_hi,
        type: landmark.type,
        lat: landmark.lat,
        lng: landmark.lng
      },
      items,
      radius_km: radiusKm ? Number(radiusKm) || 2 : 2
    });
  }
}
