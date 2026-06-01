/**
 * Role-aware "List a PG" CTA target.
 *  - signed-out → /auth/login with redirect-back to /pg-operator/become
 *  - tenant → /pg-operator/become (auto-grant; becomes pg_operator on click)
 *  - pg_operator → /pg-operator/listings/new (skip role-grant, go straight to wizard)
 *  - owner → /pg-operator/become (lands on the "manage both roles is V1.5" blocker page)
 */
export function listAPgHref(role: string | null | undefined, locale: string): string {
  if (!role) return `/${locale}/auth/login?from=/${locale}/pg-operator/become`;
  if (role === "pg_operator") return `/${locale}/pg-operator/listings/new`;
  return `/${locale}/pg-operator/become`;
}
