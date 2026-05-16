import { ImageResponse } from "next/og";
import { fetchLocality } from "../../../../../lib/seo-api";

export const runtime = "edge";
export const alt = "Cribliv locality rentals";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

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
  const data = await fetchLocality(params.citySlug, params.locality).catch(() => null);
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
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
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
        <div style={{ fontSize: 28, fontWeight: 700 }}>Cribliv</div>
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
