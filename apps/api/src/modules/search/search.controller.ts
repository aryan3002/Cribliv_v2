import { Body, Controller, Get, Inject, Post, Query } from "@nestjs/common";
import { SearchService } from "./search.service";
import { ok } from "../../common/response";

@Controller()
export class SearchController {
  constructor(@Inject(SearchService) private readonly searchService: SearchService) {}

  @Post("search/agentic-route")
  route(@Body() body: { query: string; locale: "en" | "hi"; city_hint?: string }) {
    return ok(this.searchService.routeQuery(body.query, body.locale, body.city_hint));
  }

  @Get("listings/search")
  async search(
    @Query()
    query: {
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
    }
  ) {
    return ok(await this.searchService.searchListings(query));
  }
}
