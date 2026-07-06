/**
 * apps/web/middleware.ts
 *
 * NextAuth v5 middleware — validates sessions and enforces role-based
 * route protection on all dashboard routes.
 *
 * Protected prefixes (require authentication):
 *   /en/tenant/*  → role: tenant
 *   /en/owner/*   → role: owner
 *   /en/pg-operator/* → role: pg_operator
 *   /en/admin/*   → role: admin
 *
 * Public routes (pass through):
 *   /en, /en/search/*, /auth/*, /api/*
 *   locale redirect: "/" → "/en"
 */

import { auth } from "./auth";
import { NextResponse } from "next/server";
import type { UserRole } from "./auth.config";

// ---------------------------------------------------------------------------
// Route-role map
// ---------------------------------------------------------------------------
const PROTECTED_PREFIXES: Array<{ prefix: string; roles: UserRole[] }> = [
  { prefix: "/en/tenant", roles: ["tenant"] },
  { prefix: "/en/owner", roles: ["owner"] },
  { prefix: "/en/pg-operator", roles: ["pg_operator"] },
  { prefix: "/en/admin", roles: ["admin"] },
  { prefix: "/hi/tenant", roles: ["tenant"] },
  { prefix: "/hi/owner", roles: ["owner"] },
  { prefix: "/hi/pg-operator", roles: ["pg_operator"] },
  { prefix: "/hi/admin", roles: ["admin"] }
];

// Routes that are always public (no session needed)
const PUBLIC_PREFIXES = [
  "/api/auth",
  "/auth",
  "/en/search",
  "/en/city",
  "/en/listing",
  "/en/shortlist",
  "/en/pg",
  "/en/pg-operator/become",
  "/en/map",
  "/hi/map",
  "/hi/pg-operator/become",
  "/_next",
  "/favicon",
  "/public",
  "/.well-known",
  "/md",
  "/docs/api",
  "/robots.txt"
];

const MARKDOWN_NEGOTIATED_PATHS = new Set([
  "",
  "home",
  "about",
  "how-it-works",
  "pricing",
  "faq",
  "become-owner",
  "contact",
  "privacy",
  "terms"
]);

const MARKDOWN_NEGOTIATED_DYNAMIC = ["listing", "pg", "city"] as const;

const locales = ["en", "hi"] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const RAW_PUBLIC_PREFIXES = new Set([
  "/api/auth",
  "/auth",
  "/_next",
  "/favicon",
  "/public",
  "/.well-known",
  "/md",
  "/docs/api",
  "/robots.txt"
]);

function matchesPublicPrefix(pathname: string, prefix: string): boolean {
  if (RAW_PUBLIC_PREFIXES.has(prefix)) {
    return pathname.startsWith(prefix);
  }
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => matchesPublicPrefix(pathname, prefix));
}

function getRequiredRoles(pathname: string): UserRole[] | null {
  for (const { prefix, roles } of PROTECTED_PREFIXES) {
    if (pathname.startsWith(prefix)) return roles;
  }
  return null;
}

function hasRequiredRole(userRole: UserRole | undefined, allowedRoles: UserRole[]): boolean {
  if (!userRole) return false;
  return allowedRoles.includes(userRole);
}

/**
 * Returns true if the client prefers markdown over HTML.
 *
 * Parses the Accept header with q-values per RFC 9110 §12.5.1. We only rewrite
 * when text/markdown's q > text/html's q (defaulting to q=1 when absent).
 */
function prefersMarkdown(acceptHeader: string | null): boolean {
  if (!acceptHeader) return false;
  if (!acceptHeader.includes("text/markdown")) return false;
  const parts = acceptHeader.split(",").map((s) => s.trim());
  let mdQ = 0;
  let htmlQ = 0;
  for (const part of parts) {
    const [type, ...params] = part.split(";").map((s) => s.trim());
    let q = 1;
    for (const p of params) {
      const m = p.match(/^q=([\d.]+)$/);
      if (m) q = Number(m[1]);
    }
    if (type === "text/markdown") mdQ = Math.max(mdQ, q);
    else if (type === "text/html") htmlQ = Math.max(htmlQ, q);
  }
  return mdQ > 0 && mdQ >= htmlQ;
}

/**
 * If the request path corresponds to a route that has a markdown variant,
 * return the path under /md/... to rewrite to. Otherwise return null.
 */
function markdownRewritePath(pathname: string): string | null {
  // NOTE: target uses /md/... not /_md/... — Next.js App Router treats any
  // folder whose name starts with `_` as a private (non-routed) directory.
  if (pathname === "/") return "/md/home";

  // Strip locale prefix
  const m = pathname.match(/^\/(en|hi)(\/.*)?$/);
  if (!m) return null;
  const locale = m[1];
  const tail = (m[2] ?? "").replace(/^\/+|\/+$/g, "");

  if (tail === "") {
    return `/md/${locale}`;
  }

  const segments = tail.split("/");
  if (segments.length === 1 && MARKDOWN_NEGOTIATED_PATHS.has(segments[0])) {
    return `/md/${locale}/${segments[0]}`;
  }
  if (
    segments.length === 2 &&
    (MARKDOWN_NEGOTIATED_DYNAMIC as readonly string[]).includes(segments[0])
  ) {
    return `/md/${locale}/${segments[0]}/${encodeURIComponent(segments[1])}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Middleware (runs on the edge — all request handling here must be edge-safe)
// ---------------------------------------------------------------------------
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const session = req.auth;

  // 0. Markdown content negotiation. If the agent prefers text/markdown over
  // text/html and the path has a markdown variant, rewrite to /md/... so the
  // markdown route handler can render. We do this BEFORE the locale redirect
  // so `/` with `Accept: text/markdown` returns home.md rather than 302'ing.
  if (req.method === "GET") {
    const accept = req.headers.get("accept");
    if (prefersMarkdown(accept)) {
      const rewriteTo = markdownRewritePath(pathname);
      if (rewriteTo) {
        const url = req.nextUrl.clone();
        url.pathname = rewriteTo;
        const res = NextResponse.rewrite(url);
        res.headers.append("Vary", "Accept");
        return res;
      }
    }
  }

  // 1. Root "/" → redirect to locale home
  if (pathname === "/") {
    const localeCookie = req.cookies.get("locale")?.value;
    const locale =
      localeCookie && (locales as readonly string[]).includes(localeCookie) ? localeCookie : "en";
    return NextResponse.redirect(new URL(`/${locale}`, req.url));
  }

  // 1b. /auth/login → redirect to /{locale}/auth/login
  if (pathname === "/auth/login" || pathname === "/auth/login/") {
    const localeCookie = req.cookies.get("locale")?.value;
    const locale =
      localeCookie && (locales as readonly string[]).includes(localeCookie) ? localeCookie : "en";
    const url = new URL(`/${locale}/auth/login`, req.url);
    // Preserve query params like ?from=...
    req.nextUrl.searchParams.forEach((value, key) => url.searchParams.set(key, value));
    return NextResponse.redirect(url);
  }

  // 2. Public paths — let them through immediately
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // 3. Check whether this path requires a role
  const requiredRoles = getRequiredRoles(pathname);
  if (!requiredRoles) {
    // Not a protected path — pass through
    return NextResponse.next();
  }

  // 4. No session at all → send to login
  if (!session) {
    const loginUrl = new URL("/auth/login", req.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const userRole = (session.user as { role?: UserRole })?.role;

  // 5. Session exists but token expired (role undefined) → login
  if (!userRole) {
    const loginUrl = new URL("/auth/login", req.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 6. Wrong role → 403
  if (!hasRequiredRole(userRole, requiredRoles)) {
    return NextResponse.redirect(new URL("/403", req.url));
  }

  // 7. All checks passed — forward the request
  const response = NextResponse.next();
  // Expose locale from URL for downstream use
  const localeMatch = pathname.match(/^\/(en|hi)\//);
  if (localeMatch) {
    response.headers.set("x-locale", localeMatch[1]);
  }
  // Negotiated paths must Vary on Accept so CDNs don't conflate html vs md.
  if (markdownRewritePath(pathname)) {
    response.headers.append("Vary", "Accept");
  }
  return response;
});

// ---------------------------------------------------------------------------
// Matcher — run middleware only on relevant paths for performance
// ---------------------------------------------------------------------------
export const config = {
  matcher: [
    /*
     * Match:
     *   - "/"                     (root locale redirect)
     *   - "/en/tenant/*"          (tenant dashboard)
     *   - "/en/owner/*"           (owner dashboard)
     *   - "/en/pg-operator/*"     (pg operator dashboard)
     *   - "/en/admin/*"           (admin dashboard)
     *   - "/hi/tenant/*" etc.     (Hindi locale variants)
     *
     * Exclude:
     *   - "/_next/*"              (Next.js internals — NOT in matcher)
     *   - "/api/auth/*"           (NextAuth API routes)
     *   - Static files            (.ico, .svg, .png …)
     */
    "/",
    "/auth/login",
    "/en/tenant/:path*",
    "/en/owner/:path*",
    "/en/pg-operator/:path*",
    "/en/admin/:path*",
    "/hi/tenant/:path*",
    "/hi/owner/:path*",
    "/hi/pg-operator/:path*",
    "/hi/admin/:path*",
    // Markdown content negotiation surfaces (middleware checks Accept header
    // and may rewrite to /md/... for agents).
    "/en",
    "/hi",
    "/en/about",
    "/en/how-it-works",
    "/en/pricing",
    "/en/faq",
    "/en/become-owner",
    "/en/contact",
    "/en/privacy",
    "/en/terms",
    "/hi/about",
    "/hi/how-it-works",
    "/hi/pricing",
    "/hi/faq",
    "/hi/become-owner",
    "/hi/contact",
    "/hi/privacy",
    "/hi/terms",
    "/en/listing/:id",
    "/hi/listing/:id",
    "/en/pg/:id",
    "/hi/pg/:id",
    "/en/city/:city",
    "/hi/city/:city"
  ]
};
