CREATE SCHEMA IF NOT EXISTS discord_collector;

CREATE TABLE IF NOT EXISTS discord_collector.requests (
  id_hash text PRIMARY KEY,
  wallet text NOT NULL,
  action text NOT NULL,
  expires_at timestamptz NOT NULL,
  code_challenge text,
  oauth_started boolean NOT NULL DEFAULT false
);

ALTER TABLE discord_collector.requests
  DROP CONSTRAINT IF EXISTS requests_action_check,
  ADD CONSTRAINT requests_action_check CHECK (action IN ('link', 'refresh', 'unlink', 'status'));

CREATE INDEX IF NOT EXISTS discord_collector_requests_expiry
  ON discord_collector.requests (expires_at);

CREATE TABLE IF NOT EXISTS discord_collector.links (
  wallet text PRIMARY KEY,
  discord_id text NOT NULL UNIQUE,
  next_refresh_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS discord_collector_next_refresh
  ON discord_collector.links (next_refresh_at, wallet);

CREATE TABLE IF NOT EXISTS discord_collector.status_sessions (
  id_hash text PRIMARY KEY,
  wallet text NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS discord_collector_status_session_expiry
  ON discord_collector.status_sessions (expires_at);
