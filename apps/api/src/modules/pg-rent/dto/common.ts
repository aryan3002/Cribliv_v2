import { BadRequestException } from "@nestjs/common";
import type { z } from "zod";

/** pg `date` columns arrive as JS Dates at local midnight (the driver parses them as local time). */
export function toIsoDate(value: Date | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return value.slice(0, 10);
}

export function toIsoTs(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** The admin.controller.ts:1314 pattern, centralised. */
export function parseOrThrow<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException({
      code: "invalid_payload",
      message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    });
  }
  return parsed.data;
}
