/**
 * Pure helpers for deciding where a user goes after (or instead of) the login
 * page. Kept dependency-free so both the post-verify handler and the
 * already-authenticated guard on the login page share one source of truth.
 */
import type { UserRole } from "../auth.config";

export function rolePath(role: UserRole | undefined, locale = "en"): string {
  // Tenants land on the homepage — their "dashboard" is the search experience
  if (!role || role === "tenant") return `/${locale}`;
  if (role === "owner") return `/${locale}/owner/dashboard`;
  if (role === "pg_operator") return `/${locale}/pg-operator/dashboard`;
  if (role === "admin") return `/${locale}/admin`;
  return `/${locale}`;
}

/**
 * Returns true if the given role is allowed to access the destination path.
 * Prevents a tenant from being redirected to /admin (→ 403) after login.
 */
export function canAccessPath(role: UserRole | undefined, path: string): boolean {
  if (path.startsWith("/en/admin") || path.startsWith("/hi/admin")) {
    return role === "admin";
  }
  if (path.startsWith("/en/owner") || path.startsWith("/hi/owner")) {
    return role === "owner";
  }
  if (path.startsWith("/en/pg-operator") || path.startsWith("/hi/pg-operator")) {
    // `/pg-operator/become` is the self-service upgrade gate — tenants must reach
    // it (granting the role flips them to pg_operator). Other PG routes stay
    // role-gated by middleware.
    if (path.endsWith("/pg-operator/become")) return true;
    return role === "pg_operator";
  }
  if (path.startsWith("/en/tenant") || path.startsWith("/hi/tenant")) {
    return role === "tenant";
  }
  return true; // public path
}

/**
 * Where an authenticated user should be sent from the login page. Mirrors the
 * post-verify logic: prefer a role-allowed `from`, else the role's home, else
 * the locale homepage. `fromPath` must already be locale-normalized.
 */
export function resolveAuthedDestination(
  role: UserRole | undefined,
  fromPath: string | null,
  locale: string
): string {
  if (role) {
    return fromPath && canAccessPath(role, fromPath) ? fromPath : rolePath(role, locale);
  }
  if (fromPath) return fromPath;
  return `/${locale}`;
}
