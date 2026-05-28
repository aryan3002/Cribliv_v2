import { Body, Controller, Inject, Post, Req } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";
import { ok } from "../../common/response";
import type { Request } from "express";

@Controller()
export class AnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly analyticsService: AnalyticsService) {}

  @Post("analytics/event")
  async trackEvent(
    @Body()
    body: {
      listing_id: string;
      event_type: string;
      user_id?: string;
      session_id?: string;
      metadata?: Record<string, unknown>;
    },
    @Req() req: Request
  ) {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip;
    const userAgent = req.headers["user-agent"];

    await this.analyticsService.trackEvent({
      listing_id: body.listing_id,
      event_type: body.event_type,
      user_id: body.user_id,
      session_id: body.session_id,
      ip,
      user_agent: userAgent,
      metadata: body.metadata
    });

    return ok({ tracked: true });
  }
}
