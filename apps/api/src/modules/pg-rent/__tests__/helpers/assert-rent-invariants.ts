import type { DatabaseService } from "../../../../common/database.service";

/**
 * Spec §3 invariants that can be checked from the data alone. Throws with every
 * violation listed so a failing test names the broken rule, not just "false".
 */
export async function assertRentInvariants(
  db: Pick<DatabaseService, "query">,
  propertyId: string
): Promise<void> {
  const violations: string[] = [];

  // 1: total = Σ lines, total ≥ 0
  const totals = await db.query<{ id: string; total: string; sum: string }>(
    `SELECT i.id::text, i.total_paise::text AS total, COALESCE(SUM(l.amount_paise), 0)::text AS sum
       FROM pg_rent_invoices i LEFT JOIN pg_rent_invoice_lines l ON l.invoice_id = i.id
      WHERE i.pg_property_id = $1::uuid
      GROUP BY i.id HAVING i.total_paise <> COALESCE(SUM(l.amount_paise), 0) OR i.total_paise < 0`,
    [propertyId]
  );
  for (const r of totals.rows)
    violations.push(`inv1 invoice ${r.id}: total ${r.total} != lines ${r.sum}`);

  // 2 + 14: amount_paid = Σ confirmed allocations to the invoice, and ≤ total
  const paid = await db.query<{ id: string; paid: string; sum: string; total: string }>(
    `SELECT i.id::text, i.amount_paid_paise::text AS paid, i.total_paise::text AS total,
            COALESCE(SUM(a.amount_paise) FILTER (WHERE p.status = 'confirmed'), 0)::text AS sum
       FROM pg_rent_invoices i
       LEFT JOIN pg_rent_payment_allocations a ON a.invoice_id = i.id
       LEFT JOIN pg_rent_payments p ON p.id = a.payment_id
      WHERE i.pg_property_id = $1::uuid
      GROUP BY i.id
     HAVING i.amount_paid_paise <> COALESCE(SUM(a.amount_paise) FILTER (WHERE p.status = 'confirmed'), 0)
         OR i.amount_paid_paise > i.total_paise`,
    [propertyId]
  );
  for (const r of paid.rows)
    violations.push(`inv2/14 invoice ${r.id}: paid ${r.paid}, allocs ${r.sum}, total ${r.total}`);

  // 3: Σ allocations of an inflow ≤ its amount
  const over = await db.query<{ id: string }>(
    `SELECT p.id::text FROM pg_rent_payments p
       JOIN pg_rent_payment_allocations a ON a.payment_id = p.id
      WHERE p.pg_property_id = $1::uuid
      GROUP BY p.id HAVING SUM(a.amount_paise) > p.amount_paise`,
    [propertyId]
  );
  for (const r of over.rows) violations.push(`inv3 payment ${r.id}: over-allocated`);

  // 4: status is the pure function
  const status = await db.query<{ id: string; status: string; expected: string }>(
    `SELECT id::text, status::text,
            CASE WHEN status = 'cancelled' THEN 'cancelled'
                 WHEN status = 'draft' THEN 'draft'
                 WHEN amount_paid_paise = total_paise THEN 'paid'
                 WHEN amount_paid_paise > 0 THEN 'partially_paid'
                 ELSE 'issued' END AS expected
       FROM pg_rent_invoices WHERE pg_property_id = $1::uuid`,
    [propertyId]
  );
  for (const r of status.rows) {
    if (r.status !== r.expected)
      violations.push(`inv4 invoice ${r.id}: status ${r.status}, expected ${r.expected}`);
  }

  // 5: no overlapping non-cancelled rent periods per assignment. A NULL bound
  // means "no period recorded" (e.g. a hand-inserted test fixture), not an
  // unbounded period — `daterange(NULL, NULL, '[]')` is the universal range
  // and would otherwise flag every such invoice as overlapping every other
  // one, so both invoices must actually carry a period before comparing.
  const overlap = await db.query<{ a: string; b: string }>(
    `SELECT x.id::text AS a, y.id::text AS b
       FROM pg_rent_invoices x JOIN pg_rent_invoices y
         ON x.assignment_id = y.assignment_id AND x.id < y.id
        AND x.kind = 'rent' AND y.kind = 'rent'
        AND x.status <> 'cancelled' AND y.status <> 'cancelled'
        AND x.period_start IS NOT NULL AND x.period_end IS NOT NULL
        AND y.period_start IS NOT NULL AND y.period_end IS NOT NULL
        AND daterange(x.period_start, x.period_end, '[]') && daterange(y.period_start, y.period_end, '[]')
      WHERE x.pg_property_id = $1::uuid`,
    [propertyId]
  );
  for (const r of overlap.rows) violations.push(`inv5 invoices ${r.a} and ${r.b} overlap`);

  // 15: outflows fully funded; inflows never targets
  const outflows = await db.query<{ id: string; amount: string; funded: string }>(
    `SELECT p.id::text, p.amount_paise::text AS amount, COALESCE(SUM(a.amount_paise), 0)::text AS funded
       FROM pg_rent_payments p LEFT JOIN pg_rent_payment_allocations a ON a.refund_payment_id = p.id
      WHERE p.pg_property_id = $1::uuid AND p.direction = 'outflow' AND p.status = 'confirmed'
      GROUP BY p.id HAVING COALESCE(SUM(a.amount_paise), 0) <> p.amount_paise`,
    [propertyId]
  );
  for (const r of outflows.rows)
    violations.push(`inv15 outflow ${r.id}: amount ${r.amount}, funded ${r.funded}`);

  // 16: late_fee lines only on eligible rent invoices
  const fees = await db.query<{ id: string }>(
    `SELECT i.id::text FROM pg_rent_invoices i JOIN pg_rent_invoice_lines l ON l.invoice_id = i.id
      WHERE i.pg_property_id = $1::uuid AND l.kind = 'late_fee' AND (i.kind <> 'rent' OR i.late_fee_eligible = false)`,
    [propertyId]
  );
  for (const r of fees.rows)
    violations.push(`inv16 invoice ${r.id}: late fee on ineligible invoice`);

  if (violations.length) {
    throw new Error(`Rent invariants violated for ${propertyId}:\n${violations.join("\n")}`);
  }
}
