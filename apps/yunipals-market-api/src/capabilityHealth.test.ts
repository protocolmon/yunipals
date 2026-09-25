import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createBnbTestDatabase } from "@/bnb/fixtures/database";
import { CapabilityHealthService } from "@/capabilityHealth";
import { writeOpenSeaPublicationHeartbeat } from "@/opensea/publicationHealth";

const db = createBnbTestDatabase();
before(db.initialize);
after(async () => {
  await db.owner.query(
    "DELETE FROM yunipals_market.checkpoint WHERE chain_id IN (1,8453) AND name IN ('opensea-order-worker','opensea-publication-worker')"
  );
  await db.clear();
  await db.close();
});

test("capability health requires every fresh worker checkpoint and fails stale sources independently", async () => {
  await db.clear();
  await db.owner.query(
    `INSERT INTO yunipals_market.checkpoint(source,chain_id,name,state,checked_at)
    VALUES
      ('chain',1,'opensea-order-worker','available',clock_timestamp()),
      ('indexer',1,'opensea-order-worker','available',clock_timestamp()),
      ('chain',8453,'opensea-order-worker','available',clock_timestamp())
    ON CONFLICT(source,chain_id,name) DO UPDATE SET state='available',
      checked_at=clock_timestamp(),last_error_code=NULL`
  );
  await writeOpenSeaPublicationHeartbeat(db.runtime, "ethereum", true);
  const service = new CapabilityHealthService(db.runtime, 0);
  const first = await service.current();
  assert.equal(first.openSeaRead.ethereum, true);
  assert.equal(first.openSeaPublication.ethereum, true);
  assert.equal(
    first.openSeaRead.base,
    false,
    "A chain heartbeat without the indexer heartbeat is incomplete."
  );
  assert.equal(first.openSeaRead.polygon, false);

  await db.owner.query(
    `UPDATE yunipals_market.checkpoint SET checked_at=clock_timestamp()-interval '961 seconds'
    WHERE chain_id=1 AND source='indexer' AND name='opensea-order-worker'`
  );
  const stale = await service.current();
  assert.equal(stale.openSeaRead.ethereum, false);
  assert.equal(stale.openSeaPublication.ethereum, true);
});
