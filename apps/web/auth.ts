/**
 * apps/web/auth.ts
 *
 * Main NextAuth v5 configuration.
 * Exports: handlers (for API route), auth (server-side session helper),
 *          signIn, signOut.
 *
 * Type augmentations extend next-auth's built-in Session / JWT / User
 * to include Cribliv-specific fields (role, phone, accessToken, etc.).
 */

import NextAuth from "next-auth";
import type { DefaultSession } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";
import { authConfig, type UserRole } from "./auth.config";

// ---------------------------------------------------------------------------
// Module augmentation — extend built-in next-auth types
// ---------------------------------------------------------------------------

declare module "next-auth" {
  interface Session {
    /** JWT access token forwarded to the Next.js app for API calls */
    accessToken: string;
    /** Wallet credit balance, synced from /auth/me on every session read */
    walletBalance: number;
    user: {
      id: string;
      phone: string;
      role: UserRole;
      preferredLanguage: "en" | "hi";
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    phone: string;
    role: UserRole;
    preferredLanguage: "en" | "hi";
    accessToken: string;
    refreshToken: string | null;
    tokenIssuedAt: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    phone: string;
    role: UserRole;
    preferredLanguage: string;
    accessToken: string;
    refreshToken: string | null;
    tokenIssuedAt: number;
  }
}

// ---------------------------------------------------------------------------
// NextAuth initialisation
// ---------------------------------------------------------------------------

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

/**
 * authOptions is a convenience re-export of authConfig so that server
 * components can pass it to getServerSession() from next-auth helpers.
 */
export const authOptions = authConfig;
