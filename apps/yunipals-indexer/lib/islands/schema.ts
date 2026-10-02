// Append these after existing migrations. Islands publications use immutable
// JSON sources rather than the monster renderer or its active archive release.
export const islandsMigrations = [
  `ALTER TABLE metadata.chain_readiness DROP CONSTRAINT IF EXISTS chain_readiness_collection_check`,
  `ALTER TABLE metadata.chain_readiness ADD CONSTRAINT chain_readiness_collection_check
    CHECK(collection IN ('ethereum','base','polygon','bnb','ethereum-islands'))`,
  `CREATE TABLE IF NOT EXISTS metadata_source.island_revision (
    revision_hash text PRIMARY KEY CHECK(revision_hash ~ '^[0-9a-f]{64}$'),
    collection text NOT NULL CHECK(collection='ethereum-islands'),
    token_id numeric(78,0) NOT NULL,
    lifecycle integer NOT NULL CHECK(lifecycle>0),
    mint_transaction_hash text NOT NULL,
    mint_log_index integer NOT NULL,
    token_uri text NOT NULL,
    source_hash text NOT NULL REFERENCES metadata_source.source_blob(content_hash),
    renderer_version text NOT NULL,
    document_hash text NOT NULL,
    document jsonb NOT NULL,
    uri_block numeric(78,0) NOT NULL,
    uri_block_hash text NOT NULL,
    metadata_storage text NOT NULL,
    genesis_limit numeric(78,0) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS island_revision_token_idx
    ON metadata_source.island_revision(collection,token_id,lifecycle,created_at)`,
  `CREATE TABLE IF NOT EXISTS metadata.island_publication (
    collection text NOT NULL CHECK(collection='ethereum-islands'),
    token_id numeric(78,0) NOT NULL,
    lifecycle integer NOT NULL,
    mint_transaction_hash text NOT NULL,
    mint_log_index integer NOT NULL,
    revision_hash text REFERENCES metadata_source.island_revision(revision_hash),
    status text NOT NULL CHECK(status IN ('published','retry')),
    attempts integer NOT NULL DEFAULT 0,
    last_error text,
    uri_checked_at timestamptz,
    uri_checked_block numeric(78,0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(collection,token_id,lifecycle)
  )`,
  `CREATE INDEX IF NOT EXISTS island_publication_queue_idx
    ON metadata.island_publication(next_attempt_at,token_id)`,
  `CREATE TABLE IF NOT EXISTS metadata.island_verification (
    collection text NOT NULL CHECK(collection='ethereum-islands'),
    schema_name text NOT NULL,
    build_id text NOT NULL,
    checkpoint_block numeric(78,0) NOT NULL,
    block_hash text NOT NULL,
    active_supply integer NOT NULL,
    verified_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(collection,schema_name,build_id)
  )`,
  `INSERT INTO metadata.chain_readiness(collection,state,reason)
    VALUES('ethereum-islands','rebuilding','ownership_verification_pending')
    ON CONFLICT(collection) DO NOTHING`
] as const;
