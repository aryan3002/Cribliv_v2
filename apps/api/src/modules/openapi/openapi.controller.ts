import { Controller, Get, Header } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { buildOpenApiDocument } from "./openapi.document";

/**
 * Unauthenticated, machine-readable description of Cribliv's public read API.
 *
 * Hand-authored (not generated from controllers) so we never accidentally
 * advertise admin/owner internal routes or auth-protected mutations to agents.
 * Bumped manually when public surface changes.
 */
@Controller()
export class OpenApiController {
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get("openapi.json")
  @Header("Content-Type", "application/openapi+json; charset=utf-8")
  @Header("Cache-Control", "public, max-age=300")
  openapi() {
    return buildOpenApiDocument();
  }
}
