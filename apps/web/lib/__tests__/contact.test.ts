import { describe, it, expect } from "vitest";

import { CRIBLIV_WHATSAPP, shouldShowWhatsappFab, waLink } from "../contact";

describe("waLink", () => {
  it("builds a wa.me link to the central Cribliv number", () => {
    expect(CRIBLIV_WHATSAPP).toBe("918062179562");
    expect(waLink()).toBe("https://wa.me/918062179562");
  });

  it("url-encodes a prefilled message", () => {
    expect(waLink("Hi there now")).toBe("https://wa.me/918062179562?text=Hi%20there%20now");
  });
});

describe("shouldShowWhatsappFab", () => {
  it("shows on public marketing, search and listing pages", () => {
    for (const p of [
      "/en",
      "/hi",
      "/en/search",
      "/en/listing/abc",
      "/en/pg/lucknow/abc",
      "/en/city/lucknow",
      "/en/city/lucknow/gomti-nagar",
      "/hi/blog"
    ]) {
      expect(shouldShowWhatsappFab(p)).toBe(true);
    }
  });

  it("hides on owner/tenant/admin/pg-operator dashboards and auth", () => {
    for (const p of [
      "/en/owner/listings",
      "/hi/owner",
      "/en/tenant/dashboard",
      "/en/admin",
      "/hi/admin/login",
      "/en/pg-operator/listings",
      "/auth/login"
    ]) {
      expect(shouldShowWhatsappFab(p)).toBe(false);
    }
  });

  it("hides when the pathname is unknown", () => {
    expect(shouldShowWhatsappFab(null)).toBe(false);
  });
});
