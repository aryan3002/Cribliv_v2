import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Cribliv Times: Rental Intelligence for Urban India";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PAPER = "#f1f0ea";
const INK = "#1a1815";
const INK_SOFT = "#6a645c";
const FLAG = "#c2301c";
const RULE = "#cbc9bf";

/** Masthead share card for the CRIBLIV TIMES front page itself. */
export default async function Image({ params }: { params: { locale: string } }) {
  const hi = params.locale === "hi";
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: PAPER,
        color: INK,
        padding: "44px 64px"
      }}
    >
      <div style={{ width: "100%", borderTop: `6px solid ${INK}`, display: "flex" }} />
      <div
        style={{ width: "100%", borderTop: `2px solid ${INK}`, marginTop: 4, display: "flex" }}
      />
      <div style={{ fontSize: 120, fontWeight: 800, letterSpacing: -2, marginTop: 30 }}>
        Cribliv Times
      </div>
      <div style={{ fontSize: 30, color: INK_SOFT, marginTop: 6 }}>
        {hi ? "शहरी भारत के लिए किराया इंटेलिजेंस" : "Rental Intelligence for Urban India"}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: FLAG,
          textTransform: "uppercase",
          letterSpacing: 4,
          marginTop: 26
        }}
      >
        {hi
          ? "किराया रुझान · लोकल गाइड · किरायेदार अधिकार"
          : "Rent trends · Local guides · Tenant rights"}
      </div>
      <div
        style={{ width: "100%", borderTop: `2px solid ${RULE}`, marginTop: 30, display: "flex" }}
      />
      <div
        style={{
          fontSize: 21,
          color: INK_SOFT,
          textTransform: "uppercase",
          letterSpacing: 2,
          marginTop: 14
        }}
      >
        cribliv.com
      </div>
    </div>,
    { ...size }
  );
}
