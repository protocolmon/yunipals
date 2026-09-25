import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { parseActivityPage } from "@protopals/yunipals-market-core/activity";

// Caller verifies the loopback fork and disposable DB before invoking this.
// Require empty activity tables so resetting a fork cursor cannot erase evidence
// belonging to another run. Preserve the pre-existing checkpoint exactly.
export async function createActivityHarness({ pool, rpc, orderHashes, base }) {
  for (const table of ["sale", "sale_receipt", "activity_block"])
    assert.equal(
      (
        await pool.query(
          `SELECT count(*) FROM yunipals_market.${table} WHERE chain_id=56`
        )
      ).rows[0].count,
      "0",
      `Use an isolated empty BNB activity fixture: ${table}`
    );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*) FROM yunipals_market.snapshot WHERE kind='activity' AND header->'chains' ? 'bnb'"
      )
    ).rows[0].count,
    "0",
    "Use an isolated empty BNB activity snapshot fixture"
  );
  const where = "source='chain' AND chain_id=56 AND name='bnb-sales'";
  const prior = (
    await pool.query(
      `SELECT to_jsonb(c) AS value FROM yunipals_market.checkpoint c WHERE ${where}`
    )
  ).rows[0]?.value;
  assert.ok(prior);
  await pool.query(`UPDATE yunipals_market.checkpoint SET block_number=NULL,block_hash=NULL,coverage_start=NULL,coverage_start_time=NULL,
    replay_from=NULL,generation=generation+1,state='syncing',checked_at=NULL,last_error_code=NULL WHERE ${where}`);
  const hashes = new Set();
  async function confirm(hash, expectedKind) {
    hashes.add(hash.toLowerCase());
    await rpc("anvil_mine", ["0x19", "0x0"]);
    const until = Date.now() + 25000;
    let found;
    while (Date.now() < until) {
      const result = await pool.query(
        `SELECT s.observation,r.receipt,r.confirmation_policy FROM yunipals_market.sale s
        JOIN yunipals_market.sale_receipt r USING(chain_id,block_hash,transaction_hash)
        WHERE s.chain_id=56 AND s.order_hash=$1 AND s.canonical`,
        [hash.toLowerCase()]
      );
      if (result.rows.length) {
        found = result.rows[0];
        break;
      }
      await delay(150);
    }
    assert.ok(
      found,
      "Built worker must persist canonical sale and receipt proof"
    );
    assert.equal(found.observation.kind, expectedKind);
    assert.equal(found.receipt.status, "success");
    assert.equal(found.observation.blockHash, found.receipt.blockHash);
    assert.equal(
      found.observation.transactionHash,
      found.receipt.transactionHash
    );
    assert.equal(found.confirmation_policy, "bnb-local-validation-depth-20-v1");
    const scope = {
      kind: "wallet",
      wallet: found.observation.seller,
      chain: "bnb",
      view: "sales"
    };
    let activity;
    const waitUntil = Date.now() + 12000;
    while (Date.now() < waitUntil) {
      const response = await fetch(
        `${base}/v1/market/wallets/${scope.wallet}/activity?chain=bnb&view=sales`
      );
      if (response.ok) {
        activity = parseActivityPage(await response.json(), scope);
        if (
          activity.items.some(
            (item) => item.sale.eventId === found.observation.eventId
          )
        )
          break;
      }
      await delay(250);
    }
    assert.ok(
      activity?.items.some(
        (item) => item.sale.eventId === found.observation.eventId
      ),
      "Actual HTTP wallet activity includes the persisted receipt-backed sale"
    );
    const assetScope = { kind: "asset", asset: found.observation.asset };
    const assetResponse = await fetch(
      `${base}/v1/market/assets/bnb/${assetScope.asset.contractAddress}/${assetScope.asset.tokenId}/activity`
    );
    assert.equal(assetResponse.status, 200);
    parseActivityPage(await assetResponse.json(), assetScope);
    return {
      eventId: found.observation.eventId,
      transactionHash: found.observation.transactionHash,
      blockNumber: found.observation.blockNumber,
      currency: found.observation.currency,
      seller: found.observation.seller,
      nftRecipient: found.observation.nftRecipient
    };
  }
  async function retained() {
    const result = await pool.query(
      "SELECT order_hash,count(*)::integer AS count FROM yunipals_market.sale WHERE chain_id=56 AND canonical GROUP BY order_hash"
    );
    for (const hash of hashes)
      assert.equal(
        result.rows.find((row) => row.order_hash === hash)?.count,
        1
      );
  }
  async function close() {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query(
        "DELETE FROM yunipals_market.sale_receipt r WHERE chain_id=56 AND EXISTS(SELECT 1 FROM yunipals_market.sale s WHERE s.chain_id=r.chain_id AND s.block_hash=r.block_hash AND s.transaction_hash=r.transaction_hash AND s.order_hash=ANY($1::text[]))",
        [
          [
            ...new Set([
              ...hashes,
              ...orderHashes.map((hash) => hash.toLowerCase())
            ])
          ]
        ]
      );
      await db.query(
        "DELETE FROM yunipals_market.sale WHERE chain_id=56 AND order_hash=ANY($1::text[])",
        [
          [
            ...new Set([
              ...hashes,
              ...orderHashes.map((hash) => hash.toLowerCase())
            ])
          ]
        ]
      );
      await db.query(
        "DELETE FROM yunipals_market.snapshot WHERE kind='activity' AND header->'chains' ? 'bnb'"
      );
      await db.query(
        "DELETE FROM yunipals_market.activity_block WHERE chain_id=56"
      );
      await db.query(`DELETE FROM yunipals_market.checkpoint WHERE ${where}`);
      await db.query(
        "INSERT INTO yunipals_market.checkpoint SELECT * FROM jsonb_populate_record(NULL::yunipals_market.checkpoint,$1)",
        [JSON.stringify(prior)]
      );
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  return { confirm, retained, close };
}
