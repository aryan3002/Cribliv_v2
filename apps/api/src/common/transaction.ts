import { ConflictException } from "@nestjs/common";
import type { PoolClient } from "pg";

import type { DatabaseService } from "./database.service";

type TransactionOptions = {
  uniqueViolationCode?: string;
};

export async function transaction<T>(
  db: Pick<DatabaseService, "getClient">,
  work: (client: PoolClient) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  const client = await db.getClient();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((error as { code?: string }).code === "23505") {
      throw new ConflictException({ code: options.uniqueViolationCode ?? "conflict" });
    }
    throw error;
  } finally {
    client.release();
  }
}
