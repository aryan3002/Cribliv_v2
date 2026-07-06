import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.BLOG_WORKER_API_KEY?.trim();
    const request = context.switchToHttp().getRequest();
    const provided = (request.headers["x-api-key"] as string | undefined)?.trim();

    if (!expected || !provided) {
      throw new UnauthorizedException({ code: "unauthorized", message: "Invalid API key" });
    }

    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(provided);
    if (
      expectedBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(expectedBuffer, providedBuffer)
    ) {
      throw new UnauthorizedException({ code: "unauthorized", message: "Invalid API key" });
    }

    return true;
  }
}
