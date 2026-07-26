import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../auth.service";

/**
 * Braced arrow bodies throughout: Vitest treats a returned value from a
 * beforeEach callback as a teardown function, so `beforeEach(() => x.reset())`
 * on a mock that returns a promise fails the test after its assertions pass.
 */
function makeService(opts: { dbEnabled: boolean }) {
  const query = vi.fn();
  const users = new Map<string, Record<string, unknown>>();
  const appState = {
    users,
    getWalletDetails: () => {
      return { balance_credits: 0 };
    }
  };
  const database = {
    isEnabled: () => {
      return opts.dbEnabled;
    },
    query
  };
  // AuthService takes three injected deps: (appState, database, d7OtpClient).
  // updateProfile touches none of the OTP client, so a bare stub is enough.
  const service = new AuthService(appState as never, database as never, {} as never);
  return { service, query, users };
}

describe("AuthService.updateProfile — DB mode", () => {
  it("writes the name it was given without re-normalising", async () => {
    const { service, query } = makeService({ dbEnabled: true });
    query.mockResolvedValue({
      rowCount: 1,
      rows: [{ id: "u1", full_name: "Asha Devi", preferred_language: "en", whatsapp_opt_in: false }]
    });

    const result = await service.updateProfile("u1", { full_name: "Asha Devi" });

    expect(result).toMatchObject({ full_name: "Asha Devi" });
    // 5th element is the "full_name was provided" flag ($5 in the query) —
    // true here since full_name was explicitly given in the body.
    expect(query.mock.calls[0][1]).toEqual(["u1", "Asha Devi", null, null, true]);
  });

  it("clears the column when given null", async () => {
    const { service, query } = makeService({ dbEnabled: true });
    query.mockResolvedValue({
      rowCount: 1,
      rows: [{ id: "u1", full_name: null, preferred_language: "en", whatsapp_opt_in: false }]
    });

    await service.updateProfile("u1", { full_name: null });

    // null must reach the UPDATE as an explicit clear, distinguishable from
    // "field absent" — COALESCE alone cannot express this.
    expect(query.mock.calls[0][1][1]).toBeNull();
    expect(query.mock.calls[0][0]).toContain("full_name = CASE WHEN $5 THEN $2");
  });

  it("leaves the column alone when full_name is absent", async () => {
    const { service, query } = makeService({ dbEnabled: true });
    query.mockResolvedValue({
      rowCount: 1,
      rows: [{ id: "u1", full_name: "Asha", preferred_language: "hi", whatsapp_opt_in: false }]
    });

    await service.updateProfile("u1", { preferred_language: "hi" });

    // $5 is the "full_name was provided" flag.
    expect(query.mock.calls[0][1][4]).toBe(false);
  });

  it("throws NotFound instead of silently falling through to in-memory", async () => {
    const { service, query } = makeService({ dbEnabled: true });
    query.mockResolvedValue({ rowCount: 0, rows: [] });

    await expect(service.updateProfile("missing", { full_name: "Asha" })).rejects.toBeInstanceOf(
      NotFoundException
    );
  });
});

describe("AuthService.updateProfile — in-memory mode", () => {
  it("stores the name", async () => {
    const { service, users } = makeService({ dbEnabled: false });
    users.set("u1", { id: "u1", full_name: undefined, preferred_language: "en" });

    const result = await service.updateProfile("u1", { full_name: "Asha Devi" });

    expect(result).toMatchObject({ id: "u1", full_name: "Asha Devi" });
  });

  it("clears the name when given null", async () => {
    const { service, users } = makeService({ dbEnabled: false });
    users.set("u1", { id: "u1", full_name: "Asha", preferred_language: "en" });

    const result = await service.updateProfile("u1", { full_name: null });

    expect(result).toMatchObject({ full_name: null });
  });

  it("throws NotFound for an unknown user", async () => {
    const { service } = makeService({ dbEnabled: false });
    await expect(service.updateProfile("nope", { full_name: "Asha" })).rejects.toBeInstanceOf(
      NotFoundException
    );
  });
});
