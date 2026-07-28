import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { SeoAggregatesService } from "./seo-aggregates.service";
import { SeoPlacesService } from "./seo-places.service";
import { SeoCityConfigService } from "./seo-city-config.service";
import { SeoCopyService } from "./seo-copy.service";
import { ok } from "../../common/response";
import { AuthGuard } from "../../common/auth.guard";
import { CopyInputsDto } from "./dto/copy-inputs.dto";

@Controller("seo")
export class SeoController {
  constructor(
    @Inject(SeoAggregatesService) private readonly aggregates: SeoAggregatesService,
    @Inject(SeoPlacesService) private readonly places: SeoPlacesService,
    @Inject(SeoCityConfigService) private readonly cityConfig: SeoCityConfigService,
    @Inject(SeoCopyService) private readonly copy: SeoCopyService
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

  @Get("cities")
  async listCities() {
    return ok({ items: await this.cityConfig.listEnabled() });
  }

  /**
   * Every place in a city with its live listing count and a server-computed
   * `indexable` flag. The sitemap consumes this and filters on `indexable` — it
   * must never re-derive the threshold itself.
   */
  @Get("cities/:citySlug/places")
  async listCityPlaces(@Param("citySlug") citySlug: string) {
    return ok(await this.places.placesForCity(citySlug));
  }

  /**
   * The city's OWN metro stations, with line topology, coordinates and listing
   * counts.
   *
   * Distinct from `/map/metro`, which returns whole metro *lines* that touch a
   * city — correct for drawing a map, but the reason phantom Delhi stations were
   * linked under Faridabad. Any rail that renders station links or computes a
   * nearest station must use this instead. `SeoPlace` from
   * `/cities/:slug/places` deliberately carries no geometry or line data, which
   * is why this returns the richer row rather than extending that shape.
   */
  @Get("cities/:citySlug/metro-stations")
  async listCityMetroStations(@Param("citySlug") citySlug: string) {
    return ok({ items: await this.aggregates.metroStationsWithCountsForCity(citySlug) });
  }

  /**
   * PUBLIC read of stored copy — no auth, no LLM. The SSR render path calls
   * this; it returns whatever the batch generator pre-populated, or null (the
   * page then falls back to its template).
   */
  @Get("copy")
  async getCopy(@Query("path") path?: string, @Query("locale") locale?: string) {
    if (!path) return ok(null);
    return ok(await this.copy.getStored(path, locale === "hi" ? "hi" : "en"));
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

  /**
   * Admin batch: generate + store AI copy for enabled localities with >= 3
   * listings that lack fresh copy. Bounded to `limit` new generations per call
   * (default 10, max 50) so LLM cost stays predictable; run it repeatedly to
   * work through the backlog. The public GET /seo/copy then serves the result.
   */
  @UseGuards(AuthGuard)
  @Post("copy/generate-batch")
  async generateBatch(@Query("limit") limitRaw?: string, @Query("force") forceRaw?: string) {
    const limit = Math.min(Math.max(Number(limitRaw) || 10, 1), 50);
    // force=1 regenerates pages that already have fresh copy — used to refresh
    // stored copy after a generation-logic change.
    const force = forceRaw === "1" || forceRaw === "true";
    const locales = ["en", "hi"] as const;
    let generated = 0;
    let skipped = 0;

    const cities = await this.cityConfig.listEnabled();
    for (const city of cities) {
      if (generated >= limit) break;
      const localities = await this.aggregates.localitiesForCity(city.city_slug);
      for (const loc of localities) {
        if (generated >= limit) break;
        // localitiesForCity is ordered by listing_count DESC — once we reach a
        // thin locality the rest are thinner, so stop scanning this city.
        if (loc.listing_count < 3) break;

        let agg: Awaited<ReturnType<SeoAggregatesService["aggregatesForLocality"]>> | null = null;
        for (const locale of locales) {
          if (generated >= limit) break;
          const pagePath = `/city/${city.city_slug}/${loc.slug}`;
          if (!force && (await this.copy.hasFreshCopy(pagePath, locale))) {
            skipped++;
            continue;
          }
          if (force) {
            await this.copy.deleteCopy(pagePath, locale);
          }
          if (!agg) {
            agg = await this.aggregates.aggregatesForLocality(city.city_slug, loc.slug);
          }
          const copy = await this.copy.getOrGenerate({
            pagePath,
            locale,
            placeName: { en: loc.name_en, hi: loc.name_hi },
            placeKind: "locality",
            aggregates: {
              ...agg,
              nearest_metro: null,
              parent_locality: loc.parent_locality_slug ?? null
            }
          });
          if (copy) generated++;
        }
      }
    }
    return ok({ generated, skipped });
  }
}
