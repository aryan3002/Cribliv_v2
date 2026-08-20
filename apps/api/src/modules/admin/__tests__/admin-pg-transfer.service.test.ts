import { describe, expect, it, vi } from "vitest";
import { AdminPgTransferService } from "../admin-pg-transfer.service";

const LISTING = "ad204234-4b39-4228-8b49-3b9e91113e16";
const PROPERTY = "9d1c0f22-7a4e-4c2b-9f31-0b8d4e6a1c55";
const NEW_OP = "f5b7e19c-cfaa-4926-ad3a-10be52b7c876";
const OLD_OP = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";

/**
 * DB-mode uses a mocked client so these run in CI without Postgres. The service
 * issues client.query() in this order:
 *   1. BEGIN
 *   2. SELECT ... FROM pg_listings ... FOR UPDATE   (guard + current operator)
 *   3. SELECT ... FROM pg_properties ... FOR UPDATE (skipped when orphaned)
 *   4. INSERT INTO users ... ON CONFLICT            (resolve/upsert operator)
 *   5. UPDATE pg_listings SET operator_user_id
 *   6. UPDATE pg_properties SET operator_id         (skipped when orphaned)
 *   7. UPDATE listings SET owner_user_id, contact_phone_encrypted, whatsapp_available
 *   8. UPDATE leads SET owner_user_id, transferred_at
 *   9. DELETE FROM pg_analytics_overrides           (then UPDATE — order matters)
 *  10. UPDATE pg_analytics_overrides SET operator_id
 *  11. UPDATE pg_manage_requests SET operator_user_id
 *  12. INSERT INTO admin_actions
 *  13. COMMIT
 */
function makeService(overrides: {
  headRow?: Record<string, unknown> | null;
  userRow?: Record<string, unknown>;
  leadsMoved?: number;
  dbEnabled?: boolean;
}) {
  const headRow =
    overrides.headRow === undefined
      ? {
          id: LISTING,
          operator_user_id: OLD_OP,
          pg_property_id: PROPERTY,
          status: "active"
        }
      : overrides.headRow;
  const userRow = overrides.userRow ?? {
    id: NEW_OP,
    phone_e164: "+919956729103",
    role: "pg_operator",
    is_blocked: false
  };

  const query = vi.fn(async (sql: string) => {
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/FROM pg_listings/i.test(sql) && /FOR UPDATE/i.test(sql)) {
      return { rows: headRow ? [headRow] : [], rowCount: headRow ? 1 : 0 };
    }
    if (/FROM pg_properties/i.test(sql) && /FOR UPDATE/i.test(sql)) {
      return { rows: [{ id: PROPERTY }], rowCount: 1 };
    }
    if (/INSERT INTO users/i.test(sql)) return { rows: [userRow], rowCount: 1 };
    if (/UPDATE leads/i.test(sql)) return { rows: [], rowCount: overrides.leadsMoved ?? 0 };
    return { rows: [], rowCount: 1 };
  });

  const client = { query, release: vi.fn() };
  const database = {
    isEnabled: () => overrides.dbEnabled ?? true,
    getClient: vi.fn(async () => client)
  } as unknown as ConstructorParameters<typeof AdminPgTransferService>[0];

  return { service: new AdminPgTransferService(database), query, client };
}

/** All SQL the service issued, whitespace-collapsed, in order. */
const sqlLog = (query: ReturnType<typeof vi.fn>) =>
  query.mock.calls.map((c) => String(c[0]).replace(/\s+/g, " ").trim());

describe("AdminPgTransferService.transferOperator", () => {
  it("moves the listing head, the property, and the projection in one transaction", async () => {
    const { service, query } = makeService({});

    const result = await service.transferOperator({
      listingId: LISTING,
      phoneE164: "99567 29103",
      adminUserId: ADMIN
    });

    expect(result).toEqual({
      listing_id: LISTING,
      operator_user_id: NEW_OP,
      operator_phone: "+919956729103",
      leads_moved: 0,
      already_owned: false
    });

    const log = sqlLog(query);
    expect(log[0]).toMatch(/^BEGIN/i);
    expect(log.at(-1)).toMatch(/^COMMIT/i);
    expect(log.some((s) => /UPDATE pg_listings SET operator_user_id/i.test(s))).toBe(true);
    expect(log.some((s) => /UPDATE pg_properties SET operator_id/i.test(s))).toBe(true);
    // The load-bearing one: all three projection columns move together.
    const projection = log.find((s) => /^UPDATE listings/i.test(s));
    expect(projection).toBeDefined();
    expect(projection).toMatch(/owner_user_id/);
    expect(projection).toMatch(/contact_phone_encrypted/);
    expect(projection).toMatch(/whatsapp_available/);
  });

  it("sources whatsapp_available from the target, never the previous operator", async () => {
    const { service, query } = makeService({});
    await service.transferOperator({
      listingId: LISTING,
      phoneE164: "9956729103",
      adminUserId: ADMIN
    });

    const projection = sqlLog(query).find((s) => /^UPDATE listings/i.test(s))!;
    expect(projection).toMatch(
      /whatsapp_available = \(SELECT whatsapp_opt_in FROM users WHERE id = \$2::uuid\)/i
    );
  });

  it("stamps transferred_at on inherited leads so they skip the free allowance", async () => {
    const { service, query } = makeService({ leadsMoved: 3 });
    const result = await service.transferOperator({
      listingId: LISTING,
      phoneE164: "9956729103",
      adminUserId: ADMIN
    });

    expect(result.leads_moved).toBe(3);
    const leads = sqlLog(query).find((s) => /^UPDATE leads/i.test(s))!;
    expect(leads).toMatch(/transferred_at = now\(\)/i);
    expect(leads).toMatch(/owner_user_id <> \$2::uuid/i);
  });

  it("deletes a colliding override row BEFORE re-pointing (uq_pg_override_listing)", async () => {
    const { service, query } = makeService({});
    await service.transferOperator({
      listingId: LISTING,
      phoneE164: "9956729103",
      adminUserId: ADMIN
    });

    const log = sqlLog(query);
    const del = log.findIndex((s) => /DELETE FROM pg_analytics_overrides/i.test(s));
    const upd = log.findIndex((s) => /UPDATE pg_analytics_overrides/i.test(s));
    expect(del).toBeGreaterThan(-1);
    expect(upd).toBeGreaterThan(del);
  });

  it("re-points pg_manage_requests so the admin queue names the new operator", async () => {
    const { service, query } = makeService({});
    await service.transferOperator({
      listingId: LISTING,
      phoneE164: "9956729103",
      adminUserId: ADMIN
    });
    expect(
      sqlLog(query).some((s) => /UPDATE pg_manage_requests SET operator_user_id/i.test(s))
    ).toBe(true);
  });

  it("leaves operator-global overrides with the previous operator", async () => {
    const { service, query } = makeService({});
    await service.transferOperator({
      listingId: LISTING,
      phoneE164: "9956729103",
      adminUserId: ADMIN
    });

    // Both override statements must be scoped by listing_id; a statement that
    // touched listing_id IS NULL rows would drag the operator-global cut along.
    for (const s of sqlLog(query).filter((x) => /pg_analytics_overrides/i.test(x))) {
      expect(s).toMatch(/listing_id = \$1::uuid/i);
    }
  });

  it("transfers a legacy orphan (pg_property_id IS NULL) and skips the property update", async () => {
    const { service, query } = makeService({
      headRow: { id: LISTING, operator_user_id: OLD_OP, pg_property_id: null, status: "draft" }
    });

    const result = await service.transferOperator({
      listingId: LISTING,
      phoneE164: "9956729103",
      adminUserId: ADMIN
    });

    expect(result.already_owned).toBe(false);
    const log = sqlLog(query);
    expect(log.some((s) => /UPDATE pg_listings SET operator_user_id/i.test(s))).toBe(true);
    expect(log.some((s) => /pg_properties/i.test(s))).toBe(false);
  });

  it("returns already_owned without writing when the number already owns it", async () => {
    const { service, query } = makeService({
      userRow: { id: OLD_OP, phone_e164: "+919956729103", role: "pg_operator", is_blocked: false }
    });

    const result = await service.transferOperator({
      listingId: LISTING,
      phoneE164: "9956729103",
      adminUserId: ADMIN
    });

    expect(result.already_owned).toBe(true);
    expect(result.leads_moved).toBe(0);
    expect(sqlLog(query).some((s) => /^UPDATE /i.test(s))).toBe(false);
  });

  it("promotes a tenant to pg_operator and never downgrades anyone else", async () => {
    const { service, query } = makeService({});
    await service.transferOperator({
      listingId: LISTING,
      phoneE164: "9956729103",
      fullName: "Ravi",
      adminUserId: ADMIN
    });

    const upsert = sqlLog(query).find((s) => /INSERT INTO users/i.test(s))!;
    expect(upsert).toMatch(
      /role = CASE WHEN users\.role = 'tenant' THEN 'pg_operator'::user_role ELSE users\.role END/i
    );
    expect(upsert).toMatch(
      /full_name = COALESCE\(NULLIF\(users\.full_name, ''\), EXCLUDED\.full_name\)/i
    );
  });

  it("rejects an unparseable phone before opening a transaction", async () => {
    const { service, client } = makeService({});
    await expect(
      service.transferOperator({ listingId: LISTING, phoneE164: "12345", adminUserId: ADMIN })
    ).rejects.toMatchObject({ response: { code: "invalid_phone" } });
    expect(client.query).not.toHaveBeenCalled();
  });

  it("404s when the PG listing does not exist", async () => {
    const { service } = makeService({ headRow: null });
    await expect(
      service.transferOperator({ listingId: LISTING, phoneE164: "9956729103", adminUserId: ADMIN })
    ).rejects.toMatchObject({ response: { code: "listing_not_found" } });
  });

  it("refuses an admin account", async () => {
    const { service } = makeService({
      userRow: { id: NEW_OP, phone_e164: "+919956729103", role: "admin", is_blocked: false }
    });
    await expect(
      service.transferOperator({ listingId: LISTING, phoneE164: "9956729103", adminUserId: ADMIN })
    ).rejects.toMatchObject({ response: { code: "cannot_transfer_to_admin" } });
  });

  it("refuses an existing flat/house owner — roles are exclusive in middleware", async () => {
    const { service } = makeService({
      userRow: { id: NEW_OP, phone_e164: "+919956729103", role: "owner", is_blocked: false }
    });
    await expect(
      service.transferOperator({ listingId: LISTING, phoneE164: "9956729103", adminUserId: ADMIN })
    ).rejects.toMatchObject({ response: { code: "target_is_owner" } });
  });

  it("refuses a blocked account", async () => {
    const { service } = makeService({
      userRow: { id: NEW_OP, phone_e164: "+919956729103", role: "pg_operator", is_blocked: true }
    });
    await expect(
      service.transferOperator({ listingId: LISTING, phoneE164: "9956729103", adminUserId: ADMIN })
    ).rejects.toMatchObject({ response: { code: "target_blocked" } });
  });

  it("rolls back when a write fails mid-transaction", async () => {
    const { service, query, client } = makeService({});
    query.mockImplementation(async (sql: string) => {
      if (/^\s*(BEGIN|ROLLBACK)/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM pg_listings/i.test(sql)) {
        return {
          rows: [
            { id: LISTING, operator_user_id: OLD_OP, pg_property_id: PROPERTY, status: "active" }
          ],
          rowCount: 1
        };
      }
      if (/FROM pg_properties/i.test(sql)) return { rows: [{ id: PROPERTY }], rowCount: 1 };
      if (/INSERT INTO users/i.test(sql)) {
        return {
          rows: [
            { id: NEW_OP, phone_e164: "+919956729103", role: "pg_operator", is_blocked: false }
          ],
          rowCount: 1
        };
      }
      if (/UPDATE pg_listings/i.test(sql)) throw new Error("boom");
      return { rows: [], rowCount: 1 };
    });

    await expect(
      service.transferOperator({ listingId: LISTING, phoneE164: "9956729103", adminUserId: ADMIN })
    ).rejects.toThrow("boom");
    expect(sqlLog(query).some((s) => /^ROLLBACK/i.test(s))).toBe(true);
    expect(client.release).toHaveBeenCalled();
  });

  it("refuses to run without a database", async () => {
    const { service } = makeService({ dbEnabled: false });
    await expect(
      service.transferOperator({ listingId: LISTING, phoneE164: "9956729103", adminUserId: ADMIN })
    ).rejects.toMatchObject({ response: { code: "db_disabled" } });
  });
});
