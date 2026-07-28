import { describe, expect, it, vi } from "vitest";
import { AppStateService } from "../../../common/app-state.service";
import { AdminListingTransferService } from "../admin-listing-transfer.service";

const LISTING = "ad204234-4b39-4228-8b49-3b9e91113e16";
const NEW_OWNER = "f5b7e19c-cfaa-4926-ad3a-10be52b7c876";
const OLD_OWNER = "11111111-1111-4111-8111-111111111111";

/**
 * DB-mode uses a mocked client so these run in CI without Postgres. The service
 * issues client.query() in this order:
 *   1. BEGIN
 *   2. SELECT ... FROM listings ... FOR UPDATE      (guard + current owner)
 *   3. INSERT INTO users ... ON CONFLICT             (resolve/upsert owner)
 *   4. UPDATE listings SET owner_user_id, contact_phone_encrypted
 *   5. UPDATE leads SET owner_user_id, transferred_at
 *   6. INSERT INTO admin_actions
 *   7. COMMIT
 */
function makeDbService(overrides: {
  listingRow?: Record<string, unknown> | null;
  userRow?: Record<string, unknown>;
  leadsMoved?: number;
}) {
  const listingRow =
    overrides.listingRow === undefined
      ? { id: LISTING, owner_user_id: OLD_OWNER, listing_type: "flat_house", status: "active" }
      : overrides.listingRow;
  const userRow = overrides.userRow ?? {
    id: NEW_OWNER,
    phone_e164: "+919956729103",
    role: "owner",
    is_blocked: false
  };

  const query = vi.fn(async (sql: string) => {
    if (/^\s*BEGIN/i.test(sql) || /^\s*COMMIT/i.test(sql) || /^\s*ROLLBACK/i.test(sql)) {
      return { rows: [], rowCount: 0 };
    }
    if (/FROM listings/i.test(sql) && /FOR UPDATE/i.test(sql)) {
      return { rows: listingRow ? [listingRow] : [], rowCount: listingRow ? 1 : 0 };
    }
    if (/INSERT INTO users/i.test(sql)) return { rows: [userRow], rowCount: 1 };
    if (/UPDATE listings/i.test(sql)) return { rows: [{ id: LISTING }], rowCount: 1 };
    if (/UPDATE leads/i.test(sql)) return { rows: [], rowCount: overrides.leadsMoved ?? 0 };
    if (/INSERT INTO admin_actions/i.test(sql)) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });

  const client = { query, release: vi.fn() };
  const database = { isEnabled: () => true, getClient: vi.fn(async () => client) } as any;
  const service = new AdminListingTransferService(database, new AppStateService());
  return { service, query, client };
}

describe("AdminListingTransferService.transferOwner — DB mode", () => {
  it("moves owner_user_id and contact_phone_encrypted in the same UPDATE", async () => {
    const { service, query } = makeDbService({});

    const result = await service.transferOwner({
      listingId: LISTING,
      phoneE164: "99567 29103",
      fullName: "Akash Rai",
      adminUserId: "admin-1"
    });

    // Cast rationale: see `userCall` below — the mock's declared (sql: string)
    // signature makes mock.calls infer as 1-tuples even though Vitest records
    // every real argument. Assert the actual BOUND VALUES, not just that the
    // SQL text mentions the column names — the text alone can't catch e.g. the
    // raw, un-normalised phone being written into the paid-unlock column.
    const updateCall = query.mock.calls.find(([sql]: [string]) => /UPDATE listings/i.test(sql)) as
      | [string, unknown[]]
      | undefined;
    expect(updateCall).toBeDefined();
    expect(updateCall![0]).toContain("owner_user_id");
    expect(updateCall![0]).toContain("contact_phone_encrypted");
    expect(updateCall![1]).toEqual([LISTING, NEW_OWNER, "+919956729103"]);

    expect(result.owner_user_id).toBe(NEW_OWNER);
    expect(result.owner_phone).toBe("+919956729103");
    expect(result.already_owned).toBe(false);
  });

  it("moves whatsapp_available too, sourced from the target user's own opt-in", async () => {
    const { service, query } = makeDbService({});

    await service.transferOwner({
      listingId: LISTING,
      phoneE164: "+919956729103",
      adminUserId: "admin-1"
    });

    // whatsapp_available is a third owner-derived column alongside
    // owner_user_id/contact_phone_encrypted (Finding 2, 2026-07-28 review):
    // written at creation from the CREATING user's whatsapp_opt_in
    // (owner.service.ts:428), read back on the paid-unlock response
    // (contacts.service.ts:305), and driving the public WhatsApp CTA
    // (listing-host-card.tsx:74). Leaving it behind on transfer lets a
    // tenant spend a credit, get told WhatsApp works, and hear nothing back
    // from an owner who never opted in. Assert the SQL shape, not just that
    // the column name appears somewhere: it must be a subquery keyed off the
    // TARGET user (the same $2 bound param as owner_user_id), not carried
    // over from the old owner or copied from the admin's own opt-in.
    const updateCall = query.mock.calls.find(([sql]: [string]) => /UPDATE listings/i.test(sql)) as
      | [string, unknown[]]
      | undefined;
    expect(updateCall).toBeDefined();
    expect(updateCall![0]).toMatch(
      /whatsapp_available\s*=\s*\(SELECT\s+whatsapp_opt_in\s+FROM\s+users\s+WHERE\s+id\s*=\s*\$2::uuid\)/i
    );
  });

  it("leaves verification_status untouched — the badge describes the property, not the person", async () => {
    const { service, query } = makeDbService({});

    await service.transferOwner({
      listingId: LISTING,
      phoneE164: "+919956729103",
      adminUserId: "admin-1"
    });

    const updateCall = query.mock.calls.find(([sql]: [string]) => /UPDATE listings/i.test(sql));
    expect(updateCall![0]).not.toContain("verification_status");
  });

  it("normalises the entered phone before touching the database", async () => {
    const { service, query } = makeDbService({});

    await service.transferOwner({
      listingId: LISTING,
      phoneE164: "099567 29103",
      adminUserId: "admin-1"
    });

    // `query` is typed with only the `sql` param (see makeDbService), so its
    // mock.calls elements type as 1-tuples even though Vitest always records
    // every real argument. Cast to reach the params array actually passed.
    const userCall = query.mock.calls.find(([sql]: [string]) => /INSERT INTO users/i.test(sql)) as
      | [string, unknown[]]
      | undefined;
    expect(userCall![1]).toContain("+919956729103");
  });

  it("stamps transferred_at on the leads it moves and reports the count", async () => {
    const { service, query } = makeDbService({ leadsMoved: 3 });

    const result = await service.transferOwner({
      listingId: LISTING,
      phoneE164: "+919956729103",
      adminUserId: "admin-1"
    });

    const leadsCall = query.mock.calls.find(([sql]: [string]) => /UPDATE leads/i.test(sql));
    expect(leadsCall![0]).toContain("transferred_at");
    expect(result.leads_moved).toBe(3);
  });

  it("writes a transfer_owner admin_actions row carrying both user ids", async () => {
    const { service, query } = makeDbService({});

    await service.transferOwner({
      listingId: LISTING,
      phoneE164: "+919956729103",
      adminUserId: "admin-1"
    });

    // Same cast rationale as `userCall` above — before/after state live in the
    // params array (indices 2/3), one slot the declared mock type doesn't have.
    const auditCall = query.mock.calls.find(([sql]: [string]) =>
      /INSERT INTO admin_actions/i.test(sql)
    ) as [string, unknown[]] | undefined;
    expect(auditCall![0]).toContain("'transfer_owner'");
    const after = JSON.parse(auditCall![1][3] as string);
    expect(after.to_user_id).toBe(NEW_OWNER);
    const before = JSON.parse(auditCall![1][2] as string);
    expect(before.from_user_id).toBe(OLD_OWNER);
  });

  it("commits the whole transfer as one transaction", async () => {
    const { service, query, client } = makeDbService({});

    await service.transferOwner({
      listingId: LISTING,
      phoneE164: "+919956729103",
      adminUserId: "admin-1"
    });

    const statements = query.mock.calls.map(([sql]: [string]) => String(sql).trim());
    expect(statements[0]).toMatch(/^BEGIN/i);
    expect(statements[statements.length - 1]).toMatch(/^COMMIT/i);
    expect(client.release).toHaveBeenCalled();
  });

  it("is a no-op when the listing is already owned by the target", async () => {
    const { service, query } = makeDbService({
      listingRow: {
        id: LISTING,
        owner_user_id: NEW_OWNER,
        listing_type: "flat_house",
        status: "active"
      }
    });

    const result = await service.transferOwner({
      listingId: LISTING,
      phoneE164: "+919956729103",
      adminUserId: "admin-1"
    });

    expect(result.already_owned).toBe(true);
    expect(query.mock.calls.some(([sql]: [string]) => /UPDATE listings/i.test(sql))).toBe(false);

    // The early-return path still has to close its own transaction — it holds
    // the FOR UPDATE row lock taken above, and a client released while still
    // inside an open transaction would carry that lock back into the pool,
    // blocking every later transfer of this listing on whichever connection
    // inherits it next.
    const statements = query.mock.calls.map(([sql]: [string]) => String(sql).trim());
    expect(statements[statements.length - 1]).toMatch(/^COMMIT/i);
  });

  it("refuses a PG listing", async () => {
    const { service } = makeDbService({
      listingRow: { id: LISTING, owner_user_id: OLD_OWNER, listing_type: "pg", status: "active" }
    });

    await expect(
      service.transferOwner({
        listingId: LISTING,
        phoneE164: "+919956729103",
        adminUserId: "admin-1"
      })
    ).rejects.toMatchObject({ response: { code: "pg_not_supported" } });
  });

  it("refuses when the listing does not exist", async () => {
    const { service } = makeDbService({ listingRow: null });

    await expect(
      service.transferOwner({
        listingId: LISTING,
        phoneE164: "+919956729103",
        adminUserId: "admin-1"
      })
    ).rejects.toMatchObject({ response: { code: "listing_not_found" } });
  });

  it("refuses an unparseable phone before opening a transaction", async () => {
    const { service, query } = makeDbService({});

    await expect(
      service.transferOwner({ listingId: LISTING, phoneE164: "12345", adminUserId: "admin-1" })
    ).rejects.toMatchObject({ response: { code: "invalid_phone" } });

    // Not just that the rejection happened, but that it happened before any
    // client.query() call at all — including BEGIN. An implementation that
    // opened the transaction first and validated after would still reject with
    // the same code, but would have started a transaction it then has to
    // unwind; this is the assertion that actually distinguishes the two.
    expect(query).not.toHaveBeenCalled();
  });

  it("refuses transferring to an admin account", async () => {
    const { service } = makeDbService({
      userRow: { id: NEW_OWNER, phone_e164: "+919956729103", role: "admin", is_blocked: false }
    });

    await expect(
      service.transferOwner({
        listingId: LISTING,
        phoneE164: "+919956729103",
        adminUserId: "admin-1"
      })
    ).rejects.toMatchObject({ response: { code: "cannot_transfer_to_admin" } });
  });

  it("refuses transferring to a blocked account", async () => {
    const { service } = makeDbService({
      userRow: { id: NEW_OWNER, phone_e164: "+919956729103", role: "owner", is_blocked: true }
    });

    await expect(
      service.transferOwner({
        listingId: LISTING,
        phoneE164: "+919956729103",
        adminUserId: "admin-1"
      })
    ).rejects.toMatchObject({ response: { code: "target_blocked" } });
  });

  it("rolls back when a statement fails mid-transfer", async () => {
    const { service, query, client } = makeDbService({});
    query.mockImplementation(async (sql: string) => {
      if (/^\s*BEGIN/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM listings/i.test(sql) && /FOR UPDATE/i.test(sql)) {
        return {
          rows: [
            { id: LISTING, owner_user_id: OLD_OWNER, listing_type: "flat_house", status: "active" }
          ],
          rowCount: 1
        };
      }
      if (/INSERT INTO users/i.test(sql)) throw new Error("boom");
      return { rows: [], rowCount: 0 };
    });

    await expect(
      service.transferOwner({
        listingId: LISTING,
        phoneE164: "+919956729103",
        adminUserId: "admin-1"
      })
    ).rejects.toThrow("boom");

    const statements = query.mock.calls.map(([sql]: [string]) => String(sql).trim());
    expect(statements.some((s) => /^ROLLBACK/i.test(s))).toBe(true);
    expect(client.release).toHaveBeenCalled();
  });

  it("also flips status to pending_review when alsoSubmit is set", async () => {
    const { service, query } = makeDbService({});

    await service.transferOwner({
      listingId: LISTING,
      phoneE164: "+919956729103",
      adminUserId: "admin-1",
      alsoSubmit: true
    });

    const updateCall = query.mock.calls.find(([sql]: [string]) => /UPDATE listings/i.test(sql));
    expect(updateCall![0]).toContain("pending_review");
  });

  // Edge case: publish-on-behalf re-run (or same number re-entered) on a
  // listing that already belongs to the target. The already_owned early
  // return is gated on `!input.alsoSubmit`, so alsoSubmit skips it and falls
  // through to the real UPDATE — that fallthrough is what actually flips
  // status. Without it, clicking "publish" a second time (or on a listing an
  // admin resumed after an earlier transfer) would silently no-op forever.
  it("still runs the UPDATE and flips status when alsoSubmit targets the already-current owner", async () => {
    const { service, query } = makeDbService({
      listingRow: {
        id: LISTING,
        owner_user_id: NEW_OWNER,
        listing_type: "flat_house",
        status: "active"
      }
    });

    const result = await service.transferOwner({
      listingId: LISTING,
      phoneE164: "+919956729103",
      adminUserId: "admin-1",
      alsoSubmit: true
    });

    const updateCall = query.mock.calls.find(([sql]: [string]) => /UPDATE listings/i.test(sql)) as
      | [string, unknown[]]
      | undefined;
    expect(updateCall).toBeDefined();
    expect(updateCall![0]).toContain("pending_review");
    expect(result.leads_moved).toBe(0);

    // Pinning current behaviour, not endorsing it as the only sensible shape:
    // because the alsoSubmit branch never takes the already-owned early
    // return, `already_owned` reports false here even though the target owned
    // the listing going in — with alsoSubmit set, this flag only ever means
    // "the short-circuit path was skipped", not "a transfer actually
    // happened". Callers must not read it as a no-op signal in this mode.
    expect(result.already_owned).toBe(false);
  });
});

describe("AdminListingTransferService.transferOwner — in-memory mode", () => {
  function makeMemoryService() {
    const appState = new AppStateService();
    (appState as any).users = new Map([
      [
        OLD_OWNER,
        { id: OLD_OWNER, phone: "+918800826659", role: "owner", preferred_language: "en" }
      ]
    ]);
    (appState as any).listings = new Map([
      [
        LISTING,
        {
          id: LISTING,
          ownerUserId: OLD_OWNER,
          listingType: "flat_house",
          title: "3RK Vrindavan Yojana",
          city: "lucknow",
          monthlyRent: 13000,
          verificationStatus: "verified",
          status: "active",
          createdAt: 1
        }
      ]
    ]);
    const database = { isEnabled: () => false, getClient: vi.fn() } as any;
    return { service: new AdminListingTransferService(database, appState), appState };
  }

  it("repoints the listing at a newly created owner", async () => {
    const { service, appState } = makeMemoryService();

    const result = await service.transferOwner({
      listingId: LISTING,
      phoneE164: "+919956729103",
      fullName: "Akash Rai",
      adminUserId: "admin-1"
    });

    const listing = (appState as any).listings.get(LISTING);
    expect(listing.ownerUserId).toBe(result.owner_user_id);
    expect(listing.ownerUserId).not.toBe(OLD_OWNER);

    const created = (appState as any).users.get(result.owner_user_id);
    expect(created.phone).toBe("+919956729103");
    expect(created.role).toBe("owner");
    expect(created.full_name).toBe("Akash Rai");
  });

  it("reuses an existing user with the same phone", async () => {
    const { service, appState } = makeMemoryService();
    (appState as any).users.set("existing", {
      id: "existing",
      phone: "+919956729103",
      role: "tenant",
      preferred_language: "en"
    });

    const result = await service.transferOwner({
      listingId: LISTING,
      phoneE164: "+919956729103",
      adminUserId: "admin-1"
    });

    expect(result.owner_user_id).toBe("existing");
    expect((appState as any).users.get("existing").role).toBe("owner");
  });

  it("stamps moved leads as transferred so they do not consume the new owner's free allowance", async () => {
    const { service, appState } = makeMemoryService();
    (appState as any).leads = new Map([
      [
        "lead-1",
        {
          id: "lead-1",
          listingId: LISTING,
          ownerUserId: OLD_OWNER,
          tenantUserId: "t-1",
          status: "new",
          accessState: "free",
          createdAt: 1,
          statusChangedAt: 1
        }
      ]
    ]);

    const result = await service.transferOwner({
      listingId: LISTING,
      phoneE164: "+919956729103",
      adminUserId: "admin-1"
    });

    expect(result.leads_moved).toBe(1);
    const moved = (appState as any).leads.get("lead-1");
    expect(moved.ownerUserId).toBe(result.owner_user_id);
    expect(moved.transferredAt).toBeGreaterThan(0);
  });
});
