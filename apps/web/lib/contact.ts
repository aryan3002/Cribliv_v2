/**
 * Central Cribliv contact details + the floating WhatsApp CTA's visibility rule.
 *
 * `CRIBLIV_WHATSAPP` is the single source of truth for the support number so the
 * floating button, the contact page, and the FAQ never drift apart again.
 */

/** Central Cribliv WhatsApp number, international format, no "+". */
export const CRIBLIV_WHATSAPP = "918062179562";

/** Build a wa.me click-to-chat link, optionally pre-filling the first message. */
export function waLink(message?: string): string {
  const base = `https://wa.me/${CRIBLIV_WHATSAPP}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

const DASHBOARD_ROUTE = /^\/(en|hi)\/(owner|tenant|admin|pg-operator)(\/|$)/;
const AUTH_ROUTE = /^\/auth(\/|$)/;

/**
 * The floating WhatsApp button is a public support CTA. Show it across the
 * public site but hide it inside the authenticated owner/tenant/admin/
 * pg-operator dashboards and on the auth screens.
 */
export function shouldShowWhatsappFab(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return !DASHBOARD_ROUTE.test(pathname) && !AUTH_ROUTE.test(pathname);
}
