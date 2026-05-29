import { describe, it, expect } from "vitest";
import { zodToJsonSchema } from "zod-to-json-schema";
import { PgListingCreateSchema } from "../src/modules/pg-operator/dto/pg-listing.dto";

/**
 * Contract test — locks the wire shape of the PG listing create payload.
 * Web `lib/pg-operator-api.ts` will consume the SAME schema via
 * @cribliv/shared-types. Snapshot drift => PR blocker (kills the
 * "Backend-Reference drift" class of bug per lessons.md 2026-05-20).
 */
describe("PG Listing DTO contract", () => {
  it("matches the JSON schema snapshot", () => {
    const schema = zodToJsonSchema(PgListingCreateSchema, { name: "PgListingCreate" });
    expect(schema).toMatchSnapshot();
  });
});
