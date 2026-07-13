import { describe, expect, it } from "vitest";
import type { AdminLeadTimelineEvent } from "@cribliv/shared-types";
import { describeEvent } from "../LeadDrawer";

function ev(overrides: Partial<AdminLeadTimelineEvent>): AdminLeadTimelineEvent {
  return {
    at: "2026-07-13T00:00:00.000Z",
    source: "lead",
    kind: "new",
    actor: null,
    detail: null,
    ...overrides
  };
}

describe("describeEvent", () => {
  it("labels contact unlock_created with a plain note (never raw JSON)", () => {
    const r = describeEvent(ev({ source: "contact", kind: "unlock_created", detail: "{}" }));
    expect(r.label).toBe("Unlock created");
    expect(r.note).toBe("seeker spent 1 credit");
  });

  it("summarizes owner_responded from its metadata channel, not the JSON blob", () => {
    const r = describeEvent(
      ev({
        source: "contact",
        kind: "owner_responded",
        detail: '{"channel": "call", "called_by": "owner"}'
      })
    );
    expect(r.label).toBe("Owner responded");
    expect(r.note).toBe("via call");
    // The regression we are fixing: the raw JSON must never reach the UI string.
    expect(r.note).not.toContain("{");
    expect(r.note).not.toContain("called_by");
  });

  it("maps known channels to friendly names", () => {
    expect(
      describeEvent(
        ev({ source: "contact", kind: "owner_responded", detail: '{"channel":"whatsapp"}' })
      ).note
    ).toBe("via WhatsApp");
    expect(
      describeEvent(ev({ source: "contact", kind: "owner_responded", detail: '{"channel":"sms"}' }))
        .note
    ).toBe("via SMS");
  });

  it("handles owner_responded with no/blank metadata without leaking a note", () => {
    expect(
      describeEvent(ev({ source: "contact", kind: "owner_responded", detail: "{}" })).note
    ).toBeUndefined();
    expect(
      describeEvent(ev({ source: "contact", kind: "owner_responded", detail: null })).note
    ).toBeUndefined();
  });

  it("labels refund_issued", () => {
    const r = describeEvent(ev({ source: "contact", kind: "refund_issued", detail: "{}" }));
    expect(r.label).toBe("Refund issued");
    expect(r.note).toBe("1 credit returned to seeker");
  });

  it("labels admin actions and surfaces a human reason (never a JSON blob)", () => {
    expect(describeEvent(ev({ source: "admin", kind: "nudge_owner", detail: null }))).toEqual({
      label: "Admin nudged owner",
      note: undefined
    });
    expect(
      describeEvent(ev({ source: "admin", kind: "lead_manual_refund", detail: "seeker complaint" }))
    ).toEqual({
      label: "Admin refunded seeker",
      note: "seeker complaint"
    });
    expect(
      describeEvent(ev({ source: "admin", kind: "mark_team_called", detail: null })).label
    ).toBe("Team marked as called");
    // A stray JSON reason is suppressed rather than rendered raw.
    expect(
      describeEvent(ev({ source: "admin", kind: "nudge_owner", detail: "{}" })).note
    ).toBeUndefined();
  });

  it("maps lead statuses and the nudge note to readable labels", () => {
    expect(describeEvent(ev({ source: "lead", kind: "new", detail: "new" })).label).toBe(
      "Lead created"
    );
    expect(
      describeEvent(ev({ source: "lead", kind: "contacted", detail: "contacted" })).label
    ).toBe("Owner marked contacted");
    expect(
      describeEvent(ev({ source: "lead", kind: "deal_done", detail: "deal_done" })).label
    ).toBe("Deal done");
    expect(
      describeEvent(ev({ source: "lead", kind: "admin_nudged_owner", detail: "new" })).label
    ).toBe("Owner nudged");
  });

  it("falls back to a humanized (never raw) label for unknown kinds", () => {
    const r = describeEvent(ev({ source: "contact", kind: "some_new_event", detail: "{}" }));
    expect(r.label).toBe("Some new event");
    expect(r.note).toBeUndefined();
  });
});
