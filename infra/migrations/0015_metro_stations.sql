-- 0015_metro_stations.sql
-- Phase 2: Metro stations table for CriblMap metro overlay
-- Uses plain lat/lng FLOAT8 columns (no PostGIS dependency).

CREATE TABLE IF NOT EXISTS metro_stations (
  id           SERIAL PRIMARY KEY,
  city         TEXT NOT NULL DEFAULT 'delhi',
  line_name    TEXT NOT NULL,
  line_color   TEXT NOT NULL,
  station_name TEXT NOT NULL,
  lat          FLOAT8 NOT NULL,
  lng          FLOAT8 NOT NULL,
  sequence     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_metro_stations_city ON metro_stations (city);
CREATE INDEX IF NOT EXISTS idx_metro_stations_line ON metro_stations (line_name);
CREATE INDEX IF NOT EXISTS idx_metro_stations_latLng ON metro_stations (lat, lng);
