import { Controller, Inject, Post, UseGuards } from "@nestjs/common";
import { ok } from "../../common/response";
import { AuthGuard } from "../../common/auth.guard";
import { EmbeddingService } from "./embedding.service";
import { RankingService } from "./ranking.service";

/**
 * Admin-only endpoints for triggering AI background jobs.
 * Protected by AuthGuard (admin role).
 */
@Controller("admin/ai")
@UseGuards(AuthGuard)
export class AiAdminController {
  constructor(
    @Inject(EmbeddingService) private readonly embedding: EmbeddingService,
    @Inject(RankingService) private readonly ranking: RankingService
  ) {}

  /** Backfill embeddings for listings that don't have them yet */
  @Post("backfill-embeddings")
  async backfillEmbeddings() {
    const count = await this.embedding.backfillEmbeddings(100);
    return ok({ backfilled: count });
  }

  /** Recompute materialized ranking scores for active listings */
  @Post("recompute-scores")
  async recomputeScores() {
    const count = await this.ranking.recomputeScores(500);
    return ok({ recomputed: count });
  }
}
