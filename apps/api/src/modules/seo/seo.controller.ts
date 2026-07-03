import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { SeoAggregatesService } from "./seo-aggregates.service";
import { SeoCopyService } from "./seo-copy.service";
import { ok } from "../../common/response";
import { AuthGuard } from "../../common/auth.guard";
import { CopyInputsDto } from "./dto/copy-inputs.dto";

@Controller("seo")
export class SeoController {
  constructor(
    private readonly aggregates: SeoAggregatesService,
    private readonly copy: SeoCopyService
  ) {}

  @Get("localities/:citySlug")
  async listLocalities(@Param("citySlug") citySlug: string) {
    return ok({ items: await this.aggregates.localitiesForCity(citySlug) });
  }

  @Get("localities/:citySlug/:localitySlug")
  async getLocality(
    @Param("citySlug") citySlug: string,
    @Param("localitySlug") localitySlug: string
  ) {
    const locality = await this.aggregates.findLocality(citySlug, localitySlug);
    if (!locality) return ok(null);
    const aggregates = await this.aggregates.aggregatesForLocality(citySlug, localitySlug);
    return ok({ locality, aggregates });
  }

  @Get("metro/:city/:stationSlug")
  async getMetro(
    @Param("city") city: string,
    @Param("stationSlug") stationSlug: string,
    @Query("radius_km") radiusKm?: string
  ) {
    const station = await this.aggregates.findMetroStation(city, stationSlug);
    if (!station) return ok(null);
    const aggregates = await this.aggregates.aggregatesNearPoint(
      station.lat,
      station.lng,
      radiusKm ? Math.min(Number(radiusKm) || 1.5, 3) : 1.5
    );
    return ok({ station, aggregates });
  }

  @UseGuards(AuthGuard)
  @Post("copy")
  async generateCopy(@Body() body: CopyInputsDto) {
    return ok(await this.copy.getOrGenerate(body));
  }

  @UseGuards(AuthGuard)
  @Post("copy/regenerate-expired")
  async regenerate() {
    return ok({ cleared: await this.copy.regenerateExpired(50) });
  }
}
