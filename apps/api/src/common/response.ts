import type { ApiSuccess } from "./types";

export function ok<T>(data: T, meta?: Record<string, unknown>): ApiSuccess<T> {
  return { data, meta };
}
