import { describe, expect, it } from "vitest";
import { VerificationService } from "../src/modules/verification/verification.service";

describe("Verification payload masking", () => {
  it("redacts sensitive identity and address fields in provider payloads", () => {
    const service = new VerificationService({} as any, {} as any, {} as any, {} as any);

    const masked = (service as any).maskPayload({
      consumer_id: "CONS-99887766",
      address_text: "House 14, Sector 52, Gurugram",
      owner_id: "owner-123",
      nested: {
        user_name: "Alice",
        person_phone: "+919900001111",
        address_line_1: "Apartment 1201"
      },
      provider_reference: "ref-abc"
    }) as Record<string, unknown>;

    expect(masked.consumer_id).toBe("***7766");
    expect(masked.address_text).toBe("[redacted_address_29]");
    expect(masked.owner_id).toBe("[redacted_person]");
    expect(masked.provider_reference).toBe("ref-abc");

    const nested = masked.nested as Record<string, unknown>;
    expect(nested.user_name).toBe("[redacted_person]");
    expect(nested.person_phone).toBe("[redacted_person]");
    expect(nested.address_line_1).toBe("[redacted_address_14]");
  });
});
