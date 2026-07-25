import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  title: "API documentation",
  description:
    "Public, agent-friendly OpenAPI 3.1 reference for the Cribliv rentals platform: search listings, fetch a listing, locality SEO data, OTP login.",
  robots: { index: true, follow: true }
};

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "";
const SPEC_URL = SITE_URL ? `${SITE_URL}/v1/openapi.json` : "/v1/openapi.json";

/**
 * Renders the public OpenAPI spec via ReDoc loaded from a CDN. ReDoc is
 * pure-client; the spec itself is served by the API at /v1/openapi.json.
 *
 * The custom <redoc> element is injected via dangerouslySetInnerHTML so we
 * don't need a global JSX intrinsic-element augmentation just for one usage.
 */
export default function ApiDocsPage() {
  const redocMarkup = `<redoc spec-url="${SPEC_URL}"></redoc>`;
  return (
    <main>
      <noscript>
        <p style={{ padding: 24, fontFamily: "sans-serif" }}>
          JavaScript is required to render the API docs. The raw OpenAPI 3.1 spec is available at{" "}
          <a href={SPEC_URL}>{SPEC_URL}</a>.
        </p>
      </noscript>
      <div dangerouslySetInnerHTML={{ __html: redocMarkup }} />
      <Script
        src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"
        strategy="afterInteractive"
      />
    </main>
  );
}
