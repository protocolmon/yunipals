// These tables are owned by the Solana worker, never by Ponder.
export const solanaSchemaStatements = [
  `CREATE SCHEMA IF NOT EXISTS solana_indexer`,
  `CREATE TABLE IF NOT EXISTS solana_indexer.schema_migration (
    version integer PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS solana_indexer.manifest (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    release_id text NOT NULL, checksum text NOT NULL,
    asset_count integer NOT NULL CHECK (asset_count > 0),
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS solana_indexer.manifest_asset (
    mint text PRIMARY KEY, legacy_alias text NOT NULL UNIQUE,
    asset_key text NOT NULL UNIQUE, source_hash text NOT NULL,
    release_id text NOT NULL,
    CHECK (mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
  )`,
  `CREATE TABLE IF NOT EXISTS solana_indexer.asset_metadata (
    mint text PRIMARY KEY REFERENCES solana_indexer.manifest_asset(mint),
    release_id text NOT NULL, source_hash text NOT NULL,
    document jsonb NOT NULL, content_hash text NOT NULL,
    name text, image text, attributes jsonb NOT NULL DEFAULT '[]'::jsonb,
    rarity_points numeric, rarity_points_capped numeric,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS solana_metadata_rarity_idx ON solana_indexer.asset_metadata(rarity_points DESC, mint)`,
  `CREATE TABLE IF NOT EXISTS solana_indexer.scan_run (
    id bigserial PRIMARY KEY, manifest_checksum text NOT NULL,
    state text NOT NULL CHECK (state IN ('running','published','abandoned','failed')),
    next_batch integer NOT NULL DEFAULT 0, asset_count integer NOT NULL,
    batch_size integer NOT NULL CHECK(batch_size BETWEEN 1 AND 1000),
    request_count integer NOT NULL DEFAULT 0, missing_count integer NOT NULL DEFAULT 0,
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz, error_code text
  )`,
  `CREATE TABLE IF NOT EXISTS solana_indexer.scan_stage (
    run_id bigint NOT NULL REFERENCES solana_indexer.scan_run(id) ON DELETE CASCADE,
    mint text NOT NULL REFERENCES solana_indexer.manifest_asset(mint),
    status text NOT NULL CHECK(status IN ('observed','missing')),
    owner text, burnt boolean,
    delegated boolean NOT NULL DEFAULT false, delegate text,
    metadata_uri text, metadata_slot bigint,
    observed_at timestamptz NOT NULL,
    PRIMARY KEY (run_id,mint)
  )`,
  `CREATE TABLE IF NOT EXISTS solana_indexer.token (
    mint text PRIMARY KEY REFERENCES solana_indexer.manifest_asset(mint),
    owner text, burnt boolean NOT NULL,
    delegated boolean NOT NULL DEFAULT false, delegate text,
    metadata_uri text, metadata_slot bigint,
    observed_at timestamptz NOT NULL,
    published_run_id bigint NOT NULL REFERENCES solana_indexer.scan_run(id)
  )`,
  `CREATE INDEX IF NOT EXISTS solana_token_owner_idx ON solana_indexer.token(owner,mint) WHERE NOT burnt`,
  `CREATE INDEX IF NOT EXISTS solana_token_burnt_idx ON solana_indexer.token(burnt,mint)`,
  `CREATE TABLE IF NOT EXISTS solana_indexer.observed_change (
    run_id bigint NOT NULL REFERENCES solana_indexer.scan_run(id),
    mint text NOT NULL REFERENCES solana_indexer.manifest_asset(mint),
    previous_owner text, owner text,
    previous_burnt boolean NOT NULL, burnt boolean NOT NULL,
    observed_at timestamptz NOT NULL,
    PRIMARY KEY(run_id,mint)
  )`,
  `CREATE INDEX IF NOT EXISTS solana_change_mint_idx ON solana_indexer.observed_change(mint,run_id)`,
  `CREATE TABLE IF NOT EXISTS solana_indexer.wallet_stats (
    owner text PRIMARY KEY, monster_count integer NOT NULL,
    total_rarity numeric NOT NULL, unique_types integer NOT NULL,
    special_count integer NOT NULL, glitter_count integer NOT NULL,
    collector_score numeric NOT NULL, updated_at timestamptz NOT NULL,
    published_run_id bigint NOT NULL REFERENCES solana_indexer.scan_run(id)
  )`,
  `CREATE INDEX IF NOT EXISTS solana_wallet_score_idx ON solana_indexer.wallet_stats(collector_score DESC,owner)`,
  `CREATE TABLE IF NOT EXISTS solana_indexer.rpc_usage (
    id bigserial PRIMARY KEY, reserved_at timestamptz NOT NULL DEFAULT now(),
    method text NOT NULL, credits integer NOT NULL CHECK (credits > 0),
    outcome text NOT NULL DEFAULT 'reserved', run_id bigint,
    error_code text
  )`,
  `CREATE INDEX IF NOT EXISTS solana_usage_time_idx ON solana_indexer.rpc_usage(reserved_at)`,
  `CREATE TABLE IF NOT EXISTS solana_indexer.sync_state (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    published_run_id bigint REFERENCES solana_indexer.scan_run(id),
    next_scan_at timestamptz NOT NULL DEFAULT now(),
    last_error text, updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `INSERT INTO solana_indexer.sync_state(singleton) VALUES(true) ON CONFLICT DO NOTHING`
] as const;
