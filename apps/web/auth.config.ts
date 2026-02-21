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
            tokenIssuedAt: Date.now()
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
          id: user.id as string,
          phone: (user as { phone: string }).phone,
          role: (user as { role: UserRole }).role,
          preferredLanguage: (user as { preferredLanguage: string }).preferredLanguage,
          accessToken: (user as { accessToken: string }).accessToken,
          refreshToken: (user as { refreshToken: string | null }).refreshToken,
          tokenIssuedAt: Date.now()
        };
      }

      // Subsequent calls: rotate if token is older than 30 minutes
      const issuedAt = (token.tokenIssuedAt as number) ?? 0;
      const thirtyMinutes = 30 * 60 * 1000;
      const shouldRefresh = Date.now() - issuedAt > thirtyMinutes;

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
            return {
              ...token,
              accessToken: payload.data.access_token,
              refreshToken: payload.data.refresh_token ?? (token.refreshToken as string),
              tokenIssuedAt: Date.now()
            };
          }
        } catch {
          // Refresh failed — let the existing token stand until it expires
        }
      }

      return token;
    },

    /**
     * session callback — shapes the session object visible to the client.
     * Syncs role from backend via GET /auth/me.
     */
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        (session.user as { phone?: string }).phone = token.phone as string;
        (session.user as { role?: UserRole }).role = token.role as UserRole;
        (session.user as { preferredLanguage?: string }).preferredLanguage =
          token.preferredLanguage as string;
        (session as { accessToken?: string }).accessToken = token.accessToken as string;
      }

      // Sync role from backend to catch permission changes in real-time
      if (token.accessToken) {
        try {
          const res = await fetch(`${API_BASE_URL}/auth/me`, {
            headers: {
              Authorization: `Bearer ${token.accessToken as string}`
            },
            cache: "no-store"
          });
          if (res.ok) {
            const payload = (await res.json()) as { data: MeResponse };
            (session.user as { role?: UserRole }).role = payload.data.role;
            (session as { walletBalance?: number }).walletBalance =
              payload.data.wallet_balance ?? 0;
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
    // 1 hour — tokens rotate at 30 min via the jwt callback
    maxAge: 60 * 60
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
