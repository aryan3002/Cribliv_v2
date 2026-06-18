import type { AppStateService } from "./app-state.service";
import type { DatabaseService } from "./database.service";
import type { Role } from "./types";

/**
 * Resolve an authenticated user from a bearer access token (`acc_<sessionId>`).
 *
 * This is the exact session-lookup `AuthGuard` performs, factored out so
 * non-HTTP entry points (e.g. the PG voice WebSocket gateway) can authenticate
 * a handshake token instead of trusting client-supplied identity (audit SEC-C2).
 *
 * Returns the verified `{ id, role }` or `null` if the token is missing/invalid
 * or the session is revoked/expired. Never throws.
 */
export async function resolveSessionUser(
  token: string | undefined,
  database: DatabaseService,
  appState: AppStateService
): Promise<{ id: string; role: Role } | null> {
  const sessionId = token?.startsWith("acc_") ? token.slice(4) : undefined;
  const sessionIdLooksValid = Boolean(sessionId && /^[0-9a-f-]{36}$/i.test(sessionId));

  if (database.isEnabled() && sessionIdLooksValid) {
    try {
      const result = await database.query<{ id: string; role: Role }>(
        `
          SELECT u.id, u.role
          FROM sessions s
          JOIN users u ON u.id = s.user_id
          WHERE s.id = $1::uuid
            AND s.revoked_at IS NULL
            AND s.expires_at > now()
        `,
        [sessionId]
      );
      if (result.rowCount && result.rows[0]) {
        return { id: result.rows[0].id, role: result.rows[0].role };
      }
    } catch {
      // Fall through to in-memory lookup (parity with AuthGuard local bootstrap).
    }
  }

  if (token) {
    const user = appState.getUserByAccessToken(token);
    if (user) return { id: user.id, role: user.role as Role };
  }

  return null;
}
