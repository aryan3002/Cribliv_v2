import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  UseGuards
} from "@nestjs/common";
import type {
  PgBedAssignmentListFilters,
  PgBedAssignmentOccupantInput
} from "@cribliv/shared-types";

import { AuthGuard } from "../../common/auth.guard";
import { AuthUser } from "../../common/auth-user.decorator";
import { IdempotencyService, PASSTHROUGH_IDEMPOTENCY } from "../../common/idempotency.service";
import { requireIdempotencyKey } from "../../common/idempotency.util";
import { ok } from "../../common/response";
import { Roles } from "../../common/roles.decorator";
import { RolesGuard } from "../../common/roles.guard";
import type { UserContext } from "../../common/types";
import { PgBedAssignmentService } from "./services/pg-bed-assignment.service";

@Controller("pg-operator/properties")
@UseGuards(AuthGuard, RolesGuard)
@Roles("pg_operator")
export class PgAssignmentController {
  constructor(
    @Inject(PgBedAssignmentService) private readonly assignments: PgBedAssignmentService,
    @Optional() @Inject(IdempotencyService) private readonly idem: IdempotencyService | undefined
  ) {}

  @Get(":propertyId/assignments")
  async list(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Query("status") status?: PgBedAssignmentListFilters["status"],
    @Query("bed_id") bedId?: string,
    @Query("tenant_user_id") tenantUserId?: string
  ) {
    return ok(
      await this.assignments.list(user.id, propertyId, {
        status,
        bed_id: bedId,
        tenant_user_id: tenantUserId
      })
    );
  }

  @Get(":propertyId/beds/:bedId")
  async getBedDetail(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("bedId") bedId: string
  ) {
    return ok(await this.assignments.getBedDetail(user.id, propertyId, bedId));
  }

  @Post(":propertyId/beds/:bedId/reserve")
  async reserve(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("bedId") bedId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: PgBedAssignmentOccupantInput
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    return ok(
      await (this.idem ?? PASSTHROUGH_IDEMPOTENCY).run(
        user.id,
        `pg-operator:properties:${propertyId}:beds:${bedId}:reserve`,
        key,
        () => this.assignments.reserve(user.id, propertyId, bedId, body)
      )
    );
  }

  @Post(":propertyId/beds/:bedId/move-in")
  async moveIn(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("bedId") bedId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: PgBedAssignmentOccupantInput
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    return ok(
      await (this.idem ?? PASSTHROUGH_IDEMPOTENCY).run(
        user.id,
        `pg-operator:properties:${propertyId}:beds:${bedId}:move-in`,
        key,
        () => this.assignments.moveIn(user.id, propertyId, bedId, body)
      )
    );
  }

  @Post(":propertyId/assignments/:id/operator-move-out-request")
  async operatorMoveOutRequest(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") assignmentId: string
  ) {
    return ok(await this.assignments.operatorMoveOutRequest(user.id, propertyId, assignmentId));
  }

  @Post(":propertyId/assignments/:id/confirm-move-out")
  async confirmMoveOut(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") assignmentId: string
  ) {
    return ok(await this.assignments.confirmMoveOut(user.id, propertyId, assignmentId));
  }

  @Post(":propertyId/assignments/:id/move-out-now")
  async moveOutNow(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") assignmentId: string
  ) {
    return ok(await this.assignments.operatorDirectMoveOut(user.id, propertyId, assignmentId));
  }

  @Post(":propertyId/assignments/:id/cancel-move-out")
  async cancelMoveOut(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") assignmentId: string
  ) {
    return ok(await this.assignments.cancelMoveOut(user.id, propertyId, assignmentId));
  }
}
