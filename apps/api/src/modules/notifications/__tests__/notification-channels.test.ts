import { describe, it, expect, vi } from "vitest";
import { NotificationService } from "../notification.service";

function svc(waSend: any, smsSend: any) {
  const appState: any = {
    users: new Map([["u1", { phone: "+919999999999", whatsapp_opt_in: true }]])
  };
  const database: any = { isEnabled: () => false };
  const whatsApp: any = { sendTemplate: waSend };
  const sms: any = { sendSms: smsSend };
  return new NotificationService(appState, database, whatsApp, sms);
}

describe("NotificationService channel fan-out", () => {
  it("dispatches to both whatsapp and sms for a two-channel type", async () => {
    const wa = vi.fn().mockResolvedValue({ success: true, messageId: "wa1" });
    const sms = vi.fn().mockResolvedValue({ success: true, messageId: "sms1" });
    const ok = await svc(wa, sms).send({
      type: "owner.contact_unlocked",
      recipientUserId: "u1",
      payload: { listing_title: "Flat", tenant_name: "A", response_deadline: "24 घंटे" },
      mode: "immediate",
      forceOptIn: true
    });
    expect(ok).toBe(true);
    expect(wa).toHaveBeenCalledTimes(1);
    expect(sms).toHaveBeenCalledTimes(1);
  });

  it("does not send SMS for a whatsapp-only type", async () => {
    const wa = vi.fn().mockResolvedValue({ success: true });
    const sms = vi.fn().mockResolvedValue({ success: true });
    await svc(wa, sms).send({
      type: "owner.listing_approved",
      recipientUserId: "u1",
      payload: {},
      mode: "immediate",
      forceOptIn: true
    });
    expect(wa).toHaveBeenCalledTimes(1);
    expect(sms).not.toHaveBeenCalled();
  });
});
