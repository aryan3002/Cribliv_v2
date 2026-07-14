DO $$ BEGIN
  CREATE TYPE pg_maintenance_priority AS ENUM ('emergency','high','normal','low');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE pg_maintenance_location_kind AS ENUM
    ('bed','room','floor','common_area','property_wide','other');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE pg_maintenance_common_area AS ENUM
    ('kitchen','common_bathroom','lift','stairs','corridor','terrace','laundry','parking',
     'reception','mess_food_area','water_tank_motor','wifi_router','security_cctv','other');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE pg_maintenance_event_type AS ENUM
    ('created','status_changed','priority_set','priority_overridden','comment_added',
     'internal_note_added','photo_added','resolution_recorded','reopened','auto_closed','cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE pg_maintenance_event_visibility AS ENUM ('public','operator_internal');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS pg_maintenance_categories (
  slug text PRIMARY KEY,
  display_name text NOT NULL,
  default_priority pg_maintenance_priority NOT NULL,
  active boolean NOT NULL DEFAULT true,
  sort_order smallint NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_updated_at ON pg_maintenance_categories;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pg_maintenance_categories
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

INSERT INTO pg_maintenance_categories (slug, display_name, default_priority, sort_order) VALUES
  ('plumbing', 'Plumbing', 'high', 10),
  ('electrical', 'Electrical', 'emergency', 20),
  ('internet_wifi', 'Internet/Wi-Fi', 'high', 30),
  ('appliance', 'Appliance', 'normal', 40),
  ('furniture', 'Furniture', 'normal', 50),
  ('cleaning', 'Cleaning', 'normal', 60),
  ('pest_control', 'Pest control', 'normal', 70),
  ('water_supply', 'Water supply', 'emergency', 80),
  ('power_backup', 'Power backup', 'high', 90),
  ('food_mess', 'Food/Mess', 'normal', 100),
  ('security', 'Security', 'emergency', 110),
  ('room_access_keys', 'Room access/keys', 'high', 120),
  ('noise_roommate', 'Noise/roommate', 'low', 130),
  ('billing', 'Billing', 'low', 140),
  ('other', 'Other', 'normal', 150)
ON CONFLICT (slug) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      default_priority = EXCLUDED.default_priority,
      sort_order = EXCLUDED.sort_order,
      active = true;

ALTER TABLE pg_maintenance_requests
  ADD COLUMN IF NOT EXISTS category_slug text REFERENCES pg_maintenance_categories(slug),
  ADD COLUMN IF NOT EXISTS category_label_snapshot text,
  ADD COLUMN IF NOT EXISTS location_kind pg_maintenance_location_kind,
  ADD COLUMN IF NOT EXISTS room_id uuid REFERENCES pg_rooms(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bed_id uuid REFERENCES pg_beds(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS floor smallint,
  ADD COLUMN IF NOT EXISTS common_area pg_maintenance_common_area,
  ADD COLUMN IF NOT EXISTS location_detail text,
  ADD COLUMN IF NOT EXISTS location_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- R2: temporary enum column; backfilled below, then legacy text `priority`
  -- is dropped and this is renamed to `priority`. No permanent priority_v2.
  ADD COLUMN IF NOT EXISTS priority_enum pg_maintenance_priority,
  ADD COLUMN IF NOT EXISTS priority_source text NOT NULL DEFAULT 'category_default',
  ADD COLUMN IF NOT EXISTS priority_overridden_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS priority_overridden_at timestamptz,
  ADD COLUMN IF NOT EXISTS priority_override_reason text,
  ADD COLUMN IF NOT EXISTS sla_hours smallint,
  ADD COLUMN IF NOT EXISTS sla_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS resolution_note text,
  ADD COLUMN IF NOT EXISTS resolution_source text,
  ADD COLUMN IF NOT EXISTS fix_photo_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS resolution_cost_paise bigint,
  ADD COLUMN IF NOT EXISTS chargeable_damage boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_close_after timestamptz,
  ADD COLUMN IF NOT EXISTS auto_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_tenant_activity_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_operator_activity_at timestamptz;

CREATE TABLE IF NOT EXISTS pg_maintenance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES pg_maintenance_requests(id) ON DELETE CASCADE,
  event_type pg_maintenance_event_type NOT NULL,
  visibility pg_maintenance_event_visibility NOT NULL DEFAULT 'public',
  actor_user_id uuid REFERENCES users(id),
  actor_role text NOT NULL CHECK (actor_role IN ('tenant','pg_operator','admin','system')),
  from_status text,
  to_status text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

UPDATE pg_maintenance_requests r
SET category_slug = COALESCE(c.slug, 'other'),
    category_label_snapshot = r.category
FROM pg_maintenance_categories c
WHERE lower(regexp_replace(r.category, '[^a-zA-Z0-9]+', '_', 'g')) = c.slug
  AND r.category_slug IS NULL;

UPDATE pg_maintenance_requests
SET category_slug = 'other',
    category_label_snapshot = category
WHERE category_slug IS NULL;

-- R2 (defensive): preserve any existing free-text priority that already maps to
-- the enum (so an operator-set value isn't lost); category default fills the rest.
UPDATE pg_maintenance_requests
SET priority_enum = lower(trim(priority))::pg_maintenance_priority,
    priority_source = 'backfill'
WHERE priority_enum IS NULL
  AND lower(trim(priority)) IN ('emergency','high','normal','low');

UPDATE pg_maintenance_requests r
SET priority_enum = c.default_priority,
    priority_source = 'backfill'
FROM pg_maintenance_categories c
WHERE r.category_slug = c.slug
  AND r.priority_enum IS NULL;

UPDATE pg_maintenance_requests
SET sla_hours = CASE priority_enum
  WHEN 'emergency' THEN 4
  WHEN 'high' THEN 24
  WHEN 'normal' THEN 72
  WHEN 'low' THEN 168
END
WHERE sla_hours IS NULL;

UPDATE pg_maintenance_requests
SET sla_due_at = created_at + (sla_hours || ' hours')::interval
WHERE sla_due_at IS NULL;

UPDATE pg_maintenance_requests r
SET location_kind = COALESCE(
      (
        SELECT 'bed'::pg_maintenance_location_kind
        FROM pg_bed_assignments a
        JOIN pg_beds b ON b.id = a.bed_id
        WHERE a.id = r.assignment_id
      ),
      'property_wide'::pg_maintenance_location_kind
    ),
    room_id = (
      SELECT rm.id
      FROM pg_bed_assignments a
      JOIN pg_beds b ON b.id = a.bed_id
      JOIN pg_rooms rm ON rm.id = b.room_id
      WHERE a.id = r.assignment_id
    ),
    bed_id = (
      SELECT b.id
      FROM pg_bed_assignments a
      JOIN pg_beds b ON b.id = a.bed_id
      WHERE a.id = r.assignment_id
    ),
    floor = (
      SELECT rm.floor
      FROM pg_bed_assignments a
      JOIN pg_beds b ON b.id = a.bed_id
      JOIN pg_rooms rm ON rm.id = b.room_id
      WHERE a.id = r.assignment_id
    ),
    location_snapshot = COALESCE(
      (
        SELECT jsonb_build_object(
          'kind', 'bed',
          'property_name', p.display_name,
          'room_number', rm.room_number,
          'room_label', rm.display_label,
          'floor', rm.floor,
          'bed_label', b.bed_label,
          'common_area', null,
          'detail', null
        )
        FROM pg_bed_assignments a
        JOIN pg_beds b ON b.id = a.bed_id
        JOIN pg_rooms rm ON rm.id = b.room_id
        WHERE a.id = r.assignment_id
      ),
      jsonb_build_object(
        'kind', 'property_wide',
        'property_name', p.display_name,
        'room_number', null,
        'room_label', null,
        'floor', null,
        'bed_label', null,
        'common_area', null,
        'detail', null
      )
    )
FROM pg_properties p
WHERE p.id = r.pg_property_id
  AND r.location_kind IS NULL;

UPDATE pg_maintenance_requests
SET resolved_at = COALESCE(closed_at, updated_at),
    resolution_source = COALESCE(resolution_source, 'backfill_v1'),
    auto_close_after = NULL
WHERE status IN ('resolved','closed')
  AND resolved_at IS NULL;

ALTER TABLE pg_maintenance_requests
  ALTER COLUMN priority_enum SET NOT NULL;
ALTER TABLE pg_maintenance_requests DROP COLUMN priority;
ALTER TABLE pg_maintenance_requests RENAME COLUMN priority_enum TO priority;

ALTER TABLE pg_maintenance_requests
  ALTER COLUMN category_slug SET NOT NULL,
  ALTER COLUMN category_label_snapshot SET NOT NULL,
  ALTER COLUMN location_kind SET NOT NULL,
  ALTER COLUMN sla_hours SET NOT NULL,
  ALTER COLUMN sla_due_at SET NOT NULL;

ALTER TABLE pg_maintenance_requests
  ADD CONSTRAINT pg_maint_resolution_cost_nonnegative
    CHECK (resolution_cost_paise IS NULL OR resolution_cost_paise >= 0),
  ADD CONSTRAINT pg_maint_priority_source_valid
    CHECK (priority_source IN ('category_default','operator_override','backfill')),
  ADD CONSTRAINT pg_maint_sla_hours_positive
    CHECK (sla_hours IN (4, 24, 72, 168)),
  ADD CONSTRAINT pg_maint_location_required
    CHECK (
      (location_kind = 'bed' AND bed_id IS NOT NULL)
      OR (location_kind = 'room' AND room_id IS NOT NULL)
      OR (location_kind = 'floor' AND floor IS NOT NULL)
      OR (location_kind = 'common_area' AND common_area IS NOT NULL)
      OR (location_kind = 'property_wide')
      OR (location_kind = 'other' AND nullif(trim(location_detail), '') IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS idx_pg_maint_queue
  ON pg_maintenance_requests(pg_property_id, status, priority, sla_due_at)
  WHERE status IN ('open','in_progress','waiting_on_tenant','resolved');

-- R3/R12: serves the default keyset sort (SLA due first) across active statuses,
-- which the (property, status, ...) index above cannot order efficiently.
CREATE INDEX IF NOT EXISTS idx_pg_maint_queue_sla
  ON pg_maintenance_requests(pg_property_id, sla_due_at, id)
  WHERE status IN ('open','in_progress','waiting_on_tenant','resolved');

-- R9: closed_this_month analytics counts closed rows that the partial indexes exclude.
CREATE INDEX IF NOT EXISTS idx_pg_maint_closed_at
  ON pg_maintenance_requests(pg_property_id, closed_at)
  WHERE status = 'closed';

CREATE INDEX IF NOT EXISTS idx_pg_maint_due_sweep
  ON pg_maintenance_requests(sla_due_at)
  WHERE status IN ('open','in_progress','waiting_on_tenant');

CREATE INDEX IF NOT EXISTS idx_pg_maint_auto_close_sweep
  ON pg_maintenance_requests(auto_close_after)
  WHERE status = 'resolved';

CREATE INDEX IF NOT EXISTS idx_pg_maint_assignment_created
  ON pg_maintenance_requests(assignment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pg_maint_bed_status
  ON pg_maintenance_requests(pg_property_id, bed_id, status, created_at DESC)
  WHERE bed_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pg_maint_category_status
  ON pg_maintenance_requests(pg_property_id, category_slug, status);

CREATE INDEX IF NOT EXISTS idx_pg_maint_common_area
  ON pg_maintenance_requests(pg_property_id, common_area, status)
  WHERE location_kind = 'common_area';

CREATE INDEX IF NOT EXISTS idx_pg_maint_events_request
  ON pg_maintenance_events(request_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_pg_assignments_tenant_history
  ON pg_bed_assignments(tenant_user_id, move_out_date DESC)
  WHERE status = 'moved_out';

INSERT INTO pg_maintenance_events (request_id, event_type, visibility, actor_user_id, actor_role, to_status, payload, created_at)
SELECT r.id, 'created', 'public', r.created_by_user_id, 'tenant', r.status::text,
       jsonb_build_object('category_slug', r.category_slug, 'priority', r.priority),
       r.created_at
FROM pg_maintenance_requests r
WHERE NOT EXISTS (
  SELECT 1 FROM pg_maintenance_events e
  WHERE e.request_id = r.id AND e.event_type = 'created'
);

INSERT INTO pg_maintenance_events (request_id, event_type, visibility, actor_user_id, actor_role, payload, created_at)
SELECT c.request_id, 'comment_added', 'public', c.author_user_id, c.author_role,
       jsonb_build_object('comment_id', c.id, 'attachments', c.attachments),
       c.created_at
FROM pg_maintenance_comments c
WHERE NOT EXISTS (
  SELECT 1 FROM pg_maintenance_events e
  WHERE e.event_type = 'comment_added'
    AND e.payload->>'comment_id' = c.id::text
);
