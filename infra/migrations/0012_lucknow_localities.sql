-- ─── Migration 0012: Lucknow City + Locality Seed Data ───────────────────────
-- Seeds Lucknow city and 15 key localities with lat/lng + PostGIS geo_point.
-- Safe to re-run: uses ON CONFLICT DO NOTHING / DO UPDATE.

-- Seed Lucknow city
INSERT INTO cities (slug, name_en, name_hi, state_en, state_hi, is_active)
VALUES ('lucknow', 'Lucknow', 'लखनऊ', 'Uttar Pradesh', 'उत्तर प्रदेश', true)
ON CONFLICT (slug) DO NOTHING;

-- Seed Lucknow localities with lat/lng + geo_point
-- geo_point uses PostGIS GEOGRAPHY type (SRID 4326); falls back gracefully if PostGIS unavailable
DO $$
DECLARE
  lucknow_city_id int;
BEGIN
  SELECT id INTO lucknow_city_id FROM cities WHERE slug = 'lucknow';
  IF lucknow_city_id IS NULL THEN
    RAISE EXCEPTION 'Lucknow city not found after insert';
  END IF;

  INSERT INTO localities (city_id, slug, name_en, name_hi, lat, lng)
  VALUES
    (lucknow_city_id, 'gomti-nagar',         'Gomti Nagar',          'गोमती नगर',          26.846700, 80.946200),
    (lucknow_city_id, 'hazratganj',           'Hazratganj',           'हजरतगंज',            26.850500, 80.939100),
    (lucknow_city_id, 'indira-nagar',         'Indira Nagar',         'इंदिरा नगर',         26.876500, 80.994000),
    (lucknow_city_id, 'alambagh',             'Alambagh',             'आलमबाग',             26.799000, 80.905300),
    (lucknow_city_id, 'aliganj',              'Aliganj',              'अलीगंज',             26.887700, 80.962000),
    (lucknow_city_id, 'vikas-nagar',          'Vikas Nagar',          'विकास नगर',          26.876000, 81.026000),
    (lucknow_city_id, 'rajajipuram',          'Rajajipuram',          'राजाजीपुरम',         26.838000, 80.906000),
    (lucknow_city_id, 'chinhat',              'Chinhat',              'चिनहट',              26.878000, 81.052000),
    (lucknow_city_id, 'mahanagar',            'Mahanagar',            'महानगर',             26.871000, 80.974000),
    (lucknow_city_id, 'lucknow-cantt',        'Lucknow Cantt',        'लखनऊ छावनी',         26.832800, 80.911700),
    (lucknow_city_id, 'aminabad',             'Aminabad',             'अमीनाबाद',           26.842200, 80.928500),
    (lucknow_city_id, 'chowk',               'Chowk',                'चौक',               26.853600, 80.913900),
    (lucknow_city_id, 'kapoorthala',          'Kapoorthala',          'कपूरथला',            26.865300, 80.978500),
    (lucknow_city_id, 'nirala-nagar',         'Nirala Nagar',         'निराला नगर',         26.860900, 80.960800),
    (lucknow_city_id, 'sushant-golf-city',    'Sushant Golf City',    'सुशांत गोल्फ सिटी', 26.788900, 81.009700)
  ON CONFLICT (city_id, slug) DO UPDATE SET
    name_en    = EXCLUDED.name_en,
    name_hi    = EXCLUDED.name_hi,
    lat        = EXCLUDED.lat,
    lng        = EXCLUDED.lng,
    updated_at = now();

  -- Backfill geo_point if PostGIS column exists and PostGIS functions are available
  BEGIN
    UPDATE localities
    SET geo_point = ST_SetSRID(ST_MakePoint(lng::float8, lat::float8), 4326)::geography
    WHERE city_id = lucknow_city_id
      AND lat IS NOT NULL
      AND lng IS NOT NULL
      AND geo_point IS NULL;
  EXCEPTION
    WHEN undefined_function OR undefined_column THEN
      -- PostGIS not available or geo_point column not yet added;
      -- geo_point will be backfilled when PostGIS container is active and 0009 re-runs.
      NULL;
  END;
END $$;
