/**
 * apps/web/middleware.ts
 *
 * NextAuth v5 middleware — validates sessions and enforces role-based
 * route protection on all dashboard routes.
 *
 * Protected prefixes (require authentication):
 *   /en/tenant/*  → role: tenant
 *   /en/owner/*   → role: owner | pg_operator
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
  { prefix: "/en/owner", roles: ["owner", "pg_operator"] },
  { prefix: "/en/admin", roles: ["admin"] },
  { prefix: "/hi/tenant", roles: ["tenant"] },
  { prefix: "/hi/owner", roles: ["owner", "pg_operator"] },
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
  "/_next",
  "/favicon",
  "/public"
];

const locales = ["en", "hi"] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
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

// ---------------------------------------------------------------------------
// Middleware (runs on the edge — all request handling here must be edge-safe)
// ---------------------------------------------------------------------------
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const session = req.auth;

  // 1. Root "/" → redirect to locale home
  if (pathname === "/") {
    const localeCookie = req.cookies.get("locale")?.value;
    const locale =
      localeCookie && (locales as readonly string[]).includes(localeCookie) ? localeCookie : "en";
    return NextResponse.redirect(new URL(`/${locale}`, req.url));
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
     *   - "/en/admin/*"           (admin dashboard)
     *   - "/hi/tenant/*" etc.     (Hindi locale variants)
     *
     * Exclude:
     *   - "/_next/*"              (Next.js internals — NOT in matcher)
     *   - "/api/auth/*"           (NextAuth API routes)
     *   - Static files            (.ico, .svg, .png …)
     */
    "/",
    "/en/tenant/:path*",
    "/en/owner/:path*",
    "/en/admin/:path*",
    "/hi/tenant/:path*",
    "/hi/owner/:path*",
    "/hi/admin/:path*"
  ]
};
