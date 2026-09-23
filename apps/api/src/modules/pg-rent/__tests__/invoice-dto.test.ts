import { describe, expect, it } from "vitest";

import { paiseKeysToInr } from "../dto/invoice.dto";

/** Collect every key in a nested structure, so the money-boundary check can be exhaustive. */
function allKeys(value: unknown, acc: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, acc);
    return acc;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      acc.push(k);
      allKeys(v, acc);
    }
  }
  return acc;
}

describe("paiseKeysToInr", () => {
  it("converts a scalar _paise key, number or numeric string", () => {
    expect(paiseKeysToInr({ total_paise: 850000 })).toEqual({ total_inr: 8500 });
    expect(paiseKeysToInr({ total_paise: "850000" })).toEqual({ total_inr: 8500 });
  });

  it("converts every scalar leaf under a _paise key holding a {from,to} diff", () => {
    // RentSettingsService.diff() stores exactly this shape in settings.updated payloads.
    expect(paiseKeysToInr({ late_fee_amount_paise: { from: 10000, to: 15000 } })).toEqual({
      late_fee_amount_inr: { from: 100, to: 150 }
    });
  });

  it("renames a _paise key whose value is null", () => {
    expect(paiseKeysToInr({ late_fee_cap_paise: null })).toEqual({ late_fee_cap_inr: null });
  });

  it("converts each element of an array under a _paise key", () => {
    expect(paiseKeysToInr({ amounts_paise: [10000, "25000"] })).toEqual({
      amounts_inr: [100, 250]
    });
  });

  it("renames a nested _paise key inside a _paise-keyed object", () => {
    expect(paiseKeysToInr({ outer_paise: { inner_paise: 10000 } })).toEqual({
      outer_inr: { inner_inr: 100 }
    });
  });

  it("leaves non-money keys and their nesting untouched", () => {
    expect(
      paiseKeysToInr({ reason: "owner", nested: { kind: "rent", count: 3 }, list: [{ a: 1 }] })
    ).toEqual({ reason: "owner", nested: { kind: "rent", count: 3 }, list: [{ a: 1 }] });
  });

  it("never emits a key ending in _paise, whatever the value shape", () => {
    const payload = {
      total_paise: 850000,
      late_fee_amount_paise: { from: 10000, to: 15000 },
      late_fee_cap_paise: null,
      amounts_paise: [10000],
      flag_paise: true,
      nested: { deep_paise: { from: 100, to: 200 } }
    };
    const keys = allKeys(paiseKeysToInr(payload));
    expect(keys.filter((k) => k.endsWith("_paise"))).toEqual([]);
  });
});
