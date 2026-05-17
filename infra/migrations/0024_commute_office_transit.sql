-- 0024_commute_office_transit.sql
-- "Where Should I Live?" reverse-search v1.
-- Caches Google Distance Matrix transit time from an arbitrary office
-- coordinate to every metro station, so the heatmap math only pays for
-- a given office's data once.

CREATE TABLE IF NOT EXISTS commute_office_transit (
  office_key   TEXT NOT NULL,
  station_id   INT  NOT NULL REFERENCES metro_stations(id) ON DELETE CASCADE,
  duration_s   INT  NOT NULL CHECK (duration_s >= 0),
  distance_m   INT  NOT NULL CHECK (distance_m >= 0),
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (office_key, station_id)
);

CREATE INDEX IF NOT EXISTS idx_commute_office_key
  ON commute_office_transit (office_key);
