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
