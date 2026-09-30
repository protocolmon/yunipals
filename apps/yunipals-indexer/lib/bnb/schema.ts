export function sqlIdentifier(value: string) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error(`Invalid SQL identifier: ${value}`);
  return `"${value}"`;
}

export const bnbSchemaName = process.env.BNB_DATABASE_SCHEMA ?? "bnb_indexer";
export const bnbSchema = sqlIdentifier(bnbSchemaName);

export const bnbSchemaStatements = [
  `CREATE SCHEMA IF NOT EXISTS ${bnbSchema}`,
  `CREATE TABLE IF NOT EXISTS ${bnbSchema}.token (
    collection text NOT NULL,
    chain_id integer NOT NULL,
    contract_address text NOT NULL,
    token_id text NOT NULL,
    owner text NOT NULL,
    burned boolean NOT NULL,
    lifecycle integer NOT NULL,
    mint_block bigint NOT NULL,
    mint_timestamp bigint NOT NULL,
    last_transfer_block bigint NOT NULL,
    last_transfer_timestamp bigint NOT NULL,
    last_transaction_hash text NOT NULL,
    PRIMARY KEY (collection, token_id)
  )`,
  `CREATE INDEX IF NOT EXISTS bnb_token_owner_idx ON ${bnbSchema}.token(owner)`,
  `CREATE INDEX IF NOT EXISTS bnb_token_collection_owner_idx ON ${bnbSchema}.token(collection, owner)`,
  `CREATE INDEX IF NOT EXISTS bnb_token_burned_idx ON ${bnbSchema}.token(burned)`,
  `CREATE INDEX IF NOT EXISTS bnb_token_numeric_collection_idx ON ${bnbSchema}.token((token_id::numeric), collection)`,
  `CREATE INDEX IF NOT EXISTS bnb_token_collection_numeric_idx ON ${bnbSchema}.token(collection, (token_id::numeric))`,
  `CREATE TABLE IF NOT EXISTS ${bnbSchema}.token_lifecycle (
    collection text NOT NULL,
    token_id text NOT NULL,
    lifecycle integer NOT NULL,
    minted_to text NOT NULL,
    mint_block bigint NOT NULL,
    mint_timestamp bigint NOT NULL,
    mint_transaction_hash text NOT NULL,
    burned_at_block bigint,
    burned_at_timestamp bigint,
    burn_transaction_hash text,
    PRIMARY KEY (collection, token_id, lifecycle)
  )`,
  `CREATE TABLE IF NOT EXISTS ${bnbSchema}.transfer_event (
    id text PRIMARY KEY,
    collection text NOT NULL,
    chain_id integer NOT NULL,
    contract_address text NOT NULL,
    token_id text NOT NULL,
    lifecycle integer NOT NULL,
    "from" text NOT NULL,
    "to" text NOT NULL,
    block_number bigint NOT NULL,
    block_timestamp bigint NOT NULL,
    transaction_hash text NOT NULL,
    transaction_index integer NOT NULL,
    log_index integer NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS bnb_transfer_event_token_idx ON ${bnbSchema}.transfer_event(collection, token_id)`,
  `CREATE INDEX IF NOT EXISTS bnb_transfer_event_from_idx ON ${bnbSchema}.transfer_event("from")`,
  `CREATE INDEX IF NOT EXISTS bnb_transfer_event_to_idx ON ${bnbSchema}.transfer_event("to")`,
  `CREATE INDEX IF NOT EXISTS bnb_transfer_event_token_order_idx ON ${bnbSchema}.transfer_event(collection, token_id, block_number, transaction_index, log_index)`,
  `CREATE TABLE IF NOT EXISTS ${bnbSchema}.admin_role_event (
    id text PRIMARY KEY,
    collection text NOT NULL,
    chain_id integer NOT NULL,
    contract_address text NOT NULL,
    role text NOT NULL,
    account text NOT NULL,
    sender text NOT NULL,
    granted boolean NOT NULL,
    block_number bigint NOT NULL,
    transaction_hash text NOT NULL,
    log_index integer NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS bnb_admin_role_account_idx ON ${bnbSchema}.admin_role_event(account)`,
  `CREATE INDEX IF NOT EXISTS bnb_admin_role_role_idx ON ${bnbSchema}.admin_role_event(role)`,
  `CREATE TABLE IF NOT EXISTS ${bnbSchema}.sync_state (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    next_block bigint NOT NULL,
    last_scanned_block bigint,
    last_scanned_hash text,
    caught_up_at timestamptz,
    last_error text,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `INSERT INTO ${bnbSchema}.sync_state(singleton, next_block)
    VALUES (true, 7579197) ON CONFLICT (singleton) DO NOTHING`
] as const;
