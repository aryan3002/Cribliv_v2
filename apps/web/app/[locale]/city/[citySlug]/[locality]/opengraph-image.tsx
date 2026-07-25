import { ImageResponse } from "next/og";
import { fetchLocality } from "../../../../../lib/seo-api";

export const runtime = "edge";
export const alt = "Cribliv locality rentals";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Satori (which backs ImageResponse) cannot apply CSS filters and will throw if
 * a referenced image fails to load, so the brand art is inlined as a data URI.
 *
 * The assets are co-located and resolved via `import.meta.url` so Next bundles
 * them into the Edge function. Deliberately NOT fetched from the public origin:
 * that costs a round trip per render and would break whenever the deployed
 * origin lags the code (a new asset 404s until the deploy that adds it lands).
 * They are sized at 2x their render size — mark 49x48, wordmark 156x39.
 */
async function inlineAsset(url: URL): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return `data:image/png;base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

/**
 * Dynamic OG image for each locality page. Rendered on first request via
 * Next.js' built-in Edge runtime and cached at the CDN edge thereafter.
 * Falls back to a brand-only card when the API is unreachable.
 */
export default async function Image({
  params
}: {
  params: { locale: string; citySlug: string; locality: string };
}) {
  const [data, markSrc, wordmarkSrc] = await Promise.all([
    fetchLocality(params.citySlug, params.locality).catch(() => null),
    // Transparent mark — public/cribliv.png is the opaque white-background app
    // icon and would render as a white tile on this dark gradient.
    inlineAsset(new URL("./brand-mark.png", import.meta.url)),
    // Light variant: this card sits on a near-black gradient.
    inlineAsset(new URL("./brand-wordmark-light.png", import.meta.url))
  ]);
  const locale = params.locale === "hi" ? "hi" : "en";
  const placeName = data
    ? locale === "hi"
      ? data.locality.name_hi
      : data.locality.name_en
    : params.locality.replace(/-/g, " ");
  const cityName = params.citySlug.charAt(0).toUpperCase() + params.citySlug.slice(1);
  const subtitle =
    data && data.aggregates.listing_count > 0
      ? locale === "hi"
        ? `${data.aggregates.listing_count} सत्यापित लिस्टिंग`
        : `${data.aggregates.listing_count} verified listings`
      : locale === "hi"
        ? "सीधे मालिक से किराये"
        : "Zero-brokerage rentals";

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 64,
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0b1220 100%)",
        color: "#f8fafc"
      }}
    >
      {/* Brand lockup at the master-artwork ratios: wordmark 0.806x the mark,
          gap 0.189x, optically centred. Mark 48px -> wordmark 39px, gap 9px. */}
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        {markSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={markSrc} alt="" width={49} height={48} />
        ) : (
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: "#22d3ee",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              color: "#0f172a",
              fontSize: 28
            }}
          >
            C
          </div>
        )}
        {wordmarkSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={wordmarkSrc} alt="Cribliv" height={39} width={156} />
        ) : (
          <div style={{ fontSize: 28, fontWeight: 700 }}>Cribliv</div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div
          style={{
            fontSize: 24,
            color: "#94a3b8",
            textTransform: "uppercase",
            letterSpacing: "0.1em"
          }}
        >
          {locale === "hi" ? `${cityName} • लोकालिटी` : `${cityName} • Locality`}
        </div>
        <div style={{ fontSize: 84, fontWeight: 800, lineHeight: 1.0 }}>{placeName}</div>
        <div style={{ fontSize: 32, color: "#22d3ee", fontWeight: 600 }}>{subtitle}</div>
      </div>

      <div style={{ fontSize: 22, color: "#64748b" }}>cribliv.com</div>
    </div>,
    { ...size }
  );
}
