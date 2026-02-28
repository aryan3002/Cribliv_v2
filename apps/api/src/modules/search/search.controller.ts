import { Body, Controller, Get, Inject, Post, Query } from "@nestjs/common";
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
}
