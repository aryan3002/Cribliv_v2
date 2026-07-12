import { BadRequestException } from "@nestjs/common";

export function optionalStringField(body: unknown, field: string): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestException({
      code: "invalid_payload",
      message: "Payload must be an object"
    });
  }

  const value = (body as Record<string, unknown>)[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new BadRequestException({
      code: "invalid_payload",
      message: `${field} must be a string`
    });
  }
  return value;
}
