import { describe, expect, it, vi } from "vitest";
import { AdminHomesController } from "../admin-homes.controller";

describe("AdminHomesController", () => {
  it("sanitizes list query params and wraps the service result", async () => {
    const listHomes = vi.fn().mockResolvedValue({ items: [], total: 0 });
    const controller = new AdminHomesController({ listHomes } as any);

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
    const controller = new AdminHomesController({ getHome } as any);

    expect(await (controller as any).detail(listingId)).toMatchObject({
      data: { listing: { id: listingId } }
    });
    expect(getHome).toHaveBeenCalledWith(listingId);
  });
});
