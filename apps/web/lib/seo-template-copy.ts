// Single source of truth for the built-in template copy of a locality page.
// Both the SSR locality page and the admin override editor use this, so the
// editor prefills with exactly what the page renders when no AI/override copy
// exists yet — no drift between "what's live" and "what you're editing".

import type { SeoCopyFields } from "./admin-api";

export interface TemplateAggregates {
  listing_count: number;
  median_rent_1bhk?: number | null;
  median_rent_2bhk?: number | null;
  median_rent_pg?: number | null;
}

export interface NearestMetro {
  station_name: string;
  line_name: string;
  dist: number;
}

export interface LocalityTemplateInput {
  locale: "en" | "hi";
  placeName: { en: string; hi: string };
  cityName: string;
  aggregates: TemplateAggregates;
  nearestMetro: NearestMetro | null;
}

function inr(n: number): string {
  return n.toLocaleString("en-IN");
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (n: number) => (n * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Closest metro station to a locality, with distance in km (null if none). */
export function nearestMetroForLocality(
  metros: Array<{
    station_name: string;
    line_name: string;
    lat: number | null;
    lng: number | null;
  }>,
  lat: number | null,
  lng: number | null
): NearestMetro | null {
  if (lat == null || lng == null) return null;
  const scored = (metros || [])
    .filter((m) => m.station_name && m.lat != null && m.lng != null)
    .map((m) => ({
      station_name: m.station_name,
      line_name: m.line_name,
      dist: haversine(lat, lng, m.lat as number, m.lng as number)
    }))
    .sort((a, b) => a.dist - b.dist);
  return scored[0] ?? null;
}

/** Build the template copy for a locality (mirrors the locality page defaults). */
export function buildLocalityTemplateCopy(input: LocalityTemplateInput): SeoCopyFields {
  const { locale, cityName, aggregates: agg, nearestMetro } = input;
  const hi = locale === "hi";
  const placeName = hi ? input.placeName.hi : input.placeName.en;

  const meta_title = hi
    ? `${cityName} के ${placeName} में किराये · Cribliv`
    : `Rentals in ${placeName}, ${cityName} · Cribliv`;
  const meta_description = hi
    ? `${placeName}, ${cityName} में ${agg.listing_count}+ सत्यापित PG और फ्लैट। मासिक किराये और लोकप्रिय इलाके।`
    : `${agg.listing_count}+ verified PGs and flats in ${placeName}, ${cityName}. Median rents, nearby metros, and direct-owner contact.`;

  const h1 = hi
    ? `${placeName} में किराये के लिए घर`
    : `Verified Rentals in ${placeName}, ${cityName}`;

  const intro_paragraph = hi
    ? `${cityName} के ${placeName} में Cribliv पर ${agg.listing_count} सत्यापित किराये — PG, 1/2/3 BHK फ्लैट और स्वतंत्र मकान।${agg.median_rent_1bhk ? ` यहाँ 1BHK का किराया लगभग ₹${inr(agg.median_rent_1bhk)}/माह${agg.median_rent_2bhk ? `, 2BHK लगभग ₹${inr(agg.median_rent_2bhk)}/माह` : ""} है।` : ""} हर मालिक सत्यापित है, कोई ब्रोकरेज नहीं।`
    : `${placeName} in ${cityName} has ${agg.listing_count} verified ${agg.listing_count === 1 ? "rental" : "rentals"} on Cribliv — PGs, 1/2/3 BHK flats and independent houses.${agg.median_rent_1bhk ? ` 1BHK homes here rent for around ₹${inr(agg.median_rent_1bhk)}/mo${agg.median_rent_2bhk ? `, 2BHKs around ₹${inr(agg.median_rent_2bhk)}/mo` : ""}.` : ""} Every owner is verified and you pay zero brokerage.`;

  const faq_items = [
    {
      q: hi
        ? `${placeName} में 1BHK फ्लैट का औसत किराया क्या है?`
        : `What's the average rent for a 1BHK in ${placeName}?`,
      a: agg.median_rent_1bhk
        ? hi
          ? `${placeName} में 1BHK फ्लैट का औसत मासिक किराया लगभग ₹${inr(agg.median_rent_1bhk)} है।`
          : `The median rent for a 1BHK in ${placeName} is around ₹${inr(agg.median_rent_1bhk)} per month.`
        : hi
          ? `${placeName} में अभी 1BHK डेटा उपलब्ध नहीं है।`
          : `Not enough 1BHK data for ${placeName} yet. Check the listings tab.`
    },
    {
      q: hi ? `${placeName} में PG किस बजट से शुरू होते हैं?` : `What do PGs in ${placeName} cost?`,
      a: agg.median_rent_pg
        ? hi
          ? `${placeName} में PG का औसत मासिक किराया लगभग ₹${inr(agg.median_rent_pg)} है।`
          : `The median PG rent in ${placeName} is around ₹${inr(agg.median_rent_pg)} per month, with budget options often available from ₹3,500.`
        : hi
          ? `${placeName} में अभी PG डेटा सीमित है।`
          : `PG data for ${placeName} is still being aggregated.`
    },
    {
      q: hi
        ? `${placeName} के पास सबसे नजदीकी मेट्रो स्टेशन कौन सा है?`
        : `What's the nearest metro station to ${placeName}?`,
      a: nearestMetro
        ? hi
          ? `सबसे नजदीकी मेट्रो ${nearestMetro.station_name} है (${nearestMetro.line_name}), लगभग ${nearestMetro.dist.toFixed(1)} किमी की दूरी पर।`
          : `The nearest metro is ${nearestMetro.station_name} on the ${nearestMetro.line_name}, about ${nearestMetro.dist.toFixed(1)} km away.`
        : hi
          ? `${placeName} के पास अभी कोई मेट्रो डेटा उपलब्ध नहीं है।`
          : `No metro data within range of ${placeName} yet.`
    },
    {
      q: hi ? "क्या ब्रोकर फीस है?" : "Are there any broker fees?",
      a: hi
        ? `नहीं। Cribliv पर सभी लिस्टिंग सीधे मालिक की होती हैं, कोई ब्रोकरेज नहीं।`
        : `No, every Cribliv listing connects you directly to a verified owner with zero brokerage.`
    }
  ];

  return { h1, meta_title, meta_description, intro_paragraph, nearby_blurb: "", faq_items };
}
