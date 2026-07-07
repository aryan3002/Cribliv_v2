import { UnauthorizedException } from "@nestjs/common";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ApiKeyGuard } from "../src/common/api-key.guard";

function ctx(headers: Record<string, string>) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) })
  } as never;
}

describe("ApiKeyGuard", () => {
  const OLD = process.env.BLOG_WORKER_API_KEY;

  beforeEach(() => {
    process.env.BLOG_WORKER_API_KEY = "secret-key-123";
  });

  afterEach(() => {
    if (OLD === undefined) delete process.env.BLOG_WORKER_API_KEY;
    else process.env.BLOG_WORKER_API_KEY = OLD;
  });

  it("allows a request with the correct x-api-key", () => {
    const guard = new ApiKeyGuard();
    expect(guard.canActivate(ctx({ "x-api-key": "secret-key-123" }))).toBe(true);
  });

  it("rejects a wrong key", () => {
    const guard = new ApiKeyGuard();
    expect(() => guard.canActivate(ctx({ "x-api-key": "wrong" }))).toThrow(UnauthorizedException);
  });

  it("rejects a missing key", () => {
    const guard = new ApiKeyGuard();
    expect(() => guard.canActivate(ctx({}))).toThrow(UnauthorizedException);
  });

  it("fails closed when BLOG_WORKER_API_KEY is unset", () => {
    delete process.env.BLOG_WORKER_API_KEY;
    const guard = new ApiKeyGuard();
    expect(() => guard.canActivate(ctx({ "x-api-key": "anything" }))).toThrow(
      UnauthorizedException
    );
  });
});
