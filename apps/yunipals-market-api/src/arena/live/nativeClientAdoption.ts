import type { Pool } from "pg";
import type { ArenaTransactionAction } from "@protopals/yunipals-market-core/arena";
import { transaction } from "@/db/pool";

/** Separate from chain-origin adoption. Only the immutable legacy cipher
 * context identifies which already-adopted parent owned these old requests. */
export async function adoptLegacyClientTransactions(
  pool: Pool,
  deployment: string
) {
  return transaction(pool, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `arena/project/${deployment}`
    ]);
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `arena/client-tx/${deployment}`
    ]);
    const mode = (
      await db.query<{ halted: boolean; indexer_mode: string }>(
        "SELECT halted,indexer_mode FROM yunipals_arena.deployment WHERE id=$1 FOR UPDATE",
        [deployment]
      )
    ).rows[0];
    if (!mode?.halted || mode.indexer_mode !== "unified")
      throw new Error("Client adoption requires a halted native deployment.");
    const rows = (
      await db.query<{
        hash: string;
        wallet: string;
        action: ArenaTransactionAction;
      }>(
        "SELECT hash,wallet,action FROM yunipals_arena.client_transaction WHERE deployment=$1 AND reader_mode='legacy' ORDER BY created_at LIMIT 1001 FOR UPDATE",
        [deployment]
      )
    ).rows;
    if (rows.length > 1000)
      throw new Error("Client adoption batch exceeds the reviewed limit.");
    let adopted = 0;
    for (const row of rows) {
      let incarnation: string | null = null;
      if (row.action.kind !== "claim") {
        const action = row.action;
        const parent = (
          await db.query<{ incarnation: string }>(
            `SELECT DISTINCT i.incarnation FROM yunipals_arena.tournament_identity i
          JOIN yunipals_arena.admission a USING(deployment,tournament_id,incarnation)
          WHERE i.deployment=$1 AND i.tournament_id=$2 AND i.cipher_context=$3 AND i.bound_at IS NOT NULL
          AND i.incarnation~'^0x[0-9a-f]{64}$' AND a.wallet=$4
          ${action.kind === "entry" ? "AND a.nft_chain_id=$5 AND a.collection=$6 AND a.token_id=$7" : ""} LIMIT 2`,
            [
              deployment,
              action.tournamentId,
              `${deployment}/${action.tournamentId}`,
              row.wallet,
              ...(action.kind === "entry"
                ? [action.nftChainId, action.collection, action.tokenId]
                : [])
            ]
          )
        ).rows;
        if (parent.length !== 1) continue;
        incarnation = parent[0]!.incarnation;
      }
      const action =
        row.action.kind === "claim"
          ? row.action
          : { ...row.action, incarnation };
      await db.query(
        `UPDATE yunipals_arena.client_transaction SET reader_mode='unified',tournament_id=$3,incarnation=$4,action=$5,
        state='submitted',result=NULL,indexed_through_block=NULL,receipt_finalized=false,receipt_block_number=NULL,receipt_block_hash=NULL,
        proof_event_id=NULL,verified_release_id=NULL,next_check_at=now(),tracking_until=now()+interval '2 hours'
        WHERE deployment=$1 AND hash=$2`,
        [
          deployment,
          row.hash,
          row.action.kind === "claim" ? null : row.action.tournamentId,
          incarnation,
          action
        ]
      );
      adopted++;
    }
    return { adopted, unresolved: rows.length - adopted };
  });
}
