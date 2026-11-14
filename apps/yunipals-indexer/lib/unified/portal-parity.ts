import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { indexerTransaction } from "../../../../packages/yunipals-indexer-server/src/database.js";
import { PortalLedgerStore } from "../portals/ledger-store.js";
import type { SharedPortalLedger } from "../portals/shared-ledger.js";

const tables = {
  portal_v2_ledger_event: "block_number,transaction_index,log_index",
  portal_v2_token: "token_id",
  portal_v5_request: "request_id",
  portal_v5_mint: 'source COLLATE "C",request_id',
  portal_v5_state:
    'source COLLATE "C",component COLLATE "C",entity_id COLLATE "C"',
  portal_v3_competition_entry: "entry_id",
  portal_v3_competition_batch: "batch_id",
  portal_v3_competition_prize: "batch_id,rank"
} as const;
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stable(item)])
    );
  return value;
}
async function digest(
  db: Pick<Pool, "query">,
  table: keyof typeof tables,
  deployment: string
) {
  const hash = createHash("sha256");
  let rows = 0;
  // SELECT columns directly: pg returns uint256 numerics as strings. A JSON
  // aggregate would round those IDs through JavaScript's number parser.
  await db.query(
    `DECLARE portal_parity NO SCROLL CURSOR FOR SELECT * FROM ${table} WHERE deployment=$1 ORDER BY ${tables[table]}`,
    [deployment]
  );
  try {
    for (;;) {
      const page = (await db.query("FETCH FORWARD 1000 FROM portal_parity"))
        .rows;
      for (const row of page) {
        hash.update(JSON.stringify(stable(row)));
        hash.update("\n");
        rows++;
      }
      if (page.length < 1000) break;
    }
  } finally {
    await db.query("CLOSE portal_parity");
  }
  return { rows, sha256: hash.digest("hex") };
}
export async function comparePortalSources(
  legacyPool: Pool,
  shared: SharedPortalLedger
) {
  return shared.transactionSnapshot(() =>
    indexerTransaction(
      legacyPool,
      async (db) => {
        const legacy = new PortalLedgerStore(db, shared.deployment);
        const before = await legacy.cursor(),
          available = await shared.cursor();
        if (
          !before ||
          (await legacy.requiresReplay()) ||
          BigInt(available.block) < BigInt(before.block) ||
          before.competition !== available.competition
        )
          throw new Error(
            "Portal sources do not have a comparable complete boundary."
          );
        if (
          (
            await shared.chain.client.getBlock({
              blockNumber: BigInt(before.block)
            })
          ).hash !== before.hash
        )
          throw new Error("Legacy portal boundary is not canonical.");
        await shared.db.query(
          "SELECT set_config('yunipals.portal_boundary',$1,true)",
          [before.block]
        );
        const comparisons = [];
        for (const table of Object.keys(tables) as (keyof typeof tables)[]) {
          const old = await digest(db, table, legacy.deployment);
          const next = await digest(shared.db, table, shared.deployment);
          comparisons.push({
            table,
            baseline: old,
            candidate: next,
            matches: old.rows === next.rows && old.sha256 === next.sha256
          });
        }
        if (
          (
            await shared.chain.client.getBlock({
              blockNumber: BigInt(before.block)
            })
          ).hash !== before.hash
        )
          throw new Error("Portal boundary changed during parity checks.");
        return {
          ...shared.sourceIdentity(),
          block: before.block,
          hash: before.hash,
          matches: comparisons.every((row) => row.matches),
          comparisons
        };
      },
      true
    )
  );
}
