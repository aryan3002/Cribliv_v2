import { describe, expect, it, vi } from "vitest";
import { AdminHomesController } from "../admin-homes.controller";

describe("AdminHomesController", () => {
  it("sanitizes list query params and wraps the service result", async () => {
    const listHomes = vi.fn().mockResolvedValue({ items: [], total: 0 });
    const controller = new AdminHomesController({ listHomes } as any, {} as any);

    const result = await controller.list("archived", "lucknow", "gomti", "views", "2", "50");

    expect(listHomes).toHaveBeenCalledWith({
      status: "archived",
      city: "lucknow",
      q: "gomti",
      sort: "views",
      page: 2,
      page_size: 50
    });
    expect(result).toMatchObject({ data: { items: [], total: 0 } });
  });

  it("delegates GET /admin/homes/:id", async () => {
    const listingId = "11111111-1111-4111-8111-111111111111";
    const getHome = vi.fn().mockResolvedValue({ listing: { id: listingId } });
    const controller = new AdminHomesController({ getHome } as any, {} as any);

    expect(await (controller as any).detail(listingId)).toMatchObject({
      data: { listing: { id: listingId } }
    });
    expect(getHome).toHaveBeenCalledWith(listingId);
  });

  it("delegates PATCH /admin/homes/:id/availability-status with the admin id and reason", async () => {
    const listingId = "11111111-1111-4111-8111-111111111111";
    const setAvailability = vi
      .fn()
      .mockResolvedValue({ listing_id: listingId, is_available: false });
    const controller = new AdminHomesController({ setAvailability } as any, {} as any);
    const req = { user: { id: "admin-1" } };

    const result = await controller.setAvailability(req, listingId, {
      available: false,
      reason: "off-market"
    });

    expect(setAvailability).toHaveBeenCalledWith(listingId, false, "admin-1", "off-market");
    expect(result).toMatchObject({ data: { listing_id: listingId, is_available: false } });
  });

  it("delegates GET /admin/homes/:id/waitlist and wraps items", async () => {
    const listingId = "11111111-1111-4111-8111-111111111111";
    const listWaitlist = vi
      .fn()
      .mockResolvedValue([
        { id: "alert-1", phone: "+919000000009", user_id: null, status: "waiting", created_at: "x" }
      ]);
    const controller = new AdminHomesController({ listWaitlist } as any, {} as any);

    const result = await controller.waitlist(listingId);

    expect(listWaitlist).toHaveBeenCalledWith(listingId);
    expect(result).toMatchObject({
      data: { items: [{ phone: "+919000000009" }] }
    });
  });
});
