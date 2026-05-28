-- ── Listing → Metro Station walking-time cache ───────────────────────────
-- Per-(listing, station) walking distance + duration computed once via the
-- Google Distance Matrix API and cached forever (both endpoints are static).
--
-- Pricing model (see plan): each refresh = N stations × 1 = N elements at
-- $5/1000. With this cache, each (listing, station) pair is paid for exactly
-- once per listing creation; subsequent reads are free DB hits.

CREATE TABLE IF NOT EXISTS listing_metro_walks (
  listing_id  UUID NOT NULL REFERENCES listings(id)        ON DELETE CASCADE,
  station_id  INT  NOT NULL REFERENCES metro_stations(id)  ON DELETE CASCADE,
  distance_m  INT  NOT NULL CHECK (distance_m >= 0),
  duration_s  INT  NOT NULL CHECK (duration_s >= 0),
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (listing_id, station_id)
);

CREATE INDEX IF NOT EXISTS idx_listing_metro_walks_listing
  ON listing_metro_walks (listing_id);
