import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import PgLeadsBoard from "../PgLeadsBoard";
import type { PgDashboardLead } from "@cribliv/shared-types";

const { flagState } = vi.hoisted(() => ({
  flagState: { ff_callback_leads: false } as Record<string, boolean>
}));

vi.mock("../../../../lib/feature-flags", () => ({
  useFlag: (flag: string) => Boolean(flagState[flag])
}));

function baseLead(overrides: Partial<PgDashboardLead> = {}): PgDashboardLead {
  return {
    lead_id: "lead-1",
    source: "contact_unlock",
    status: "new",
    created_at: "2026-01-01T00:00:00Z",
    contact: { phone_masked: "+9198***234" },
    access_state: "locked",
    call_deadline_at: "2026-01-02T00:00:00Z",
    called_at: null,
    called_by: null,
    tenant_name: "Asha",
    tenant_phone: null,
    ...overrides
  };
}

function jsonOk(data: unknown) {
  return Promise.resolve({ ok: true, json: async () => ({ data }) });
}

function jsonErr(status: number, code: string, message: string) {
  return Promise.resolve({ ok: false, status, json: async () => ({ error: { code, message } }) });
}

// @hello-pangea/dnd's dragHandleProps puts role="button" on the whole
// draggable <article> (for keyboard drag support), so getByRole often finds
// two matches for a button's accessible name — the wrapping article AND the
// real <button>. Filter down to the actual <button> element.
function getInnerButton(name: RegExp): HTMLElement {
  const matches = screen.getAllByRole("button", { name });
  const button = matches.find((el) => el.tagName === "BUTTON");
  if (!button) throw new Error(`No <button> element found matching ${name}`);
  return button;
}

function routeFetch(
  routes: Array<{
    match: (url: string, init?: RequestInit) => boolean;
    respond: (init?: RequestInit) => Promise<unknown>;
  }>
) {
  return vi.fn((url: string, init?: RequestInit) => {
    const route = routes.find((r) => r.match(String(url), init));
    if (!route) {
      throw new Error(`Unmocked fetch call: ${init?.method ?? "GET"} ${url}`);
    }
    return route.respond(init);
  });
}

beforeEach(() => {
  flagState.ff_callback_leads = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PgLeadsBoard", () => {
  it("callback flag off: retains the legacy dev-reveal path via pg-operator/leads/:id/open", async () => {
    flagState.ff_callback_leads = false;
    vi.stubGlobal(
      "fetch",
      routeFetch([
        {
          match: (url, init) =>
            url.includes("/pg-operator/leads/lead-1/open") && init?.method === "POST",
          respond: () => jsonOk({ lead_id: "lead-1", phone: "+919812345678", tenant_name: "Asha" })
        }
      ])
    );

    render(<PgLeadsBoard leads={[baseLead()]} token="tok" locale="en" />);

    expect(screen.queryByTestId("lead-monetization")).not.toBeInTheDocument();
    fireEvent.click(getInnerButton(/reveal contact/i));
    await screen.findByText("+919812345678");
  });

  it("callback flag on, locked lead: shows blurred contact and unlocks via the paid owner/leads endpoint", async () => {
    flagState.ff_callback_leads = true;
    vi.stubGlobal(
      "fetch",
      routeFetch([
        {
          match: (url, init) =>
            url.includes("/owner/leads/lead-1/unlock") && init?.method === "POST",
          respond: () =>
            jsonOk({
              lead_id: "lead-1",
              access_state: "unlocked",
              tenant_phone: "+919812345678",
              tenant_name: "Asha",
              credits_remaining: 4
            })
        }
      ])
    );

    render(<PgLeadsBoard leads={[baseLead()]} token="tok" locale="en" />);

    expect(screen.queryByRole("button", { name: /reveal contact/i })).not.toBeInTheDocument();
    fireEvent.click(getInnerButton(/unlock for 1 credit/i));
    await screen.findByText("+919812345678");
  });

  it("callback flag on, insufficient credits: opens the shared purchase dialog instead of the legacy reveal", async () => {
    flagState.ff_callback_leads = true;
    vi.stubGlobal(
      "fetch",
      routeFetch([
        {
          match: (url, init) =>
            url.includes("/owner/leads/lead-1/unlock") && init?.method === "POST",
          respond: () => jsonErr(402, "insufficient_credits", "Not enough credits")
        },
        {
          match: (url) => url.includes("/wallet/plans"),
          respond: () => jsonOk({ items: [] })
        },
        {
          match: (url, init) =>
            url.includes("/wallet") &&
            !url.includes("/wallet/plans") &&
            (!init?.method || init.method === "GET"),
          respond: () => jsonOk({ balance_credits: 0, free_credits_granted: 2 })
        }
      ])
    );

    render(<PgLeadsBoard leads={[baseLead()]} token="tok" locale="en" />);

    fireEvent.click(getInnerButton(/unlock for 1 credit/i));
    await screen.findByTestId("lead-credits-panel");
  });

  it("callback flag on, free/unlocked lead: shows the phone and a Call now button", () => {
    flagState.ff_callback_leads = true;
    vi.stubGlobal("fetch", routeFetch([]));

    render(
      <PgLeadsBoard
        leads={[
          baseLead({
            access_state: "free",
            tenant_phone: "+919812345678",
            call_deadline_at: null
          })
        ]}
        token="tok"
        locale="en"
      />
    );

    expect(screen.getByText("+919812345678")).toBeInTheDocument();
    expect(getInnerButton(/call now/i)).toBeInTheDocument();
  });
});
