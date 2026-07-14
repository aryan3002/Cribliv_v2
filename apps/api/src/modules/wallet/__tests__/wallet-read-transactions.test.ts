import type { PoolClient, QueryResult } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppStateService } from "../../../common/app-state.service";
import type { DatabaseService } from "../../../common/database.service";

const expireSignupCredits = vi.hoisted(() => vi.fn());

vi.mock("../wallet-balance", () => ({
  expireSignupCredits
}));

import { AuthService } from "../../auth/auth.service";
import { WalletController } from "../wallet.controller";

function result(): QueryResult<Record<string, unknown>> {
  return {
    command: "SELECT",
    rowCount: 0,
    oid: 0,
    fields: [],
    rows: []
  };
}

function createDatabase(options: { beginError?: Error; rollbackError?: Error } = {}) {
  const queries: string[] = [];
  const client = {
    query: vi.fn(async (text: string) => {
      queries.push(text);
      if (text === "BEGIN" && options.beginError) throw options.beginError;
      if (text === "ROLLBACK" && options.rollbackError) throw options.rollbackError;
      return result();
    }),
    release: vi.fn()
  } as unknown as PoolClient;
  const database = {
    isEnabled: () => true,
    getClient: vi.fn(async () => client)
  } as unknown as DatabaseService;

  return { client, database, queries };
}

function createAuthService(database: DatabaseService) {
  return new AuthService(new AppStateService(), database, {} as never);
}

function createWalletController(database: DatabaseService) {
  return new WalletController(new AppStateService(), database, {} as never);
}

describe("lazy wallet read transactions", () => {
  beforeEach(() => {
    expireSignupCredits.mockReset();
  });

  it("AuthService.getMe does not roll back when BEGIN fails", async () => {
    const { client, database, queries } = createDatabase({
      beginError: new Error("begin failed")
    });

    await expect(createAuthService(database).getMe("user-1")).rejects.toThrow("begin failed");

    expect(queries).toEqual(["BEGIN"]);
    expect(expireSignupCredits).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("AuthService.getMe preserves the expiry error when rollback fails", async () => {
    const { client, database, queries } = createDatabase({
      rollbackError: new Error("rollback failed")
    });
    expireSignupCredits.mockRejectedValueOnce(new Error("expiry failed"));

    await expect(createAuthService(database).getMe("user-1")).rejects.toThrow("expiry failed");

    expect(queries).toEqual(["BEGIN", "ROLLBACK"]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("WalletController.balance does not roll back when BEGIN fails", async () => {
    const { client, database, queries } = createDatabase({
      beginError: new Error("begin failed")
    });

    await expect(
      createWalletController(database).balance({ user: { id: "user-1" } })
    ).rejects.toThrow("begin failed");

    expect(queries).toEqual(["BEGIN"]);
    expect(expireSignupCredits).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("WalletController.balance preserves the expiry error when rollback fails", async () => {
    const { client, database, queries } = createDatabase({
      rollbackError: new Error("rollback failed")
    });
    expireSignupCredits.mockRejectedValueOnce(new Error("expiry failed"));

    await expect(
      createWalletController(database).balance({ user: { id: "user-1" } })
    ).rejects.toThrow("expiry failed");

    expect(queries).toEqual(["BEGIN", "ROLLBACK"]);
    expect(client.release).toHaveBeenCalledOnce();
  });
});
