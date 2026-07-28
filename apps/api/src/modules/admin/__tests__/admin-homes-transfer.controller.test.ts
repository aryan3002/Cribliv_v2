import { describe, expect, it, vi } from "vitest";
import { AdminHomesController } from "../admin-homes.controller";

describe("AdminHomesController.transfer", () => {
  it("passes the listing id, phone, name and acting admin to the service", async () => {
    const transferOwner = vi.fn(async () => ({
      listing_id: "listing-1",
      owner_user_id: "owner-9",
      owner_phone: "+919956729103",
      leads_moved: 0,
      already_owned: false
    }));
    const controller = new AdminHomesController({} as any, { transferOwner } as any);

    const result = await controller.transfer({ user: { id: "admin-1" } }, "listing-1", {
      phone_e164: "+919956729103",
      full_name: "Akash Rai"
    });

    expect(transferOwner).toHaveBeenCalledWith({
      listingId: "listing-1",
      phoneE164: "+919956729103",
      fullName: "Akash Rai",
      adminUserId: "admin-1"
    });
    expect(result).toEqual({ data: expect.objectContaining({ owner_user_id: "owner-9" }) });
  });
});
