import type { Pool, PoolClient, QueryResult } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

const expireSignupCredits = vi.hoisted(() => vi.fn());

vi.mock("../../modules/wallet/wallet-balance", () => ({
  expireSignupCredits
}));

import { runSignupCreditExpirySweepDb } from "../signup-credit-sweep";

type DueRow = { user_id: string };

function result<T>(rows: T[]): QueryResult<T & Record<string, unknown>> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: rows as Array<T & Record<string, unknown>>
  };
}

function createPool(batches: DueRow[][]) {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  let batchIndex = 0;
  const client = {
    query: vi.fn(async (text: string, params: unknown[] = []) => {
      queries.push({ text, params });
      if (text.includes("FROM wallets")) {
        return result(batches[batchIndex++] ?? []);
      }
      return result([]);
    }),
    release: vi.fn()
  } as unknown as PoolClient;
  const pool = {
    connect: vi.fn(async () => client)
  } as unknown as Pool;

  return { pool, client, queries };
}

describe("runSignupCreditExpirySweepDb", () => {
  beforeEach(() => {
    expireSignupCredits.mockReset();
  });

  it("batches due wallets with SKIP LOCKED and delegates expiry to the shared helper", async () => {
    const { pool, client, queries } = createPool([
      [{ user_id: "user-1" }, { user_id: "user-2" }],
      []
    ]);
    expireSignupCredits.mockResolvedValueOnce(4).mockResolvedValueOnce(6);

    await expect(runSignupCreditExpirySweepDb(pool)).resolves.toEqual({
      walletsExpired: 2,
      creditsExpired: 10
    });

    expect(expireSignupCredits).toHaveBeenNthCalledWith(1, client, "user-1");
    expect(expireSignupCredits).toHaveBeenNthCalledWith(2, client, "user-2");
    const select = queries.find((query) => query.text.includes("FROM wallets"));
    expect(select?.text).toContain("FOR UPDATE SKIP LOCKED");
    expect(select?.text).toContain("LIMIT $1");
    expect(select?.params).toEqual([100]);
    expect(queries.filter((query) => query.text === "BEGIN")).toHaveLength(2);
    expect(queries.filter((query) => query.text === "COMMIT")).toHaveLength(2);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rolls back and releases the client when an expiry fails", async () => {
    const { pool, client, queries } = createPool([[{ user_id: "user-1" }]]);
    expireSignupCredits.mockRejectedValueOnce(new Error("expiry failed"));

    await expect(runSignupCreditExpirySweepDb(pool)).rejects.toThrow("expiry failed");

    expect(queries.map((query) => query.text)).toContain("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
  });
});
