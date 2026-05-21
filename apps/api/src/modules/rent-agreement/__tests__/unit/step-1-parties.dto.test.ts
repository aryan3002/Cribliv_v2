import "reflect-metadata";

import { describe, expect, it } from "vitest";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";

import { PartyDto, Step1PartiesDto } from "../../validators/step-1-parties.dto";

/* ─── Helpers ───────────────────────────────────────────────────────────── */

const validOwner = {
  full_name: "John Doe",
  father_name: "Sam Doe",
  age: 35,
  phone: "+919876543210",
  permanent_address: "123 MG Road, Bangalore, KA"
};

const validTenant = {
  full_name: "Jane Smith",
  father_name: "Bob Smith",
  age: 28,
  phone: "+919876543211",
  permanent_address: "456 Park St, Mumbai, MH"
};

async function validateDto(payload: unknown) {
  const dto = plainToInstance(Step1PartiesDto, payload);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

async function validateParty(party: unknown) {
  // Validate via the parent so nested decorators fire correctly.
  const errors = await validateDto({ owner: party, tenant: validTenant });
  return errors.find((e) => e.property === "owner");
}

async function validateTenantParty(party: unknown) {
  const errors = await validateDto({ owner: validOwner, tenant: party });
  return errors.find((e) => e.property === "tenant");
}

function partyChildErrorFor(
  parentError: { children?: Array<{ property: string }> } | undefined,
  property: string
) {
  return parentError?.children?.find((c) => c.property === property);
}

/* ─── Happy path ────────────────────────────────────────────────────────── */

describe("Step1PartiesDto: happy path", () => {
  it("accepts a valid owner + tenant payload", async () => {
    const errors = await validateDto({ owner: validOwner, tenant: validTenant });
    expect(errors).toEqual([]);
  });

  it("accepts optional email, pan, aadhaar_last4 when all valid", async () => {
    const errors = await validateDto({
      owner: {
        ...validOwner,
        email: "john@example.com",
        pan: "ABCDE1234F",
        aadhaar_last4: "1234"
      },
      tenant: {
        ...validTenant,
        email: "jane@example.com",
        pan: "ZYXWV9876A",
        aadhaar_last4: "5678"
      }
    });
    expect(errors).toEqual([]);
  });
});

/* ─── full_name ─────────────────────────────────────────────────────────── */

describe("PartyDto.full_name", () => {
  it("rejects too short (<2)", async () => {
    const err = await validateParty({ ...validOwner, full_name: "A" });
    expect(partyChildErrorFor(err, "full_name")).toBeDefined();
  });

  it("rejects too long (>200)", async () => {
    const err = await validateParty({ ...validOwner, full_name: "A".repeat(201) });
    expect(partyChildErrorFor(err, "full_name")).toBeDefined();
  });

  it("accepts boundary length 2", async () => {
    const errors = await validateDto({
      owner: { ...validOwner, full_name: "Jo" },
      tenant: validTenant
    });
    expect(errors).toEqual([]);
  });

  it("accepts boundary length 200", async () => {
    const errors = await validateDto({
      owner: { ...validOwner, full_name: "A".repeat(200) },
      tenant: validTenant
    });
    expect(errors).toEqual([]);
  });

  it("rejects non-string", async () => {
    const err = await validateParty({ ...validOwner, full_name: 123 });
    expect(partyChildErrorFor(err, "full_name")).toBeDefined();
  });
});

/* ─── father_name ───────────────────────────────────────────────────────── */

describe("PartyDto.father_name", () => {
  it("rejects too short (<2)", async () => {
    const err = await validateParty({ ...validOwner, father_name: "X" });
    expect(partyChildErrorFor(err, "father_name")).toBeDefined();
  });

  it("rejects too long (>200)", async () => {
    const err = await validateParty({ ...validOwner, father_name: "B".repeat(201) });
    expect(partyChildErrorFor(err, "father_name")).toBeDefined();
  });

  it("accepts boundary length 2", async () => {
    const errors = await validateDto({
      owner: { ...validOwner, father_name: "Sa" },
      tenant: validTenant
    });
    expect(errors).toEqual([]);
  });

  it("accepts boundary length 200", async () => {
    const errors = await validateDto({
      owner: { ...validOwner, father_name: "B".repeat(200) },
      tenant: validTenant
    });
    expect(errors).toEqual([]);
  });
});

/* ─── age ───────────────────────────────────────────────────────────────── */

describe("PartyDto.age", () => {
  it("rejects 17 (too low)", async () => {
    const err = await validateParty({ ...validOwner, age: 17 });
    expect(partyChildErrorFor(err, "age")).toBeDefined();
  });

  it("accepts 18 (boundary)", async () => {
    const errors = await validateDto({
      owner: { ...validOwner, age: 18 },
      tenant: validTenant
    });
    expect(errors).toEqual([]);
  });

  it("accepts 120 (boundary)", async () => {
    const errors = await validateDto({
      owner: { ...validOwner, age: 120 },
      tenant: validTenant
    });
    expect(errors).toEqual([]);
  });

  it("rejects 121 (too high)", async () => {
    const err = await validateParty({ ...validOwner, age: 121 });
    expect(partyChildErrorFor(err, "age")).toBeDefined();
  });

  it("rejects non-integer (18.5)", async () => {
    const err = await validateParty({ ...validOwner, age: 18.5 });
    expect(partyChildErrorFor(err, "age")).toBeDefined();
  });

  it("rejects non-number string", async () => {
    const err = await validateParty({ ...validOwner, age: "35" });
    expect(partyChildErrorFor(err, "age")).toBeDefined();
  });
});

/* ─── phone ─────────────────────────────────────────────────────────────── */

describe("PartyDto.phone", () => {
  it("accepts valid +91 mobile", async () => {
    const errors = await validateDto({
      owner: { ...validOwner, phone: "+919876543210" },
      tenant: validTenant
    });
    expect(errors).toEqual([]);
  });

  it("rejects missing +91 prefix", async () => {
    const err = await validateParty({ ...validOwner, phone: "9876543210" });
    expect(partyChildErrorFor(err, "phone")).toBeDefined();
  });

  it("rejects wrong mobile prefix (5xxxxxxxxx)", async () => {
    const err = await validateParty({ ...validOwner, phone: "+915876543210" });
    expect(partyChildErrorFor(err, "phone")).toBeDefined();
  });

  it("rejects too short", async () => {
    const err = await validateParty({ ...validOwner, phone: "+9198765" });
    expect(partyChildErrorFor(err, "phone")).toBeDefined();
  });

  it("rejects too long", async () => {
    const err = await validateParty({ ...validOwner, phone: "+9198765432109" });
    expect(partyChildErrorFor(err, "phone")).toBeDefined();
  });

  it("rejects non-string", async () => {
    const err = await validateParty({ ...validOwner, phone: 9876543210 });
    expect(partyChildErrorFor(err, "phone")).toBeDefined();
  });
});

/* ─── email (optional) ──────────────────────────────────────────────────── */

describe("PartyDto.email", () => {
  it("accepts when omitted", async () => {
    const errors = await validateDto({
      owner: { ...validOwner }, // no email
      tenant: validTenant
    });
    expect(errors).toEqual([]);
  });

  it("accepts a valid email", async () => {
    const errors = await validateDto({
      owner: { ...validOwner, email: "owner@example.com" },
      tenant: validTenant
    });
    expect(errors).toEqual([]);
  });

  it("rejects an invalid email", async () => {
    const err = await validateParty({ ...validOwner, email: "not-an-email" });
    expect(partyChildErrorFor(err, "email")).toBeDefined();
  });
});

/* ─── permanent_address ─────────────────────────────────────────────────── */

describe("PartyDto.permanent_address", () => {
  it("rejects <10 chars", async () => {
    const err = await validateParty({ ...validOwner, permanent_address: "Too short" });
    expect(partyChildErrorFor(err, "permanent_address")).toBeDefined();
  });

  it("accepts exactly 10 chars (boundary)", async () => {
    const errors = await validateDto({
      owner: { ...validOwner, permanent_address: "1234567890" },
      tenant: validTenant
    });
    expect(errors).toEqual([]);
  });

  it("accepts exactly 500 chars (boundary)", async () => {
    const errors = await validateDto({
      owner: { ...validOwner, permanent_address: "A".repeat(500) },
      tenant: validTenant
    });
    expect(errors).toEqual([]);
  });

  it("rejects >500 chars", async () => {
    const err = await validateParty({
      ...validOwner,
      permanent_address: "A".repeat(501)
    });
    expect(partyChildErrorFor(err, "permanent_address")).toBeDefined();
  });
});

/* ─── pan (optional) ────────────────────────────────────────────────────── */

describe("PartyDto.pan", () => {
  it("accepts when omitted", async () => {
    const errors = await validateDto({ owner: { ...validOwner }, tenant: validTenant });
    expect(errors).toEqual([]);
  });

  it("accepts valid PAN", async () => {
    const errors = await validateDto({
      owner: { ...validOwner, pan: "ABCDE1234F" },
      tenant: validTenant
    });
    expect(errors).toEqual([]);
  });

  it("rejects lowercase PAN", async () => {
    const err = await validateParty({ ...validOwner, pan: "abcde1234f" });
    expect(partyChildErrorFor(err, "pan")).toBeDefined();
  });

  it("rejects PAN missing trailing letter", async () => {
    const err = await validateParty({ ...validOwner, pan: "ABCDE1234" });
    expect(partyChildErrorFor(err, "pan")).toBeDefined();
  });
});

/* ─── aadhaar_last4 (optional) ──────────────────────────────────────────── */

describe("PartyDto.aadhaar_last4", () => {
  it("accepts when omitted", async () => {
    const errors = await validateDto({ owner: { ...validOwner }, tenant: validTenant });
    expect(errors).toEqual([]);
  });

  it("accepts exactly 4 digits", async () => {
    const errors = await validateDto({
      owner: { ...validOwner, aadhaar_last4: "1234" },
      tenant: validTenant
    });
    expect(errors).toEqual([]);
  });

  it("rejects 3 digits", async () => {
    const err = await validateParty({ ...validOwner, aadhaar_last4: "123" });
    expect(partyChildErrorFor(err, "aadhaar_last4")).toBeDefined();
  });

  it("rejects 5 digits", async () => {
    const err = await validateParty({ ...validOwner, aadhaar_last4: "12345" });
    expect(partyChildErrorFor(err, "aadhaar_last4")).toBeDefined();
  });

  it("rejects letters", async () => {
    const err = await validateParty({ ...validOwner, aadhaar_last4: "12A4" });
    expect(partyChildErrorFor(err, "aadhaar_last4")).toBeDefined();
  });
});

/* ─── Top-level structural rules ────────────────────────────────────────── */

describe("Step1PartiesDto: top-level structure", () => {
  it("rejects when owner is missing", async () => {
    const errors = await validateDto({ tenant: validTenant });
    expect(errors.find((e) => e.property === "owner")).toBeDefined();
  });

  it("rejects when tenant is missing", async () => {
    const errors = await validateDto({ owner: validOwner });
    expect(errors.find((e) => e.property === "tenant")).toBeDefined();
  });

  it("rejects unknown extra field at top level (forbidNonWhitelisted)", async () => {
    const errors = await validateDto({
      owner: validOwner,
      tenant: validTenant,
      surprise: "not allowed"
    });
    expect(errors.find((e) => e.property === "surprise")).toBeDefined();
  });

  it("rejects unknown extra field inside a party (forbidNonWhitelisted)", async () => {
    const errors = await validateDto({
      owner: { ...validOwner, nickname: "Johnny" },
      tenant: validTenant
    });
    const ownerErr = errors.find((e) => e.property === "owner");
    expect(partyChildErrorFor(ownerErr, "nickname")).toBeDefined();
  });
});

/* ─── Independence: tenant errors are tenant-scoped ─────────────────────── */

describe("Step1PartiesDto: tenant branch validates independently", () => {
  it("invalid tenant alone produces a tenant-scoped error (owner stays clean)", async () => {
    const err = await validateTenantParty({ ...validTenant, phone: "9999999999" });
    expect(err).toBeDefined();
    expect(partyChildErrorFor(err, "phone")).toBeDefined();
  });

  it("owner-only error does not pollute tenant branch", async () => {
    const errors = await validateDto({
      owner: { ...validOwner, age: 10 },
      tenant: validTenant
    });
    expect(errors.find((e) => e.property === "tenant")).toBeUndefined();
    expect(errors.find((e) => e.property === "owner")).toBeDefined();
  });
});

/* ─── Both branches independently surface their own errors ──────────────── */

describe("Step1PartiesDto: both branches in parallel", () => {
  it("collects errors from both owner and tenant simultaneously", async () => {
    const errors = await validateDto({
      owner: { ...validOwner, age: 17 },
      tenant: { ...validTenant, phone: "12345" }
    });
    const ownerErr = errors.find((e) => e.property === "owner");
    const tenantErr = errors.find((e) => e.property === "tenant");
    expect(partyChildErrorFor(ownerErr, "age")).toBeDefined();
    expect(partyChildErrorFor(tenantErr, "phone")).toBeDefined();
  });
});

/* ─── Re-export sanity ──────────────────────────────────────────────────── */

describe("Module exports", () => {
  it("exports both PartyDto and Step1PartiesDto as constructors", () => {
    expect(typeof PartyDto).toBe("function");
    expect(typeof Step1PartiesDto).toBe("function");
  });
});
