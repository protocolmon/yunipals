import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { Hono } from "hono";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerIslandsRoutes } from "../lib/api/islands-routes.js";
import {
  collections,
  islandCollection,
  ZERO_ADDRESS
} from "../lib/constants.js";
import { chainReadiness } from "../lib/metadata/chain-readiness.js";
import {
  publishIslandMetadata,
  retryIslandMetadata,
  dueIslandJobs
} from "../lib/islands/publication.js";
import { islandsMigrations } from "../lib/islands/schema.js";
import {
  verifyIslandsOwnership,
  type IslandChainReader
} from "../lib/islands/verify.js";
import { transferEventId } from "../lib/ownership/transfer.js";
import { bnbReadSchemaStatements } from "../lib/bnb/read-schema.js";
import {
  islandStakingAddress,
  syncIslandStaking,
  type StakingChainReader
} from "../lib/islands/staking.js";

const db = new PGlite();
const query = (sql: string, params?: unknown[]) => db.query(sql, params);
const pool = {
  query,
  connect: async () => ({ query, release: () => undefined })
} as unknown as Pool;
const owner = "0x0000000000000000000000000000000000000001";
const recipient = "0x0000000000000000000000000000000000000002";
const hash = `0x${"11".repeat(32)}`;
const block = 26_091_208n;
const checkpoint =
  "1790782295" +
  "1".padStart(16, "0") +
  block.toString().padStart(16, "0") +
  "0".repeat(33);
const job = (tokenId = "1") => ({
  tokenId,
  lifecycle: 1,
  mintTransactionHash: hash,
  mintLogIndex: Number(tokenId),
  attempts: 0
});
const evidence = {
  uri: "https://meta.polychainmonsters.com/v1/island-meta/grassland/10000000",
  blockNumber: block,
  blockHash: hash,
  metadataStorage: owner,
  genesisLimit: 1_000n
};
const raw = { name: "Grassland Genesis Island", image: "ipfs://example" };
const root = "/v2/collections/ethereum-islands";

async function mint(
  tokenId: string,
  collection = islandCollection.slug as string,
  address = islandCollection.address as string
) {
  await query(
    `INSERT INTO public.token VALUES($1,1,$2,$3,$4,false,1,14570452,1,14570452,1,$5)`,
    [collection, address, tokenId, owner, hash]
  );
  await query(
    `INSERT INTO public.token_lifecycle VALUES($1,$2,1,$3,14570452,1,$4,NULL,NULL,NULL)`,
    [collection, tokenId, owner, hash]
  );
  await query(
    `INSERT INTO public.transfer_event VALUES($1,$2,1,$3,$4,1,$5,$6,14570452,1,$7,0,$8)`,
    [
      transferEventId(collection as "ethereum-islands", hash, Number(tokenId)),
      collection,
      address,
      tokenId,
      ZERO_ADDRESS,
      owner,
      hash,
      Number(tokenId)
    ]
  );
}
function app(enabled = true, ready?: boolean, staking = false) {
  const result = new Hono();
  registerIslandsRoutes(result, {
    pool,
    schemaName: "public",
    enabled: () => enabled,
    stakingEnabled: () => staking,
    ...(ready === undefined ? {} : { checkReadiness: async () => ({ ready }) })
  });
  return result;
}
function chain(ids = [1n], owners = [owner]): IslandChainReader {
  return {
    finalizedBlock: async () => ({ number: block, hash }),
    blockHash: async () => hash,
    totalSupply: async () => BigInt(ids.length),
    tokenIds: async (offset, count) => ids.slice(offset, offset + count),
    owners: async (tokenIds) => tokenIds.map((id) => owners[ids.indexOf(id)]!)
  };
}

beforeAll(async () => {
  await db.exec(
    readFileSync(
      new URL("./fixtures/islands-schema.sql", import.meta.url),
      "utf8"
    )
  );
  for (const migration of islandsMigrations) await db.exec(migration);
  await db.exec(
    "CREATE SCHEMA bnb_indexer; CREATE SCHEMA yunipals_read_v4; CREATE TABLE bnb_indexer.token(LIKE public.token)"
  );
  await db.exec(
    bnbReadSchemaStatements.find(
      (sql) =>
        sql.includes("CREATE OR REPLACE VIEW") && sql.includes(".token AS")
    )!
  );
}, 30_000);
beforeEach(async () => {
  await db.exec(`TRUNCATE public.token,public.token_lifecycle,public.transfer_event,metadata.island_publication,
    metadata_source.island_revision,metadata_source.source_blob,metadata.chain_readiness,metadata.island_verification,public._ponder_checkpoint,public._ponder_meta,
    metadata.island_staking_scan,metadata.island_staking_position CASCADE`);
  await query("INSERT INTO public._ponder_checkpoint VALUES(1,$1)", [
    checkpoint
  ]);
  await query(
    'INSERT INTO public._ponder_meta VALUES(\'app\',\'{"is_ready":"1","build_id":"test-build"}\')'
  );
  await query(
    "INSERT INTO metadata.chain_readiness(collection,state,checkpoint_block,verified_at) VALUES('ethereum-islands','ready',$1,now())",
    [block.toString()]
  );
  await query(
    "INSERT INTO metadata.island_verification(collection,schema_name,build_id,checkpoint_block,block_hash,active_supply) VALUES('ethereum-islands','public','test-build',$1,$2,1)",
    [block.toString(), hash]
  );
});
afterAll(async () => {
  await db.close();
});

describe("Islands publication and API with PostgreSQL", () => {
  it("isolates tokens with identical IDs on the same chain, and deduplicates shared raw documents", async () => {
    await mint("1");
    await mint("2");
    await mint("1", "ethereum", collections.ethereum.address);
    await publishIslandMetadata(pool, "public", job("1"), evidence, raw);
    await publishIslandMetadata(pool, "public", job("2"), evidence, raw);
    const response = await app().request(root + "/tokens");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items.map((item: { tokenId: string }) => item.tokenId)).toEqual(
      ["1", "2"]
    );
    expect(body.items[0]).toMatchObject({
      collectionId: "ethereum-islands",
      chain: "ethereum",
      chainId: 1,
      contractAddress: islandCollection.address,
      metadata: { id: "1", attributes: [] },
      rarityPoints: null
    });
    expect(
      (
        await query(
          "SELECT count(*)::int AS count FROM metadata_source.source_blob"
        )
      ).rows[0]
    ).toEqual({ count: 1 });
    expect(
      (
        await query(
          "SELECT count(*)::int AS count FROM metadata_source.island_revision"
        )
      ).rows[0]
    ).toEqual({ count: 2 });
    expect(
      (await query("SELECT collection FROM yunipals_read_v4.token")).rows
    ).toEqual([{ collection: "ethereum" }]);
    expect(await (await app().request(root + "/stats")).json()).toMatchObject({
      activeSupply: 2,
      knownTokens: 2,
      holders: 1,
      metadataAvailable: 2
    });
    expect((await app().request(root)).status).toBe(200);
  });
  it("retains immutable revisions when content changes at the same URI", async () => {
    await mint("1");
    await publishIslandMetadata(pool, "public", job(), evidence, raw);
    await publishIslandMetadata(
      pool,
      "public",
      job(),
      { ...evidence, blockNumber: block + 1n },
      raw
    );
    expect(
      (
        await query(
          "SELECT count(*)::int AS count FROM metadata_source.island_revision"
        )
      ).rows[0]
    ).toEqual({ count: 1 });
    await publishIslandMetadata(
      pool,
      "public",
      job(),
      { ...evidence, blockNumber: block + 2n },
      { ...raw, name: "Updated island" }
    );
    const response = await (await app().request(root + "/tokens/1")).json();
    expect(response.token.metadata.name).toBe("Updated island");
    expect(
      (
        await query(
          "SELECT document->>'name' AS name FROM metadata_source.island_revision ORDER BY created_at"
        )
      ).rows
    ).toEqual([{ name: raw.name }, { name: "Updated island" }]);
  });
  it("hides stale publications after a replay replaces a mint anchor", async () => {
    await mint("1");
    await publishIslandMetadata(pool, "public", job(), evidence, raw);
    await query(
      "UPDATE public.transfer_event SET log_index=11 WHERE token_id='1'"
    );
    const response = await (await app().request(root + "/tokens/1")).json();
    expect(response.token).toMatchObject({
      metadata: null,
      metadataStatus: "pending",
      metadataProvenance: null
    });
    expect(
      await publishIslandMetadata(pool, "public", job(), evidence, raw)
    ).toBe("obsolete");
    expect(await dueIslandJobs(pool, "public", block)).toMatchObject([
      { mintLogIndex: 11 }
    ]);
    await publishIslandMetadata(
      pool,
      "public",
      { ...job(), mintLogIndex: 11 },
      evidence,
      raw
    );
    expect(
      (await (await app().request(root + "/tokens/1")).json()).token.metadata.id
    ).toBe("1");
  });
  it("keeps RPC/HTTP failures retryable and preserves archived metadata", async () => {
    await mint("1");
    await publishIslandMetadata(pool, "public", job(), evidence, raw);
    await retryIslandMetadata(
      pool,
      "public",
      job(),
      block,
      new Error("RPC unavailable")
    );
    expect(
      (await (await app().request(root + "/tokens/1")).json()).token
    ).toMatchObject({ owner, metadata: null, metadataStatus: "retry" });
    expect(await dueIslandJobs(pool, "public", block)).toEqual([]);
    expect(
      (
        await query(
          "SELECT count(*)::int AS count FROM metadata_source.island_revision"
        )
      ).rows[0]
    ).toEqual({ count: 1 });
  });
  it("retries a replaced mint without poisoning its new publication with old audit evidence", async () => {
    await mint("1");
    await publishIslandMetadata(
      pool,
      "public",
      job(),
      { ...evidence, blockNumber: block + 10n },
      raw
    );
    await query(
      "UPDATE public.transfer_event SET log_index=11 WHERE token_id='1'"
    );
    expect(
      await retryIslandMetadata(
        pool,
        "public",
        job(),
        block,
        new Error("obsolete RPC failure")
      )
    ).toBe("obsolete");
    await retryIslandMetadata(
      pool,
      "public",
      { ...job(), mintLogIndex: 11 },
      block,
      new Error("HTTP unavailable")
    );
    expect(
      (await (await app().request(root + "/tokens/1")).json()).token
    ).toMatchObject({ metadataStatus: "retry", metadata: null });
    expect(await dueIslandJobs(pool, "public", block)).toEqual([]);
    await publishIslandMetadata(
      pool,
      "public",
      { ...job(), mintLogIndex: 11 },
      evidence,
      raw
    );
    expect(
      (await (await app().request(root + "/tokens/1")).json()).token.metadata.id
    ).toBe("1");
  });
  it("paginates numerically and rejects cursors from a different owner, sort, or edition", async () => {
    await mint("2");
    await mint("10");
    await mint("1001");
    const api = app();
    const first = await (await api.request(root + "/tokens?limit=1")).json();
    expect(first.items[0].tokenId).toBe("2");
    const second = await (
      await api.request(root + "/tokens?limit=1&cursor=" + first.nextCursor)
    ).json();
    expect(second.items[0].tokenId).toBe("10");
    for (const filter of [
      "sort=token-id-desc",
      "edition=Personal",
      "owner=" + recipient
    ]) {
      expect(
        (
          await api.request(
            root + "/tokens?" + filter + "&cursor=" + first.nextCursor
          )
        ).status
      ).toBe(409);
    }
    expect(
      (await (await api.request(root + "/tokens?edition=Personal")).json())
        .items[0].tokenId
    ).toBe("1001");
    expect((await api.request(root + "/tokens?limit=100000")).status).toBe(400);
    expect((await api.request(root + "/tokens?owner=")).status).toBe(400);
    expect((await api.request(root + "/tokens?cursor=")).status).toBe(409);
  });
  it("excludes burned tokens from holdings while retaining their token and transfer history", async () => {
    await mint("1");
    await publishIslandMetadata(pool, "public", job(), evidence, raw);
    await query(
      `INSERT INTO public.transfer_event VALUES('burn','ethereum-islands',1,$1,'1',1,$2,$3,26091208,2,$4,0,9)`,
      [islandCollection.address, owner, ZERO_ADDRESS, hash]
    );
    await query(
      "UPDATE public.token SET owner=$1,burned=true,last_transfer_block=26091208,last_transfer_timestamp=2 WHERE token_id='1'",
      [ZERO_ADDRESS]
    );
    await query(
      "UPDATE public.token_lifecycle SET burned_at_block=26091208,burned_at_timestamp=2,burn_transaction_hash=$1 WHERE token_id='1'",
      [hash]
    );
    const api = app();
    expect(
      (await (await api.request(root + `/owners/${owner}/tokens`)).json()).items
    ).toEqual([]);
    expect(
      (await (await api.request(root + "/tokens/1")).json()).token
    ).toMatchObject({ owner: null, burned: true, metadata: { id: "1" } });
    const first = await (
      await api.request(root + "/tokens/1/transfers?limit=1")
    ).json();
    expect(first.items[0].from).toBe(ZERO_ADDRESS);
    const second = await (
      await api.request(
        root + "/tokens/1/transfers?limit=1&cursor=" + first.nextCursor
      )
    ).json();
    expect(second.items[0].to).toBe(ZERO_ADDRESS);
    expect(
      (
        await api.request(
          root + "/tokens/2/transfers?cursor=" + first.nextCursor
        )
      ).status
    ).toBe(409);
    expect(
      (await (await api.request(root + "/stats")).json()).activeSupply
    ).toBe(0);
  });
  it("gates reads during replay without adding Islands to legacy readiness checks", async () => {
    expect((await app(false).request(root + "/tokens")).status).toBe(503);
    expect(
      await (await app(false).request(root + "/indexing-status")).json()
    ).toMatchObject({ ready: false, enabled: false });
    await query('UPDATE public._ponder_meta SET value=\'{"is_ready":"0"}\'');
    expect((await app().request(root + "/tokens")).status).toBe(503);
    await query("UPDATE metadata.chain_readiness SET state='rebuilding'");
    for (const collection of Object.keys(collections)) {
      await query(
        "INSERT INTO metadata.chain_readiness(collection,state,checkpoint_block,verified_at) VALUES($1,'ready',1,now())",
        [collection]
      );
    }
    expect((await chainReadiness(pool)).ready).toBe(true);
  });
  it("requires activation for the current physical schema and Ponder build", async () => {
    await mint("1");
    await query(
      "UPDATE metadata.island_verification SET schema_name='another_candidate'"
    );
    expect((await app().request(root + "/tokens")).status).toBe(503);
    await query("UPDATE metadata.island_verification SET schema_name='public'");
    expect((await app().request(root + "/tokens")).status).toBe(200);
    await query(
      'UPDATE public._ponder_meta SET value=\'{"is_ready":"1","build_id":"new-build"}\''
    );
    expect((await app().request(root + "/tokens")).status).toBe(503);
    await publishIslandMetadata(pool, "public", job(), evidence, raw);
    await verifyIslandsOwnership(pool, "public", chain(), true);
    expect((await app().request(root + "/tokens")).status).toBe(200);
  });
});

describe("Islands finalized ownership verification", () => {
  it("checks every owner and activates only after metadata publication", async () => {
    await mint("1");
    expect(await verifyIslandsOwnership(pool, "public", chain())).toMatchObject(
      {
        activeSupply: 1,
        ownersMatched: 1,
        activated: false,
        metadataAvailable: 0
      }
    );
    await expect(
      verifyIslandsOwnership(pool, "public", chain(), true)
    ).rejects.toThrow("publication_pending");
    await publishIslandMetadata(pool, "public", job(), evidence, raw);
    expect(
      await verifyIslandsOwnership(pool, "public", chain(), true)
    ).toMatchObject({ activated: true, metadataAvailable: 1 });
  });
  it("rejects partial enumeration, owner mismatches, and a changed finalized block", async () => {
    await mint("1");
    await query("UPDATE metadata.chain_readiness SET state='rebuilding'");
    await expect(
      verifyIslandsOwnership(pool, "public", chain([1n], [recipient]))
    ).rejects.toThrow("ownership_mismatch");
    await expect(
      verifyIslandsOwnership(pool, "public", {
        ...chain(),
        tokenIds: async () => []
      })
    ).rejects.toThrow("enumeration");
    await expect(
      verifyIslandsOwnership(pool, "public", {
        ...chain(),
        blockHash: async () => "different"
      })
    ).rejects.toThrow("block_changed");
    expect(
      (
        await query(
          "SELECT state FROM metadata.chain_readiness WHERE collection='ethereum-islands'"
        )
      ).rows[0]
    ).toEqual({ state: "rebuilding" });
  });
  it("compares ownership at the pinned block even when the latest indexed transfer is newer", async () => {
    await mint("1");
    await query(
      `INSERT INTO public.transfer_event VALUES('later','ethereum-islands',1,$1,'1',1,$2,$3,26091209,2,$4,0,9)`,
      [islandCollection.address, owner, recipient, hash]
    );
    await query(
      "UPDATE public.token SET owner=$1,last_transfer_block=26091209,last_transfer_timestamp=2 WHERE token_id='1'",
      [recipient]
    );
    expect(await verifyIslandsOwnership(pool, "public", chain())).toMatchObject(
      { ownersMatched: 1 }
    );
    await query("UPDATE public.token SET owner=$1 WHERE token_id='1'", [owner]);
    await expect(
      verifyIslandsOwnership(pool, "public", chain())
    ).rejects.toThrow("current_state_inconsistent");
  });
  it("rejects a corrupt mint lifecycle even when current ownership matches", async () => {
    await mint("1");
    await query(
      "UPDATE public.token SET mint_block=mint_block+1 WHERE token_id='1'"
    );
    await expect(
      verifyIslandsOwnership(pool, "public", chain(), true)
    ).rejects.toThrow("mint_state_inconsistent");
  });
});

async function deposit(tokenId: string, from = owner, sequence = 1) {
  const tx = `0x${String(sequence + 20).repeat(32)}`;
  const eventId = transferEventId(
    "ethereum-islands",
    tx as `0x${string}`,
    Number(tokenId)
  );
  await query(
    `UPDATE public.token SET owner=$2,last_transfer_block=$3,last_transaction_hash=$4 WHERE collection='ethereum-islands' AND token_id=$1`,
    [
      tokenId,
      islandStakingAddress,
      (block - 100n + BigInt(sequence)).toString(),
      tx
    ]
  );
  await query(
    `INSERT INTO public.transfer_event VALUES($1,'ethereum-islands',1,$2,$3,1,$4,$5,$6,2,$7,0,$8)`,
    [
      eventId,
      islandCollection.address,
      tokenId,
      from,
      islandStakingAddress,
      (block - 100n + BigInt(sequence)).toString(),
      tx,
      Number(tokenId)
    ]
  );
  return eventId;
}
function stakingChain(
  ids: string[],
  stakes: Record<string, string[]> = { [owner]: ids }
): StakingChainReader {
  return {
    finalizedBlock: async () => ({ number: block, hash }),
    blockHash: async () => hash,
    islandContract: async () => islandCollection.address,
    custodyBalance: async () => BigInt(ids.length),
    owners: async (batch) => batch.map(() => islandStakingAddress),
    stakedIslands: async (wallet) => (stakes[wallet] ?? []).map(BigInt)
  };
}

describe("Verified legacy Island staking", () => {
  it("combines wallet and verified stakes before pagination without rewriting custody", async () => {
    await mint("1");
    await mint("2");
    await mint("10");
    await deposit("1");
    await deposit("10");
    expect(
      await syncIslandStaking(pool, "public", stakingChain(["1", "10"]))
    ).toMatchObject({ custody: 2, verified: 2 });
    const api = app(true, true, true);
    const first = await (
      await api.request(`${root}/owners/${owner}/tokens?holding=all&limit=2`)
    ).json();
    expect(first).toMatchObject({
      total: 3,
      complete: true,
      stakingStatus: { ready: true }
    });
    expect(first.items.map((x: { tokenId: string }) => x.tokenId)).toEqual([
      "1",
      "2"
    ]);
    expect(first.items[0]).toMatchObject({
      owner: islandStakingAddress,
      staking: { status: "staked", staker: owner }
    });
    const last = await (
      await api.request(
        `${root}/owners/${owner}/tokens?holding=all&limit=2&cursor=${first.nextCursor}`
      )
    ).json();
    expect(last.items.map((x: { tokenId: string }) => x.tokenId)).toEqual([
      "10"
    ]);
    expect(last.nextCursor).toBeNull();
    expect(
      (
        await api.request(
          `${root}/owners/${owner}/tokens?holding=wallet&cursor=${first.nextCursor}`
        )
      ).status
    ).toBe(409);
    const legacy = await (
      await api.request(`${root}/tokens?owner=${owner}`)
    ).json();
    expect(legacy.items.map((x: { tokenId: string }) => x.tokenId)).toEqual([
      "2"
    ]);
    const staked = await (
      await api.request(`${root}/tokens?owner=${owner}&holding=staked`)
    ).json();
    expect(staked.total).toBe(2);
    const detail = await (await api.request(`${root}/tokens/1`)).json();
    expect(detail.token.staking.staker).toBe(owner);
  });

  it("does not attribute a direct custody transfer without staking membership", async () => {
    await mint("1");
    await deposit("1");
    expect(
      await syncIslandStaking(pool, "public", stakingChain(["1"], {}))
    ).toMatchObject({ verified: 0, unverified: 1 });
    const api = app(true, true, true);
    expect(
      (
        await (
          await api.request(`${root}/tokens?owner=${owner}&holding=all`)
        ).json()
      ).items
    ).toEqual([]);
    expect(
      (await (await api.request(`${root}/tokens/1`)).json()).token.staking
        .status
    ).toBe("unverified");
  });

  it("invalidates attribution on restaking, replay, burn, or expired verification", async () => {
    await mint("1");
    await deposit("1");
    await syncIslandStaking(pool, "public", stakingChain(["1"]));
    const api = app(true, true, true);
    await deposit("1", recipient, 2);
    let page = await (
      await api.request(`${root}/tokens?owner=${owner}&holding=all`)
    ).json();
    expect(page.items).toEqual([]);
    expect(page.complete).toBe(false);
    await syncIslandStaking(
      pool,
      "public",
      stakingChain(["1"], { [recipient]: ["1"] })
    );
    expect(
      (
        await (
          await api.request(`${root}/tokens?owner=${recipient}&holding=all`)
        ).json()
      ).total
    ).toBe(1);
    await query(
      "UPDATE metadata.island_staking_scan SET verified_at=now()-interval '16 minutes'"
    );
    page = await (
      await api.request(`${root}/tokens?owner=${recipient}&holding=all`)
    ).json();
    expect(page.items).toEqual([]);
    expect(page.complete).toBe(false);
    await syncIslandStaking(
      pool,
      "public",
      stakingChain(["1"], { [recipient]: ["1"] })
    );
    await query(
      `UPDATE public._ponder_meta SET value='{"is_ready":"1","build_id":"new-build"}' WHERE key='app'`
    );
    expect(
      (
        await (
          await api.request(`${root}/tokens?owner=${recipient}&holding=all`)
        ).json()
      ).complete
    ).toBe(false);
    await query("UPDATE public.token SET burned=true");
    expect(
      (
        await (
          await api.request(`${root}/tokens?owner=${recipient}&holding=all`)
        ).json()
      ).items
    ).toEqual([]);
  });

  it("keeps withdrawn islands visible once custody returns to the wallet", async () => {
    await mint("1");
    await deposit("1");
    await syncIslandStaking(pool, "public", stakingChain(["1"]));
    await query("UPDATE public.token SET owner=$1", [owner]);
    const page = await (
      await app(true, true, true).request(
        `${root}/tokens?owner=${owner}&holding=all`
      )
    ).json();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      owner,
      staking: { status: "none", staker: null }
    });
  });

  it("rejects incomplete RPC, custody mismatches and finalized history changes atomically", async () => {
    await mint("1");
    await deposit("1");
    const reader = stakingChain(["1"]);
    await expect(
      syncIslandStaking(pool, "public", {
        ...reader,
        stakedIslands: async () => {
          throw new Error("rpc unavailable");
        }
      })
    ).rejects.toThrow("rpc unavailable");
    await expect(
      syncIslandStaking(pool, "public", {
        ...reader,
        custodyBalance: async () => 2n
      })
    ).rejects.toThrow("count_mismatch");
    await expect(
      syncIslandStaking(pool, "public", {
        ...reader,
        owners: async () => [owner]
      })
    ).rejects.toThrow("custody_mismatch");
    await expect(
      syncIslandStaking(pool, "public", {
        ...reader,
        blockHash: async () => `0x${"ab".repeat(32)}`
      })
    ).rejects.toThrow("block_changed");
    expect(
      (await query("SELECT * FROM metadata.island_staking_scan")).rows
    ).toEqual([]);
    const api = app(true, true, true);
    expect(
      (
        await (
          await api.request(`${root}/tokens?owner=${owner}&holding=all`)
        ).json()
      ).complete
    ).toBe(false);
  });

  it("reports disabled verification explicitly and validates holding scopes", async () => {
    await mint("1");
    const api = app(true, true);
    const page = await (
      await api.request(`${root}/tokens?owner=${owner}&holding=all`)
    ).json();
    expect(page).toMatchObject({
      total: 1,
      complete: false,
      stakingStatus: { enabled: false }
    });
    for (const search of [
      "holding=staked",
      `owner=${owner}&holding=bad`,
      `owner=${owner}&holding=all&holding=wallet`
    ]) {
      expect((await api.request(`${root}/tokens?${search}`)).status).toBe(400);
    }
  });
});
