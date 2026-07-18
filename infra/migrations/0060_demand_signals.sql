-- infra/migrations/0060_demand_signals.sql
-- Captures unmet rental demand expressed on the voice map: the precise spec a
-- seeker asked for that we could not satisfy, plus an optional phone for
-- owner-acquisition follow-up. This is the demand-sensing output of the feature.
-- Additive only. Table and indexes only; no behavioral DDL.

CREATE TABLE IF NOT EXISTS demand_signals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city         text,
  locality     text,
  filters      jsonb NOT NULL DEFAULT '{}'::jsonb,
  unmet        text,                 -- what we couldn't filter, e.g. "parking"
  transcript   text,                 -- raw spoken query (optional)
  phone        text,                 -- optional; only when the seeker subscribed
  source       text NOT NULL DEFAULT 'voice_map',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS demand_signals_city_locality_idx ON demand_signals (city, locality);
CREATE INDEX IF NOT EXISTS demand_signals_created_idx ON demand_signals (created_at DESC);
