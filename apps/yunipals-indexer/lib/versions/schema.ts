export const monsterVersionMigrations = [
  `CREATE TABLE IF NOT EXISTS metadata.monster_version_release (
    revision text PRIMARY KEY CHECK (revision ~ '^[0-9a-f]{64}$'),
    metadata_release_id text NOT NULL,
    source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
    active boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS monster_version_one_active ON metadata.monster_version_release ((active)) WHERE active`,
  `CREATE TABLE IF NOT EXISTS metadata.monster_version_member (
    revision text NOT NULL REFERENCES metadata.monster_version_release(revision),
    group_id text NOT NULL CHECK (group_id ~ '^[0-9a-f]{64}$'),
    collection text NOT NULL CHECK (collection IN ('ethereum','polygon','bnb','base','solana')),
    contract_address text NOT NULL,
    token_id text NOT NULL,
    lifecycle integer NOT NULL CHECK (lifecycle > 0),
    mint_transaction_hash text,
    mint_log_index integer,
    asset_key text NOT NULL,
    role text NOT NULL CHECK (role IN ('original','airdrop','version')),
    snapshot_date date,
    evidence jsonb NOT NULL,
    PRIMARY KEY(revision,collection,contract_address,token_id,lifecycle)
  )`,
  `CREATE INDEX IF NOT EXISTS monster_version_group ON metadata.monster_version_member(revision,group_id)`,
  `ALTER TABLE metadata.monster_version_member DROP CONSTRAINT IF EXISTS monster_version_member_collection_check,
    ADD CONSTRAINT monster_version_member_collection_check CHECK (collection IN ('ethereum','polygon','bnb','base','solana')),
    DROP CONSTRAINT IF EXISTS monster_version_member_role_check,
    ADD CONSTRAINT monster_version_member_role_check CHECK (role IN ('original','airdrop','version')),
    ALTER COLUMN mint_transaction_hash DROP NOT NULL, ALTER COLUMN mint_log_index DROP NOT NULL`
] as const;
