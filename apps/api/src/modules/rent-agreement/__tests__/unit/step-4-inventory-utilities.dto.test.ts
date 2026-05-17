import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { Step4InventoryUtilitiesDto } from "../../validators/step-4-inventory-utilities.dto";

async function validateDto(payload: unknown) {
  const dto = plainToInstance(Step4InventoryUtilitiesDto, payload);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

const VALID = {
  rent_due_day: 5,
  rent_payment_method: "upi",
  maintenance_included: true,
  electricity_paid_by: "tenant",
  water_paid_by: "tenant",
  gas_paid_by: "tenant",
  society_charges_paid_by: "shared",
  late_payment_penalty_pct: 2.5
};

describe("Step4InventoryUtilitiesDto: baseline", () => {
  it("accepts the minimal valid payload", async () => {
    const errors = await validateDto(VALID);
    expect(errors).toEqual([]);
  });
});

describe("Step4InventoryUtilitiesDto: inventory_items (optional array)", () => {
  it("accepts payload with inventory_items omitted", async () => {
    const errors = await validateDto(VALID);
    expect(errors).toEqual([]);
  });

  it("accepts an empty inventory_items array", async () => {
    const errors = await validateDto({ ...VALID, inventory_items: [] });
    expect(errors).toEqual([]);
  });

  it("accepts a valid array of inventory items", async () => {
    const errors = await validateDto({
      ...VALID,
      inventory_items: [
        { item: "Bed", quantity: 2, condition: "good" },
        { item: "Fridge", quantity: 1, condition: "new" }
      ]
    });
    expect(errors).toEqual([]);
  });

  it("rejects inventory_items that is not an array", async () => {
    const errors = await validateDto({ ...VALID, inventory_items: "not-an-array" });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === "inventory_items")).toBeDefined();
  });

  it("rejects nested item with quantity = 0", async () => {
    const errors = await validateDto({
      ...VALID,
      inventory_items: [{ item: "Bed", quantity: 0, condition: "good" }]
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === "inventory_items")).toBeDefined();
  });

  it("rejects nested item with quantity = -1 (negative)", async () => {
    const errors = await validateDto({
      ...VALID,
      inventory_items: [{ item: "Bed", quantity: -1, condition: "good" }]
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === "inventory_items")).toBeDefined();
  });

  it("rejects nested item with quantity = 1001 (above max)", async () => {
    const errors = await validateDto({
      ...VALID,
      inventory_items: [{ item: "Bed", quantity: 1001, condition: "good" }]
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === "inventory_items")).toBeDefined();
  });

  it("rejects nested item with unknown condition", async () => {
    const errors = await validateDto({
      ...VALID,
      inventory_items: [{ item: "Bed", quantity: 1, condition: "broken" }]
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === "inventory_items")).toBeDefined();
  });

  it("rejects more than 50 inventory items", async () => {
    const items = Array.from({ length: 51 }, (_, i) => ({
      item: `Item ${i}`,
      quantity: 1,
      condition: "good" as const
    }));
    const errors = await validateDto({ ...VALID, inventory_items: items });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === "inventory_items")).toBeDefined();
  });

  it("accepts exactly 50 inventory items (boundary)", async () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      item: `Item ${i}`,
      quantity: 1,
      condition: "good" as const
    }));
    const errors = await validateDto({ ...VALID, inventory_items: items });
    expect(errors).toEqual([]);
  });
});

describe("Step4InventoryUtilitiesDto: inventory item — fields", () => {
  it("accepts a valid item", async () => {
    const errors = await validateDto({
      ...VALID,
      inventory_items: [{ item: "Sofa", quantity: 1, condition: "fair" }]
    });
    expect(errors).toEqual([]);
  });

  it("rejects nested item with missing item field", async () => {
    const errors = await validateDto({
      ...VALID,
      inventory_items: [{ quantity: 1, condition: "good" }]
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === "inventory_items")).toBeDefined();
  });

  it("rejects nested item with empty-string item", async () => {
    const errors = await validateDto({
      ...VALID,
      inventory_items: [{ item: "", quantity: 1, condition: "good" }]
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === "inventory_items")).toBeDefined();
  });

  it("rejects nested item with item > 200 chars", async () => {
    const errors = await validateDto({
      ...VALID,
      inventory_items: [{ item: "x".repeat(201), quantity: 1, condition: "good" }]
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === "inventory_items")).toBeDefined();
  });

  it("accepts quantity at lower boundary (1)", async () => {
    const errors = await validateDto({
      ...VALID,
      inventory_items: [{ item: "Bed", quantity: 1, condition: "good" }]
    });
    expect(errors).toEqual([]);
  });

  it("accepts quantity at upper boundary (1000)", async () => {
    const errors = await validateDto({
      ...VALID,
      inventory_items: [{ item: "Bed", quantity: 1000, condition: "good" }]
    });
    expect(errors).toEqual([]);
  });

  it.each(["new", "good", "fair", "poor"])("accepts condition = %s", async (cond) => {
    const errors = await validateDto({
      ...VALID,
      inventory_items: [{ item: "Bed", quantity: 1, condition: cond }]
    });
    expect(errors).toEqual([]);
  });
});

describe("Step4InventoryUtilitiesDto: rent_due_day", () => {
  it("accepts rent_due_day = 1 (lower boundary)", async () => {
    const errors = await validateDto({ ...VALID, rent_due_day: 1 });
    expect(errors).toEqual([]);
  });

  it("accepts rent_due_day = 28 (upper boundary)", async () => {
    const errors = await validateDto({ ...VALID, rent_due_day: 28 });
    expect(errors).toEqual([]);
  });

  it("rejects rent_due_day = 0", async () => {
    const errors = await validateDto({ ...VALID, rent_due_day: 0 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === "rent_due_day")).toBeDefined();
  });

  it("rejects rent_due_day = 29", async () => {
    const errors = await validateDto({ ...VALID, rent_due_day: 29 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === "rent_due_day")).toBeDefined();
  });

  it("rejects float rent_due_day", async () => {
    const errors = await validateDto({ ...VALID, rent_due_day: 5.5 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === "rent_due_day")).toBeDefined();
  });
});

describe("Step4InventoryUtilitiesDto: rent_payment_method", () => {
  it.each(["bank_transfer", "upi", "cheque", "cash"])(
    "accepts rent_payment_method = %s",
    async (method) => {
      const errors = await validateDto({ ...VALID, rent_payment_method: method });
      expect(errors).toEqual([]);
    }
  );

  it("rejects unknown rent_payment_method", async () => {
    const errors = await validateDto({ ...VALID, rent_payment_method: "crypto" });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === "rent_payment_method")).toBeDefined();
  });
});

describe("Step4InventoryUtilitiesDto: maintenance_included", () => {
  it("accepts maintenance_included = true", async () => {
    const errors = await validateDto({ ...VALID, maintenance_included: true });
    expect(errors).toEqual([]);
  });

  it("accepts maintenance_included = false", async () => {
    const errors = await validateDto({ ...VALID, maintenance_included: false });
    expect(errors).toEqual([]);
  });

  it("rejects non-boolean maintenance_included", async () => {
    const errors = await validateDto({ ...VALID, maintenance_included: "yes" });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === "maintenance_included")).toBeDefined();
  });
});

describe("Step4InventoryUtilitiesDto: maintenance_paise (optional)", () => {
  it("accepts payload with maintenance_paise omitted", async () => {
    const errors = await validateDto(VALID);
    expect(errors).toEqual([]);
  });

  it("accepts maintenance_paise = 0", async () => {
    const errors = await validateDto({ ...VALID, maintenance_paise: 0 });
    expect(errors).toEqual([]);
  });

  it("accepts positive maintenance_paise", async () => {
    const errors = await validateDto({ ...VALID, maintenance_paise: 250000 });
    expect(errors).toEqual([]);
  });

  it("rejects negative maintenance_paise", async () => {
    const errors = await validateDto({ ...VALID, maintenance_paise: -1 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === "maintenance_paise")).toBeDefined();
  });

  it("rejects non-integer maintenance_paise", async () => {
    const errors = await validateDto({ ...VALID, maintenance_paise: 100.5 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === "maintenance_paise")).toBeDefined();
  });
});

describe("Step4InventoryUtilitiesDto: electricity_paid_by", () => {
  it.each(["owner", "tenant", "shared"])("accepts electricity_paid_by = %s", async (v) => {
    const errors = await validateDto({ ...VALID, electricity_paid_by: v });
    expect(errors).toEqual([]);
  });

  it("rejects unknown electricity_paid_by", async () => {
    const errors = await validateDto({ ...VALID, electricity_paid_by: "na" });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === "electricity_paid_by")).toBeDefined();
  });
});

describe("Step4InventoryUtilitiesDto: water_paid_by", () => {
  it.each(["owner", "tenant", "shared"])("accepts water_paid_by = %s", async (v) => {
    const errors = await validateDto({ ...VALID, water_paid_by: v });
    expect(errors).toEqual([]);
  });

  it("rejects unknown water_paid_by", async () => {
    const errors = await validateDto({ ...VALID, water_paid_by: "na" });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === "water_paid_by")).toBeDefined();
  });
});

describe("Step4InventoryUtilitiesDto: gas_paid_by", () => {
  it.each(["owner", "tenant", "shared"])("accepts gas_paid_by = %s", async (v) => {
    const errors = await validateDto({ ...VALID, gas_paid_by: v });
    expect(errors).toEqual([]);
  });

  it("rejects unknown gas_paid_by", async () => {
    const errors = await validateDto({ ...VALID, gas_paid_by: "na" });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === "gas_paid_by")).toBeDefined();
  });
});

describe("Step4InventoryUtilitiesDto: society_charges_paid_by", () => {
  it.each(["owner", "tenant", "shared", "na"])(
    "accepts society_charges_paid_by = %s",
    async (v) => {
      const errors = await validateDto({ ...VALID, society_charges_paid_by: v });
      expect(errors).toEqual([]);
    }
  );

  it("rejects unknown society_charges_paid_by", async () => {
    const errors = await validateDto({ ...VALID, society_charges_paid_by: "split" });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === "society_charges_paid_by")).toBeDefined();
  });
});

describe("Step4InventoryUtilitiesDto: late_payment_penalty_pct", () => {
  it("accepts 0 (lower boundary)", async () => {
    const errors = await validateDto({ ...VALID, late_payment_penalty_pct: 0 });
    expect(errors).toEqual([]);
  });

  it("accepts 100 (upper boundary)", async () => {
    const errors = await validateDto({ ...VALID, late_payment_penalty_pct: 100 });
    expect(errors).toEqual([]);
  });

  it("accepts fractional values within range", async () => {
    const errors = await validateDto({ ...VALID, late_payment_penalty_pct: 1.75 });
    expect(errors).toEqual([]);
  });

  it("rejects -0.1", async () => {
    const errors = await validateDto({ ...VALID, late_payment_penalty_pct: -0.1 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === "late_payment_penalty_pct")).toBeDefined();
  });

  it("rejects 100.01", async () => {
    const errors = await validateDto({ ...VALID, late_payment_penalty_pct: 100.01 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === "late_payment_penalty_pct")).toBeDefined();
  });
});

describe("Step4InventoryUtilitiesDto: top-level required fields", () => {
  it("rejects missing rent_due_day", async () => {
    const { rent_due_day, ...rest } = VALID;
    void rent_due_day;
    const errors = await validateDto(rest);
    expect(errors.find((e) => e.property === "rent_due_day")).toBeDefined();
  });

  it("rejects missing rent_payment_method", async () => {
    const { rent_payment_method, ...rest } = VALID;
    void rent_payment_method;
    const errors = await validateDto(rest);
    expect(errors.find((e) => e.property === "rent_payment_method")).toBeDefined();
  });

  it("rejects missing maintenance_included", async () => {
    const { maintenance_included, ...rest } = VALID;
    void maintenance_included;
    const errors = await validateDto(rest);
    expect(errors.find((e) => e.property === "maintenance_included")).toBeDefined();
  });

  it("rejects missing electricity_paid_by", async () => {
    const { electricity_paid_by, ...rest } = VALID;
    void electricity_paid_by;
    const errors = await validateDto(rest);
    expect(errors.find((e) => e.property === "electricity_paid_by")).toBeDefined();
  });

  it("rejects missing water_paid_by", async () => {
    const { water_paid_by, ...rest } = VALID;
    void water_paid_by;
    const errors = await validateDto(rest);
    expect(errors.find((e) => e.property === "water_paid_by")).toBeDefined();
  });

  it("rejects missing gas_paid_by", async () => {
    const { gas_paid_by, ...rest } = VALID;
    void gas_paid_by;
    const errors = await validateDto(rest);
    expect(errors.find((e) => e.property === "gas_paid_by")).toBeDefined();
  });

  it("rejects missing society_charges_paid_by", async () => {
    const { society_charges_paid_by, ...rest } = VALID;
    void society_charges_paid_by;
    const errors = await validateDto(rest);
    expect(errors.find((e) => e.property === "society_charges_paid_by")).toBeDefined();
  });

  it("rejects missing late_payment_penalty_pct", async () => {
    const { late_payment_penalty_pct, ...rest } = VALID;
    void late_payment_penalty_pct;
    const errors = await validateDto(rest);
    expect(errors.find((e) => e.property === "late_payment_penalty_pct")).toBeDefined();
  });

  it("rejects unknown top-level field", async () => {
    const errors = await validateDto({ ...VALID, foo_bar: "baz" });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === "foo_bar")).toBeDefined();
  });
});
