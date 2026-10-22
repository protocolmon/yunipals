// Append to the overall operational ledger, after existing archive/publication
// migrations, so installed migration version numbers remain unchanged.
export const unifiedMetadataMigrations = [
  `ALTER TABLE metadata_source.chain_metadata_scan ADD COLUMN IF NOT EXISTS ingestion_mode text NOT NULL DEFAULT 'rpc'
    CHECK (ingestion_mode IN ('rpc','unified'))`,
  `CREATE TABLE IF NOT EXISTS metadata_source.chain_metadata_consumer (
    name text PRIMARY KEY REFERENCES metadata_source.chain_metadata_scan(name),
    release_id text NOT NULL, manifest_hash text NOT NULL,
    cursor jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
  )`
] as const;
