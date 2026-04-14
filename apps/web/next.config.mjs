/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
  experimental: {
    typedRoutes: true,
    optimizePackageImports: ["lucide-react"],
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

    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Google Maps JS API loads scripts from maps.googleapis.com
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: https: blob:",
              "font-src 'self' https://fonts.gstatic.com",
              // Allow API calls, Azure services, and Google Maps tiles + geocoding
              `connect-src ${connectSrc} https://maps.googleapis.com https://maps.gstatic.com https://*.googleapis.com`,
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
