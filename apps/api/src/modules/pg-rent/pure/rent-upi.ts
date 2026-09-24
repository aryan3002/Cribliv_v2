/** Spec §7.7: `tr` ≤ 35 alphanumerics — invoice numbers carry hyphens, so strip them. */
export function sanitizeTr(invoiceNumber: string): string {
  return invoiceNumber.replace(/[^A-Za-z0-9]/g, "").slice(0, 35);
}

/** upi://pay intent. `am` omitted for "pay a different amount"; `tn` ≤ 50 chars. */
export function buildUpiUri(i: {
  vpa: string;
  payeeName: string;
  amountInr: number | null;
  note: string;
  tr: string;
}): string {
  const params = new URLSearchParams();
  params.set("pa", i.vpa);
  params.set("pn", i.payeeName.slice(0, 50));
  if (i.amountInr !== null) params.set("am", String(i.amountInr));
  params.set("tn", i.note.slice(0, 50));
  params.set("tr", sanitizeTr(i.tr));
  params.set("cu", "INR");
  return `upi://pay?${params.toString()}`;
}

export function waDigits(e164: string): string {
  return e164.replace(/\D/g, "");
}

export function buildWaMeLink(e164: string, text: string): string {
  return `https://wa.me/${waDigits(e164)}?text=${encodeURIComponent(text)}`;
}
