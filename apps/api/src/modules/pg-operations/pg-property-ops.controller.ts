import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards
} from "@nestjs/common";
import type { PgBedStatus, PgLayoutPutInput, PgLayoutRoomCountInput } from "@cribliv/shared-types";

import { AuthGuard } from "../../common/auth.guard";
import { AuthUser } from "../../common/auth-user.decorator";
import { ok } from "../../common/response";
import { Roles } from "../../common/roles.decorator";
import { RolesGuard } from "../../common/roles.guard";
import type { UserContext } from "../../common/types";
import { PgLayoutService } from "./services/pg-layout.service";
import { PgOccupancyService } from "./services/pg-occupancy.service";

@Controller("pg-operator/properties")
@UseGuards(AuthGuard, RolesGuard)
@Roles("pg_operator")
export class PgPropertyOpsController {
  constructor(
    @Inject(PgLayoutService) private readonly layouts: PgLayoutService,
    @Inject(PgOccupancyService) private readonly occupancy: PgOccupancyService
  ) {}

  @Get()
  async list(@AuthUser() user: UserContext) {
    return ok({ items: await this.occupancy.listManagedProperties(user.id) });
  }

  @Get(":propertyId")
  async get(@AuthUser() user: UserContext, @Param("propertyId") propertyId: string) {
    return ok(await this.occupancy.getManagedProperty(user.id, propertyId));
  }

  @Get(":propertyId/layout")
  async getLayout(@AuthUser() user: UserContext, @Param("propertyId") propertyId: string) {
    return ok(await this.layouts.getLayout(user.id, propertyId));
  }

  @Post(":propertyId/layout/generate")
  async generateLayout(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Body() body: { room_counts?: PgLayoutRoomCountInput[] }
  ) {
    return ok(await this.layouts.generateDraft(user.id, propertyId, body?.room_counts ?? []));
  }

  @Put(":propertyId/layout")
  async putLayout(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Body() body: PgLayoutPutInput
  ) {
    return ok(await this.layouts.putLayout(user.id, propertyId, body));
  }

  @Get(":propertyId/occupancy")
  async getOccupancy(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Query("floor") floor?: string,
    @Query("status") status?: PgBedStatus,
    @Query("available_from") availableFrom?: string
  ) {
    return ok(
      await this.occupancy.summary(user.id, propertyId, {
        floor: floor === undefined ? undefined : Number(floor),
        status,
        available_from: availableFrom
      })
    );
  }

  @Patch(":propertyId/beds/:bedId/status")
  async updateBedStatus(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("bedId") bedId: string,
    @Body() body: { status: PgBedStatus }
  ) {
    return ok(await this.occupancy.updateBedStatus(user.id, propertyId, bedId, body?.status));
  }

  @Post(":propertyId/beds/:bedId/relist")
  async relistBed(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("bedId") bedId: string
  ) {
    return ok(await this.occupancy.relistBed(user.id, propertyId, bedId));
  }
}
