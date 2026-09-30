// Append-only: these entries follow the already installed archive migrations.
export const publicationMigrations = [
  `ALTER TABLE metadata_source.render_revision DROP CONSTRAINT IF EXISTS render_revision_variant_check`,
  `ALTER TABLE metadata_source.render_revision ADD CONSTRAINT render_revision_variant_check CHECK(variant IN ('public','internal','legacy-factory'))`,
  `ALTER TABLE metadata_source.render_revision DROP CONSTRAINT IF EXISTS render_revision_pkey`,
  `ALTER TABLE metadata_source.render_revision ADD PRIMARY KEY(release_id,asset_key,variant,renderer_version,input_hash)`,
  `CREATE TABLE IF NOT EXISTS metadata.token_publication (
    collection text NOT NULL,token_id numeric(78,0) NOT NULL,lifecycle integer NOT NULL,
    source_kind text NOT NULL DEFAULT 'archive' CHECK(source_kind='archive'),
    release_id text NOT NULL REFERENCES metadata_source.archive_release(release_id),
    asset_key text,renderer_version text NOT NULL,input_hash text,publication_content_hash text,
    publication_status text NOT NULL CHECK(publication_status IN ('published','unavailable','reconciliation_required')),
    publication_error text,published_at timestamptz NOT NULL DEFAULT now(),
    mint_transaction_hash text NOT NULL,mint_log_index integer NOT NULL,chain_event_key text,
    PRIMARY KEY(collection,token_id,lifecycle)
  )`,
  `CREATE TABLE IF NOT EXISTS metadata.publication_job (
    id bigserial PRIMARY KEY,
    release_id text NOT NULL REFERENCES metadata_source.archive_release(release_id),
    collection text NOT NULL CHECK(collection IN ('ethereum','base','polygon','bnb')),
    token_id numeric(78,0) NOT NULL,
    lifecycle integer NOT NULL,
    mint_transaction_hash text NOT NULL,
    mint_log_index integer NOT NULL,
    request_key text NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','publishing','published','unavailable','reconciliation_required','retry','obsolete')),
    reason text,
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    lease_token uuid,
    lease_until timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(release_id,collection,token_id,mint_transaction_hash,mint_log_index)
  )`,
  `CREATE INDEX IF NOT EXISTS publication_job_claim_idx ON metadata.publication_job(release_id,next_attempt_at,id)
    WHERE status IN ('pending','retry','publishing')`,
  `CREATE TABLE IF NOT EXISTS metadata.publication_cursor (
    release_id text NOT NULL REFERENCES metadata_source.archive_release(release_id),
    collection text NOT NULL,
    token_id text NOT NULL DEFAULT '',
    next_scan_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(release_id,collection)
  )`,
  `CREATE INDEX IF NOT EXISTS publication_status_idx ON metadata.token_publication(release_id,publication_status)`,
  `CREATE INDEX IF NOT EXISTS archive_binding_asset_idx ON metadata_source.asset_binding(release_id,asset_key)`,
  `CREATE TABLE IF NOT EXISTS metadata.publication_runtime (
    singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
    last_worker_at timestamptz,
    base_error text,
    base_checked_at timestamptz
  )`,
  `INSERT INTO metadata.publication_runtime(singleton) VALUES(true) ON CONFLICT DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS metadata.projection_revision (
    collection text NOT NULL,token_id numeric(78,0) NOT NULL,lifecycle integer NOT NULL,metadata_content_hash text NOT NULL,
    PRIMARY KEY(collection,token_id,lifecycle)
  )`,
  `CREATE TABLE IF NOT EXISTS metadata.derived_snapshot (
    name text PRIMARY KEY,metadata_release_id text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS metadata.chain_readiness (
    collection text PRIMARY KEY CHECK(collection IN ('ethereum','base','polygon','bnb')),
    state text NOT NULL CHECK(state IN ('rebuilding','ready','failed')),
    checkpoint_block numeric(78,0),reason text,updated_at timestamptz NOT NULL DEFAULT now(),verified_at timestamptz
  )`,
  // Cover valid-document identity/hash reads without repeatedly decompressing
  // every JSON document for collection-wide metadata counts.
  `CREATE INDEX IF NOT EXISTS token_metadata_valid_publication_idx
    ON metadata.token_metadata(collection,token_id,lifecycle) INCLUDE(content_hash)
    WHERE CASE WHEN jsonb_typeof(document)='object' AND length(document->>'name')>0
      AND length(document->>'id')>0 AND jsonb_typeof(document->'attributes')='array' THEN true ELSE false END`,
  `CREATE STATISTICS IF NOT EXISTS metadata.token_metadata_valid_publication_stats
    ON (CASE WHEN jsonb_typeof(document)='object' AND length(document->>'name')>0
      AND length(document->>'id')>0 AND jsonb_typeof(document->'attributes')='array' THEN true ELSE false END)
    FROM metadata.token_metadata`
] as const;
