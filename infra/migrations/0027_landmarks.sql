-- ─── Migration 0024: Landmarks ────────────────────────────────────────────────
-- Generic place-of-interest table that powers SEO landing pages like
--   /[locale]/city/lucknow/near/[landmark]
-- Type covers colleges, hospitals, malls, markets, stations, airports, IT
-- parks, religious sites etc. Same schema is reusable across cities.
--
-- `aka` holds common aliases / abbreviations / Hindi forms so search and
-- redirects can match how users actually type ("KGMU", "King George",
-- "किंग जॉर्ज").
--
-- Safe to re-run: CREATE IF NOT EXISTS + ON CONFLICT.

DO $$ BEGIN
  CREATE TYPE landmark_type AS ENUM (
    'college', 'hospital', 'mall', 'market', 'station', 'airport',
    'it_park', 'office', 'religious', 'park', 'stadium', 'monument'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS landmarks (
  id                     serial PRIMARY KEY,
  city_id                int NOT NULL REFERENCES cities(id),
  slug                   text NOT NULL,
  name_en                text NOT NULL,
  name_hi                text NOT NULL,
  type                   landmark_type NOT NULL,
  aka                    text[] NOT NULL DEFAULT '{}',
  lat                    numeric(9,6) NOT NULL,
  lng                    numeric(9,6) NOT NULL,
  primary_locality_id    int REFERENCES localities(id),
  description_en         text,
  description_hi         text,
  is_active              boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_landmarks_city           ON landmarks (city_id);
CREATE INDEX IF NOT EXISTS idx_landmarks_type           ON landmarks (type);
CREATE INDEX IF NOT EXISTS idx_landmarks_active         ON landmarks (is_active);
CREATE INDEX IF NOT EXISTS idx_landmarks_lat_lng        ON landmarks (lat, lng);
CREATE INDEX IF NOT EXISTS idx_landmarks_aka_gin        ON landmarks USING GIN (aka);

-- PostGIS geo column for fast radius queries; mirrors localities pattern.
-- Uses the same availability check as migration 0009.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'geography') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'landmarks' AND column_name = 'geo_point'
    ) THEN
      EXECUTE 'ALTER TABLE landmarks ADD COLUMN geo_point GEOGRAPHY(Point, 4326)';
    END IF;

    UPDATE landmarks
    SET geo_point = ST_SetSRID(ST_MakePoint(lng::float8, lat::float8), 4326)::geography
    WHERE geo_point IS NULL;

    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'idx_landmarks_geo_point'
    ) THEN
      EXECUTE 'CREATE INDEX idx_landmarks_geo_point ON landmarks USING GIST (geo_point)';
    END IF;
  END IF;
END $$;
