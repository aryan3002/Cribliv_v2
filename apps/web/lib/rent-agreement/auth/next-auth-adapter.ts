import { getSession, signOut } from "next-auth/react";
import type { AuthPort, AuthUser } from "./auth-port";

/**
 * Production auth adapter — wraps NextAuth.
 *
 * NOTE: the backend access token is attached at `session.accessToken` by the
 * `session` callback in `apps/web/auth.config.ts` (NOT `session.user.accessToken`).
 */
export class NextAuthAdapter implements AuthPort {
  async getAccessToken(): Promise<string | null> {
    const session = await getSession();
    const token = (session as { accessToken?: string } | null)?.accessToken;
    return token ?? null;
  }

  async getUser(): Promise<AuthUser | null> {
    const session = await getSession();
    const u = (session as { user?: { id?: string; role?: string } } | null)?.user;
    if (!u?.id) return null;
    return { id: u.id, role: u.role ?? "tenant" };
  }

  async signOut(): Promise<void> {
    await signOut({ redirect: false });
  }
}
