import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query
} from "@nestjs/common";
import { SearchService } from "./search.service";
import { ok } from "../../common/response";

@Controller()
export class SearchController {
  constructor(@Inject(SearchService) private readonly searchService: SearchService) {}

  @Post("search/agentic-route")
  async route(
    @Body()
    body: {
      query: string;
      locale: "en" | "hi";
      city_hint?: string;
      session_token?: string;
      user_id?: string;
    }
  ) {
    return ok(
      await this.searchService.routeQuery(
        body.query,
        body.locale,
        body.city_hint,
        body.session_token,
        body.user_id
      )
    );
  }

  @Get("listings/search")
  async search(
    @Query()
    query: {
      q?: string;
      city?: string;
      locality?: string;
      listing_type?: "flat_house" | "pg";
      min_rent?: string;
      max_rent?: string;
      bhk?: string;
      furnishing?: string;
      verified_only?: string;
      sort?: string;
      page?: string;
      source?: string;
      /** Geo-search params (Phase 0A) */
      lat?: string;
      lng?: string;
      radius_km?: string;
      /** Extended filters (Phase 3B) */
      min_deposit?: string;
      max_deposit?: string;
      preferred_tenant?: string;
      availability?: string; // 'immediate' | ISO date string
      /** SEO intent filters (Phase 4 — programmatic landing pages) */
      occupancy_type?: string; // 'male' | 'female' | 'co_living'
      food_included?: string; // 'true' | 'false'
      /** PG segment filters (split — read over the projection + pg aggregate) */
      gender_policy?: string; // 'boys' | 'girls' | 'coed'
      tenant_type?: string; // 'students' | 'working' | 'any'
      sharing?: string; // 'single' | 'double' | 'triple' | 'quad' | 'dorm'
      ac?: string; // 'true'
      page_size?: string;
    }
  ) {
    return ok(await this.searchService.searchListings(query));
  }

  @Get("listings/search/suggest")
  async suggest(@Query() query: { q?: string; limit?: string }) {
    const limit = Math.min(Math.max(Number(query.limit) || 8, 1), 20);
    return ok(await this.searchService.suggest(query.q ?? "", limit));
  }

  @Get("listings/search/filters-metadata")
  async filtersMetadata() {
    return ok(await this.searchService.searchFiltersMetadata());
  }

  @Get("listings/search/dictionary")
  async dictionary() {
    return ok(await this.searchService.searchDictionary());
  }

  @Get("listings/search/preview")
  async preview(@Query() query: { type?: string; value?: string }) {
    if (query.type !== "city" && query.type !== "locality") return ok(null);
    if (!query.value) return ok(null);
    return ok(await this.searchService.getSearchPreview(query.type, query.value));
  }

  @Get("listings/search/map")
  async mapSearch(
    @Query()
    query: {
      sw_lat: string;
      sw_lng: string;
      ne_lat: string;
      ne_lng: string;
      limit?: string;
      bhk?: string;
      max_rent?: string;
      listing_type?: string;
      verified_only?: string;
      near_metro?: string;
    }
  ) {
    const bounds = {
      sw_lat: Number(query.sw_lat),
      sw_lng: Number(query.sw_lng),
      ne_lat: Number(query.ne_lat),
      ne_lng: Number(query.ne_lng)
    };
    if (!Object.values(bounds).every(Number.isFinite)) {
      throw new BadRequestException("sw_lat, sw_lng, ne_lat, and ne_lng must be valid numbers");
    }
    const bhk = query.bhk ? Number(query.bhk) : undefined;
    const maxRent = query.max_rent ? Number(query.max_rent) : undefined;
    const listingType = query.listing_type as "flat_house" | "pg" | undefined;
    if (bhk !== undefined && !Number.isFinite(bhk)) {
      throw new BadRequestException("bhk must be a valid number");
    }
    if (maxRent !== undefined && !Number.isFinite(maxRent)) {
      throw new BadRequestException("max_rent must be a valid number");
    }
    if (listingType !== undefined && listingType !== "flat_house" && listingType !== "pg") {
      throw new BadRequestException("listing_type must be flat_house or pg");
    }
    const limit = Math.min(Math.max(Number(query.limit) || 200, 1), 500);
    const filters = {
      bhk,
      max_rent: maxRent,
      listing_type: listingType,
      verified_only: query.verified_only === "true",
      near_metro: query.near_metro === "true"
    };
    return ok(await this.searchService.searchListingsForMap(bounds, limit, filters));
  }

  @Get("listings/:listing_id/similar")
  async similar(@Query() query: { limit?: string }, @Param("listing_id") listingId: string) {
    const limit = Math.min(Math.max(Number(query.limit) || 6, 1), 20);
    return ok(await this.searchService.getSimilarListings(listingId, limit));
  }

  @Get("listings/search/popular-localities")
  async popularLocalities(@Query() query: { city?: string; limit?: string }) {
    const limit = Math.min(Math.max(Number(query.limit) || 12, 1), 30);
    return ok(await this.searchService.getPopularLocalities(query.city, limit));
  }

  @Get("listings/pricing-intel")
  async pricingIntel(
    @Query()
    query: {
      city?: string;
      locality_id?: string;
      bhk?: string;
      listing_type?: string;
    }
  ) {
    return ok(
      await this.searchService.getPricingIntel({
        city: query.city,
        locality_id: query.locality_id ? Number(query.locality_id) : undefined,
        bhk: query.bhk ? Number(query.bhk) : undefined,
        listing_type: query.listing_type as "flat_house" | "pg" | undefined
      })
    );
  }
}
