import { BadRequestException } from "@nestjs/common";

export function requireIdempotencyKey(key?: string) {
  if (!key || !key.trim()) {
    throw new BadRequestException({
      code: "missing_idempotency_key",
      message: "Idempotency-Key header is required"
    });
  }

  return key.trim();
}
