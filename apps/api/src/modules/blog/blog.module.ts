import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { SeoModule } from "../seo/seo.module";
import { BlogBriefService } from "./blog-brief.service";
import { BlogEmbeddingService } from "./blog-embedding.service";
import { BlogGeneratorService } from "./blog-generator.service";
import { BlogInternalController } from "./blog-internal.controller";
import { BlogTopicPlannerService } from "./blog-topic-planner.service";
import { BlogController } from "./blog.controller";
import { BlogService } from "./blog.service";

@Module({
  imports: [AiModule, SeoModule],
  controllers: [BlogController, BlogInternalController],
  providers: [
    BlogService,
    BlogBriefService,
    BlogEmbeddingService,
    BlogGeneratorService,
    BlogTopicPlannerService
  ],
  exports: [
    BlogService,
    BlogBriefService,
    BlogEmbeddingService,
    BlogGeneratorService,
    BlogTopicPlannerService
  ]
})
export class BlogModule {}
