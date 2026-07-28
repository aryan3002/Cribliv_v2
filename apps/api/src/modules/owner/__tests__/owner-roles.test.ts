import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { OwnerController } from "../owner.controller";

/**
 * The listing wizard is reused inside the admin portal (create-on-behalf), so
 * the endpoints it calls must accept an admin caller. Ownership scoping still
 * happens in the service layer against req.user.id.
 */
const WIZARD_METHODS = [
  "list",
  "create",
  "getListing",
  "update",
  "presign",
  "complete",
  "reorderPhotos",
  "submit",
  "generateContent"
] as const;

/**
 * These routes must remain owner-only and never accept admin.
 * Ownership scoping happens in the service layer, but at the route level,
 * these are intentionally restricted to the owner role only.
 */
const OWNER_ONLY_METHODS = ["toggleAvailability", "setAvailability", "markResponded"] as const;

describe("OwnerController wizard endpoints", () => {
  for (const method of WIZARD_METHODS) {
    it(`${method} accepts an admin caller`, () => {
      const roles = Reflect.getMetadata("roles", (OwnerController.prototype as any)[method]);
      expect(roles, `${method} must declare its own @Roles`).toBeDefined();
      expect(roles).toContain("admin");
      expect(roles).toContain("owner");
    });
  }
});

describe("OwnerController owner-only endpoints", () => {
  for (const method of OWNER_ONLY_METHODS) {
    it(`${method} stays owner-only`, () => {
      const roles = Reflect.getMetadata("roles", (OwnerController.prototype as any)[method]);
      // No method-level @Roles: falls through to the class-level @Roles("owner").
      expect(roles).toBeUndefined();
    });
  }
});
