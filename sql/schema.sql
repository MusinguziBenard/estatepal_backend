-- EstatePal schema for Supabase (PostgreSQL)
-- Run in Supabase SQL editor or via scripts/migrate.js

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Users (app profile; auth can use phone OTP via our layer or Supabase Auth) ───
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         TEXT NOT NULL UNIQUE,
  name          TEXT,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  identity_verification_status TEXT NOT NULL DEFAULT 'NONE'
    CHECK (identity_verification_status IN ('NONE', 'PENDING', 'VERIFIED', 'REJECTED')),
  accepted_terms_at TIMESTAMPTZ,
  push_tokens   JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_phone ON users (phone);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

-- ─── OTP codes (short-lived) ───
CREATE TABLE IF NOT EXISTS otp_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      TEXT NOT NULL,
  code       TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes (phone, used);

-- ─── Sessions / tokens (simple bearer tokens stored hashed) ───
CREATE TABLE IF NOT EXISTS sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions (token_hash);

-- ─── Listings ───
CREATE TABLE IF NOT EXISTS listings (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  category             TEXT NOT NULL CHECK (category IN ('LAND', 'SUGARCANE_PLANTATION')),
  transaction_type     TEXT NOT NULL CHECK (transaction_type IN ('SALE', 'LEASE')),
  acreage              NUMERIC(12, 2) NOT NULL,
  advertised_value_ugx BIGINT NOT NULL,
  unit_price           BIGINT,
  lease_years          INT,
  district             TEXT NOT NULL,
  subcounty            TEXT NOT NULL,
  custom_location      TEXT,
  gps_lat              DOUBLE PRECISION,
  gps_lng              DOUBLE PRECISION,
  images               JSONB NOT NULL DEFAULT '[]'::jsonb,
  status               TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN (
      'DRAFT','AWAITING_PAYMENT','PROOF_SUBMITTED','UNDER_REVIEW',
      'PUBLISHED','EXPIRED','SOLD','LEASED','REJECTED'
    )),
  ownership            TEXT NOT NULL CHECK (ownership IN ('OWNER', 'BROKER')),
  package              TEXT NOT NULL DEFAULT 'STANDARD' CHECK (package IN ('STANDARD', 'PREMIUM')),
  fee_ugx              INT,
  reference            TEXT UNIQUE,
  contact_name         TEXT,
  contact_phone        TEXT,
  contact_whatsapp     TEXT,
  likes_count          INT NOT NULL DEFAULT 0,
  views_count          INT NOT NULL DEFAULT 0,
  requests_count       INT NOT NULL DEFAULT 0,
  rejection_reason     TEXT,
  published_at         TIMESTAMPTZ,
  expires_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listings_status ON listings (status);
CREATE INDEX IF NOT EXISTS idx_listings_seller ON listings (seller_id);
CREATE INDEX IF NOT EXISTS idx_listings_district ON listings (district);
CREATE INDEX IF NOT EXISTS idx_listings_category ON listings (category);
CREATE INDEX IF NOT EXISTS idx_listings_published ON listings (published_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_listings_search ON listings
  USING gin (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(district,'') || ' ' || coalesce(subcounty,'') || ' ' || coalesce(custom_location,'')));

-- ─── Likes (saved) ───
CREATE TABLE IF NOT EXISTS listing_likes (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);

-- ─── Connections (contact unlock requests) ───
CREATE TABLE IF NOT EXISTS connections (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id       UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  requester_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'AWAITING_PAYMENT'
    CHECK (status IN ('AWAITING_PAYMENT','PROOF_SUBMITTED','UNLOCKED','REJECTED')),
  fee_ugx          INT NOT NULL,
  reference        TEXT NOT NULL UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (listing_id, requester_id)
);

CREATE INDEX IF NOT EXISTS idx_connections_requester ON connections (requester_id);
CREATE INDEX IF NOT EXISTS idx_connections_listing ON connections (listing_id);

-- ─── Payment proofs ───
CREATE TABLE IF NOT EXISTS payment_proofs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_code  TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('LISTING', 'CONNECTION')),
  listing_id      UUID REFERENCES listings(id) ON DELETE SET NULL,
  connection_id   UUID REFERENCES connections(id) ON DELETE SET NULL,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  transaction_id  TEXT NOT NULL,
  payer_phone     TEXT,
  status          TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'VERIFIED', 'REJECTED')),
  reviewed_by     UUID REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proofs_status ON payment_proofs (status);
CREATE INDEX IF NOT EXISTS idx_proofs_ref ON payment_proofs (reference_code);

-- ─── Devices (explicit push token registry) ───
CREATE TABLE IF NOT EXISTS devices (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  push_token  TEXT NOT NULL,
  platform    TEXT NOT NULL DEFAULT 'android',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, push_token)
);

-- ─── Admin audit log ───
CREATE TABLE IF NOT EXISTS admin_actions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID NOT NULL REFERENCES users(id),
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   UUID,
  meta        JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── updated_at trigger ───
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_listings_updated ON listings;
CREATE TRIGGER trg_listings_updated BEFORE UPDATE ON listings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_connections_updated ON connections;
CREATE TRIGGER trg_connections_updated BEFORE UPDATE ON connections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Auth/profile upgrade: email + password + profile picture + ID verification ───
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_photo_url TEXT;          -- private: never returned in public payloads
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_submitted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_rejection_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT true; -- Play policy: user-controllable

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email) WHERE email IS NOT NULL;

-- ─── Email verification codes (self-serve) ───
CREATE TABLE IF NOT EXISTS email_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  code       TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_codes_user ON email_codes (user_id, used);

-- ─── v3: phone verification + ID verification name field (matches frontend contract) ───
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_full_name TEXT; -- name as given on the submitted national ID photo

-- ─── v4: listing detail fields (description, cane age, harvests/cuttings) ───
ALTER TABLE listings ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS cane_age_months INT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS harvests INT;

-- Optional search boost for description
DROP INDEX IF EXISTS idx_listings_search;
CREATE INDEX IF NOT EXISTS idx_listings_search ON listings
  USING gin (to_tsvector('english',
    coalesce(title,'') || ' ' ||
    coalesce(description,'') || ' ' ||
    coalesce(district,'') || ' ' ||
    coalesce(subcounty,'') || ' ' ||
    coalesce(custom_location,'')));
