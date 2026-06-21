import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { SeoController } from "../src/modules/seo/seo.controller";
import { AuthGuard } from "../src/common/auth.guard";

describe("SeoController security", () => {
  it("protects POST /seo/copy with AuthGuard", () => {
    const guards = (Reflect.getMetadata(GUARDS_METADATA, SeoController.prototype.generateCopy) ??
      []) as Array<new (...args: unknown[]) => unknown>;
    expect(guards).toEqual(expect.arrayContaining([AuthGuard]));
  });
});
