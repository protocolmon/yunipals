import { pool } from "./db.js";
import { bnbSchema, sqlIdentifier } from "./schema.js";

const readSchema = sqlIdentifier(process.env.READ_DATABASE_SCHEMA ?? "yunipals_read_v4");
const views = {
  token: `SELECT collection, chain_id, contract_address, token_id, owner, burned, lifecycle,
    mint_block, mint_timestamp, last_transfer_block, last_transfer_timestamp, last_transaction_hash
    FROM ${bnbSchema}.token`,
  token_lifecycle: `SELECT collection, token_id, lifecycle, minted_to, mint_block, mint_timestamp,
    mint_transaction_hash, burned_at_block, burned_at_timestamp, burn_transaction_hash
    FROM ${bnbSchema}.token_lifecycle`,
  transfer_event: `SELECT id, collection, chain_id, contract_address, token_id, lifecycle, "from", "to",
    block_number, block_timestamp, transaction_hash, transaction_index, log_index
    FROM ${bnbSchema}.transfer_event`
};

const db = await pool.connect();
try {
  await db.query("BEGIN");
  await db.query(`CREATE SCHEMA IF NOT EXISTS ${readSchema}`);
  for (const [name, query] of Object.entries(views)) {
    const existing = await db.query<{ relation: string | null }>(
      "SELECT to_regclass($1)::text AS relation",
      [`${readSchema}.${sqlIdentifier(name)}`]
    );
    if (existing.rows[0]?.relation)
      throw new Error(`Refusing to replace existing ${readSchema}.${name}`);
    await db.query(`CREATE VIEW ${readSchema}.${sqlIdentifier(name)} AS ${query}`);
  }
  await db.query("COMMIT");
  console.log("BNB-only read views ready");
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  db.release();
  await pool.end();
}
