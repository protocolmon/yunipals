// Durable off-chain data: deliberately no references to a Ponder/BNB schema.
// Append changes to the shared migration ledger; never reorder this array.
export const archiveMigrations = [
  `CREATE SCHEMA IF NOT EXISTS metadata_source`,
  `CREATE TABLE IF NOT EXISTS metadata_source.archive_release (
    release_id text PRIMARY KEY,
    format_version integer NOT NULL DEFAULT 1 CHECK (format_version=1),
    state text NOT NULL DEFAULT 'candidate' CHECK (state IN ('candidate','validated','active','superseded','invalid')),
    manifest jsonb NOT NULL DEFAULT '{}',
    validation_report jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    validated_at timestamptz,
    activated_at timestamptz
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS archive_one_active_idx
    ON metadata_source.archive_release ((state)) WHERE state='active'`,
  `CREATE TABLE IF NOT EXISTS metadata_source.source_blob (
    content_hash text PRIMARY KEY CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS metadata_source.source_record (
    release_id text NOT NULL REFERENCES metadata_source.archive_release(release_id),
    namespace text NOT NULL,
    source_key text NOT NULL,
    content_hash text NOT NULL REFERENCES metadata_source.source_blob(content_hash),
    asset_key text,
    legacy_id text,
    family text,
    chain_id text,
    origin_type text,
    source_burned boolean,
    issue text,
    imported_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (release_id, namespace, source_key)
  )`,
  `CREATE INDEX IF NOT EXISTS archive_source_asset_idx
    ON metadata_source.source_record(release_id, asset_key) WHERE asset_key IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS archive_source_legacy_idx
    ON metadata_source.source_record(release_id, legacy_id, family) WHERE legacy_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS metadata_source.import_run (
    release_id text NOT NULL REFERENCES metadata_source.archive_release(release_id),
    namespace text NOT NULL,
    cursor jsonb,
    upper_bound jsonb,
    rows_imported bigint NOT NULL DEFAULT 0,
    rolling_hash text NOT NULL DEFAULT '',
    state text NOT NULL DEFAULT 'running' CHECK (state IN ('running','scanned','reconciled','failed')),
    source_descriptor jsonb NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (release_id, namespace)
  )`,
  `CREATE TABLE IF NOT EXISTS metadata_source.render_revision (
    release_id text NOT NULL REFERENCES metadata_source.archive_release(release_id),
    asset_key text NOT NULL,
    variant text NOT NULL CHECK (variant IN ('public','internal')),
    renderer_version text NOT NULL,
    input_hash text NOT NULL,
    content_hash text NOT NULL,
    document jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (release_id, asset_key, variant, input_hash)
  )`,
  `CREATE TABLE IF NOT EXISTS metadata_source.lookup_alias (
    release_id text NOT NULL REFERENCES metadata_source.archive_release(release_id),
    namespace text NOT NULL,
    alias text NOT NULL,
    family text NOT NULL,
    asset_key text NOT NULL,
    PRIMARY KEY (release_id, namespace, alias, family, asset_key)
  )`,
  `CREATE TABLE IF NOT EXISTS metadata_source.asset_origin (
    release_id text NOT NULL REFERENCES metadata_source.archive_release(release_id),
    asset_key text NOT NULL,
    relation text NOT NULL,
    position integer NOT NULL,
    parent_asset_key text NOT NULL,
    original_inputs jsonb,
    PRIMARY KEY (release_id, asset_key, relation, position)
  )`,
  `CREATE TABLE IF NOT EXISTS metadata_source.asset_binding (
    release_id text NOT NULL REFERENCES metadata_source.archive_release(release_id),
    network text NOT NULL,
    chain_id text NOT NULL,
    contract_address text NOT NULL,
    token_id text NOT NULL,
    asset_key text NOT NULL,
    evidence jsonb NOT NULL,
    PRIMARY KEY (release_id, network, chain_id, contract_address, token_id)
  )`,
  `CREATE TABLE IF NOT EXISTS metadata_source.lifecycle_binding (
    release_id text NOT NULL REFERENCES metadata_source.archive_release(release_id),
    chain_id text NOT NULL,
    contract_address text NOT NULL,
    token_id text NOT NULL,
    mint_transaction_hash text NOT NULL,
    mint_log_index integer NOT NULL,
    asset_key text NOT NULL,
    input_hash text,
    PRIMARY KEY (release_id, chain_id, contract_address, token_id, mint_transaction_hash, mint_log_index)
  )`,
  `CREATE TABLE IF NOT EXISTS metadata_source.chain_metadata_scan (
    name text PRIMARY KEY,
    chain_id integer NOT NULL,
    contract_address text NOT NULL,
    deployment_block bigint NOT NULL,
    next_block bigint NOT NULL,
    target_block bigint NOT NULL,
    target_hash text NOT NULL,
    last_scanned_hash text,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS metadata_source.chain_metadata_event (
    chain_id integer NOT NULL,
    contract_address text NOT NULL,
    transaction_hash text NOT NULL,
    log_index integer NOT NULL,
    transaction_index integer NOT NULL,
    block_number bigint NOT NULL,
    block_hash text NOT NULL,
    event_name text NOT NULL CHECK(event_name IN ('Mint','Update')),
    token_id text NOT NULL,
    recipient text NOT NULL,
    traits jsonb NOT NULL,
    PRIMARY KEY(chain_id,contract_address,transaction_hash,log_index)
  )`,
  `CREATE INDEX IF NOT EXISTS chain_metadata_event_token_idx ON metadata_source.chain_metadata_event
    (chain_id,contract_address,token_id,block_number DESC,transaction_index DESC,log_index DESC)`
] as const;
