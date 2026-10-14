import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { Hono } from "hono";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { islandsMigrations } from "../lib/islands/schema.js";
import { baseIslandsMigrations } from "../lib/islands/base-schema.js";
import {
  baseIslandCollection as collection,
  replacementSnapshotSha256,
  replacementDistributionRoot
} from "../lib/islands/collections.js";
import {
  applyBaseRange,
  readBaseCursor,
  baseIslandsReadiness,
  rewindBaseToFinalized,
  type BaseTransfer
} from "../lib/islands/base-sync.js";
import { baseLogsAdaptive, type RawBaseLog } from "../lib/islands/base-rpc.js";
import { loadReplacementSnapshot } from "../lib/islands/replacement.js";
import { loadAirdropSnapshot } from "../lib/islands/airdrop.js";
import {
  dueIslandJobs,
  publishIslandMetadata
} from "../lib/islands/publication.js";
import { registerCombinedIslandsRoutes } from "../lib/api/islands-combined.js";
import { registerIslandsRoutes } from "../lib/api/islands-routes.js";

const db = new PGlite(),
  schema = collection.schemaName;
const query = (sql: string, params?: unknown[]) => db.query(sql, params);
const pool = {
  query,
  connect: async () => ({ query, release: () => undefined })
} as unknown as Pool;
const zero = "0x0000000000000000000000000000000000000000";
const alice = "0x0000000000000000000000000000000000000001";
const bob = "0x0000000000000000000000000000000000000002";
const hash = `0x${"11".repeat(32)}`,
  hash2 = `0x${"22".repeat(32)}`;
const start = BigInt(collection.deploymentBlock);
function event(
  tokenId = "1",
  from = zero,
  to = alice,
  block = start,
  index = 0
): BaseTransfer {
  return {
    id: `base-islands-v2:${hash}:${index}`,
    tokenId,
    from: from as `0x${string}`,
    to: to as `0x${string}`,
    blockNumber: block,
    blockTimestamp: 100n + block - start,
    blockHash: hash,
    transactionHash: hash,
    transactionIndex: 0,
    logIndex: index
  };
}
function app(baseReady = true) {
  const result = new Hono();
  registerCombinedIslandsRoutes(result, {
    pool,
    ethereumSchema: "public",
    baseEnabled: () => true,
    stakingEnabled: () => false,
    ethereumReady: async () => ({ ready: true }),
    baseReady: async () => ({ ready: baseReady })
  });
  registerIslandsRoutes(result, {
    pool,
    schemaName: schema,
    collection,
    enabled: () => true,
    stakingEnabled: () => false,
    airdropEnabled: () => true,
    checkReadiness: async () => ({ ready: baseReady })
  });
  return result;
}
async function original(tokenId = "1") {
  const address = "0xa22e2f53ca787414dc0643c399f92234949e2305";
  await query(
    `INSERT INTO public.token VALUES('ethereum-islands',1,$1,$2,$3,false,1,14570452,1,14570452,1,$4)`,
    [address, tokenId, alice, hash]
  );
  await query(
    `INSERT INTO public.token_lifecycle VALUES('ethereum-islands',$1,1,$2,14570452,1,$3,NULL,NULL,NULL)`,
    [tokenId, alice, hash]
  );
  await query(
    `INSERT INTO public.transfer_event VALUES($1,'ethereum-islands',1,$2,$3,1,$4,$5,14570452,1,$6,0,$7)`,
    [
      `ethereum-islands:${hash}:${tokenId}`,
      address,
      tokenId,
      zero,
      alice,
      hash,
      Number(tokenId)
    ]
  );
}
beforeAll(async () => {
  await db.exec(
    readFileSync(
      new URL("./fixtures/islands-schema.sql", import.meta.url),
      "utf8"
    )
  );
  for (const sql of islandsMigrations) await db.exec(sql);
  for (const sql of baseIslandsMigrations) await db.exec(sql);
  await db.exec(
    `CREATE SCHEMA yunipals_base_islands_v1; CREATE TABLE yunipals_base_islands_v1.transfer_event (LIKE ${schema}.transfer_event INCLUDING ALL);`
  );
}, 30_000);
beforeEach(async () => {
  await db.exec(`TRUNCATE public.token,public.token_lifecycle,public.transfer_event,
    ${schema}.token,${schema}.token_lifecycle,${schema}.transfer_event,${schema}.contract_event,
    metadata.island_publication,metadata_source.island_revision,metadata_source.source_blob,
    metadata.island_airdrop_origin,metadata.island_replacement_origin,yunipals_base_islands_v1.transfer_event CASCADE`);
  await query(
    `UPDATE ${schema}.sync_state SET next_block=$1,last_scanned_block=NULL,last_scanned_hash=NULL,
    finalized_block=NULL,finalized_hash=NULL,verified_block=NULL,verified_hash=NULL,ready=false`,
    [String(start)]
  );
});
afterAll(async () => {
  await db.close();
});

describe("Base Islands indexing, publication and combined browsing", () => {
  it("validates the exact frozen snapshot and rejects budget errors without splitting requests", async () => {
    expect(await loadAirdropSnapshot()).toHaveLength(898);
    expect(await loadReplacementSnapshot()).toHaveLength(898);
    let calls = 0;
    await expect(
      baseLogsAdaptive(
        async () => {
          calls++;
          throw new Error("429 rpc_budget_exhausted");
        },
        1n,
        100000n
      )
    ).rejects.toThrow("budget");
    expect(calls).toBe(1);
    calls = 0;
    const logs = await baseLogsAdaptive(
      async (from, to) => {
        calls++;
        if (to - from > 1n) throw new Error("block range exceeded");
        return [{ blockNumber: `0x${from.toString(16)}` } as RawBaseLog];
      },
      1n,
      4n
    );
    expect(logs).toHaveLength(2);
    expect(calls).toBe(3);
  });
  it("commits transfers and cursor together, and rejects an owner mismatch without advancing", async () => {
    await applyBaseRange(pool, start, { number: start, hash }, [event()], []);
    await expect(
      applyBaseRange(
        pool,
        start + 1n,
        { number: start + 1n, hash: hash2 },
        [event("1", bob, alice, start + 1n, 1)],
        []
      )
    ).rejects.toThrow("owner_mismatch");
    expect((await readBaseCursor(pool)).nextBlock).toBe(String(start + 1n));
    expect((await query(`SELECT owner FROM ${schema}.token`)).rows).toEqual([
      { owner: alice }
    ]);
    await applyBaseRange(
      pool,
      start + 1n,
      { number: start + 1n, hash: hash2 },
      [event("1", alice, bob, start + 1n, 1)],
      []
    );
    expect((await query(`SELECT owner FROM ${schema}.token`)).rows).toEqual([
      { owner: bob }
    ]);
  });
  it("rewinds a changed tail while retaining the original mint and invalidating verification", async () => {
    await applyBaseRange(pool, start, { number: start, hash }, [event()], []);
    await applyBaseRange(
      pool,
      start + 1n,
      { number: start + 1n, hash: hash2 },
      [event("1", alice, bob, start + 1n, 1)],
      []
    );
    await query(
      `UPDATE ${schema}.sync_state SET ready=true,verified_block=$1,verified_hash=$2`,
      [String(start), hash]
    );
    await rewindBaseToFinalized(pool, { number: start, hash });
    expect((await query(`SELECT owner FROM ${schema}.token`)).rows).toEqual([
      { owner: alice }
    ]);
    expect(
      (
        await query(
          `SELECT count(*)::int AS count FROM ${schema}.transfer_event`
        )
      ).rows[0]
    ).toEqual({ count: 1 });
    expect((await readBaseCursor(pool)).ready).toBe(false);
  });
  it("publishes per-token Base metadata against its own canonical mint without colliding with Ethereum", async () => {
    await original();
    await applyBaseRange(pool, start, { number: start, hash }, [event()], []);
    const [job] = await dueIslandJobs(pool, schema, start, 100, collection);
    expect(job?.tokenId).toBe("1");
    await publishIslandMetadata(
      pool,
      schema,
      job!,
      {
        uri: "https://islands-meta.yunipals.com/v2/base-islands/1",
        blockNumber: start,
        blockHash: hash,
        metadataStorage: null,
        genesisLimit: 1000n
      },
      {
        name: "Genesis",
        properties: {
          chain_id: 8453,
          contract: collection.address,
          token_id: "1",
          replacement_snapshot: {
            sha256: replacementSnapshotSha256,
            distribution_root: replacementDistributionRoot
          }
        }
      },
      3600,
      collection
    );
    const response = await app().request(
      "/v2/collections/base-islands-v2/tokens/1"
    );
    expect(response.status).toBe(200);
    expect((await response.json()).token).toMatchObject({
      collectionId: "base-islands-v2",
      chain: "base",
      chainId: 8453,
      origin: "airdrop",
      metadata: { id: "1", name: "Genesis" }
    });
  });
  it("paginates equal token IDs on different chains without losing either and rejects changed filters", async () => {
    await original();
    await applyBaseRange(pool, start, { number: start, hash }, [event()], []);
    const first = await (
      await app().request("/v2/islands/tokens?limit=1")
    ).json();
    expect(first.items[0].collectionId).toBe("base-islands-v2");
    expect(first.total).toBe(2);
    const second = await (
      await app().request(
        `/v2/islands/tokens?limit=1&cursor=${first.nextCursor}`
      )
    ).json();
    expect(second.items[0].collectionId).toBe("ethereum-islands");
    expect(second.nextCursor).toBeNull();
    expect(
      (
        await app().request(
          `/v2/islands/tokens?limit=1&origin=original&cursor=${first.nextCursor}`
        )
      ).status
    ).toBe(409);
  });
  it("keeps counterpart provenance after a transfer while showing the new Base owner", async () => {
    await original();
    await applyBaseRange(pool, start, { number: start, hash }, [event()], []);
    await query(
      `INSERT INTO metadata.island_airdrop_origin VALUES('1','ethereum-islands','base-islands',$1,$1,25694139,$2,$3)`,
      [alice, hash, "1".repeat(64)]
    );
    await query(
      `INSERT INTO yunipals_base_islands_v1.transfer_event SELECT * FROM ${schema}.transfer_event`
    );
    await query(`UPDATE yunipals_base_islands_v1.transfer_event SET "to"=$1`, [
      bob
    ]);
    await query(`UPDATE metadata.island_airdrop_origin SET recipient=$1`, [
      bob
    ]);
    await query(
      `INSERT INTO metadata.island_replacement_origin VALUES('1',$1,$2,52587044,$3,$4,$5)`,
      [
        alice,
        "0x1058f1a6fedcaec94e488d6ec3c639e541faf066",
        hash,
        replacementSnapshotSha256,
        replacementDistributionRoot
      ]
    );
    await applyBaseRange(
      pool,
      start + 1n,
      { number: start + 1n, hash: hash2 },
      [event("1", alice, bob, start + 1n, 1)],
      []
    );
    const token = (
      await (
        await app().request("/v2/collections/base-islands-v2/tokens/1")
      ).json()
    ).token;
    expect(token).toMatchObject({
      owner: bob,
      counterpart: { collectionId: "ethereum-islands", tokenId: "1" },
      airdrop: { recipient: bob },
      replacement: { recipient: alice }
    });
    const holdings = await (
      await app().request(`/v2/islands/tokens?owner=${bob}&holding=wallet`)
    ).json();
    expect(holdings.items).toHaveLength(1);
    expect(holdings.items[0].collectionId).toBe("base-islands-v2");
  });
  it("returns explicit partial results if Base is unavailable and isolates collection detail readiness", async () => {
    await original();
    const result = await (
      await app(false).request("/v2/islands/tokens")
    ).json();
    expect(result.items).toHaveLength(1);
    expect(result.complete).toBe(false);
    expect(result.unavailableCollections).toEqual(["base-islands-v2"]);
    expect(
      (await app(false).request("/v2/collections/base-islands-v2/tokens/1"))
        .status
    ).toBe(503);
  });
});

it("partial range progress cannot refresh readiness after a completed scan becomes stale", async () => {
  await query(`UPDATE ${schema}.sync_state SET ready=true,last_scanned_block=100,verified_block=90,
    completed_at=now()-interval '16 minutes',updated_at=now()`);
  expect((await baseIslandsReadiness(pool)).ready).toBe(false);
  await query(`UPDATE ${schema}.sync_state SET completed_at=now()`);
  expect((await baseIslandsReadiness(pool)).ready).toBe(true);
});
