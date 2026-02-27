/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    typedRoutes: true
  },
  async headers() {
    // Strip path (e.g. /v1) from API URL so connect-src allows all sub-paths.
    // CSP spec: a source with a path (no trailing slash) matches only that exact path.
    // Using just origin (scheme+host+port) matches all paths on that host.
    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";
    const apiOrigin = apiUrl.replace(/\/v\d+\/?$/, "").replace(/\/$/, "") || "http://localhost:4000";
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: https: blob:",
              "font-src 'self' https://fonts.gstatic.com",
              // Allow API calls + Azure Speech REST API for voice search
              `connect-src 'self' ${apiOrigin} https://*.stt.speech.microsoft.com https://*.openai.azure.com`,
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
