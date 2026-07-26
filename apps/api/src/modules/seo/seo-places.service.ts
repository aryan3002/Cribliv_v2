import { Injectable } from "@nestjs/common";
import { INDEXABLE_MIN_LISTINGS } from "@cribliv/shared-types";
import { SeoAggregatesService } from "./seo-aggregates.service";

/**
 * The single source of truth for "which programmatic pages may be indexed".
 *
 * The sitemap, the page templates and the admin panel all previously derived
 * this independently, which is how the sitemap ended up submitting ~32,300
 * URLs that could never be indexed. Consumers must read `indexable` from here
 * and must not re-apply a threshold of their own.
 */

export interface SeoPlace {
  slug: string;
  name_en: string;
  name_hi: string | null;
  listing_count: number;
  indexable: boolean;
}

export interface CityPlaces {
  city_slug: string;
  localities: SeoPlace[];
  metro_stations: SeoPlace[];
  landmarks: SeoPlace[];
}

@Injectable()
export class SeoPlacesService {
  constructor(private readonly aggregates: SeoAggregatesService) {}

  async placesForCity(citySlug: string): Promise<CityPlaces> {
    const [localities, metros, landmarks] = await Promise.all([
      this.aggregates.localitiesForCity(citySlug),
      this.aggregates.metroStationsWithCountsForCity(citySlug),
      this.aggregates.landmarksWithCountsForCity(citySlug)
    ]);

    return {
      city_slug: citySlug,
      localities: localities.map((row) =>
        toPlace(row.slug, row.name_en, row.name_hi, row.listing_count)
      ),
      metro_stations: metros.map((row) =>
        toPlace(row.slug, row.station_name, null, row.listing_count)
      ),
      landmarks: landmarks.map((row) =>
        toPlace(row.slug, row.name_en, row.name_hi, row.listing_count)
      )
    };
  }
}

function toPlace(
  slug: string,
  nameEn: string,
  nameHi: string | null,
  listingCount: number
): SeoPlace {
  return {
    slug,
    name_en: nameEn,
    name_hi: nameHi,
    listing_count: listingCount,
    indexable: listingCount >= INDEXABLE_MIN_LISTINGS
  };
}
