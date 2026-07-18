import { Body, Controller, Post } from "@nestjs/common";
import { DemandSignalsService } from "./demand-signals.service";
import { ok } from "../../common/response";
import type { CreateDemandSignalDto } from "@cribliv/shared-types";

// Public: anonymous seekers on the voice map submit an unmet-demand spec.
// No AuthGuard. Rate-limited globally via ConditionalThrottlerGuard (APP_GUARD).
@Controller("demand-signals")
export class DemandSignalsController {
  constructor(private readonly demandSignalsService: DemandSignalsService) {}

  @Post()
  async create(@Body() dto: CreateDemandSignalDto) {
    const { id } = await this.demandSignalsService.create(dto ?? { filters: {} });
    return ok({ ok: true, id });
  }
}
