import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsAppClient } from "../src/modules/notifications/whatsapp.client";

/**
 * D7 acts as our WhatsApp BSP (it ran the Meta embedded-signup that created the
 * CribLiv WABA), so sends go through D7's proxy rather than graph.facebook.com.
 * Docs: https://d7networks.com/docs/whatsapp/send-templated-message/authentication-template-message/
 */
describe("WhatsAppClient D7 transport", () => {
  beforeEach(() => {
    process.env.WHATSAPP_PROVIDER = "d7";
    process.env.WHATSAPP_ORIGINATOR = "+919000000000";
    process.env.D7_WHATSAPP_TOKEN = "d7-jwt";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.WHATSAPP_PROVIDER;
    delete process.env.WHATSAPP_ORIGINATOR;
    delete process.env.D7_WHATSAPP_TOKEN;
    delete process.env.D7_KEY;
    delete process.env.WHATSAPP_API_URL;
  });

  function stub(body: unknown, ok = true, status = 200) {
    const spy = vi.fn().mockResolvedValue({ ok, status, json: async () => body });
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  it("posts D7's auth-template shape with the code in BOTH body and button", async () => {
    const spy = stub({ request_id: "req_1" });

    const result = await new WhatsAppClient().sendTemplate({
      to: "+919044904818",
      templateName: "cribliv",
      languageCode: "en",
      bodyParams: ["123456"],
      buttonParams: ["123456"]
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("req_1");

    expect(spy.mock.calls[0][0]).toBe("https://api.d7networks.com/whatsapp/v2/send");
    expect(spy.mock.calls[0][1].headers.Authorization).toBe("Bearer d7-jwt");

    const body = JSON.parse(spy.mock.calls[0][1].body);
    expect(body).toEqual({
      messages: [
        {
          originator: "+919000000000",
          content: {
            message_type: "TEMPLATE",
            template: {
              template_id: "cribliv",
              language: "en",
              body_parameter_values: { "0": "123456" },
              buttons: {
                actions: [{ action_index: "0", action_type: "url", action_payload: "123456" }]
              }
            }
          },
          recipients: [{ recipient: "+919044904818", recipient_type: "individual" }]
        }
      ]
    });
  });

  it("omits the buttons block for templates with no button", async () => {
    const spy = stub({ request_id: "req_3" });

    await new WhatsAppClient().sendTemplate({
      to: "+919044904818",
      templateName: "listing_approved",
      languageCode: "hi",
      bodyParams: ["Flat 2BHK", "Gomti Nagar"]
    });

    const template = JSON.parse(spy.mock.calls[0][1].body).messages[0].content.template;
    expect(template.body_parameter_values).toEqual({ "0": "Flat 2BHK", "1": "Gomti Nagar" });
    expect(template.buttons).toBeUndefined();
  });

  it("falls back to D7_KEY when D7_WHATSAPP_TOKEN is unset", async () => {
    delete process.env.D7_WHATSAPP_TOKEN;
    process.env.D7_KEY = "shared-d7-key";
    const spy = stub({ request_id: "req_2" });

    await new WhatsAppClient().sendTemplate({
      to: "+919044904818",
      templateName: "3_auth_copy",
      languageCode: "en",
      buttonParams: ["654321"]
    });

    expect(spy.mock.calls[0][1].headers.Authorization).toBe("Bearer shared-d7-key");
  });

  it("reports failure when D7 returns a non-2xx", async () => {
    stub({ detail: "invalid template" }, false, 400);

    const result = await new WhatsAppClient().sendTemplate({
      to: "+919044904818",
      templateName: "3_auth_copy",
      languageCode: "en",
      buttonParams: ["123456"]
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("400");
  });

  it("reports missing_credentials when no originator is configured", async () => {
    delete process.env.WHATSAPP_ORIGINATOR;
    const spy = stub({ request_id: "nope" });

    const result = await new WhatsAppClient().sendTemplate({
      to: "+919044904818",
      templateName: "3_auth_copy",
      languageCode: "en",
      buttonParams: ["123456"]
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("missing_credentials");
    expect(spy).not.toHaveBeenCalled();
  });

  it("still uses the Meta transport when WHATSAPP_PROVIDER=meta", async () => {
    process.env.WHATSAPP_PROVIDER = "meta";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "pn_1";
    process.env.WHATSAPP_API_TOKEN = "meta-token";
    const spy = stub({ messages: [{ id: "wamid.9" }] });

    await new WhatsAppClient().sendTemplate({
      to: "+919044904818",
      templateName: "cribliv_login_otp",
      languageCode: "en",
      bodyParams: ["123456"],
      buttonParams: ["123456"]
    });

    expect(String(spy.mock.calls[0][0])).toContain("graph.facebook.com");

    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_API_TOKEN;
  });
});
