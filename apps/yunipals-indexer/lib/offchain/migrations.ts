import { archiveMigrations } from "../metadata/source/schema.js";
import { publicationMigrations } from "../metadata/publication-schema.js";
import { islandsMigrations } from "../islands/schema.js";

export const migrations = [
  `CREATE SCHEMA IF NOT EXISTS metadata`,
  `CREATE TABLE IF NOT EXISTS metadata.schema_migration (
    version integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS metadata.token_metadata (
    token_id numeric(78,0) NOT NULL,
    lifecycle integer NOT NULL,
    token_uri text NOT NULL,
    uri_provenance text NOT NULL,
    uri_verified_at_block bigint,
    audit_status text NOT NULL DEFAULT 'sample_verified',
    name text,
    description text,
    image text,
    animation_url text,
    attributes jsonb,
    document jsonb,
    content_hash text,
    fetch_status text NOT NULL DEFAULT 'pending',
    attempts integer NOT NULL DEFAULT 0,
    last_error text,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    fetched_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (token_id, lifecycle)
  )`,
  `CREATE INDEX IF NOT EXISTS token_metadata_queue_idx ON metadata.token_metadata(fetch_status, next_attempt_at)`,
  `CREATE TABLE IF NOT EXISTS metadata.metadata_revision (
    token_id numeric(78,0) NOT NULL,
    lifecycle integer NOT NULL,
    content_hash text NOT NULL,
    token_uri text NOT NULL,
    document jsonb NOT NULL,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (token_id, lifecycle, content_hash)
  )`,
  `ALTER TABLE metadata.token_metadata ALTER COLUMN audit_status SET DEFAULT 'sample_verified'`,
  `CREATE SCHEMA IF NOT EXISTS leaderboard`,
  `CREATE TABLE IF NOT EXISTS leaderboard.wallet_stats (
    owner text PRIMARY KEY,
    monster_count integer NOT NULL,
    total_rarity numeric NOT NULL,
    unique_types integer NOT NULL,
    special_count integer NOT NULL,
    glitter_count integer NOT NULL,
    collector_score numeric NOT NULL,
    score_version text NOT NULL,
    updated_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS wallet_stats_monster_count_idx ON leaderboard.wallet_stats(monster_count DESC, owner)`,
  `CREATE INDEX IF NOT EXISTS wallet_stats_total_rarity_idx ON leaderboard.wallet_stats(total_rarity DESC, owner)`,
  `CREATE INDEX IF NOT EXISTS wallet_stats_unique_types_idx ON leaderboard.wallet_stats(unique_types DESC, owner)`,
  `CREATE INDEX IF NOT EXISTS wallet_stats_special_count_idx ON leaderboard.wallet_stats(special_count DESC, owner)`,
  `CREATE INDEX IF NOT EXISTS wallet_stats_glitter_count_idx ON leaderboard.wallet_stats(glitter_count DESC, owner)`,
  `CREATE INDEX IF NOT EXISTS wallet_stats_collector_score_idx ON leaderboard.wallet_stats(collector_score DESC, owner)`,
  `CREATE TABLE IF NOT EXISTS metadata.token_search (
    token_id numeric(78,0) NOT NULL,
    lifecycle integer NOT NULL,
    metadata_available boolean NOT NULL,
    rarity_points numeric,
    rarity_points_capped numeric,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (token_id, lifecycle)
  )`,
  `CREATE INDEX IF NOT EXISTS token_search_metadata_idx ON metadata.token_search(metadata_available, token_id)`,
  `CREATE INDEX IF NOT EXISTS token_search_rarity_idx ON metadata.token_search(rarity_points, token_id)`,
  `CREATE TABLE IF NOT EXISTS metadata.token_trait (
    token_id numeric(78,0) NOT NULL,
    lifecycle integer NOT NULL,
    trait_type text NOT NULL,
    value text NOT NULL,
    value_numeric numeric,
    PRIMARY KEY (token_id, lifecycle, trait_type, value)
  )`,
  `CREATE INDEX IF NOT EXISTS token_trait_filter_idx ON metadata.token_trait(trait_type, value, token_id, lifecycle)`,
  `CREATE INDEX IF NOT EXISTS token_trait_numeric_idx ON metadata.token_trait(trait_type, value_numeric) WHERE value_numeric IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS metadata.trait_facet (
    trait_type text PRIMARY KEY,
    kind text NOT NULL,
    min_value numeric,
    max_value numeric,
    values jsonb,
    updated_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS metadata.trait_facet_status (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    available integer NOT NULL,
    missing integer NOT NULL,
    updated_at timestamptz NOT NULL
  )`,
  `ALTER TABLE metadata.token_metadata ADD COLUMN IF NOT EXISTS collection text NOT NULL DEFAULT 'ethereum'`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='metadata.token_metadata'::regclass AND pg_get_constraintdef(oid)='PRIMARY KEY (collection, token_id, lifecycle)') THEN ALTER TABLE metadata.token_metadata DROP CONSTRAINT IF EXISTS token_metadata_pkey; ALTER TABLE metadata.token_metadata ADD PRIMARY KEY (collection, token_id, lifecycle); END IF; END $$`,
  `ALTER TABLE metadata.metadata_revision ADD COLUMN IF NOT EXISTS collection text NOT NULL DEFAULT 'ethereum'`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='metadata.metadata_revision'::regclass AND pg_get_constraintdef(oid)='PRIMARY KEY (collection, token_id, lifecycle, content_hash)') THEN ALTER TABLE metadata.metadata_revision DROP CONSTRAINT IF EXISTS metadata_revision_pkey; ALTER TABLE metadata.metadata_revision ADD PRIMARY KEY (collection, token_id, lifecycle, content_hash); END IF; END $$`,
  `ALTER TABLE metadata.token_search ADD COLUMN IF NOT EXISTS collection text NOT NULL DEFAULT 'ethereum'`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='metadata.token_search'::regclass AND pg_get_constraintdef(oid)='PRIMARY KEY (collection, token_id, lifecycle)') THEN ALTER TABLE metadata.token_search DROP CONSTRAINT IF EXISTS token_search_pkey; ALTER TABLE metadata.token_search ADD PRIMARY KEY (collection, token_id, lifecycle); END IF; END $$`,
  `ALTER TABLE metadata.token_trait ADD COLUMN IF NOT EXISTS collection text NOT NULL DEFAULT 'ethereum'`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='metadata.token_trait'::regclass AND pg_get_constraintdef(oid)='PRIMARY KEY (collection, token_id, lifecycle, trait_type, value)') THEN ALTER TABLE metadata.token_trait DROP CONSTRAINT IF EXISTS token_trait_pkey; ALTER TABLE metadata.token_trait ADD PRIMARY KEY (collection, token_id, lifecycle, trait_type, value); END IF; END $$`,
  `CREATE INDEX IF NOT EXISTS token_metadata_collection_queue_idx ON metadata.token_metadata(collection, fetch_status, next_attempt_at)`,
  `CREATE INDEX IF NOT EXISTS token_search_collection_metadata_idx ON metadata.token_search(collection, metadata_available, token_id)`,
  `CREATE INDEX IF NOT EXISTS token_search_collection_rarity_idx ON metadata.token_search(collection, rarity_points, token_id)`,
  `CREATE INDEX IF NOT EXISTS token_trait_collection_filter_idx ON metadata.token_trait(collection, trait_type, value, token_id, lifecycle)`,
  `ALTER TABLE metadata.trait_facet ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'all'`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='metadata.trait_facet'::regclass AND pg_get_constraintdef(oid)='PRIMARY KEY (scope, trait_type)') THEN ALTER TABLE metadata.trait_facet DROP CONSTRAINT IF EXISTS trait_facet_pkey; ALTER TABLE metadata.trait_facet ADD PRIMARY KEY (scope, trait_type); END IF; END $$`,
  `ALTER TABLE metadata.trait_facet_status ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'all'`,
  `ALTER TABLE metadata.trait_facet_status DROP CONSTRAINT IF EXISTS trait_facet_status_singleton_check`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='metadata.trait_facet_status'::regclass AND pg_get_constraintdef(oid)='PRIMARY KEY (scope)') THEN ALTER TABLE metadata.trait_facet_status DROP CONSTRAINT IF EXISTS trait_facet_status_pkey; ALTER TABLE metadata.trait_facet_status ADD PRIMARY KEY (scope); END IF; END $$`,
  `ALTER TABLE leaderboard.wallet_stats ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'all'`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='leaderboard.wallet_stats'::regclass AND pg_get_constraintdef(oid)='PRIMARY KEY (scope, owner)') THEN ALTER TABLE leaderboard.wallet_stats DROP CONSTRAINT IF EXISTS wallet_stats_pkey; ALTER TABLE leaderboard.wallet_stats ADD PRIMARY KEY (scope, owner); END IF; END $$`,
  `CREATE INDEX IF NOT EXISTS wallet_stats_scope_monster_idx ON leaderboard.wallet_stats(scope, monster_count DESC, owner)`,
  `CREATE INDEX IF NOT EXISTS wallet_stats_scope_rarity_idx ON leaderboard.wallet_stats(scope, total_rarity DESC, owner)`,
  `CREATE INDEX IF NOT EXISTS wallet_stats_scope_score_idx ON leaderboard.wallet_stats(scope, collector_score DESC, owner)`,
  `CREATE TABLE IF NOT EXISTS metadata.chain_event_cursor (
    name text PRIMARY KEY,
    block_number bigint NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS metadata.ens_identity (
    chain_id integer NOT NULL,
    address text NOT NULL,
    name text,
    verified boolean NOT NULL DEFAULT false,
    resolved_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    last_error text,
    retry_after timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, address)
  )`,
  `CREATE INDEX IF NOT EXISTS ens_identity_refresh_idx ON metadata.ens_identity(expires_at, retry_after)`,
  `CREATE TABLE IF NOT EXISTS metadata.token_visibility (
    collection text NOT NULL,
    token_id numeric(78,0) NOT NULL,
    owner text NOT NULL,
    lifecycle integer NOT NULL,
    anchor_event_id text NOT NULL,
    anchor_block bigint NOT NULL,
    anchor_transaction_index integer NOT NULL,
    anchor_log_index integer NOT NULL,
    hidden_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (collection, token_id)
  )`,
  `CREATE INDEX IF NOT EXISTS token_visibility_owner_idx ON metadata.token_visibility(owner, collection, token_id)`,
  `CREATE TABLE IF NOT EXISTS metadata.wallet_visibility_nonce (
    owner text PRIMARY KEY,
    next_nonce numeric(78,0) NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE metadata.token_metadata ADD COLUMN IF NOT EXISTS uri_checked_at timestamptz`,
  `CREATE INDEX IF NOT EXISTS token_metadata_polygon_uri_audit_idx
    ON metadata.token_metadata(uri_checked_at) WHERE collection='polygon'`,
  `CREATE INDEX IF NOT EXISTS token_metadata_bnb_uri_audit_idx
    ON metadata.token_metadata(uri_checked_at) WHERE collection='bnb'`,
  `ALTER TABLE metadata.token_search ADD COLUMN IF NOT EXISTS rarity_points_capped numeric`,
  `CREATE INDEX IF NOT EXISTS token_search_capped_rarity_idx ON metadata.token_search(rarity_points_capped, token_id)`,
  `CREATE INDEX IF NOT EXISTS token_search_collection_capped_rarity_idx ON metadata.token_search(collection, rarity_points_capped, token_id)`,
  `CREATE TABLE IF NOT EXISTS metadata.token_rarity (
    collection text NOT NULL,
    token_id numeric(78,0) NOT NULL,
    lifecycle integer NOT NULL,
    formula_version text NOT NULL,
    metadata_content_hash text,
    input_fingerprint text NOT NULL,
    status text NOT NULL CHECK (status IN ('valid','unscored','missing_input','invalid')),
    rarity_points numeric,
    rarity_points_capped numeric,
    error_code text,
    calculated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (collection, token_id, lifecycle, formula_version),
    CHECK (
      (status='valid' AND rarity_points IS NOT NULL AND rarity_points_capped IS NOT NULL AND error_code IS NULL)
      OR (status<>'valid' AND rarity_points IS NULL AND rarity_points_capped IS NULL)
    )
  )`,
  `CREATE INDEX IF NOT EXISTS token_rarity_formula_status_idx
    ON metadata.token_rarity(formula_version, status, collection, token_id)`,
  `CREATE INDEX IF NOT EXISTS token_rarity_content_idx
    ON metadata.token_rarity(formula_version, metadata_content_hash)`,
  ...archiveMigrations,
  ...publicationMigrations,
  ...islandsMigrations
] as const;
