/**
 * Receipts get their own Azure container (not rent-agreement's) so a receipt
 * blob path can never collide with an agreement's `yyyy/mm/<id>.pdf`. Shared
 * by pg-rent.module.ts (Nest DI factories) and worker/pg-rent-sweeps.ts (the
 * worker has no Nest container, so it wires the same adapters by hand) so
 * the default only lives in one place.
 */
export function receiptContainer(): string {
  return (process.env.PG_RENT_AZURE_CONTAINER ?? "").trim() || "pg-rent-receipts";
}
