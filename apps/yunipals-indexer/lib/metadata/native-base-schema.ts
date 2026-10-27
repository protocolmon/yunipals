export const nativeBaseMetadataMigrations = [
  `CREATE TABLE IF NOT EXISTS metadata_source.native_base_metadata_state (
    release_id text PRIMARY KEY,read_identity text NOT NULL,
    state text NOT NULL CHECK(state IN('ready','blocked')),frontier text,
    implementation text,checked_block bigint,checked_hash text,
    checked_at timestamptz NOT NULL DEFAULT now(),error_code text
  )`,
  `ALTER TABLE metadata.token_publication ADD COLUMN IF NOT EXISTS chain_event_block_hash text`,
  `ALTER TABLE metadata_source.chain_metadata_scan DROP CONSTRAINT IF EXISTS chain_metadata_scan_ingestion_mode_check`,
  `ALTER TABLE metadata_source.chain_metadata_scan ADD CONSTRAINT chain_metadata_scan_ingestion_mode_check
    CHECK(ingestion_mode IN('rpc','unified','native'))`
] as const;
