import { physicalPonderSchema } from "../offchain/sql.js";
import { bnbSchema, bnbSchemaStatements, sqlIdentifier } from "./schema.js";

const readSchema = sqlIdentifier(process.env.READ_DATABASE_SCHEMA ?? "yunipals_read_v4");

export const bnbReadSchemaStatements = [
  ...bnbSchemaStatements,
  `CREATE SCHEMA IF NOT EXISTS ${readSchema}`,
  `CREATE OR REPLACE VIEW ${readSchema}.token AS
    SELECT collection, chain_id, contract_address, token_id, owner, burned, lifecycle,
      mint_block, mint_timestamp, last_transfer_block, last_transfer_timestamp, last_transaction_hash
    FROM ${physicalPonderSchema}.token
    WHERE collection IN ('ethereum','base','polygon')
    UNION ALL
    SELECT collection, chain_id, contract_address, token_id, owner, burned, lifecycle,
      mint_block, mint_timestamp, last_transfer_block, last_transfer_timestamp, last_transaction_hash
    FROM ${bnbSchema}.token`,
  `CREATE OR REPLACE VIEW ${readSchema}.token_lifecycle AS
    SELECT collection, token_id, lifecycle, minted_to, mint_block, mint_timestamp,
      mint_transaction_hash, burned_at_block, burned_at_timestamp, burn_transaction_hash
    FROM ${physicalPonderSchema}.token_lifecycle
    WHERE collection IN ('ethereum','base','polygon')
    UNION ALL
    SELECT collection, token_id, lifecycle, minted_to, mint_block, mint_timestamp,
      mint_transaction_hash, burned_at_block, burned_at_timestamp, burn_transaction_hash
    FROM ${bnbSchema}.token_lifecycle`,
  `CREATE OR REPLACE VIEW ${readSchema}.transfer_event AS
    SELECT id, collection, chain_id, contract_address, token_id, lifecycle, "from", "to",
      block_number, block_timestamp, transaction_hash, transaction_index, log_index
    FROM ${physicalPonderSchema}.transfer_event
    WHERE collection IN ('ethereum','base','polygon')
    UNION ALL
    SELECT id, collection, chain_id, contract_address, token_id, lifecycle, "from", "to",
      block_number, block_timestamp, transaction_hash, transaction_index, log_index
    FROM ${bnbSchema}.transfer_event`,
  `CREATE OR REPLACE VIEW ${readSchema}.admin_role_event AS
    SELECT id, collection, chain_id, contract_address, role, account, sender, granted,
      block_number, transaction_hash, log_index
    FROM ${physicalPonderSchema}.admin_role_event
    WHERE collection IN ('ethereum','base','polygon')
    UNION ALL
    SELECT id, collection, chain_id, contract_address, role, account, sender, granted,
      block_number, transaction_hash, log_index
    FROM ${bnbSchema}.admin_role_event`
] as const;
