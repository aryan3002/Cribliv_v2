import { Module } from "@nestjs/common";
import { IntentClassifierService } from "./intent-classifier.service";
import { QueryParserService } from "./query-parser.service";
import { EmbeddingService } from "./embedding.service";
import { RankingService } from "./ranking.service";
import { AiAdminController } from "./ai-admin.controller";

@Module({
  controllers: [AiAdminController],
  providers: [IntentClassifierService, QueryParserService, EmbeddingService, RankingService],
  exports: [IntentClassifierService, QueryParserService, EmbeddingService, RankingService]
})
export class AiModule {}
