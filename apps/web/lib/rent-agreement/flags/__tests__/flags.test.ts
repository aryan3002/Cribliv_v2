import { describe, expect, it } from "vitest";
import { EnvFlagsAdapter, DEFAULT_FLAGS } from "../env-flags-adapter";

describe("EnvFlagsAdapter", () => {
  it("returns defaults when no env override", () => {
    const a = new EnvFlagsAdapter({});
    expect(a.get("rent_agreement_show_e_sign")).toBe(DEFAULT_FLAGS.rent_agreement_show_e_sign);
  });

  it("overrides boolean flags from env (true)", () => {
    const a = new EnvFlagsAdapter({ NEXT_PUBLIC_RENT_AGREEMENT_SHOW_E_SIGN: "true" });
    expect(a.get("rent_agreement_show_e_sign")).toBe(true);
  });

  it("overrides boolean flags from env (false)", () => {
    const a = new EnvFlagsAdapter({ NEXT_PUBLIC_RENT_AGREEMENT_SHOW_E_SIGN: "false" });
    expect(a.get("rent_agreement_show_e_sign")).toBe(false);
  });

  it("overrides numeric flags from env", () => {
    const a = new EnvFlagsAdapter({ NEXT_PUBLIC_RENT_AGREEMENT_STATUS_POLL_INTERVAL_MS: "2500" });
    expect(a.get("rent_agreement_status_poll_interval_ms")).toBe(2500);
  });

  it("ignores unknown env keys", () => {
    const a = new EnvFlagsAdapter({ NEXT_PUBLIC_UNRELATED: "x" });
    expect(a.get("rent_agreement_show_e_sign")).toBe(DEFAULT_FLAGS.rent_agreement_show_e_sign);
  });
});
