import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_SCHEMA: "native_islands_source",
    OWNERSHIP_READ_MODE: "unified",
    OWNERSHIP_READ_SCHEMA: "native_islands_read",
    READ_DATABASE_SCHEMA: "native_islands_read",
    OWNERSHIP_RELEASE_ID: `0x${"11".repeat(32)}`,
    YUNIPALS_PROJECTION_MODE: "generation",
    API_ISLANDS_ENABLED: "true",
    API_BASE_ISLANDS_ENABLED: "true",
    API_ISLAND_STAKING_ENABLED: "false"
  });
});
import { createIslandsApp } from "../lib/api/islands-app.js";
import { requestSnapshotPool } from "../lib/ownership/request-snapshot.js";
import { islandStakingAddress } from "../lib/islands/staking-read.js";
import {
  verifyNativeIslandStaking,
  type NativeStakingChainReader
} from "../lib/islands/staking-verifier.js";
import {
  baseIslandCollection,
  ethereumIslandCollection,
  legacyBaseIslandCollection
} from "../lib/islands/collections.js";

const db = new PGlite();
const query = (sql: string, params?: unknown[]) =>
  db.query<Record<string, unknown>>(sql, params);
const pool = requestSnapshotPool({
  query,
  connect: async () => ({ query, release() {} })
} as unknown as Pool);
const release = `0x${"11".repeat(32)}`;
const hash = `0x${"22".repeat(32)}`;
const alice = `0x${"12".repeat(20)}`;
const bob = `0x${"34".repeat(20)}`;
const app = createIslandsApp(pool);
const finalized = 14_570_600n;
async function custodyFixture() {
  process.env.API_ISLAND_STAKING_ENABLED = "true";
  await mint("ethereum-islands");
  await query(
    "UPDATE native_islands_read.token SET owner=$1,last_transfer_block=$2 WHERE collection='ethereum-islands'",
    [islandStakingAddress, String(finalized - 1n)]
  );
  await query(
    `INSERT INTO native_islands_read.transfer_event SELECT 'deposit',collection,chain_id,contract_address,token_id,lifecycle,$1,$2,$3,2,transaction_hash,0,1
    FROM native_islands_read.transfer_event WHERE collection='ethereum-islands'`,
    [alice, islandStakingAddress, String(finalized - 1n)]
  );
  await query(
    "UPDATE native_islands_read.fixture_status SET status=jsonb_set(status,'{block_number}',$1::jsonb) WHERE collection='ethereum-islands'",
    [JSON.stringify(String(finalized + 10n))]
  );
  await query("INSERT INTO native_islands_source.chain_block VALUES(1,$1,$2)", [
    String(finalized),
    hash
  ]);
}
const chain = (
  overrides: Partial<NativeStakingChainReader> = {}
): NativeStakingChainReader => ({
  contractAddress: islandStakingAddress,
  finalizedBlock: async () => ({ number: finalized, hash }),
  blockHash: async () => hash,
  islandContract: async () => ethereumIslandCollection.address,
  custodyBalance: async () => 1n,
  owners: async () => [islandStakingAddress],
  stakedIslands: async () => [1n],
  ...overrides
});
const limits = { maxTokens: 10, maxReadCalls: 20 };
const root = (id = "base-islands-v2") => `/v2/collections/${id}`;
const body = async (path: string) => {
  const response = await app.request(path);
  return {
    status: response.status,
    value: await response.json(),
    release: response.headers.get("X-Indexer-Release")
  };
};
async function status(id: string, available: boolean) {
  const definition =
    id === "base-islands-v2" ? baseIslandCollection : ethereumIslandCollection;
  await query(
    `INSERT INTO native_islands_read.fixture_status VALUES($1,$2)
    ON CONFLICT(collection) DO UPDATE SET status=EXCLUDED.status`,
    [
      id,
      {
        collection: id,
        available,
        ready: available,
        reason: available ? "ready" : "halted",
        release_id: release,
        manifest_hash: hash,
        chain_id: definition.chainId,
        contract_address: definition.address,
        policy: "latest",
        block_number: "100",
        block_hash: hash
      }
    ]
  );
}
async function mint(id = "base-islands-v2", token = "1") {
  const definition =
    id === "base-islands-v2" ? baseIslandCollection : ethereumIslandCollection;
  await query(
    `INSERT INTO native_islands_read.token VALUES($1,$2,$3,$4,$5,false,1,10,1,10,1,$6)`,
    [id, definition.chainId, definition.address, token, alice, hash]
  );
  await query(
    `INSERT INTO native_islands_read.token_lifecycle VALUES($1,$2,1,$3,10,1,$4,NULL,NULL,NULL)`,
    [id, token, alice, hash]
  );
  await query(
    `INSERT INTO native_islands_read.transfer_event VALUES($1,$2,$3,$4,$5,1,$6,$7,10,1,$8,0,0)`,
    [
      `${id}:${token}:mint`,
      id,
      definition.chainId,
      definition.address,
      token,
      `0x${"00".repeat(20)}`,
      alice,
      hash
    ]
  );
}
beforeAll(async () => {
  await db.exec(`CREATE SCHEMA native_islands_source; CREATE SCHEMA native_islands_read;
    CREATE SCHEMA metadata; CREATE SCHEMA metadata_source; CREATE SCHEMA yunipals_indexer_control;
    CREATE SCHEMA yunipals_base_islands_v1;
    CREATE TABLE yunipals_indexer_control.release(id text PRIMARY KEY,physical_schema text,build_id text);
    CREATE TABLE native_islands_read._unified_read_release(singleton boolean,identity text,release_id text,manifest_hash text);
    CREATE TABLE native_islands_read.fixture_status(collection text PRIMARY KEY,status jsonb);
    CREATE FUNCTION native_islands_read.source_probe(selected text) RETURNS jsonb LANGUAGE sql STABLE AS
      $$ SELECT status FROM native_islands_read.fixture_status WHERE collection=selected $$;
    CREATE FUNCTION native_islands_read.source_boundary(selected text)
      RETURNS TABLE(chain_id integer,block_number bigint,block_hash text) LANGUAGE plpgsql STABLE AS $$
      DECLARE value jsonb; BEGIN
      SELECT status INTO value FROM native_islands_read.fixture_status WHERE collection=selected;
      IF value->>'available' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'unavailable'; END IF;
      RETURN QUERY SELECT (value->>'chain_id')::integer,(value->>'block_number')::bigint,value->>'block_hash'; END $$;
    CREATE TABLE native_islands_source.chain_block(chain_id integer,block_number bigint,block_hash text);
    CREATE TABLE native_islands_read.token(collection text,chain_id integer,contract_address text,token_id text,owner text,burned boolean,lifecycle integer,
      mint_block bigint,mint_timestamp bigint,last_transfer_block bigint,last_transfer_timestamp bigint,last_transaction_hash text,PRIMARY KEY(collection,token_id));
    CREATE TABLE native_islands_read.token_lifecycle(collection text,token_id text,lifecycle integer,minted_to text,mint_block bigint,mint_timestamp bigint,mint_transaction_hash text,
      burned_at_block bigint,burned_at_timestamp bigint,burn_transaction_hash text);
    CREATE TABLE native_islands_read.transfer_event(id text,collection text,chain_id integer,contract_address text,token_id text,lifecycle integer,"from" text,"to" text,
      block_number bigint,block_timestamp bigint,transaction_hash text,transaction_index integer,log_index integer);
    CREATE TABLE yunipals_base_islands_v1.transfer_event(LIKE native_islands_read.transfer_event);
    CREATE TABLE metadata.island_publication(collection text,token_id numeric,lifecycle integer,mint_transaction_hash text,mint_log_index integer,revision_hash text,status text,uri_checked_at timestamptz,uri_checked_block bigint);
    CREATE TABLE metadata_source.island_revision(revision_hash text,collection text,token_id numeric,lifecycle integer,mint_transaction_hash text,mint_log_index integer,document jsonb,
      token_uri text,source_hash text,document_hash text,renderer_version text,uri_block bigint,uri_block_hash text,metadata_storage text);
    CREATE TABLE metadata.island_airdrop_origin(token_id text,recipient text,snapshot_block bigint,snapshot_block_hash text,snapshot_sha256 text,source_owner text);
    CREATE TABLE metadata.island_replacement_origin(token_id text,recipient text,source_contract text,snapshot_block bigint,snapshot_block_hash text,snapshot_sha256 text,distribution_root text);
    CREATE TABLE metadata.chain_readiness(collection text,state text,checkpoint_block bigint,reason text,updated_at timestamptz,verified_at timestamptz);
    CREATE TABLE metadata.island_verification(collection text,schema_name text,build_id text,checkpoint_block bigint);
    CREATE TABLE metadata.island_staking_scan(schema_name text PRIMARY KEY,build_id text,state text,block_number bigint,block_hash text,verified_at timestamptz DEFAULT now(),ownership_release_id text,ownership_read_identity text);
    CREATE TABLE metadata.island_staking_position(schema_name text,build_id text,token_id text,lifecycle integer,deposit_event_id text,staker text);`);
}, 30000);
beforeEach(async () => {
  process.env.API_ISLAND_STAKING_ENABLED = "false";
  await db.exec(`TRUNCATE native_islands_read.token,native_islands_read.token_lifecycle,native_islands_read.transfer_event,native_islands_read.fixture_status,
    native_islands_read._unified_read_release,native_islands_source.chain_block,yunipals_indexer_control.release,
    metadata.island_publication,metadata_source.island_revision,metadata.island_airdrop_origin,metadata.island_replacement_origin,
    metadata.island_staking_scan,metadata.island_staking_position,metadata.island_verification,metadata.chain_readiness,yunipals_base_islands_v1.transfer_event;`);
  await query(
    "INSERT INTO yunipals_indexer_control.release VALUES($1,'native_islands_source','native-build')",
    [release]
  );
  await query(
    "INSERT INTO native_islands_read._unified_read_release VALUES(true,$1,$2,$1)",
    [hash, release]
  );
  await query(
    "INSERT INTO native_islands_source.chain_block VALUES(1,100,$1)",
    [hash]
  );
  await query(
    "INSERT INTO metadata.chain_readiness VALUES('ethereum-islands','ready',100,NULL,now(),now())"
  );
  await query(
    "INSERT INTO metadata.island_verification VALUES('ethereum-islands','native_islands_source','native-build',90)"
  );
  await status("ethereum-islands", true);
  await status("base-islands-v2", true);
});
afterAll(async () => {
  await db.close();
});

describe("native Islands API preserves deployed routes with release-bound ownership", () => {
  it("mounts Base, combined, staking, documentation and superseded routes", async () => {
    for (const path of [
      root() + "/openapi.json",
      root("ethereum-islands") + "/openapi.json",
      "/v2/islands/openapi.json",
      "/v2/islands/indexing-status",
      root() + "/indexing-status",
      root("ethereum-islands") + "/staking-status"
    ])
      expect((await app.request(path)).status).toBe(200);
    const superseded = await body("/v2/collections/base-islands/tokens");
    expect(superseded.status).toBe(410);
    expect(superseded.value.successor.contractAddress).toBe(
      baseIslandCollection.address
    );
  });
  it("isolates identical token IDs by chain, contract and collection in list/detail/stats/transfers", async () => {
    await mint();
    await mint("ethereum-islands");
    await query(
      "INSERT INTO native_islands_read.token SELECT collection,chain_id,'0x0000000000000000000000000000000000000001','99',owner,burned,lifecycle,mint_block,mint_timestamp,last_transfer_block,last_transfer_timestamp,last_transaction_hash FROM native_islands_read.token WHERE collection='base-islands-v2'"
    );
    const base = await body(root() + "/tokens");
    expect(base.status).toBe(200);
    expect(base.release).toBe(release);
    expect(base.value.total).toBe(1);
    expect(base.value.items[0]).toMatchObject({
      collectionId: "base-islands-v2",
      chain: "base",
      contractAddress: baseIslandCollection.address,
      origin: "airdrop",
      tokenId: "1"
    });
    expect((await body(root() + "/tokens/1")).value.token.collectionId).toBe(
      "base-islands-v2"
    );
    expect((await body(root() + "/stats")).value.knownTokens).toBe(1);
    expect(
      (await body(root() + "/tokens/1/transfers")).value.items.map(
        (item: { collectionId: string }) => item.collectionId
      )
    ).toEqual(["base-islands-v2"]);
    const combined = await body("/v2/islands/tokens");
    expect(combined.value.total).toBe(2);
    expect(combined.value.complete).toBe(true);
  });
  it("keeps a healthy collection available while another source is unavailable", async () => {
    await mint();
    await mint("ethereum-islands");
    await status("base-islands-v2", false);
    expect((await body(root() + "/tokens")).status).toBe(503);
    expect((await body(root("ethereum-islands") + "/tokens")).status).toBe(200);
    const combined = await body("/v2/islands/tokens");
    expect(combined.status).toBe(200);
    expect(combined.value.complete).toBe(false);
    expect(combined.value.unavailableCollections).toEqual(["base-islands-v2"]);
    expect(combined.value.total).toBe(1);
    expect((await body("/v2/islands/tokens?origin=airdrop")).status).toBe(503);
    await status("ethereum-islands", false);
    expect((await body("/v2/islands/tokens")).status).toBe(503);
  });
  it("refuses wrong release/chain identity rather than returning an empty successful collection", async () => {
    await mint();
    await query(
      "UPDATE native_islands_read.fixture_status SET status=jsonb_set(status,'{chain_id}','1') WHERE collection='base-islands-v2'"
    );
    expect((await body(root() + "/tokens")).status).toBe(503);
    await status("base-islands-v2", true);
    await query(
      "UPDATE native_islands_read._unified_read_release SET release_id=$1",
      [`0x${"ab".repeat(32)}`]
    );
    expect((await body(root() + "/tokens")).status).toBe(503);
  });
  it("rejects cursors across collections, releases, filters, transfer history and changed partial coverage", async () => {
    await mint();
    await mint("base-islands-v2", "2");
    await mint("ethereum-islands");
    const first = await body(root() + "/tokens?limit=1");
    const cursor = first.value.nextCursor;
    expect(cursor).toBeTypeOf("string");
    expect(
      (await body(root() + "/tokens?limit=1&cursor=" + cursor)).value.items[0]
        .tokenId
    ).toBe("2");
    expect(
      (
        await body(
          root("ethereum-islands") + "/tokens?limit=1&cursor=" + cursor
        )
      ).status
    ).toBe(409);
    expect(
      (await body(root() + "/tokens?limit=1&edition=Personal&cursor=" + cursor))
        .status
    ).toBe(409);
    const altered = JSON.parse(Buffer.from(cursor, "base64url").toString());
    altered.scope = "legacy";
    expect(
      (
        await body(
          root() +
            "/tokens?cursor=" +
            Buffer.from(JSON.stringify(altered)).toString("base64url")
        )
      ).status
    ).toBe(409);
    const oldTransfer = Buffer.from(
      JSON.stringify({
        collectionId: "base-islands-v2",
        tokenId: "1",
        blockNumber: "10",
        transactionIndex: 0,
        logIndex: 0
      })
    ).toString("base64url");
    expect(
      (await body(root() + "/tokens/1/transfers?cursor=" + oldTransfer)).status
    ).toBe(409);
    const combined = await body("/v2/islands/tokens?limit=1");
    await status("base-islands-v2", false);
    expect(
      (
        await body(
          "/v2/islands/tokens?limit=1&cursor=" + combined.value.nextCursor
        )
      ).status
    ).toBe(409);
  });
  it("exposes staking only with a fresh selected-build canonical scan and exact latest custody deposit", async () => {
    process.env.API_ISLAND_STAKING_ENABLED = "true";
    await mint("ethereum-islands");
    await query(
      "UPDATE native_islands_read.token SET owner=$1,last_transfer_block=20 WHERE collection='ethereum-islands'",
      [islandStakingAddress]
    );
    await query(
      "INSERT INTO native_islands_read.transfer_event SELECT 'deposit',collection,chain_id,contract_address,token_id,lifecycle,$1,$2,20,2,transaction_hash,0,1 FROM native_islands_read.transfer_event WHERE collection='ethereum-islands'",
      [alice, islandStakingAddress]
    );
    await query(
      "INSERT INTO metadata.island_staking_scan VALUES('native_islands_source','native-build','ready',100,$1,now(),'0x1111111111111111111111111111111111111111111111111111111111111111',$1)",
      [hash]
    );
    await query(
      "INSERT INTO metadata.island_staking_position VALUES('native_islands_source','native-build','1',1,'deposit',$1)",
      [alice]
    );
    const path =
      root("ethereum-islands") + `/owners/${alice}/tokens?holding=all`;
    const current = await body(path);
    expect(current.status).toBe(200);
    expect(current.value.total).toBe(1);
    expect(current.value.items[0].staking.status).toBe("staked");
    expect(current.value.complete).toBe(true);
    expect(
      (
        await body(
          root("ethereum-islands") + `/owners/${alice}/tokens?holding=wallet`
        )
      ).value.total
    ).toBe(0);
    await query(
      "UPDATE metadata.island_staking_scan SET build_id='legacy-build'"
    );
    const old = await body(path);
    expect(old.value.total).toBe(0);
    expect(old.value.complete).toBe(false);
    await query(
      "UPDATE metadata.island_staking_scan SET build_id='native-build',block_hash=$1",
      [`0x${"ff".repeat(32)}`]
    );
    expect((await body(path)).value.total).toBe(0);
    await query("UPDATE metadata.island_staking_scan SET block_hash=$1", [
      hash
    ]);
    await query(
      "UPDATE native_islands_read.transfer_event SET id='new-deposit' WHERE id='deposit'"
    );
    expect((await body(path)).value.total).toBe(0);
    expect(
      (await body(root("ethereum-islands") + "/tokens/1")).value.token.staking
        .status
    ).toBe("unverified");
  });
  it("preserves airdrop/replacement provenance without multiplying rows or using another contract's mint", async () => {
    await mint();
    await mint("ethereum-islands");
    await query(
      "INSERT INTO metadata.island_airdrop_origin VALUES('1',$1,1,$2,'snapshot',$1)",
      [alice, hash]
    );
    await query(
      "INSERT INTO metadata.island_replacement_origin VALUES('1',$1,$2,1,$3,'replacement','root')",
      [alice, legacyBaseIslandCollection.address, hash]
    );
    await query(
      "INSERT INTO yunipals_base_islands_v1.transfer_event VALUES('old','base-islands',8453,$1,'1',1,$2,$3,1,1,$4,0,0)",
      [legacyBaseIslandCollection.address, `0x${"00".repeat(20)}`, alice, hash]
    );
    await query(
      "INSERT INTO native_islands_read.transfer_event SELECT id||':duplicate',collection,chain_id,contract_address,token_id,lifecycle,\"from\",\"to\",block_number+1,block_timestamp,transaction_hash,transaction_index,log_index FROM native_islands_read.transfer_event WHERE collection='base-islands-v2'"
    );
    const value = await body(root("ethereum-islands") + "/tokens");
    expect(value.value.total).toBe(1);
    expect(value.value.items[0].counterpart.collectionId).toBe(
      "base-islands-v2"
    );
    expect(value.value.items[0].replacement.recipient).toBe(alice);
    await query(
      "UPDATE native_islands_read.transfer_event SET contract_address=$1 WHERE collection='base-islands-v2'",
      [bob]
    );
    expect(
      (await body(root("ethereum-islands") + "/tokens")).value.items[0]
        .counterpart
    ).toBeNull();
  });
  it("explicit staking verifier publishes fresh selected-source proof without an API provider client", async () => {
    await custodyFixture();
    const result = await verifyNativeIslandStaking(
      pool,
      "native_islands_read",
      chain(),
      limits
    );
    expect(result).toMatchObject({
      custody: 1,
      verified: 1,
      unverified: 0,
      readCalls: 6,
      releaseId: release
    });
    const response = await body(
      root("ethereum-islands") + `/owners/${alice}/tokens?holding=all`
    );
    expect(response.value.total).toBe(1);
    expect(response.value.complete).toBe(true);
    expect(
      (
        await query(
          "SELECT ownership_release_id,ownership_read_identity FROM metadata.island_staking_scan"
        )
      ).rows[0]
    ).toEqual({ ownership_release_id: release, ownership_read_identity: hash });
  });
  it("verifies 459 custody tokens across 233 wallets in bounded membership batches", async () => {
    await custodyFixture();
    const wallet = (number: number) =>
      `0x${number.toString(16).padStart(40, "0")}` as `0x${string}`;
    await query(
      `UPDATE native_islands_read.transfer_event SET "from"=$1 WHERE id='deposit'`,
      [wallet(1)]
    );
    await query(`INSERT INTO native_islands_read.transfer_event
      SELECT 'deposit-'||i,collection,chain_id,contract_address,i::text,lifecycle,
        '0x'||lpad(to_hex(((i-1)%233)+1),40,'0'),"to",block_number,
        block_timestamp,transaction_hash,transaction_index,log_index
      FROM native_islands_read.transfer_event CROSS JOIN generate_series(2,459)i
      WHERE id='deposit'`);
    const memberships = new Map<string, bigint[]>();
    for (let token = 1; token <= 459; token++) {
      const account = wallet(((token - 1) % 233) + 1);
      memberships.set(account, [
        ...(memberships.get(account) ?? []),
        BigInt(token)
      ]);
    }
    const ownerBatches: number[] = [];
    const membershipBatches: number[] = [];
    const single = vi.fn(async () => {
      throw new Error("batched reader must not call single-wallet fallback");
    });
    const result = await verifyNativeIslandStaking(
      pool,
      "native_islands_read",
      chain({
        custodyBalance: async () => 459n,
        owners: async (tokens, block) => {
          expect(block).toBe(finalized);
          ownerBatches.push(tokens.length);
          return tokens.map(() => islandStakingAddress);
        },
        stakedIslands: single,
        stakedIslandsMany: async (wallets, block) => {
          expect(block).toBe(finalized);
          membershipBatches.push(wallets.length);
          return wallets.map((account) => memberships.get(account)!);
        }
      }),
      { maxTokens: 1000, maxReadCalls: 128 }
    );
    expect(result).toMatchObject({
      custody: 459,
      verified: 459,
      unverified: 0,
      readCalls: 22
    });
    expect(ownerBatches).toEqual([...Array<number>(11).fill(40), 19]);
    expect(membershipBatches).toEqual([40, 40, 40, 40, 40, 33]);
    expect(single).not.toHaveBeenCalled();
    expect(
      (
        await query(
          "SELECT count(*)::int AS positions,count(DISTINCT staker)::int AS wallets FROM metadata.island_staking_position"
        )
      ).rows[0]
    ).toEqual({ positions: 459, wallets: 233 });
  });
  it("rejects wrong membership batch counts, oversized rows and negative IDs before write publication", async () => {
    await custodyFixture();
    const invalid: Array<readonly (readonly bigint[])[]> = [
      [],
      [[-1n]],
      [Array<bigint>(11).fill(1n)],
      Array<readonly bigint[]>(1),
      [Array<bigint>(1)]
    ];
    for (const rows of invalid) {
      const connect = vi.fn(() => pool.connect());
      await expect(
        verifyNativeIslandStaking(
          { connect },
          "native_islands_read",
          chain({ stakedIslandsMany: async () => rows }),
          limits
        )
      ).rejects.toThrow(/staking_membership_(batch_mismatch|limit)/);
      expect(connect).toHaveBeenCalledTimes(1);
      expect(
        (
          await query(
            "SELECT (SELECT count(*)::int FROM metadata.island_staking_position)AS positions,(SELECT count(*)::int FROM metadata.island_staking_scan)AS scans"
          )
        ).rows[0]
      ).toEqual({ positions: 0, scans: 0 });
    }
  });
  it("retains the single-wallet membership fallback", async () => {
    await custodyFixture();
    const single = vi.fn(async () => [1n]);
    const result = await verifyNativeIslandStaking(
      pool,
      "native_islands_read",
      chain({ stakedIslands: single }),
      limits
    );
    expect(single).toHaveBeenCalledExactlyOnceWith(alice, finalized);
    expect(result).toMatchObject({ verified: 1, readCalls: 6 });
  });
  it("staking verifier refuses finalized reorg, changed deposit/source, mismatched custody and exhausted logical limits without publication", async () => {
    await custodyFixture();
    for (const reader of [
      chain({ blockHash: async () => `0x${"ff".repeat(32)}` }),
      chain({ custodyBalance: async () => 2n }),
      chain({ owners: async () => [bob] })
    ]) {
      await expect(
        verifyNativeIslandStaking(pool, "native_islands_read", reader, limits)
      ).rejects.toThrow();
      expect(
        (
          await query(
            "SELECT count(*)::int AS count FROM metadata.island_staking_scan"
          )
        ).rows[0].count
      ).toBe(0);
    }
    await expect(
      verifyNativeIslandStaking(pool, "native_islands_read", chain(), {
        ...limits,
        maxReadCalls: 3
      })
    ).rejects.toThrow("staking_point_read_limit");
    await expect(
      verifyNativeIslandStaking(
        pool,
        "native_islands_read",
        chain({
          blockHash: async () => {
            await query(
              "UPDATE native_islands_read.transfer_event SET id='changed-deposit' WHERE id='deposit'"
            );
            return hash;
          }
        }),
        limits
      )
    ).rejects.toThrow("staking_indexed_history_changed");
    expect(
      (
        await query(
          "SELECT count(*)::int AS count FROM metadata.island_staking_position"
        )
      ).rows[0].count
    ).toBe(0);
    await expect(
      verifyNativeIslandStaking(
        pool,
        "native_islands_read",
        chain({
          blockHash: async () => {
            await query(
              "UPDATE yunipals_indexer_control.release SET build_id='another-build'"
            );
            return hash;
          }
        }),
        limits
      )
    ).rejects.toThrow("staking_indexed_history_changed");
    expect(
      (
        await query(
          "SELECT count(*)::int AS count FROM metadata.island_staking_scan"
        )
      ).rows[0].count
    ).toBe(0);
  });
  it("unknown staking membership remains visibly incomplete even with a recent canonical scan", async () => {
    await custodyFixture();
    const result = await verifyNativeIslandStaking(
      pool,
      "native_islands_read",
      chain({ stakedIslands: async () => [] }),
      limits
    );
    expect(result).toMatchObject({ verified: 0, unverified: 1 });
    const value = await body(
      root("ethereum-islands") + `/owners/${alice}/tokens?holding=all`
    );
    expect(value.value.total).toBe(0);
    expect(value.value.complete).toBe(false);
    expect(value.value.stakingStatus.ready).toBe(false);
    expect(
      (await body(root("ethereum-islands") + "/tokens/1")).value.token.staking
        .status
    ).toBe("unverified");
  });
  it("does not describe disabled staking or expired/wrong-epoch scans as complete holdings", async () => {
    await custodyFixture();
    await verifyNativeIslandStaking(
      pool,
      "native_islands_read",
      chain(),
      limits
    );
    for (const sql of [
      "UPDATE metadata.island_staking_scan SET ownership_release_id='wrong'",
      "UPDATE metadata.island_staking_scan SET ownership_release_id='" +
        release +
        "',verified_at=now()-interval '16 minutes'",
      "UPDATE metadata.island_staking_scan SET verified_at=now()+interval '1 minute'"
    ]) {
      await query(sql);
      const value = await body(
        root("ethereum-islands") + `/owners/${alice}/tokens?holding=all`
      );
      expect(value.value.total).toBe(0);
      expect(value.value.complete).toBe(false);
    }
    process.env.API_ISLAND_STAKING_ENABLED = "false";
    const combined = await body(
      `/v2/islands/tokens?origin=original&owner=${alice}&holding=all`
    );
    expect(combined.value.complete).toBe(false);
    expect(combined.value.stakingStatus.ready).toBe(false);
  });
  it("failed scan publication rolls back positions and prior native proof atomically", async () => {
    await custodyFixture();
    await verifyNativeIslandStaking(
      pool,
      "native_islands_read",
      chain(),
      limits
    );
    const before = await query(
      "SELECT row_to_json(s) AS value FROM metadata.island_staking_scan s"
    );
    const positions = await query(
      "SELECT row_to_json(s) AS value FROM metadata.island_staking_position s"
    );
    let clients = 0;
    const failingPool = {
      connect: async () => ({
        query: async (sql: string, params?: unknown[]) => {
          if (
            clients === 2 &&
            sql.startsWith("INSERT INTO metadata.island_staking_scan")
          )
            throw new Error("fixture publication failure");
          return query(sql, params);
        },
        release() {}
      })
    };
    const connect = failingPool.connect;
    failingPool.connect = async () => {
      clients++;
      return connect();
    };
    await expect(
      verifyNativeIslandStaking(
        failingPool as unknown as Pool,
        "native_islands_read",
        chain(),
        limits
      )
    ).rejects.toThrow("fixture publication failure");
    expect(
      (
        await query(
          "SELECT row_to_json(s) AS value FROM metadata.island_staking_scan s"
        )
      ).rows
    ).toEqual(before.rows);
    expect(
      (
        await query(
          "SELECT row_to_json(s) AS value FROM metadata.island_staking_position s"
        )
      ).rows
    ).toEqual(positions.rows);
  });
});
