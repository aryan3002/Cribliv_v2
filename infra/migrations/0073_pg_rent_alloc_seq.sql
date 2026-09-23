-- infra/migrations/0073_pg_rent_alloc_seq.sql
-- Give pg_rent_payment_allocations a total order.
--
-- Every allocation row a payment produces is written inside one transaction
-- (RentAllocationService.allocateFifo loops over the plan), and created_at
-- defaults to now(), which is the *transaction* timestamp — so a payment split
-- FIFO across the deposit and then the rent gets two rows with byte-identical
-- created_at. ORDER BY created_at alone therefore has no tiebreak and Postgres
-- may return them either way round, which loses the business order operators
-- and tenants see on a receipt (deposit before rent).
--
-- ctid is not a substitute: deallocateExcess UPDATEs an allocation row to
-- reduce it (rent-allocation.service.ts), and an UPDATE moves the tuple to a
-- new ctid, silently reordering it against its siblings.
--
-- An identity column is the only key here that is monotonic in insertion order
-- and immune to later UPDATEs. Adding it rewrites the table, which is fine:
-- the table ships with this feature branch and is empty in every environment.
ALTER TABLE pg_rent_payment_allocations
  ADD COLUMN IF NOT EXISTS seq bigint GENERATED ALWAYS AS IDENTITY;
