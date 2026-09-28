import { metadataReadRelation } from "../lib/metadata/read-source.js";
import { pool } from "../lib/offchain/db.js";
import {
  calculateRarity,
  rarityFormulaVersion
} from "../lib/rarity/calculate.js";
import { storeRarityCalculations } from "../lib/rarity/store.js";

const batchSize = Math.min(
  1_000,
  Math.max(1, Number(process.env.RARITY_BACKFILL_BATCH ?? 250))
);
const pauseMs = Math.max(0, Number(process.env.RARITY_BACKFILL_PAUSE_MS ?? 25));
const maxRows = Math.max(0, Number(process.env.RARITY_BACKFILL_MAX_ROWS ?? 0));
let cursor = { collection: "", tokenId: "0", lifecycle: -1 };
let processed = 0;
const statuses: Record<string, number> = {};

try {
  while (!maxRows || processed < maxRows) {
    const limit = maxRows ? Math.min(batchSize, maxRows - processed) : batchSize;
    const page = await pool.query<{
      collection: string;
      tokenId: string;
      lifecycle: number;
      contentHash: string | null;
      document: Record<string, unknown>;
    }>(
      `SELECT m.collection, m.token_id::text AS "tokenId", m.lifecycle,
        m.content_hash AS "contentHash", m.document
      FROM ${metadataReadRelation} m
      LEFT JOIN metadata.token_rarity r ON r.collection=m.collection
        AND r.token_id=m.token_id AND r.lifecycle=m.lifecycle
        AND r.formula_version=$1
      WHERE m.document IS NOT NULL
        AND (r.token_id IS NULL OR r.metadata_content_hash IS DISTINCT FROM m.content_hash)
        AND (m.collection, m.token_id, m.lifecycle) > ($2, $3::numeric, $4)
      ORDER BY m.collection, m.token_id, m.lifecycle LIMIT $5`,
      [
        rarityFormulaVersion,
        cursor.collection,
        cursor.tokenId,
        cursor.lifecycle,
        limit
      ]
    );
    if (!page.rowCount) break;
    const calculations = page.rows.map((row) => ({
      collection: row.collection,
      tokenId: row.tokenId,
      lifecycle: row.lifecycle,
      metadataContentHash: row.contentHash,
      ...calculateRarity(row.tokenId, row.document)
    }));
    await storeRarityCalculations(pool, calculations);
    for (const item of calculations) {
      statuses[item.status] = (statuses[item.status] ?? 0) + 1;
    }
    processed += calculations.length;
    const last = page.rows.at(-1)!;
    cursor = {
      collection: last.collection,
      tokenId: last.tokenId,
      lifecycle: last.lifecycle
    };
    if (processed % 10_000 < calculations.length) {
      console.log(JSON.stringify({ status: "running", processed, statuses }));
    }
    if (pauseMs) {
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
  }
  const storedStatusResult = await pool.query<{
    status: string;
    count: number;
  }>(
    `SELECT status, count(*)::int AS count
    FROM metadata.token_rarity
    WHERE formula_version=$1
    GROUP BY status ORDER BY status`,
    [rarityFormulaVersion]
  );
  console.log(
    JSON.stringify({
      status: "complete",
      formulaVersion: rarityFormulaVersion,
      processed,
      statuses,
      storedStatuses: Object.fromEntries(
        storedStatusResult.rows.map((row) => [row.status, row.count])
      )
    })
  );
} finally {
  await pool.end();
}
