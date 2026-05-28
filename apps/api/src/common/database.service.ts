import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { readFeatureFlags } from "../config/feature-flags";

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool?: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    const flags = readFeatureFlags();

    if (process.env.NODE_ENV === "production" && flags.ff_production_db_only && !connectionString) {
      throw new Error("DATABASE_URL is required when FF_PRODUCTION_DB_ONLY is enabled");
    }

    if (connectionString) {
      this.pool = new Pool({
        connectionString,
        // Fail fast when the DB host is unreachable (e.g. firewall, VPN off).
        // Without this, a blocked connection hangs the request until the OS
        // TCP timeout fires — often 60+ seconds.
        connectionTimeoutMillis: 5_000,
        // Kill any query that takes longer than 8 s at the server level.
        query_timeout: 8_000,
        // Keep the pool small during development to surface issues quickly.
        max: 10,
        idleTimeoutMillis: 30_000
      });
    }
  }

  isEnabled(): boolean {
    return Boolean(this.pool);
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = []
  ): Promise<QueryResult<T>> {
    if (!this.pool) {
      throw new Error("DATABASE_URL is not configured");
    }

    return this.pool.query<T>(text, params);
  }

  async getClient(): Promise<PoolClient> {
    if (!this.pool) {
      throw new Error("DATABASE_URL is not configured");
    }

    return this.pool.connect();
  }

  async onModuleDestroy() {
    if (this.pool) {
      await this.pool.end();
    }
  }
}
