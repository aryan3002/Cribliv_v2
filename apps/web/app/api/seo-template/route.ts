import { fetchLocality, fetchMetroStationsForCity } from "../../../lib/seo-api";
import { buildLocalityTemplateCopy, nearestMetroForLocality } from "../../../lib/seo-template-copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

/**
 * Returns the built-in template copy for a locality page (the same text the
 * public page renders when no AI/override copy exists). Used by the admin
 * override editor to prefill its fields, so an admin edits from the real
 * current text instead of a blank slate. Derived from public data only.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const city = searchParams.get("city")?.trim();
  const locality = searchParams.get("locality")?.trim();
  const locale = searchParams.get("locale") === "hi" ? "hi" : "en";
  if (!city || !locality) {
    return json({ error: { code: "missing_params" } }, 400);
  }

  const data = await fetchLocality(city, locality);
  if (!data) return json({ data: null });

  const metros = await fetchMetroStationsForCity(city);
  const cityName = city.charAt(0).toUpperCase() + city.slice(1);
  const copy = buildLocalityTemplateCopy({
    locale,
    placeName: { en: data.locality.name_en, hi: data.locality.name_hi },
    cityName,
    aggregates: data.aggregates,
    nearestMetro: nearestMetroForLocality(metros, data.locality.lat, data.locality.lng)
  });

  return json({ data: copy });
}
