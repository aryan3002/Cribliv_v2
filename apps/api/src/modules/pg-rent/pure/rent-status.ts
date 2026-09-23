/** Invariant 4. Pure function of the four inputs; throws on invariant-14 breach. */
export function invoiceStatus(i: {
  draft: boolean;
  cancelled: boolean;
  totalPaise: number;
  paidPaise: number;
}): "draft" | "cancelled" | "paid" | "partially_paid" | "issued" {
  if (i.cancelled) return "cancelled";
  if (i.draft) return "draft";
  if (i.paidPaise > i.totalPaise) {
    throw new Error(`invariant 14: amount_paid exceeds total (${i.paidPaise} > ${i.totalPaise})`);
  }
  if (i.paidPaise === i.totalPaise) return "paid";
  if (i.paidPaise > 0) return "partially_paid";
  return "issued";
}
