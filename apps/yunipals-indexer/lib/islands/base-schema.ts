import { baseIslandCollection } from "./collections.js";

const schema = baseIslandCollection.schemaName;
export const baseIslandsMigrations = [
  `CREATE SCHEMA IF NOT EXISTS ${schema}`,
  ...[
    "metadata_source.island_revision",
    "metadata.island_publication",
    "metadata.island_verification"
  ].flatMap((table) => [
    `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table.split(".")[1]}_collection_check`,
    `ALTER TABLE ${table} ADD CONSTRAINT ${table.split(".")[1]}_collection_check
      CHECK(collection IN ('ethereum-islands','base-islands'))`
  ]),
  `ALTER TABLE metadata_source.island_revision ALTER COLUMN metadata_storage DROP NOT NULL`,
  `ALTER TABLE metadata_source.island_revision DROP CONSTRAINT IF EXISTS island_revision_storage_mode_check`,
  `ALTER TABLE metadata_source.island_revision ADD CONSTRAINT island_revision_storage_mode_check
    CHECK((collection='ethereum-islands' AND metadata_storage IS NOT NULL) OR
      (collection='base-islands' AND metadata_storage IS NULL))`,
  `CREATE TABLE IF NOT EXISTS ${schema}.sync_state (
    singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
    next_block bigint NOT NULL,
    last_scanned_block bigint, last_scanned_hash text,
    finalized_block bigint, finalized_hash text,
    verified_block bigint, verified_hash text, verified_at timestamptz,
    rpc_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
    ready boolean NOT NULL DEFAULT false,
    contract_owner text, airdrop_finalized boolean NOT NULL DEFAULT false,
    last_error text, completed_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE ${schema}.sync_state ADD COLUMN IF NOT EXISTS completed_at timestamptz`,
  `UPDATE ${schema}.sync_state SET completed_at=verified_at WHERE completed_at IS NULL AND ready`,
  `INSERT INTO ${schema}.sync_state(singleton,next_block) VALUES(true,${baseIslandCollection.deploymentBlock})
    ON CONFLICT DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS ${schema}.token (
    collection text NOT NULL CHECK(collection='base-islands'), token_id text NOT NULL,
    chain_id integer NOT NULL CHECK(chain_id=8453),
    contract_address text NOT NULL CHECK(contract_address='${baseIslandCollection.address}'),
    owner text NOT NULL, burned boolean NOT NULL, lifecycle integer NOT NULL,
    mint_block bigint NOT NULL, mint_timestamp bigint NOT NULL,
    last_transfer_block bigint NOT NULL, last_transfer_timestamp bigint NOT NULL,
    last_transaction_hash text NOT NULL, PRIMARY KEY(collection,token_id)
  )`,
  `CREATE INDEX IF NOT EXISTS token_owner_idx ON ${schema}.token(owner)`,
  `CREATE INDEX IF NOT EXISTS token_numeric_id_idx ON ${schema}.token((token_id::numeric))`,
  `CREATE TABLE IF NOT EXISTS ${schema}.token_lifecycle (
    collection text NOT NULL, token_id text NOT NULL, lifecycle integer NOT NULL,
    minted_to text NOT NULL, mint_block bigint NOT NULL, mint_timestamp bigint NOT NULL,
    mint_transaction_hash text NOT NULL, burned_at_block bigint, burned_at_timestamp bigint,
    burn_transaction_hash text, PRIMARY KEY(collection,token_id,lifecycle)
  )`,
  `CREATE TABLE IF NOT EXISTS ${schema}.transfer_event (
    id text PRIMARY KEY, collection text NOT NULL, chain_id integer NOT NULL,
    contract_address text NOT NULL, token_id text NOT NULL, lifecycle integer NOT NULL,
    "from" text NOT NULL, "to" text NOT NULL, block_number bigint NOT NULL,
    block_hash text NOT NULL, block_timestamp bigint NOT NULL, transaction_hash text NOT NULL,
    transaction_index integer NOT NULL, log_index integer NOT NULL,
    UNIQUE(transaction_hash,log_index)
  )`,
  `CREATE INDEX IF NOT EXISTS transfer_token_idx ON ${schema}.transfer_event(token_id,block_number,transaction_index,log_index)`,
  `CREATE TABLE IF NOT EXISTS ${schema}.contract_event (
    id text PRIMARY KEY, event_name text NOT NULL, args jsonb NOT NULL,
    block_number bigint NOT NULL, block_hash text NOT NULL, transaction_hash text NOT NULL,
    transaction_index integer NOT NULL, log_index integer NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS metadata.island_airdrop_origin (
    token_id text PRIMARY KEY,
    source_collection text NOT NULL CHECK(source_collection='ethereum-islands'),
    target_collection text NOT NULL CHECK(target_collection='base-islands'),
    source_owner text NOT NULL, recipient text NOT NULL,
    snapshot_block bigint NOT NULL, snapshot_block_hash text NOT NULL,
    snapshot_sha256 text NOT NULL
  )`
] as const;
