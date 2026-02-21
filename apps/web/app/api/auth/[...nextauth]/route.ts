/**
 * apps/web/app/api/auth/[...nextauth]/route.ts
 *
 * NextAuth v5 catch-all route handler.
 * Handles all NextAuth HTTP endpoints:
 *   GET  /api/auth/session
 *   GET  /api/auth/csrf
 *   GET  /api/auth/providers
 *   GET  /api/auth/signout
 *   POST /api/auth/signin
 *   POST /api/auth/callback/credentials
 *   POST /api/auth/signout
 *   ...
 */

import { handlers } from "../../../../auth";

export const { GET, POST } = handlers;
