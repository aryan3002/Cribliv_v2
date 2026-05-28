import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { AppStateService } from "./app-state.service";
import { DatabaseService } from "./database.service";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Inject(DatabaseService) private readonly database: DatabaseService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const auth = request.headers.authorization as string | undefined;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
    const sessionId = token?.startsWith("acc_") ? token.slice(4) : undefined;
    const sessionIdLooksValid = Boolean(sessionId && /^[0-9a-f-]{36}$/i.test(sessionId));

    if (this.database.isEnabled() && sessionIdLooksValid) {
      try {
        const result = await this.database.query<{
          id: string;
          role: "tenant" | "owner" | "pg_operator" | "admin";
        }>(
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
          request.user = {
            id: result.rows[0].id,
            role: result.rows[0].role
          };
          return true;
        }
      } catch {
        // Fallback to in-memory session lookup during local bootstrap.
      }
    }

    const user = this.appState.getUserByAccessToken(token);
    if (user) {
      request.user = {
        id: user.id,
        role: user.role
      };
      return true;
    }

    throw new UnauthorizedException({ code: "unauthorized", message: "Unauthorized" });
  }
}
