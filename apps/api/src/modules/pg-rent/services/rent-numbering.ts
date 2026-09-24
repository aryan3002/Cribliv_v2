import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";

export const PAY_TOKEN_DAYS = 45;

export async function nextInvoiceNumber(
  client: PoolClient,
  propertyId: string,
  prefix: string
): Promise<string> {
  const r = await client.query<{ seq: number }>(
    `UPDATE pg_rent_counters SET next_invoice_seq = next_invoice_seq + 1 WHERE pg_property_id = $1::uuid RETURNING next_invoice_seq - 1 AS seq`,
    [propertyId]
  );
  if (!r.rows[0]) throw new Error(`pg_rent_counters missing for ${propertyId}`);
  return `${prefix}-INV-${String(r.rows[0].seq).padStart(4, "0")}`;
}

export function newPayToken(): { token: string; expiresAt: Date } {
  return {
    token: randomBytes(32).toString("base64url"),
    expiresAt: new Date(Date.now() + PAY_TOKEN_DAYS * 24 * 60 * 60 * 1000)
  };
}
