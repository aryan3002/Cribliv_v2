/**
 * apps/web/lib/admin-preview.ts
 *
 * Server-only gate that lets a logged-in admin preview a not-yet-enabled
 * city's real programmatic pages via `?adminPreview=1`.
 *
 * SECURITY: the `adminPreview` query param alone proves nothing — it is
 * fully attacker-controlled. `isAdminPreview` only returns true after
 * verifying the server-side NextAuth session (via `auth()`) resolves to
 * `role === "admin"`. A logged-out user or a non-admin (tenant/owner) gets
 * `false`, so the caller's `notFound()` still fires and disabled cities
 * remain a hard 404 to everyone else.
 *
 * The `auth()` call is short-circuited behind the param check so normal
 * public requests (no `adminPreview` param) never touch the session store
 * and keep their existing cached/ISR behaviour.
 */

import { auth } from "../auth";

export async function isAdminPreview(
  searchParams: { adminPreview?: string | string[] } | undefined
): Promise<boolean> {
  const raw = searchParams?.adminPreview;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value !== "1") return false;

  try {
    const session = await auth();
    return session?.user?.role === "admin";
  } catch {
    return false;
  }
}
