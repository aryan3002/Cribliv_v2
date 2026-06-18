import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api", () => ({ fetchApi: vi.fn() }));
import { fetchApi } from "../api";
import {
  getMe,
  segment,
  getOnboardingState,
  getDashboard,
  createPgListing,
  submitSalesAssistLead
} from "../pg-operator-api";

const f = fetchApi as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => {
  f.mockReset();
});

describe("pg-operator-api (uses canonical fetchApi)", () => {
  it("segment() POSTs body and returns unwrapped data", async () => {
    f.mockResolvedValueOnce({ path: "self_serve", reason: "ok", next_step: "/listings/new" });
    const r = await segment({ total_beds: 12 }, "tok");
    expect(r.path).toBe("self_serve");
    expect(f).toHaveBeenCalledWith(
      "/pg-operator/segment",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ total_beds: 12 })
      })
    );
    const init = (f.mock.calls[0] as any)[1];
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok");
  });

  it("getMe() bodyless GET — no Content-Type set", async () => {
    f.mockResolvedValueOnce({ operator: { id: "u1", role: "pg_operator" }, properties: [] });
    const r = await getMe("tok");
    expect(r.operator.id).toBe("u1");
    const init = (f.mock.calls[0] as any)[1];
    expect(new Headers(init.headers ?? {}).get("Content-Type")).toBeNull();
  });

  it("createPgListing() propagates Idempotency-Key header", async () => {
    f.mockResolvedValueOnce({ listing_id: "L1", status: "draft" });
    await createPgListing({
      idempotencyKey: "abc-123",
      token: "tok",
      payload: {
        property: { display_name: "X", city_slug: "blr" },
        pg_details: { total_beds: 5 },
        room_types: [{ sharing: "double", ac: true, monthly_rent_paise: 800000, vacancy_count: 4 }]
      } as any
    });
    const init = (f.mock.calls[0] as any)[1];
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe("abc-123");
  });

  // --- strengthening tests ---

  it("getOnboardingState() returns unwrapped { state, property_count } data", async () => {
    f.mockResolvedValueOnce({ state: "ready_to_list", property_count: 2 });
    const r = await getOnboardingState("tok");
    expect(r.state).toBe("ready_to_list");
    expect(r.property_count).toBe(2);
    expect(f).toHaveBeenCalledWith(
      "/pg-operator/onboarding-state",
      expect.objectContaining({ headers: expect.anything() })
    );
  });

  it("getDashboard() returns unwrapped { listing_health, leads_inbox } shape", async () => {
    f.mockResolvedValueOnce({
      listing_health: [
        {
          listing_id: "L1",
          status: "live",
          views_7d: 10,
          contact_unlocks_7d: 2,
          last_updated: "2026-01-01T00:00:00Z"
        }
      ],
      leads_inbox: [
        {
          lead_id: "lead1",
          source: "search",
          status: "new",
          created_at: "2026-01-01T00:00:00Z",
          contact: { phone_masked: "+91XXXXXX1234" }
        }
      ]
    });
    const r = await getDashboard("tok");
    expect(r.listing_health).toHaveLength(1);
    expect(r.leads_inbox[0].lead_id).toBe("lead1");
    expect(f).toHaveBeenCalledWith("/pg-operator/dashboard", expect.anything());
  });

  it("submitSalesAssistLead() POSTs to /sales/leads as a pg_sales_assist lead", async () => {
    f.mockResolvedValueOnce({ id: "sl1", status: "new", source: "pg_sales_assist" });
    const r = await submitSalesAssistLead(
      { total_beds: 80, city: "Bangalore", phone: "+919999999999", notes: "Large operator" },
      "tok"
    );
    expect(r.id).toBe("sl1");
    expect(f).toHaveBeenCalledWith(
      "/sales/leads",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          source: "pg_sales_assist",
          notes: "Large operator",
          metadata: { total_beds: 80, city: "Bangalore", phone: "+919999999999" }
        })
      })
    );
  });

  it("functions called without a token do NOT set Authorization header", async () => {
    f.mockResolvedValueOnce({ operator: { id: "u1", role: "pg_operator" }, properties: [] });
    await getMe();
    const init = (f.mock.calls[0] as any)[1];
    expect(new Headers(init.headers ?? {}).get("Authorization")).toBeNull();
  });

  it("createPgListing() propagates errors from fetchApi unchanged", async () => {
    const boom = new Error("server explosion");
    f.mockRejectedValueOnce(boom);
    await expect(
      createPgListing({
        idempotencyKey: "k",
        token: "tok",
        payload: {
          property: { display_name: "X", city_slug: "blr" },
          pg_details: { total_beds: 5 },
          room_types: [
            { sharing: "double", ac: true, monthly_rent_paise: 800000, vacancy_count: 4 }
          ]
        } as any
      })
    ).rejects.toBe(boom);
  });
});
