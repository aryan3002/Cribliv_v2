import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.API_BASE_URL ||
  "http://localhost:4000/v1"
).replace(/\/+$/, "");

export type UserRole = "tenant" | "owner" | "pg_operator" | "admin";

/** Shape returned by POST /auth/otp/verify */
interface OtpVerifyResponse {
  access_token: string;
  refresh_token?: string;
  is_new_user?: boolean;
  signup_reward?: {
    credits_granted: number;
    expires_at: string | null;
  };
  user: {
    id: string;
    phone_e164: string;
    role: UserRole;
    preferred_language: "en" | "hi";
  };
}

/** Shape returned by GET /auth/me */
interface MeResponse {
  id: string;
  phone_e164: string;
  role: UserRole;
  preferred_language: "en" | "hi";
  wallet_balance: number;
  promotional_credits_remaining?: number;
  promotional_credits_expires_at?: string | null;
}

export const authConfig: NextAuthConfig = {
  // Credentials provider for OTP-based auth
  providers: [
    Credentials({
      name: "OTP",
      credentials: {
        challengeId: { label: "Challenge ID", type: "text" },
        otpCode: { label: "OTP Code", type: "text" },
        phone: { label: "Phone", type: "text" }
      },
      async authorize(credentials) {
        const { challengeId, otpCode, phone } = credentials as {
          challengeId: string;
          otpCode: string;
          phone: string;
        };

        if (!challengeId || !otpCode || !phone) {
          return null;
        }

        try {
          const res = await fetch(`${API_BASE_URL}/auth/otp/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ challenge_id: challengeId, otp_code: otpCode })
          });

          if (!res.ok) {
            // Generic error — don't leak backend details to the client
            return null;
          }

          const payload = (await res.json()) as { data: OtpVerifyResponse };
          const data = payload.data;

          return {
            id: data.user.id,
            phone: data.user.phone_e164,
            role: data.user.role,
            preferredLanguage: data.user.preferred_language,
            accessToken: data.access_token,
            refreshToken: data.refresh_token ?? null,
            tokenIssuedAt: Date.now(),
            isNewUser: data.is_new_user ?? false,
            signupReward: data.signup_reward
              ? {
                  creditsGranted: data.signup_reward.credits_granted,
                  expiresAt: data.signup_reward.expires_at
                }
              : undefined
          };
        } catch {
          return null;
        }
      }
    }),
    Credentials({
      id: "admin-totp",
      name: "Admin TOTP",
      credentials: {
        phone: { label: "Phone", type: "text" },
        totpCode: { label: "Authenticator code", type: "text" }
      },
      async authorize(credentials) {
        const { phone, totpCode } = credentials as { phone: string; totpCode: string };
        if (!phone || !totpCode) return null;
        try {
          const res = await fetch(`${API_BASE_URL}/auth/admin/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone_e164: phone, totp_code: totpCode })
          });
          if (!res.ok) return null;
          const payload = (await res.json()) as { data: OtpVerifyResponse };
          const data = payload.data;
          return {
            id: data.user.id,
            phone: data.user.phone_e164,
            role: data.user.role,
            preferredLanguage: data.user.preferred_language,
            accessToken: data.access_token,
            refreshToken: data.refresh_token ?? null,
            tokenIssuedAt: Date.now(),
            isNewUser: false
          };
        } catch {
          return null;
        }
      }
    })
  ],

  callbacks: {
    /**
     * jwt callback — runs every time a JWT is read or written.
     * Handles initial token creation and rotation (refresh if >30 min old).
     */
    async jwt({ token, user }) {
      // First sign-in: persist user data into the JWT
      if (user) {
        return {
          ...token,
          id: user.id,
          phone: user.phone,
          role: user.role,
          preferredLanguage: user.preferredLanguage,
          accessToken: user.accessToken,
          refreshToken: user.refreshToken,
          tokenIssuedAt: Date.now(),
          isNewUser: user.isNewUser,
          signupReward: user.signupReward
        };
      }

      // Subsequent calls: rotate if token is older than 30 minutes
      const issuedAt = token.tokenIssuedAt ?? 0;
      const thirtyMinutes = 30 * 60 * 1000;
      const shouldRefresh = Date.now() - issuedAt > thirtyMinutes;

      if (shouldRefresh && !token.refreshToken) {
        // Past the refresh age with nothing to refresh with. The access token
        // will expire and cannot be recovered, so flag it rather than let the
        // 401 recovery path retry against a token that can never come back.
        return { ...token, error: "RefreshFailed" };
      }

      if (shouldRefresh && token.refreshToken) {
        try {
          const res = await fetch(`${API_BASE_URL}/auth/token/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh_token: token.refreshToken })
          });

          if (res.ok) {
            const payload = (await res.json()) as {
              data: { access_token: string; refresh_token?: string };
            };
            const { error: _cleared, ...rest } = token;
            return {
              ...rest,
              accessToken: payload.data.access_token,
              refreshToken: payload.data.refresh_token ?? (token.refreshToken as string),
              tokenIssuedAt: Date.now()
            };
          }
        } catch {
          // Network error reaching the API — same handling as a rejection below.
        }

        // The refresh did not succeed, so `accessToken` is very likely already
        // revoked server-side. Flag it: `fetch` doesn't throw on a non-2xx, so
        // silently returning the token here is what used to leave admins in a
        // zombie session — authenticated to NextAuth, 401 on every API call.
        //
        // tokenIssuedAt is deliberately NOT advanced, so the next poll retries.
        // The API replays a rotated refresh token within its grace window, and
        // that retry is what heals a rotation whose Set-Cookie was dropped.
        return { ...token, error: "RefreshFailed" };
      }

      return token;
    },

    /**
     * session callback — shapes the session object visible to the client.
     * Syncs role from backend via GET /auth/me.
     */
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id;
        session.user.phone = token.phone;
        session.user.role = token.role;
        session.user.preferredLanguage = token.preferredLanguage as "en" | "hi";
        session.accessToken = token.accessToken;
        session.isNewUser = Boolean(token.isNewUser);
        // Lets the app distinguish "signed in" from "holding a dead token" and
        // sign the user out instead of rendering a surface that only 401s.
        if (token.error) {
          session.error = token.error;
        }
        if (token.signupReward) {
          session.signupReward = {
            creditsGranted: token.signupReward.creditsGranted,
            expiresAt: token.signupReward.expiresAt
          };
        }
      }

      // Sync role from backend to catch permission changes in real-time
      if (token.accessToken) {
        try {
          const res = await fetch(`${API_BASE_URL}/auth/me`, {
            headers: {
              Authorization: `Bearer ${token.accessToken}`
            },
            cache: "no-store"
          });
          if (res.ok) {
            const payload = (await res.json()) as { data: MeResponse };
            session.user.role = payload.data.role;
            session.walletBalance = payload.data.wallet_balance ?? 0;
            session.promotionalCredits = {
              remaining: payload.data.promotional_credits_remaining ?? 0,
              expiresAt: payload.data.promotional_credits_expires_at ?? null
            };
          }
        } catch {
          // Silently ignore — keep the role from the token
        }
      }

      return session;
    },

    /**
     * redirect callback — sends users to their role-specific dashboard after login.
     */
    async redirect({ url, baseUrl }) {
      // Allow relative URLs
      if (url.startsWith("/")) return `${baseUrl}${url}`;

      // Allow same-origin callbackUrls
      if (new URL(url).origin === baseUrl) return url;

      return baseUrl;
    }
  },

  pages: {
    signIn: "/auth/login",
    error: "/auth/error"
  },

  session: {
    strategy: "jwt",
    // 24h idle ceiling. updateAge must stay below maxAge or Auth.js never
    // re-signs the cookie's `exp` and the session hard-expires at maxAge
    // regardless of activity (that was the bug: maxAge=1h with the default
    // 24h updateAge meant the slide condition never triggered).
    maxAge: 60 * 60 * 24,
    // Client polls /api/auth/session every 30s (session-provider.tsx), so a
    // 15-minute updateAge reliably re-signs well before the maxAge cliff for
    // any user with the tab open — sessions now extend while active instead
    // of dying on a fixed 1-hour clock.
    updateAge: 60 * 15
  },

  cookies: {
    sessionToken: {
      name: "cribliv.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax" as const,
        path: "/",
        secure: process.env.NODE_ENV === "production"
      }
    }
  }
};
