-- CRM seed data for Cribliv admin dashboard testing
-- Uses real owner user IDs from the DB, falls back gracefully if < 2 owners exist

DO $$
DECLARE
  owner1 UUID;
  owner2 UUID;
BEGIN
  -- Pick up to 2 real owner (or any) user IDs
  SELECT id INTO owner1 FROM users WHERE role = 'owner' LIMIT 1;
  SELECT id INTO owner2 FROM users WHERE role = 'owner' LIMIT 1 OFFSET 1;

  -- If fewer than 2 owners, reuse owner1
  IF owner2 IS NULL THEN owner2 := owner1; END IF;

  -- If no owners at all, fall back to any user
  IF owner1 IS NULL THEN
    SELECT id INTO owner1 FROM users LIMIT 1;
    owner2 := owner1;
  END IF;

  INSERT INTO sales_leads
    (id, created_by_user_id, listing_id, source, status, notes, metadata, crm_sync_status, created_at)
  VALUES
    -- New leads
    (gen_random_uuid(), owner1, NULL, 'pg_sales_assist', 'new',
     'Interested in PG management for 3 properties in Noida',
     '{"phone":"+919876543210","city":"Noida","pgCount":3}',
     'pending', NOW() - INTERVAL '1 hour'),

    (gen_random_uuid(), owner2, NULL, 'property_management', 'new',
     'Has 2 flats, wants full management',
     '{"phone":"+919812345678","city":"Delhi","flatCount":2}',
     'pending', NOW() - INTERVAL '3 hours'),

    -- Contacted
    (gen_random_uuid(), owner1, NULL, 'pg_sales_assist', 'contacted',
     'Called, interested, needs pricing info',
     '{"phone":"+919900001111","city":"Gurgaon"}',
     'synced', NOW() - INTERVAL '2 days'),

    (gen_random_uuid(), owner2, NULL, 'property_management', 'contacted',
     'WhatsApp sent, awaiting reply',
     '{"phone":"+919988776655","city":"Noida"}',
     'synced', NOW() - INTERVAL '1 day'),

    -- Qualified
    (gen_random_uuid(), owner1, NULL, 'pg_sales_assist', 'qualified',
     'Ready to sign, has 5 PG rooms',
     '{"phone":"+919123456789","city":"Noida","pgCount":5,"monthlyRevenue":75000}',
     'synced', NOW() - INTERVAL '5 days'),

    (gen_random_uuid(), owner2, NULL, 'property_management', 'qualified',
     'Qualified — 3 flats, premium locality',
     '{"phone":"+919234567890","city":"Delhi"}',
     'synced', NOW() - INTERVAL '4 days'),

    -- Closed Won
    (gen_random_uuid(), owner1, NULL, 'pg_sales_assist', 'closed_won',
     'Onboarded successfully. 8 rooms under management.',
     '{"phone":"+919345678901","city":"Noida","pgCount":8}',
     'synced', NOW() - INTERVAL '10 days'),

    (gen_random_uuid(), owner2, NULL, 'property_management', 'closed_won',
     'Contract signed. 4 flats managed.',
     '{"phone":"+919456789012","city":"Gurgaon"}',
     'synced', NOW() - INTERVAL '15 days'),

    -- Closed Lost
    (gen_random_uuid(), owner1, NULL, 'pg_sales_assist', 'closed_lost',
     'Went with competitor, price too high',
     '{"phone":"+919567890123","city":"Delhi"}',
     'synced', NOW() - INTERVAL '7 days'),

    -- Sync error (triggers alert KPI card)
    (gen_random_uuid(), owner2, NULL, 'property_management', 'contacted',
     'Sync failed - retry needed',
     '{"phone":"+919678901234","city":"Noida"}',
     'error', NOW() - INTERVAL '6 hours');

  RAISE NOTICE 'Seeded 10 CRM leads using owner1=% owner2=%', owner1, owner2;
END $$;
