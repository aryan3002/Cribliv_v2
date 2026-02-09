CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('tenant', 'owner', 'pg_operator', 'admin');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE lang_code AS ENUM ('en', 'hi');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE otp_purpose AS ENUM ('login', 'contact_unlock', 'owner_verify');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE otp_status AS ENUM ('active', 'verified', 'expired', 'blocked');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE listing_type AS ENUM ('flat_house', 'pg');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE listing_status AS ENUM ('draft', 'pending_review', 'active', 'rejected', 'paused', 'archived');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE verification_status AS ENUM ('unverified', 'pending', 'verified', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE furnishing_type AS ENUM ('unfurnished', 'semi_furnished', 'fully_furnished');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE tenant_pref AS ENUM ('any', 'family', 'bachelor', 'female', 'male');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE moderation_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE occupancy_type AS ENUM ('male', 'female', 'co_living');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE pg_onboarding_path AS ENUM ('self_serve', 'sales_assist');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE verification_type AS ENUM ('video_liveness', 'electricity_bill_match');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE verification_result AS ENUM ('pending', 'pass', 'fail', 'manual_review');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE wallet_txn_type AS ENUM ('grant_signup', 'debit_contact_unlock', 'refund_no_response', 'admin_adjustment', 'purchase_pack');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE wallet_ref_type AS ENUM ('user', 'listing', 'contact_unlock', 'payment', 'admin');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE unlock_status AS ENUM ('active', 'refunded', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE owner_response_status AS ENUM ('pending', 'responded', 'timeout_refunded');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE actor_role AS ENUM ('tenant', 'owner', 'pg_operator', 'admin', 'system');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE contact_event_type AS ENUM ('unlock_created', 'owner_responded', 'refund_issued');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE admin_target_type AS ENUM ('listing', 'verification_attempt', 'wallet', 'user');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE admin_action_type AS ENUM ('approve', 'reject', 'pause', 'adjust_wallet', 'manual_review', 'block_user');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE actor_type AS ENUM ('user', 'admin', 'system');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_provider AS ENUM ('razorpay', 'upi');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('created', 'authorized', 'captured', 'failed', 'refunded');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 varchar(15) UNIQUE NOT NULL,
  role user_role NOT NULL DEFAULT 'tenant',
  full_name text,
  preferred_language lang_code NOT NULL DEFAULT 'en',
  whatsapp_opt_in boolean NOT NULL DEFAULT false,
  is_blocked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  refresh_token_hash text NOT NULL,
  device_fingerprint text,
  ip inet,
  user_agent text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 varchar(15) NOT NULL,
  purpose otp_purpose NOT NULL,
  otp_hash text NOT NULL,
  attempt_count int NOT NULL DEFAULT 0,
  resend_count int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  status otp_status NOT NULL DEFAULT 'active',
  ip inet,
  device_fingerprint text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cities (
  id serial PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  name_en text NOT NULL,
  name_hi text NOT NULL,
  state_en text NOT NULL,
  state_hi text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  seo_content jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS localities (
  id serial PRIMARY KEY,
  city_id int NOT NULL REFERENCES cities(id),
  slug text NOT NULL,
  name_en text NOT NULL,
  name_hi text NOT NULL,
  pincode varchar(6),
  lat numeric(9,6),
  lng numeric(9,6),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(city_id, slug)
);

CREATE TABLE IF NOT EXISTS listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  listing_type listing_type NOT NULL,
  title_en text NOT NULL,
  title_hi text,
  description_en text,
  description_hi text,
  status listing_status NOT NULL DEFAULT 'draft',
  verification_status verification_status NOT NULL DEFAULT 'unverified',
  monthly_rent int NOT NULL,
  security_deposit int,
  available_from date,
  furnishing furnishing_type,
  bhk smallint,
  bathrooms smallint,
  area_sqft int,
  preferred_tenant tenant_pref,
  contact_phone_encrypted text,
  whatsapp_available boolean NOT NULL DEFAULT false,
  amenities jsonb NOT NULL DEFAULT '[]'::jsonb,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listing_locations (
  listing_id uuid PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
  city_id int NOT NULL REFERENCES cities(id),
  locality_id int REFERENCES localities(id),
  address_line1 text NOT NULL,
  landmark text,
  pincode varchar(6),
  lat numeric(9,6),
  lng numeric(9,6),
  masked_address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listing_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  blob_path text NOT NULL,
  sort_order smallint NOT NULL DEFAULT 0,
  is_cover boolean NOT NULL DEFAULT false,
  moderation_status moderation_status NOT NULL DEFAULT 'pending',
  client_upload_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(listing_id, client_upload_id)
);

CREATE TABLE IF NOT EXISTS pg_details (
  listing_id uuid PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
  total_beds smallint NOT NULL,
  occupancy_type occupancy_type,
  room_sharing_options jsonb NOT NULL DEFAULT '[]'::jsonb,
  food_included boolean NOT NULL DEFAULT false,
  curfew_time time,
  attached_bathroom boolean NOT NULL DEFAULT false,
  onboarding_path pg_onboarding_path NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verification_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  listing_id uuid REFERENCES listings(id),
  verification_type verification_type NOT NULL,
  vendor_reference text,
  submitted_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  liveness_score numeric(5,2),
  address_match_score numeric(5,2),
  threshold numeric(5,2) NOT NULL DEFAULT 85.00,
  result verification_result NOT NULL DEFAULT 'pending',
  failure_reason text,
  artifact_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallets (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  balance_credits int NOT NULL DEFAULT 0,
  free_credits_granted int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_user_id uuid NOT NULL REFERENCES wallets(user_id),
  txn_type wallet_txn_type NOT NULL,
  credits_delta int NOT NULL,
  cash_amount_paise int,
  currency char(3) NOT NULL DEFAULT 'INR',
  reference_type wallet_ref_type,
  reference_id uuid,
  idempotency_key varchar(80),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(wallet_user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS contact_unlocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_user_id uuid NOT NULL REFERENCES users(id),
  listing_id uuid NOT NULL REFERENCES listings(id),
  wallet_txn_id uuid NOT NULL REFERENCES wallet_transactions(id),
  idempotency_key varchar(80) NOT NULL,
  unlock_status unlock_status NOT NULL DEFAULT 'active',
  owner_response_status owner_response_status NOT NULL DEFAULT 'pending',
  response_deadline_at timestamptz NOT NULL,
  owner_responded_at timestamptz,
  refund_txn_id uuid REFERENCES wallet_transactions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_user_id, listing_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS contact_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_unlock_id uuid NOT NULL REFERENCES contact_unlocks(id),
  actor_role actor_role NOT NULL,
  event_type contact_event_type NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  event_ts timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shortlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_user_id uuid NOT NULL REFERENCES users(id),
  listing_id uuid NOT NULL REFERENCES listings(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_user_id, listing_id)
);

CREATE TABLE IF NOT EXISTS admin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES users(id),
  target_type admin_target_type NOT NULL,
  target_id uuid NOT NULL,
  action admin_action_type NOT NULL,
  reason text,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id),
  actor_type actor_type NOT NULL,
  event_name text NOT NULL,
  entity_type text,
  entity_id uuid,
  request_id uuid,
  ip inet,
  user_agent text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  provider payment_provider NOT NULL,
  provider_order_id text,
  amount_paise int NOT NULL,
  credits_to_grant int NOT NULL,
  status payment_status NOT NULL DEFAULT 'created',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id bigserial PRIMARY KEY,
  provider payment_provider NOT NULL,
  provider_event_id text,
  signature_valid boolean NOT NULL,
  payload jsonb NOT NULL,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_listings_active_type_rent_created
  ON listings (status, listing_type, monthly_rent, created_at DESC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_listing_locations_city_locality
  ON listing_locations (city_id, locality_id);

CREATE INDEX IF NOT EXISTS idx_listings_text_search
  ON listings USING GIN (to_tsvector('simple', coalesce(title_en,'') || ' ' || coalesce(description_en,'')));

CREATE INDEX IF NOT EXISTS idx_listings_title_trgm
  ON listings USING GIN (title_en gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_localities_name_trgm
  ON localities USING GIN (name_en gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_listings_created_at
  ON listings (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_listings_verification_status
  ON listings (verification_status);

CREATE INDEX IF NOT EXISTS idx_contact_unlocks_deadline_pending
  ON contact_unlocks (response_deadline_at)
  WHERE owner_response_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_wallet_txn_user_time
  ON wallet_transactions (wallet_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_otp_phone_created
  ON otp_challenges (phone_e164, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_otp_ip_created
  ON otp_challenges (ip, created_at DESC);
