/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages are resolved from source via tsconfig `paths`
  // (packages/*/src). Without listing them here, Next neither transpiles their
  // TS nor watches/invalidates them on change — a stale compiled copy survives
  // edits and restarts (persisted in .next/cache), surfacing as runtime
  // "X is not a function" for their value exports. Transpiling them makes Next
  // own their build + HMR, keeping runtime named exports correct.
  transpilePackages: ["@cribliv/shared-types", "@cribliv/ui"],
  eslint: {
    // eslint-config-next@16 uses flat config internally, incompatible with ESLint v8 legacy config.
    // Run linting separately via `pnpm lint`.
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      // Azure Blob Storage — listing photos uploaded by owners.
      // Wildcard covers any storage account configured via AZURE_STORAGE_ACCOUNT_NAME.
      { protocol: "https", hostname: "*.blob.core.windows.net" },
    ],
  },
  experimental: {
    typedRoutes: true,
    optimizePackageImports: ["lucide-react"],
  },
  /**
   * Common misspellings + alternate slugs that 301 to the canonical URL.
   * Captures the way real users type these names: "lukhnow", "gomtinagar",
   * "hazaratganj" etc. — preserves their search-equity instead of 404ing.
   */
  async redirects() {
    const SOURCES = [
      // City-level misspellings
      ["lukhnow", "lucknow"],
      ["luknow", "lucknow"],
      ["lakhnaw", "lucknow"],
      ["lakhnau", "lucknow"],
      ["lacknow", "lucknow"]
    ];
    const LOCALITY_ALIASES = [
      ["gomtinagar", "gomti-nagar"],
      ["gomtinagr", "gomti-nagar"],
      ["hazaratganj", "hazratganj"],
      ["hazratgunj", "hazratganj"],
      ["indiranagar", "indira-nagar"],
      ["indra-nagar", "indira-nagar"],
      ["aligunj", "aliganj"],
      ["alig-anj", "aliganj"],
      ["alambag", "alambagh"],
      ["mahanagr", "mahanagar"],
      ["lucknow-cantonment", "lucknow-cantt"],
      ["sushant-golf", "sushant-golf-city"],
      ["sushantgolf", "sushant-golf-city"],
      ["vibhutikhand", "vibhuti-khand"],
      ["vijaykhand", "vijay-khand"],
      ["vipulkhand", "vipul-khand"]
    ];
    const redirects = [];
    for (const [bad, good] of SOURCES) {
      for (const locale of ["en", "hi"]) {
        redirects.push({
          source: `/${locale}/city/${bad}`,
          destination: `/${locale}/city/${good}`,
          permanent: true
        });
        redirects.push({
          source: `/${locale}/city/${bad}/:path*`,
          destination: `/${locale}/city/${good}/:path*`,
          permanent: true
        });
        redirects.push({
          source: `/${locale}/rent-in/${bad}`,
          destination: `/${locale}/rent-in/${good}`,
          permanent: true
        });
      }
    }
    for (const [bad, good] of LOCALITY_ALIASES) {
      for (const locale of ["en", "hi"]) {
        redirects.push({
          source: `/${locale}/city/lucknow/${bad}`,
          destination: `/${locale}/city/lucknow/${good}`,
          permanent: true
        });
        redirects.push({
          source: `/${locale}/city/lucknow/${bad}/:path*`,
          destination: `/${locale}/city/lucknow/${good}/:path*`,
          permanent: true
        });
      }
    }
    return redirects;
  },
  async headers() {
    const toOrigin = (value) => {
      if (!value) return "";
      try {
        return new URL(value).origin;
      } catch {
        return "";
      }
    };

    // Strip path (e.g. /v1) from API URL so connect-src allows all sub-paths.
    // CSP spec: a source with a path (no trailing slash) matches only that exact path.
    // Using just origin (scheme+host+port) matches all paths on that host.
    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";
    const apiOrigin = apiUrl.replace(/\/v\d+\/?$/, "").replace(/\/$/, "") || "http://localhost:4000";
    // WebSocket origins need ws:// / wss:// schemes — http:// does NOT cover them in CSP.
    const wsOrigin = apiOrigin.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");
    const photoPublicOrigin = toOrigin(process.env.PHOTO_PUBLIC_BASE_URL);
    const storageAccount = process.env.AZURE_STORAGE_ACCOUNT_NAME?.trim();
    const storageAccountOrigin = storageAccount
      ? `https://${storageAccount}.blob.core.windows.net`
      : "";

    const connectSrc = [
      "'self'",
      apiOrigin,
      wsOrigin,
      "https://*.stt.speech.microsoft.com",
      "https://*.openai.azure.com",
      // Required for direct browser PUT uploads to Azure Blob SAS URLs.
      "https://*.blob.core.windows.net",
      photoPublicOrigin,
      storageAccountOrigin
    ]
      .filter(Boolean)
      .join(" ");

    // RFC 8288 Link header advertising agent-discoverable resources.
    // Single Link header value with comma-separated link entries (RFC 8288 §3).
    const agentLinkHeader = [
      '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
      '</v1/openapi.json>; rel="service-desc"; type="application/openapi+json"',
      '</docs/api>; rel="service-doc"; type="text/html"',
      '</.well-known/agent-skills/index.json>; rel="https://agentskills.io/rel/index"; type="application/json"',
      '</.well-known/mcp/server-card.json>; rel="https://modelcontextprotocol.io/rel/server-card"; type="application/json"'
    ].join(", ");

    return [
      // Agent-discovery Link headers on the homepage routes only.
      // (Per RFC 9727 the catalog hint belongs on the home/root resource,
      // not on every URL.)
      {
        source: "/",
        headers: [{ key: "Link", value: agentLinkHeader }]
      },
      {
        source: "/:locale(en|hi)",
        headers: [{ key: "Link", value: agentLinkHeader }]
      },
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Google Maps JS API + PostHog SDK + Razorpay Checkout
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://*.gstatic.com https://*.posthog.com https://cdn.redoc.ly https://cdn.jsdelivr.net https://checkout.razorpay.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: https: blob:",
              "font-src 'self' https://fonts.gstatic.com",
              // Allow API calls, Azure services, Google Maps, PostHog ingestion + replay, Razorpay Checkout
              `connect-src ${connectSrc} data: https://maps.googleapis.com https://*.gstatic.com https://*.googleapis.com https://*.posthog.com https://*.i.posthog.com https://*.razorpay.com`,
              // Razorpay Checkout opens its payment UI in an iframe
              "frame-src https://*.razorpay.com",
              "worker-src 'self' blob:",
              "media-src 'self' blob:",
              "frame-ancestors 'none'",
              "object-src 'none'",
              "base-uri 'self'"
            ].join("; ")
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload"
          }
        ]
      }
    ];
  }
};

export default nextConfig;
