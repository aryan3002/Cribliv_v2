import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  UseGuards
} from "@nestjs/common";
import { AuthGuard } from "../../common/auth.guard";
import { AuthUser } from "../../common/auth-user.decorator";
import type { UserContext } from "../../common/types";
import { PgFunnelService } from "./services/pg-funnel.service";
import { PgFunnelEventSchema } from "./dto/pg-funnel.dto";

/**
 * Funnel-event ingest for the PG listing process. The shipped web client
 * (apps/web/lib/pg-funnel.ts) POSTs best-effort events here; we attach the
 * authenticated operator and persist. Returns 202 (accepted, fire-and-forget).
 */
@Controller("pg-operator")
@UseGuards(AuthGuard)
export class PgFunnelController {
  constructor(@Inject(PgFunnelService) private readonly funnel: PgFunnelService) {}

  @Post("funnel")
  @HttpCode(202)
  async ingest(@AuthUser() user: UserContext, @Body() body: unknown): Promise<{ accepted: true }> {
    const parsed = PgFunnelEventSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "invalid_funnel_event",
        message: parsed.error.message
      });
    }
    await this.funnel.track(user.id, parsed.data);
    return { accepted: true };
  }
}
