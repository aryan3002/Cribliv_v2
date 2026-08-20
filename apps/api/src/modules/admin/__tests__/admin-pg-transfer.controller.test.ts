import { describe, expect, it, vi } from "vitest";
import { AdminController } from "../admin.controller";

const LISTING = "ad204234-4b39-4228-8b49-3b9e91113e16";

/**
 * AdminController has a long constructor; this test only exercises the PG
 * transfer route, so every other dependency is an empty stub. Positional
 * arguments must match the constructor order — pgTransfer is appended LAST.
 */
function makeController(transferOperator: ReturnType<typeof vi.fn>) {
  const stub = {} as never;
  return new AdminController(
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    { transferOperator } as never
  );
}

describe("AdminController — POST admin/pg/listings/:id/transfer", () => {
  it("passes the body through and returns the service result", async () => {
    const transferOperator = vi.fn(async () => ({
      listing_id: LISTING,
      operator_user_id: "f5b7e19c-cfaa-4926-ad3a-10be52b7c876",
      operator_phone: "+919956729103",
      leads_moved: 2,
      already_owned: false
    }));

    const controller = makeController(transferOperator);
    const result = await controller.pgListingTransfer({ user: { id: "admin-1" } }, LISTING, {
      phone_e164: "99567 29103",
      full_name: "Ravi"
    });

    expect(transferOperator).toHaveBeenCalledWith({
      listingId: LISTING,
      phoneE164: "99567 29103",
      fullName: "Ravi",
      adminUserId: "admin-1"
    });
    expect(result).toMatchObject({ data: { leads_moved: 2, already_owned: false } });
  });

  it("forwards an omitted name as undefined rather than an empty string", async () => {
    const transferOperator = vi.fn(async () => ({
      listing_id: LISTING,
      operator_user_id: "f5b7e19c-cfaa-4926-ad3a-10be52b7c876",
      operator_phone: "+919956729103",
      leads_moved: 0,
      already_owned: true
    }));

    const controller = makeController(transferOperator);
    await controller.pgListingTransfer({ user: { id: "admin-1" } }, LISTING, {
      phone_e164: "9956729103"
    });

    expect(transferOperator).toHaveBeenCalledWith(expect.objectContaining({ fullName: undefined }));
  });
});
