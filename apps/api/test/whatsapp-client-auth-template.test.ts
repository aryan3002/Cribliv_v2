import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsAppClient } from "../src/modules/notifications/whatsapp.client";

describe("WhatsAppClient auth templates", () => {
  beforeEach(() => {
    process.env.WHATSAPP_PROVIDER = "meta";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "pn_123";
    process.env.WHATSAPP_API_TOKEN = "tok_123";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.WHATSAPP_PROVIDER;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_API_TOKEN;
    delete process.env.WHATSAPP_API_URL;
  });

  it("emits a url button component carrying the code", async () => {
    const spy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: "wamid.1" }] })
    });
    vi.stubGlobal("fetch", spy);

    const client = new WhatsAppClient();
    const result = await client.sendTemplate({
      to: "+919044904818",
      templateName: "cribliv_login_otp",
      languageCode: "en",
      bodyParams: ["123456"],
      buttonParams: ["123456"]
    });

    expect(result.success).toBe(true);
    const body = JSON.parse(spy.mock.calls[0][1].body);
    expect(body.to).toBe("919044904818");
    expect(body.template.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "123456" }] },
      {
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: "123456" }]
      }
    ]);
  });

  it("omits the button component when buttonParams is absent", async () => {
    const spy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: "wamid.2" }] })
    });
    vi.stubGlobal("fetch", spy);

    const client = new WhatsAppClient();
    await client.sendTemplate({
      to: "+919044904818",
      templateName: "listing_approved_hi",
      languageCode: "hi",
      bodyParams: ["Flat 2BHK"]
    });

    const body = JSON.parse(spy.mock.calls[0][1].body);
    expect(body.template.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "Flat 2BHK" }] }
    ]);
  });
});
