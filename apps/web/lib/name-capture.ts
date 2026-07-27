/**
 * apps/web/lib/name-capture.ts
 *
 * Decision layer for the name-capture prompt. Pure and storage-injected
 * (Storage is passed in, never reached for) so it unit-tests without jsdom —
 * same shape as lib/welcome-credits.ts.
 *
 * The name *rules* are not here: they live in @cribliv/shared-types so apps/api
 * validates identically. This module owns only the web's decisions — when to
 * prompt, whether the user already said no, and how to read/write the name.
 */

import { validateFullName } from "@cribliv/shared-types";
import { getApiBaseUrl } from "./api";

export { validateFullName };

export const PROMPTABLE_ROLES = ["tenant", "owner", "pg_operator"] as const;
export type PromptableRole = (typeof PROMPTABLE_ROLES)[number];

/**
 * Paths where a global overlay must not open.
 *
 * /auth/* is a genuine race, documented in welcome-credits-modal.tsx: signIn()
 * flips the client session to authenticated a tick before the login page's
 * window.location.href fires, so a globally-mounted modal opens on the login
 * page and is torn down mid-redirect. /admin is belt-and-braces — admins are
 * excluded by role anyway.
 */
const SUPPRESSED_PATHS = [/\/auth(\/|$)/, /(^|\/)admin(\/|$)/];

export function isSuppressedPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return SUPPRESSED_PATHS.some((pattern) => pattern.test(pathname));
}

/** Treats null, undefined, "" and whitespace-only alike — all mean "no name". */
export function hasName(name: string | null | undefined): boolean {
  return typeof name === "string" && name.trim().length > 0;
}

export function namePromptDismissKey(userId: string): string {
  return `cribliv:name-prompt-dismissed:${userId}`;
}

export function isNamePromptDismissed(userId: string, storage: Storage): boolean {
  try {
    return storage.getItem(namePromptDismissKey(userId)) !== null;
  } catch {
    // Storage blocked (private mode, quota). Prefer asking over going silent.
    return false;
  }
}

export function markNamePromptDismissed(userId: string, storage: Storage): void {
  try {
    storage.setItem(namePromptDismissKey(userId), new Date().toISOString());
  } catch {
    // The provider's in-render ref still prevents a repeat this session.
  }
}

export interface ShouldShowNamePromptInput {
  status: "authenticated" | "loading" | "unauthenticated";
  role: string | undefined;
  name: string | null | undefined;
  userId: string | undefined;
  pathname: string | null;
  /** Omitted when sessionStorage is unavailable. */
  storage: Storage | undefined;
  /** True while the welcome-credits celebration is pending or on screen. */
  welcomePending: boolean;
}

/**
 * The ambient (moment 3) trigger only. The contact gate (moment 4) ignores all
 * of this — it is unskippable and resolves the name from the API instead.
 */
export function shouldShowNamePrompt(input: ShouldShowNamePromptInput): boolean {
  if (input.status !== "authenticated") return false;
  if (!input.userId) return false;
  if (!input.role || !PROMPTABLE_ROLES.includes(input.role as PromptableRole)) return false;
  if (hasName(input.name)) return false;
  if (isSuppressedPath(input.pathname)) return false;
  if (input.welcomePending) return false;
  if (input.storage && isNamePromptDismissed(input.userId, input.storage)) return false;
  return true;
}

/**
 * Server-authoritative name lookup.
 *
 * The contact gate must use this rather than session.user.name: the unlock panel
 * authenticates via POST /auth/otp/verify + writeAuthSession() straight to
 * localStorage, bypassing NextAuth entirely, so those users have no NextAuth
 * session and session.user.name is undefined regardless of whether they have a
 * name. Gating on the session there would re-prompt named users on every click.
 */
export async function fetchFullName(token: string): Promise<string | null> {
  const res = await fetch(`${getApiBaseUrl()}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!res.ok) {
    throw new Error(`Failed to load profile (${res.status})`);
  }
  const payload = (await res.json()) as { data: { full_name: string | null } };
  return payload.data.full_name ?? null;
}

export async function saveFullName(token: string, name: string): Promise<void> {
  const res = await fetch(`${getApiBaseUrl()}/users/me`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ full_name: name })
  });
  if (!res.ok) {
    throw new Error(`Failed to save name (${res.status})`);
  }
}
