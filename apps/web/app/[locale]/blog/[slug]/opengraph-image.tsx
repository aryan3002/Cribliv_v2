import { ImageResponse } from "next/og";
import { fetchBlogPost } from "../../../../lib/blog-api";
import { stripBrandSuffix } from "../../../../lib/seo";
import { deskLabelFor } from "../../../../lib/blog-crosslink";

export const runtime = "edge";
export const alt = "Cribliv Times";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Paper palette — mirrors cribliv-times.module.css. Satori cannot read CSS
// modules, so the values are repeated here.
const PAPER = "#f1f0ea";
const INK = "#1a1815";
const INK_SOFT = "#6a645c";
const FLAG = "#c2301c";
const RULE = "#cbc9bf";

/**
 * Branded share card: every CRIBLIV TIMES story shared to WhatsApp/X/Slack
 * shows a front page, not a blank link. Most posts have no hero photo, so
 * without this the share preview was empty — and on WhatsApp (the channel that
 * matters for this audience) a link with a card gets tapped, a bare URL does
 * not. Falls back to a masthead-only card if the post fetch fails.
 */
export default async function Image({ params }: { params: { locale: string; slug: string } }) {
  const hi = params.locale === "hi";
  const data = await fetchBlogPost(params.slug).catch(() => null);
  const headline = data ? stripBrandSuffix(data.post.title) : "Rental Intelligence for Urban India";
  const kicker = data ? deskLabelFor(data.post.category_slug, hi) : hi ? "रिपोर्ट" : "Report";
  // Long AI headlines shrink instead of overflowing the card.
  const headlineSize = headline.length > 90 ? 44 : headline.length > 60 ? 52 : 62;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: PAPER,
        color: INK,
        padding: "44px 64px 36px"
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ width: "100%", borderTop: `6px solid ${INK}`, display: "flex" }} />
        <div
          style={{ width: "100%", borderTop: `2px solid ${INK}`, marginTop: 4, display: "flex" }}
        />
        <div style={{ fontSize: 74, fontWeight: 800, letterSpacing: -1, marginTop: 14 }}>
          Cribliv Times
        </div>
        <div style={{ fontSize: 22, color: INK_SOFT, marginTop: 2 }}>
          {hi ? "शहरी भारत के लिए किराया इंटेलिजेंस" : "Rental Intelligence for Urban India"}
        </div>
        <div
          style={{ width: "100%", borderTop: `2px solid ${RULE}`, marginTop: 18, display: "flex" }}
        />
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 18
        }}
      >
        <div
          style={{
            fontSize: 24,
            fontWeight: 700,
            color: FLAG,
            textTransform: "uppercase",
            letterSpacing: 4
          }}
        >
          {kicker}
        </div>
        <div style={{ fontSize: headlineSize, fontWeight: 800, lineHeight: 1.08 }}>{headline}</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {/* satori has no `double` border style — stack two solid rules */}
        <div style={{ width: "100%", borderTop: `2px solid ${INK}`, display: "flex" }} />
        <div
          style={{ width: "100%", borderTop: `1px solid ${INK}`, marginTop: 3, display: "flex" }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            paddingTop: 12,
            fontSize: 21,
            color: INK_SOFT,
            textTransform: "uppercase",
            letterSpacing: 2
          }}
        >
          <div>cribliv.com</div>
          <div>{hi ? "निःशुल्क" : "Free"}</div>
        </div>
      </div>
    </div>,
    { ...size }
  );
}
