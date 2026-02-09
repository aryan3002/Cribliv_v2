import { Module } from "@nestjs/common";
import { PgController } from "./pg.controller";

@Module({
  controllers: [PgController]
})
export class PgModule {}
