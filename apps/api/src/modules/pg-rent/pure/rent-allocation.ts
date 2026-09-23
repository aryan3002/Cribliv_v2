export interface OpenInvoice {
  invoiceId: string;
  kind: "rent" | "deposit" | "adhoc" | "settlement";
  dueDate: string;
  balancePaise: number;
}

// Tie-break within the same due date, for non-settlement invoices only —
// settlement invoices are placed after every other invoice regardless of
// their own due date (spec §6.2: "settlement invoices last").
const KIND_RANK: Record<OpenInvoice["kind"], number> = {
  deposit: 0,
  rent: 1,
  adhoc: 1,
  settlement: 0
};

/** Spec §6.2: targets first, then FIFO by due date (deposit before rent on ties, settlement last), remainder = credit. */
export function planAllocation(
  amountPaise: number,
  open: OpenInvoice[],
  targets: Array<{ invoiceId: string; amountPaise: number }>
): { allocations: Array<{ invoiceId: string; amountPaise: number }>; creditPaise: number } {
  const remaining = new Map(open.map((o) => [o.invoiceId, o.balancePaise]));
  const allocations: Array<{ invoiceId: string; amountPaise: number }> = [];
  let left = amountPaise;

  for (const t of targets) {
    const balance = remaining.get(t.invoiceId);
    if (balance === undefined) throw new RangeError(`invoice ${t.invoiceId} is not open`);
    if (t.amountPaise > balance)
      throw new RangeError(`allocation exceeds invoice balance for ${t.invoiceId}`);
    if (t.amountPaise > left) throw new RangeError("allocation exceeds payment");
    allocations.push({ invoiceId: t.invoiceId, amountPaise: t.amountPaise });
    remaining.set(t.invoiceId, balance - t.amountPaise);
    left -= t.amountPaise;
  }

  const order = [...open].sort((a, b) => {
    const aSettlement = a.kind === "settlement" ? 1 : 0;
    const bSettlement = b.kind === "settlement" ? 1 : 0;
    if (aSettlement !== bSettlement) return aSettlement - bSettlement;
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    return KIND_RANK[a.kind] - KIND_RANK[b.kind];
  });
  for (const o of order) {
    if (left <= 0) break;
    const balance = remaining.get(o.invoiceId) ?? 0;
    if (balance <= 0) continue;
    const take = Math.min(balance, left);
    const existing = allocations.find((a) => a.invoiceId === o.invoiceId);
    if (existing) existing.amountPaise += take;
    else allocations.push({ invoiceId: o.invoiceId, amountPaise: take });
    remaining.set(o.invoiceId, balance - take);
    left -= take;
  }
  return { allocations, creditPaise: left };
}

export interface ExistingAllocation {
  allocationId: string;
  paymentId: string;
  amountPaise: number;
  createdAt: string;
}

/** Invariant 14 procedure: shrink allocations newest-first until `excessPaise` is released. */
export function planDeallocation(
  excessPaise: number,
  allocations: ExistingAllocation[]
): Array<{ allocationId: string; paymentId: string; reducePaise: number }> {
  if (excessPaise <= 0) return [];
  const total = allocations.reduce((s, a) => s + a.amountPaise, 0);
  if (excessPaise > total) throw new RangeError("excess exceeds allocated amount");
  const out: Array<{ allocationId: string; paymentId: string; reducePaise: number }> = [];
  let left = excessPaise;
  for (const a of [...allocations].sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1))) {
    if (left <= 0) break;
    const reduce = Math.min(a.amountPaise, left);
    out.push({ allocationId: a.allocationId, paymentId: a.paymentId, reducePaise: reduce });
    left -= reduce;
  }
  return out;
}
