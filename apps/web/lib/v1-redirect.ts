/**
 * v1 → v2 cutover redirects. Old cribliv.com URLs were
 *   /properties/<slug>-<24hex ObjectId>   (flats)
 *   /pgs/<slug>-<id> | /pgs/<id>           (PGs)
 * Every migrated listing is keyed in v1-redirects.generated.json by that
 * ObjectId. We match on the trailing 24-hex (slugs are not stable) and 301 to
 * the v2 canonical page. Unmapped v1 paths fall back to the city landing page
 * so nothing 404s. Pure + edge-safe: no DB, no Node APIs.
 */
import generated from "./v1-redirects.generated.json";

export type V1RedirectEntry = { t: "listing" | "pg"; id: string; city?: string };
export type V1RedirectMap = Record<string, V1RedirectEntry>;

const FALLBACK = "/en/city/lucknow";

/** True when the path is an old v1 listing/PG URL we own the redirect for. */
function isV1Path(pathname: string): boolean {
  return (
    pathname === "/properties" ||
    pathname === "/pgs" ||
    pathname.startsWith("/properties/") ||
    pathname.startsWith("/pgs/")
  );
}

/** Extract the trailing 24-hex Mongo ObjectId from a v1 path, else null. */
export function extractV1ObjectId(pathname: string): string | null {
  const clean = pathname.replace(/\/+$/, "");
  const m = clean.match(/([a-f0-9]{24})$/i);
  return m ? m[1].toLowerCase() : null;
}

/** Resolve a v1 path to its v2 target using an explicit map (testable core). */
export function resolveV1RedirectWith(pathname: string, map: V1RedirectMap): string | null {
  if (!isV1Path(pathname)) return null;

  const id = extractV1ObjectId(pathname);
  const entry = id ? map[id] : undefined;
  if (!entry) return FALLBACK;

  if (entry.t === "pg" && entry.city) {
    return `/en/pg/${entry.city}/${entry.id}`;
  }
  if (entry.t === "pg") {
    // PG with no known city — fall back rather than build a broken /pg//<id>.
    return FALLBACK;
  }
  return `/en/listing/${entry.id}`;
}

/** Resolve against the build-time generated map. */
export function resolveV1Redirect(pathname: string): string | null {
  return resolveV1RedirectWith(pathname, generated as V1RedirectMap);
}
