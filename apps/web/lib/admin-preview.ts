/**
 * apps/web/lib/admin-preview.ts
 *
 * Server-only gate for the admin preview of not-yet-enabled cities'
 * programmatic pages, used by the routes under `app/[locale]/seo-preview/*`.
 *
 * SECURITY: being on a `/seo-preview/*` URL proves nothing — the path is
 * attacker-controlled. `requireAdminPreview` calls `notFound()` unless the
 * server-side NextAuth session resolves to `role === "admin"`, so a logged-out
 * user or a non-admin (tenant/owner) gets a hard 404 and unpublished pages stay
 * invisible. It returns 404 rather than 403 so the preview tree does not even
 * confirm that a given city/locality exists.
 *
 * WHY THIS IS A SEPARATE ROUTE AND NOT A QUERY PARAM: this used to be
 * `?adminPreview=1` read from `searchParams` on the public page. In the Next 14
 * App Router, a page that declares `searchParams` is forced into per-request
 * dynamic rendering — merely declaring it, regardless of whether the param is
 * present. That silently opted all ~33k programmatic SEO URLs out of ISR and
 * made them the single largest consumer of Vercel Fluid Active CPU (~2,978
 * invocations / 7d, roughly 8x the homepage). The old code short-circuited the
 * `auth()` call behind a param check and its comment claimed public requests
 * "keep their existing cached/ISR behaviour" — that reasoning was wrong, because
 * the cost was in the signature, not the session lookup.
 *
 * Component props, unlike `searchParams`, have no effect on cacheability, so the
 * public page now takes an `allowUnlisted` prop that only this preview tree sets.
 */

import { notFound } from "next/navigation";
import { auth } from "../auth";

/** Resolve true only for a signed-in admin. */
export async function isAdminSession(): Promise<boolean> {
  try {
    const session = await auth();
    return session?.user?.role === "admin";
  } catch {
    return false;
  }
}

/** 404 unless the caller is a signed-in admin. */
export async function requireAdminPreview(): Promise<void> {
  if (!(await isAdminSession())) notFound();
}
