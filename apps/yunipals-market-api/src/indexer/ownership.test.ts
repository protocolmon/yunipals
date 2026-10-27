import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import pg, { type Pool } from "pg";
import { toHex, zeroAddress, type PublicClient } from "viem";
import { collectionAbi } from "@protopals/yunipals-market-core/collectionAbi";
import {
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import { seaportEventAbi } from "@protopals/yunipals-market-core/seaportEvents";
import {
  sourceManifestHash,
  manifestDigest
} from "@protopals/yunipals-indexer-server/identity";
import type { RegisteredRelease } from "@protopals/yunipals-indexer-server/readers";

import { bindDiscoveredBnbLifecycles } from "@/bnb/discoveryLifecycle";
import {
  fixture as bnbFixture,
  policy as bnbPolicy
} from "@/bnb/fixtures/admission";
import { readIndexedBnbAsset } from "@/bnb/indexer";
import { sharedBnbDiscoveryConfiguration } from "@/bnb/sharedDiscovery";
import { readIndexedTransfers } from "@/db/indexedTransfers";
import { readBnbDiscoveryBinding } from "@/indexer/bnbDiscoveryRead";
import {
  closeMarketplaceOwnershipIndexer,
  configureMarketplaceOwnershipIndexer,
  marketplaceOwnershipIndexer,
  marketplaceOwnershipDefinition,
  readMarketplaceOwnershipEnvironment,
  withMarketplaceOwnershipIndexer
} from "@/indexer/ownership";
import { openSharedConsumer } from "@/indexer/consumerEnvironment";
import { marketplaceOwnershipSqlContext } from "@/indexer/ownershipSql";
import {
  admissionFixture,
  fixtureNow,
  fixtureTimestamp
} from "@/opensea/fixtures/admission";
import { readIndexedOpenSeaAsset } from "@/opensea/indexer";
import type { OpenSeaPolicyResolver } from "@/opensea/policy";
import { observeOpenSeaReadHealth } from "@/opensea/readHealth";
import { CatalogService } from "@/reads/catalog";
import { OrderReadService } from "@/reads/orders";
import { indexedTokenHiddenSqlFor } from "@/reads/visibility";

import { observeIndexerChain } from "../../../yunipals-indexer/lib/unified/observer";
import { createOwnershipReadViews } from "../../../yunipals-indexer/lib/unified/ownership-views";
import { registerIndexerRelease } from "../../../yunipals-indexer/lib/unified/releases";

test("ownership configuration defaults to legacy and rejects mixed or incomplete selectors", () => {
  assert.deepEqual(readMarketplaceOwnershipEnvironment({}), { mode: "legacy" });
  const valid = {
    MARKET_OWNERSHIP_INDEXER_MODE: "unified",
    MARKET_OWNERSHIP_INDEXER_READ_SCHEMA: "ownership_candidate",
    MARKET_OWNERSHIP_INDEXER_DATABASE_URL: "postgresql://reader@127.0.0.1/test",
    MARKET_OWNERSHIP_INDEXER_RELEASE_ID: `0x${"12".repeat(32)}`
  };
  assert.equal(readMarketplaceOwnershipEnvironment(valid).mode, "unified");
  for (const change of [
    { MARKET_OWNERSHIP_INDEXER_MODE: "typo" },
    { MARKET_OWNERSHIP_INDEXER_MODE: "legacy" },
    { MARKET_OWNERSHIP_INDEXER_DATABASE_URL: undefined },
    { MARKET_OWNERSHIP_INDEXER_RELEASE_ID: undefined },
    { MARKET_OWNERSHIP_INDEXER_READ_SCHEMA: undefined },
    { MARKET_OWNERSHIP_INDEXER_READ_SCHEMA: 'bad"schema' },
    { MARKET_OWNERSHIP_INDEXER_RELEASE_ID: "0x12" },
    { MARKET_OWNERSHIP_INDEXER_DATABASE_URL: "https://example.com/db" }
  ])
    assert.throws(() =>
      readMarketplaceOwnershipEnvironment({ ...valid, ...change })
    );
});

const sourceUrl = process.env.PONDER_UNIFIED_TEST_DATABASE_URL;
const marketUrl = process.env.MARKET_TEST_DATABASE_URL;
const enabled = Boolean(sourceUrl && marketUrl);
const schema = `marketplace_ownership_${process.pid}`;
const buildId = "marketplace-ownership-proof";
const now = fixtureNow;
const stamp = fixtureTimestamp;
const alice = `0x${"12".repeat(20)}`;
const bob = `0x${"34".repeat(20)}`;
const tokenId = String(990_000_000 + process.pid);
const hash = (n: number) => toHex(BigInt(n), { size: 32 });
const blockHash = (chain: number, n: bigint) =>
  toHex(BigInt(chain) * 1000n + n, { size: 32 });
const manifest: RegisteredRelease["manifest"] = {
  version: 1,
  ponderVersion: "0.17.5",
  ordering: "multichain",
  coverage: "ponder-live-blocks-v1",
  sources: ["bnb", "base", "ethereum", "polygon"].map((collection) => {
    const chain =
      marketplaceChains[collection as keyof typeof marketplaceChains];
    return {
      id: `ownership:${collection}`,
      feature: "ownership",
      chainId: chain.chainId,
      contractName: `Ownership${collection}`,
      address: chain.contractAddress,
      startBlock: "1",
      endBlock: null,
      enabled: true,
      abiHash: manifestDigest(collectionAbi),
      events: ["Transfer"],
      receiptRequirement: "none",
      policies:
        collection === "bnb"
          ? [{ kind: "latest" }, { kind: "depth", subsequentBlocks: 20 }]
          : [{ kind: "latest" }]
    };
  })
};
manifest.sources = [
  ...manifest.sources,
  {
    id: "marketplace:bnb:seaport",
    feature: "marketplace",
    chainId: 56,
    contractName: "SeaportBnb",
    address: seaportDeployment.address.toLowerCase(),
    startBlock: "1",
    endBlock: null,
    enabled: true,
    abiHash: manifestDigest(seaportEventAbi),
    events: ["OrderValidated", "CounterIncremented"],
    receiptRequirement: "full",
    policies: [{ kind: "finalized" }]
  }
];
let source: Pool;
let local: Pool;
let release: RegisteredRelease;
async function observe(chain: number) {
  assert.equal(
    await observeIndexerChain(
      source,
      release,
      chain,
      {
        providerId: "marketplace-local-proof",
        receipt: async () => {
          throw new Error("Receipt RPC is forbidden for ownership tests.");
        },
        code: async () => {
          throw new Error("Code RPC is forbidden for ownership tests.");
        },
        chainId: async () => chain,
        block: async (tag) => {
          const number =
            tag === "latest" ? 100n : tag === "finalized" ? 70n : tag;
          return {
            number,
            hash: blockHash(chain, number),
            parentHash: blockHash(chain, number - 1n),
            timestamp: stamp
          };
        }
      },
      { now: () => now }
    ),
    "observed"
  );
}
async function transfer(
  collection: "bnb" | "base",
  from: string,
  to: string,
  number: number,
  sequence: number,
  lifecycle = 1
) {
  const chain = marketplaceChains[collection];
  const tx = hash(sequence);
  const id = `${collection}:${tx}:${sequence}`;
  const exists =
    (
      await source.query(
        `SELECT 1 FROM ${schema}.token WHERE collection=$1 AND token_id=$2`,
        [collection, tokenId]
      )
    ).rowCount === 1;
  if (from === zeroAddress)
    await source.query(
      `INSERT INTO ${schema}.token_lifecycle(collection,token_id,lifecycle,minted_to,mint_block,mint_timestamp,mint_transaction_hash) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [collection, tokenId, lifecycle, to, String(number), stamp.toString(), tx]
    );
  if (to === zeroAddress)
    await source.query(
      `UPDATE ${schema}.token_lifecycle SET burned_at_block=$4,burned_at_timestamp=$5,burn_transaction_hash=$6 WHERE collection=$1 AND token_id=$2 AND lifecycle=$3`,
      [collection, tokenId, lifecycle, String(number), stamp.toString(), tx]
    );
  await source.query(
    `INSERT INTO ${schema}.token(collection,chain_id,contract_address,token_id,owner,burned,lifecycle,mint_block,mint_timestamp,last_transfer_block,last_transfer_timestamp,last_transaction_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$8,$9,$10) ON CONFLICT(collection,token_id) DO UPDATE SET owner=$5,burned=$6,lifecycle=$7,last_transfer_block=$8,last_transfer_timestamp=$9,last_transaction_hash=$10,mint_block=CASE WHEN $11 THEN $8 ELSE ${schema}.token.mint_block END,mint_timestamp=CASE WHEN $11 THEN $9 ELSE ${schema}.token.mint_timestamp END`,
    [
      collection,
      chain.chainId,
      chain.contractAddress,
      tokenId,
      to,
      to === zeroAddress,
      lifecycle,
      String(number),
      stamp.toString(),
      tx,
      !exists || from === zeroAddress
    ]
  );
  await source.query(
    `INSERT INTO ${schema}.transfer_event(id,collection,chain_id,contract_address,token_id,lifecycle,"from","to",block_number,block_timestamp,transaction_hash,transaction_index,log_index) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$12)`,
    [
      id,
      collection,
      chain.chainId,
      chain.contractAddress,
      tokenId,
      lifecycle,
      from,
      to,
      String(number),
      stamp.toString(),
      tx,
      sequence
    ]
  );
  await source.query(
    `INSERT INTO ${schema}.canonical_event(id,source_id,chain_id,address,name,args,abi_hash,block_number,block_hash,timestamp,transaction_hash,transaction_index,log_index,topics,data) VALUES($1,$2,$3,$4,'Transfer',$5,$6,$7,$8,$9,$10,0,$11,'[]','0x')`,
    [
      `${chain.chainId}:${chain.contractAddress}:${tx}:${sequence}`,
      `ownership:${collection}`,
      chain.chainId,
      chain.contractAddress,
      JSON.stringify({ from, to, tokenId }),
      manifestDigest(collectionAbi),
      String(number),
      blockHash(chain.chainId, BigInt(number)),
      stamp.toString(),
      tx,
      sequence
    ]
  );
  return id;
}
before(async () => {
  if (!enabled) return;
  for (const [value, database] of [
    [sourceUrl!, "/yunipals_ponder_dependency_test"],
    [marketUrl!, "/yunipals_market_test"]
  ]) {
    const url = new URL(value!);
    assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
    assert.equal(url.pathname, database);
  }
  source = new pg.Pool({ connectionString: sourceUrl, max: 4 });
  local = new pg.Pool({ connectionString: marketUrl, max: 2 });
  await source.query(`CREATE SCHEMA ${schema}`);
  for (const table of [
    "_ponder_meta",
    "_ponder_checkpoint",
    "indexer_source",
    "chain_checkpoint",
    "chain_block",
    "token",
    "token_lifecycle",
    "transfer_event",
    "canonical_event",
    "transaction_candidate",
    "admin_role_event",
    "contract_owner_event"
  ])
    await source.query(
      `CREATE TABLE ${schema}.${table}(LIKE dependency_check.${table} INCLUDING ALL)`
    );
  await source.query(`INSERT INTO ${schema}._ponder_meta VALUES('app',$1)`, [
    JSON.stringify({
      version: "6",
      build_id: buildId,
      heartbeat_at: now,
      is_ready: 1,
      is_locked: 1,
      is_dev: 0
    })
  ]);
  for (const item of manifest.sources)
    await source.query(
      `INSERT INTO ${schema}.indexer_source VALUES($1,$2,$3,$4)`,
      [
        item.id,
        item.chainId,
        sourceManifestHash(manifest),
        JSON.stringify(item)
      ]
    );
  for (const chain of [56, 8453, 1, 137]) {
    const cp = `${stamp.toString().padStart(10, "0")}${String(chain).padStart(16, "0")}${"100".padStart(16, "0")}${"9".repeat(33)}`;
    await source.query(
      `INSERT INTO ${schema}._ponder_checkpoint VALUES($1,$2,$3,$3,$3)`,
      [String(chain), chain, cp]
    );
    await source.query(
      `INSERT INTO ${schema}.chain_checkpoint VALUES($1,$2,'100',$3,$4,$5)`,
      [
        String(chain),
        chain,
        blockHash(chain, 100n),
        blockHash(chain, 99n),
        stamp.toString()
      ]
    );
    for (let n = 0n; n <= 100n; n++)
      await source.query(
        `INSERT INTO ${schema}.chain_block VALUES($1,$2,$3,$4,$5,$6)`,
        [
          `${chain}:${n}`,
          chain,
          n.toString(),
          blockHash(chain, n),
          blockHash(chain, n - 1n),
          stamp.toString()
        ]
      );
  }
  release = await registerIndexerRelease(source, { schema, buildId, manifest });
  await observe(56);
  await observe(8453);
  await observe(1);
  await observe(137);
  await createOwnershipReadViews(source, release, `${schema}_read`, [
    marketplaceOwnershipDefinition(release, "bnb"),
    marketplaceOwnershipDefinition(release, "base"),
    marketplaceOwnershipDefinition(release, "ethereum"),
    marketplaceOwnershipDefinition(release, "polygon")
  ]);
  configureMarketplaceOwnershipIndexer(
    {
      mode: "unified",
      databaseUrl: sourceUrl!,
      releaseId: release.id,
      readSchema: `${schema}_read`
    },
    { pool: source, now: () => now }
  );
});
after(async () => {
  if (!enabled) return;
  await closeMarketplaceOwnershipIndexer();
  if (local) {
    await local.query(
      "DELETE FROM metadata.token_visibility WHERE token_id=$1::numeric",
      [tokenId]
    );
    await local.end();
  }
  if (source) {
    if (release) {
      await source.query(
        "DELETE FROM yunipals_indexer_control.chain_anchor WHERE release_id=$1",
        [release.id]
      );
      await source.query(
        "DELETE FROM yunipals_indexer_control.chain_status WHERE release_id=$1",
        [release.id]
      );
      await source.query(
        "DELETE FROM yunipals_indexer_control.release WHERE id=$1",
        [release.id]
      );
    }
    await source.query(`DROP SCHEMA IF EXISTS ${schema}_read CASCADE`);
    await source.query(`DROP SCHEMA ${schema} CASCADE`);
    await source.end();
  }
});

test(
  "shared ownership preserves BNB depth, event-position lifecycles and away/back transfer gaps",
  { skip: !enabled },
  async () => {
    await transfer("bnb", zeroAddress, alice, 10, 1);
    await transfer("bnb", alice, bob, 70, 2);
    await transfer("bnb", bob, alice, 90, 3);
    const asset = {
      chain: "bnb" as const,
      chainId: 56 as const,
      contractAddress: marketplaceChains.bnb.contractAddress,
      tokenId
    };
    const before = await readIndexedBnbAsset(local, asset);
    assert.equal(before.owner.toLowerCase(), bob);
    assert.equal(before.checkpoint.number, 80n);
    assert.equal(before.lastTransfer.transactionHash, hash(2));
    const shared = marketplaceOwnershipIndexer()!;
    assert.equal(
      (
        await shared.lifecycleBefore("bnb", tokenId, {
          blockNumber: "70",
          transactionIndex: 0,
          logIndex: 2
        })
      ).transfer?.to,
      alice
    );
    assert.equal(
      (
        await shared.lifecycleBefore("bnb", tokenId, {
          blockNumber: "70",
          transactionIndex: 0,
          logIndex: 3
        })
      ).transfer?.to,
      bob
    );
    await assert.rejects(
      shared.lifecycleBefore("bnb", tokenId, {
        blockNumber: "81",
        transactionIndex: 0,
        logIndex: 0
      }),
      /beyond ownership coverage/
    );
    await source.query(
      `UPDATE ${schema}.transfer_event SET block_number=79 WHERE collection='bnb' AND transaction_hash=$1`,
      [hash(3)]
    );
    await source.query(
      `UPDATE ${schema}.canonical_event SET block_number=79,block_hash=$2 WHERE source_id='ownership:bnb' AND transaction_hash=$1`,
      [hash(3), blockHash(56, 79n)]
    );
    await source.query(
      `UPDATE ${schema}.token SET last_transfer_block=79 WHERE collection='bnb' AND token_id=$1`,
      [tokenId]
    );
    const batch = await readIndexedTransfers({} as never, "bnb", [
      tokenId,
      tokenId
    ]);
    assert.equal(batch.get(tokenId)?.transactionHash, hash(3));
    assert.notEqual(
      batch.get(tokenId)?.transactionHash,
      before.lastTransfer.transactionHash
    );
    assert.equal(
      (await readIndexedBnbAsset(local, asset)).owner.toLowerCase(),
      alice
    );
    await transfer("bnb", alice, zeroAddress, 79, 4);
    await transfer("bnb", zeroAddress, bob, 80, 5, 2);
    const remint = await readIndexedBnbAsset(local, asset);
    assert.equal(remint.lifecycle, 2);
    assert.equal(remint.owner.toLowerCase(), bob);
    const past = await shared.lifecycleBefore("bnb", tokenId, {
      blockNumber: "80",
      transactionIndex: 0,
      logIndex: 5
    });
    assert.equal(past.transfer?.lifecycle, 1);
    assert.equal(past.transfer?.to, zeroAddress);
  }
);

test(
  "visibility proves the exact anchor, survives self-transfers and expires on away/back movement",
  { skip: !enabled },
  async () => {
    const anchor = await transfer("base", zeroAddress, alice, 10, 11);
    await local.query(
      `INSERT INTO metadata.token_visibility(collection,token_id,owner,lifecycle,anchor_event_id,anchor_block,anchor_transaction_index,anchor_log_index) VALUES('base',$1::numeric,$2,1,$3,10,0,11)`,
      [tokenId, alice, anchor]
    );
    const asset = {
      chain: "base" as const,
      chainId: 8453,
      contractAddress: marketplaceChains.base.contractAddress,
      tokenId
    };
    assert.equal((await readIndexedOpenSeaAsset(local, asset)).hidden, true);
    await transfer("base", alice, alice, 20, 12);
    assert.equal((await readIndexedOpenSeaAsset(local, asset)).hidden, true);
    await transfer("base", alice, bob, 30, 13);
    await transfer("base", bob, alice, 40, 14);
    const current = await readIndexedOpenSeaAsset(local, asset);
    assert.equal(current.hidden, false);
    assert.equal(current.lastTransfer.transactionHash, hash(14));
    assert.equal(current.checkpoint.number, 100n);
    await assert.rejects(
      readIndexedOpenSeaAsset(local, {
        ...asset,
        contractAddress: marketplaceChains.bnb.contractAddress
      }),
      { code: "indexer_unavailable" }
    );
  }
);

test(
  "ownership fails closed for stopped, stale, mismatched-build, reorged and incomplete shared proofs",
  { skip: !enabled },
  async () => {
    const asset = {
      chain: "base" as const,
      chainId: 8453,
      contractAddress: marketplaceChains.base.contractAddress,
      tokenId
    };
    for (const [sql, repair] of [
      [
        `UPDATE ${schema}._ponder_meta SET value=jsonb_set(value,'{is_locked}','0')`,
        `UPDATE ${schema}._ponder_meta SET value=jsonb_set(value,'{is_locked}','1')`
      ],
      [
        `UPDATE ${schema}._ponder_meta SET value=jsonb_set(value,'{heartbeat_at}','${now - 300000}')`,
        `UPDATE ${schema}._ponder_meta SET value=jsonb_set(value,'{heartbeat_at}','${now}')`
      ],
      [
        `UPDATE ${schema}._ponder_meta SET value=jsonb_set(value,'{build_id}','"different-build"')`,
        `UPDATE ${schema}._ponder_meta SET value=jsonb_set(value,'{build_id}','"${buildId}"')`
      ],
      [
        `UPDATE ${schema}.chain_block SET block_hash='${hash(999)}' WHERE chain_id=8453 AND block_number=100`,
        `UPDATE ${schema}.chain_block SET block_hash='${blockHash(8453, 100n)}' WHERE chain_id=8453 AND block_number=100`
      ],
      [
        `UPDATE ${schema}.canonical_event SET abi_hash='${hash(999)}' WHERE source_id='ownership:base' AND transaction_hash='${hash(14)}'`,
        `UPDATE ${schema}.canonical_event SET abi_hash='${manifestDigest(collectionAbi)}' WHERE source_id='ownership:base' AND transaction_hash='${hash(14)}'`
      ]
    ]) {
      await source.query(sql!);
      await assert.rejects(readIndexedOpenSeaAsset(local, asset), {
        code: "indexer_unavailable"
      });
      await source.query(repair!);
      assert.equal(
        (await readIndexedOpenSeaAsset(local, asset)).owner.toLowerCase(),
        alice
      );
    }
    await assert.rejects(
      marketplaceOwnershipIndexer()!.transfers(
        "base",
        Array.from({ length: 101 }, (_, i) => String(i))
      ),
      /Invalid indexed transfer batch/
    );
    assert.equal(
      (await marketplaceOwnershipIndexer()!.transfers("base", [])).size,
      0
    );
  }
);

test(
  "source health and branch are rechecked after waiting for local visibility",
  { skip: !enabled },
  async () => {
    const asset = {
      chain: "base" as const,
      chainId: 8453,
      contractAddress: marketplaceChains.base.contractAddress,
      tokenId
    };
    const racingLocal = {
      query: async (...args: Parameters<Pool["query"]>) => {
        await source.query(
          `UPDATE ${schema}._ponder_meta SET value=jsonb_set(value,'{is_locked}','0')`
        );
        return local.query(...args);
      }
    } as unknown as Pool;
    try {
      await assert.rejects(readIndexedOpenSeaAsset(racingLocal, asset), {
        code: "indexer_unavailable"
      });
    } finally {
      await source.query(
        `UPDATE ${schema}._ponder_meta SET value=jsonb_set(value,'{is_locked}','1')`
      );
    }
    assert.equal(
      (await readIndexedOpenSeaAsset(local, asset)).owner.toLowerCase(),
      alice
    );
  }
);

test(
  "OpenSea deep health uses shared release and canonical anchor without legacy metadata queries",
  { skip: !enabled },
  async () => {
    const f = await admissionFixture("base");
    const saved: unknown[][] = [];
    const query = async (sql: string, values: unknown[] = []) => {
      assert.ok(!sql.includes("yunipals_indexer_v3"));
      if (sql.includes("INSERT INTO")) saved.push(values);
      return { rows: [] };
    };
    const pool = {
      query,
      connect: async () => ({ query, release() {} })
    } as unknown as Pool;
    let wrongHash = false;
    const client = {
      ...f.client,
      getBlock: async (args: Parameters<PublicClient["getBlock"]>[0]) => {
        const block = await f.client.getBlock(args);
        return args?.blockNumber === 100n
          ? {
              ...block,
              hash: wrongHash ? hash(999) : blockHash(8453, 100n),
              timestamp: stamp
            }
          : block;
      }
    } as PublicClient;
    const policies = {
      resolve: async () => ({
        collectionSlug: "yunipals-base",
        policy: f.policy
      })
    } as unknown as Pick<OpenSeaPolicyResolver, "resolve">;
    assert.equal(
      await observeOpenSeaReadHealth(pool, client, "base", policies, () => now),
      true
    );
    assert.equal(saved[1]?.[0], "indexer");
    assert.equal(saved[1]?.[2], "100");
    assert.equal(saved[1]?.[3], blockHash(8453, 100n));
    wrongHash = true;
    assert.equal(
      await observeOpenSeaReadHealth(pool, client, "base", policies, () => now),
      false
    );
  }
);

test(
  "BNB discovery binds the historical lifecycle with fresh shared proof and canonical RPC anchor",
  { skip: !enabled },
  async () => {
    const f = await bnbFixture("listing", BigInt(tokenId));
    const writes: unknown[][] = [];
    const query = async (sql: string, values: unknown[] = []) => {
      assert.ok(
        !sql.includes("bnb_indexer") && !sql.includes("yunipals_read_v4")
      );
      if (sql.includes("SELECT order_hash"))
        return {
          rows: [
            {
              order_hash: f.input.hash,
              token_id: tokenId,
              publication_block: "70",
              publication_transaction_index: 0,
              publication_log_index: 2,
              published_components: f.request.order
            }
          ]
        };
      if (sql.includes("UPDATE")) {
        writes.push(values);
        return { rows: [], rowCount: 1 };
      }
      throw new Error("Unexpected binder query.");
    };
    let wrong = false;
    const client = {
      getBlock: async (args: { blockNumber: bigint }) => ({
        hash: wrong ? hash(999) : blockHash(56, args.blockNumber)
      })
    } as unknown as PublicClient;
    assert.deepEqual(
      await bindDiscoveredBnbLifecycles(
        { query } as unknown as Pool,
        client,
        bnbPolicy,
        100n
      ),
      { bound: 1, pending: false }
    );
    assert.equal(writes[0]?.[2], 1);
    assert.equal(writes[0]?.[4], "80");
    assert.equal(writes[0]?.[5], blockHash(56, 80n));
    wrong = true;
    await assert.rejects(
      bindDiscoveredBnbLifecycles(
        { query } as unknown as Pool,
        client,
        bnbPolicy,
        100n
      ),
      /anchor changed/
    );
    assert.equal(writes.length, 1);
  }
);

test(
  "marketplace release source must use the exact deployed collection decoder ABI",
  { skip: !enabled },
  () => {
    assert.equal(
      marketplaceOwnershipDefinition(release, "base").sourceId,
      "ownership:base"
    );
    const wrong = {
      ...release,
      manifest: {
        ...release.manifest,
        sources: release.manifest.sources.map((source) => ({
          ...source,
          abiHash: hash(42)
        }))
      }
    };
    assert.throws(
      () => marketplaceOwnershipDefinition(wrong, "base"),
      /deployment mismatch/
    );
    assert.throws(
      () => marketplaceOwnershipDefinition(wrong, "bnb"),
      /deployment mismatch/
    );
  }
);

test(
  "SQL-heavy reads validate an immutable direct read schema and its actual source policy",
  { skip: !enabled },
  async () => {
    const context = await marketplaceOwnershipSqlContext(source, [
      "bnb",
      "base"
    ]);
    assert.equal(context.tokenRelation, `"${schema}_read".token`);
    assert.equal(
      (
        await source.query(
          `SELECT owner FROM ${context.tokenRelation} WHERE collection='base' AND token_id=$1`,
          [tokenId]
        )
      ).rows[0]?.owner,
      alice
    );
    const original = (
      await source.query(
        `SELECT definitions FROM ${schema}_read._unified_read_release WHERE singleton`
      )
    ).rows[0].definitions;
    try {
      await source.query(
        `UPDATE ${schema}_read._unified_read_release SET definitions=$1`,
        [
          JSON.stringify(
            original.map((row: { collection: string }) =>
              row.collection === "bnb"
                ? { ...row, policy: { kind: "latest" } }
                : row
            )
          )
        ]
      );
      await assert.rejects(marketplaceOwnershipSqlContext(source, ["bnb"]), {
        code: "indexer_unavailable"
      });
    } finally {
      await source.query(
        `UPDATE ${schema}_read._unified_read_release SET definitions=$1`,
        [JSON.stringify(original)]
      );
    }
    assert.match(
      indexedTokenHiddenSqlFor("t", context.transferRelation),
      new RegExp(`${schema}_read`)
    );
    assert.throws(() =>
      indexedTokenHiddenSqlFor("t;drop table", context.transferRelation)
    );
  }
);

test(
  "SQL-heavy readers reject copied local markers and reject a reorg hidden by a held source snapshot",
  { skip: !enabled },
  async () => {
    const client = await source.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await marketplaceOwnershipSqlContext(client, ["base"]);
      await source.query(
        `UPDATE ${schema}.chain_block SET block_hash=$1 WHERE chain_id=8453 AND block_number=100`,
        [hash(909)]
      );
      await assert.rejects(marketplaceOwnershipSqlContext(client, ["base"]), {
        code: "indexer_unavailable"
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await source.query(
        `UPDATE ${schema}.chain_block SET block_hash=$1 WHERE chain_id=8453 AND block_number=100`,
        [blockHash(8453, 100n)]
      );
    }
    await assert.rejects(marketplaceOwnershipSqlContext(local, ["base"]), {
      code: "indexer_unavailable"
    });
  }
);

test(
  "native read API uses a verified FDW mirror and rejects remapped ownership relations",
  { skip: !enabled },
  async () => {
    const mirror = `${schema}_read`,
      server = `${schema}_server`;
    const sourceConfig = {
      mode: "unified" as const,
      databaseUrl: sourceUrl!,
      releaseId: release.id,
      readSchema: mirror
    };
    // postgres_fdw executes inside this disposable PostgreSQL container, whose
    // listener is 5432; the test runner reaches that same listener via 56967.
    const fdwUrl = new URL(sourceUrl!);
    fdwUrl.port = "5432";
    await closeMarketplaceOwnershipIndexer();
    configureMarketplaceOwnershipIndexer(
      { ...sourceConfig, databaseUrl: fdwUrl.toString() },
      { pool: source, now: () => now }
    );
    const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
    try {
      await local.query(`CREATE EXTENSION IF NOT EXISTS postgres_fdw;
      CREATE SERVER ${server} FOREIGN DATA WRAPPER postgres_fdw OPTIONS(host '127.0.0.1',port '5432',dbname 'yunipals_ponder_dependency_test',updatable 'false');
      CREATE USER MAPPING FOR CURRENT_USER SERVER ${server} OPTIONS(user ${literal(decodeURIComponent(fdwUrl.username))},password ${literal(decodeURIComponent(fdwUrl.password))},password_required 'false');
      CREATE SCHEMA ${mirror};
      IMPORT FOREIGN SCHEMA ${mirror} LIMIT TO(token,token_lifecycle,transfer_event,source_status,_unified_read_release) FROM SERVER ${server} INTO ${mirror};`);
      const ctx = await marketplaceOwnershipSqlContext(local);
      const rows = await local.query(
        `SELECT t.owner,${indexedTokenHiddenSqlFor("t", ctx.transferRelation)} AS hidden FROM ${ctx.tokenRelation} t WHERE t.collection='base' AND t.token_id=$1`,
        [tokenId]
      );
      assert.equal(rows.rows[0]?.owner, alice);
      assert.equal(rows.rows[0]?.hidden, false);
      const read = new OrderReadService(local);
      const asset = await read.assetV2({
        chain: "base",
        chainId: 8453,
        contractAddress: marketplaceChains.base.contractAddress,
        tokenId
      });
      assert.equal(asset.owner.toLowerCase(), alice);
      assert.equal(asset.lifecycle, 1);
      const keepers = new pg.Pool({ connectionString: marketUrl, max: 4 });
      const catalog = new CatalogService(local, keepers, {
        projectionMode: "legacy",
        readSources: async () => ({
          statuses: {
            bnb: "unavailable",
            base: "unavailable",
            ethereum: "unavailable",
            polygon: "unavailable"
          },
          provenance: {}
        })
      });
      try {
        const result = await catalog.tokens(
          new URLSearchParams({ chain: "base", sort: "token-id-asc" })
        );
        assert.equal(result.total, 1);
        assert.equal(result.items[0]?.token.tokenId, tokenId);
        await source.query(
          `UPDATE ${schema}.chain_block SET block_hash=$1 WHERE chain_id=8453 AND block_number=100`,
          [hash(707)]
        );
        await assert.rejects(
          catalog.tokens(
            new URLSearchParams({ chain: "base", sort: "token-id-asc" })
          ),
          { code: "catalog_indexer_unavailable" }
        );
      } finally {
        await source.query(
          `UPDATE ${schema}.chain_block SET block_hash=$1 WHERE chain_id=8453 AND block_number=100`,
          [blockHash(8453, 100n)]
        );
        await catalog.close();
      }

      await local.query(
        `ALTER FOREIGN TABLE ${mirror}.token OPTIONS(SET schema_name 'wrong_schema')`
      );
      await assert.rejects(marketplaceOwnershipSqlContext(local), {
        code: "indexer_unavailable"
      });
      await local.query(
        `ALTER FOREIGN TABLE ${mirror}.token OPTIONS(SET schema_name '${mirror}')`
      );
      assert.equal(
        (await marketplaceOwnershipSqlContext(local)).mode,
        "unified"
      );
    } finally {
      await local.query(
        `DROP SCHEMA IF EXISTS ${mirror} CASCADE;DROP SERVER IF EXISTS ${server} CASCADE`
      );
      await closeMarketplaceOwnershipIndexer();
      configureMarketplaceOwnershipIndexer(sourceConfig, {
        pool: source,
        now: () => now
      });
    }
  }
);

test(
  "BNB discovery API requires the selected finalized registration and canonical saved cursor",
  { skip: !enabled },
  async () => {
    const config = sharedBnbDiscoveryConfiguration({ release }, bnbPolicy, 1n);
    const row = {
      reader_mode: "unified",
      launch_block: "1",
      next_block: "71",
      target_block: "70",
      scanned_block_hash: blockHash(56, 70n),
      policy_fingerprint: config.policyFingerprint,
      updated_at: new Date(),
      chain_id: 56,
      release_id: release.id,
      source_id: config.sourceId,
      confirmation_policy: config.confirmationPolicy,
      configuration_hash: config.configurationHash,
      cursor: {
        version: 1,
        releaseId: release.id,
        sourceId: config.sourceId,
        policy: "finalized",
        completed: { number: "70", hash: blockHash(56, 70n) },
        target: null,
        after: null
      }
    };
    const db = { query: async () => ({ rows: [row] }) } as unknown as Pool;
    assert.deepEqual(await readBnbDiscoveryBinding(db), {
      native: true,
      ready: true
    });
    row.cursor.completed.number = "69";
    row.cursor.completed.hash = blockHash(56, 69n);
    row.target_block = "69";
    row.next_block = "70";
    row.scanned_block_hash = blockHash(56, 69n);
    assert.deepEqual(await readBnbDiscoveryBinding(db), {
      native: true,
      ready: true
    });
    row.updated_at = new Date(Date.now() - 721_000);
    assert.deepEqual(await readBnbDiscoveryBinding(db), {
      native: true,
      ready: false
    });
    row.updated_at = new Date();
    row.target_block = "70";
    row.next_block = "71";
    row.scanned_block_hash = blockHash(56, 70n);
    row.cursor.completed.number = "70";
    row.cursor.completed.hash = hash(999);
    await assert.rejects(readBnbDiscoveryBinding(db), {
      code: "indexer_unavailable"
    });
    row.cursor.completed.hash = blockHash(56, 70n);
    row.release_id = hash(999);
    await assert.rejects(readBnbDiscoveryBinding(db), {
      code: "indexer_unavailable"
    });
    row.release_id = release.id;
    row.configuration_hash = hash(999);
    await assert.rejects(readBnbDiscoveryBinding(db), {
      code: "indexer_unavailable"
    });
  }
);

test(
  "direct binding rejects copied ownership tables and views over the wrong physical source",
  { skip: !enabled },
  async () => {
    const target = `${schema}_read`;
    await source.query(`ALTER VIEW ${target}.token RENAME TO token_retained`);
    try {
      await source.query(
        `CREATE TABLE ${target}.token AS SELECT * FROM ${target}.token_retained`
      );
      await assert.rejects(marketplaceOwnershipSqlContext(source, ["base"]), {
        code: "indexer_unavailable"
      });
      await source.query(`DROP TABLE ${target}.token`);
      await source.query(
        `CREATE VIEW ${target}.token AS SELECT * FROM ${schema}.token`
      );
      await assert.rejects(marketplaceOwnershipSqlContext(source, ["base"]), {
        code: "indexer_unavailable"
      });
      await source.query(`DROP VIEW ${target}.token`);
    } finally {
      const kind = (
        await source.query<{ relkind: string }>(
          `SELECT c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname='token'`,
          [target]
        )
      ).rows[0]?.relkind;
      if (kind)
        await source.query(
          `DROP ${kind === "v" ? "VIEW" : "TABLE"} ${target}.token`
        );
      await source.query(`ALTER VIEW ${target}.token_retained RENAME TO token`);
    }
    assert.equal(
      (await marketplaceOwnershipSqlContext(source, ["base"])).mode,
      "unified"
    );
  }
);

test(
  "restricted source login exercises the checked-in source grants without write privileges",
  { skip: !enabled },
  async () => {
    const role = `${schema}_reader`,
      target = `${schema}_read`;
    const password = "marketplace-local-read-only";
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
    const connection = new URL(sourceUrl!);
    connection.username = role;
    connection.password = password;
    const configuration = {
      mode: "unified" as const,
      databaseUrl: connection.toString(),
      releaseId: release.id,
      readSchema: target
    };
    const original = { ...configuration, databaseUrl: sourceUrl! };
    let readPool: Pool | undefined;
    try {
      await source.query(
        `CREATE ROLE ${quote(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD ${literal(password)}`
      );
      const grants = await readFile(
        new URL(
          "../../../../ops/unified-indexer/grant-marketplace-source.sql",
          import.meta.url
        ),
        "utf8"
      );
      const variables: Record<string, string> = {
        physical_schema: schema,
        read_schema: target,
        market_source_role: role
      };
      await source.query(
        grants.replace(/:"([a-z_]+)"/g, (_match, name: string) => {
          assert.ok(variables[name]);
          return quote(variables[name]!);
        })
      );
      readPool = new pg.Pool({
        connectionString: connection.toString(),
        max: 4
      });
      await closeMarketplaceOwnershipIndexer();
      configureMarketplaceOwnershipIndexer(configuration, {
        pool: readPool,
        now: () => now
      });
      const asset = {
        chain: "base" as const,
        chainId: 8453,
        contractAddress: marketplaceChains.base.contractAddress,
        tokenId
      };
      assert.equal(
        (await readIndexedOpenSeaAsset(local, asset)).owner.toLowerCase(),
        alice
      );
      assert.equal(
        (await marketplaceOwnershipSqlContext(readPool)).mode,
        "unified"
      );
      for (const relation of [
        `${schema}.token`,
        `${schema}.canonical_event`,
        `${target}._unified_read_release`,
        "yunipals_indexer_control.release"
      ]) {
        const permissions:
          | { can_read: boolean; can_write: boolean }
          | undefined = (
          await readPool.query<{ can_read: boolean; can_write: boolean }>(
            `SELECT has_table_privilege(current_user,$1,'SELECT') AS can_read,has_table_privilege(current_user,$1,'INSERT,UPDATE,DELETE,TRUNCATE') AS can_write`,
            [relation]
          )
        ).rows[0];
        assert.equal(permissions?.can_read, true);
        assert.equal(permissions?.can_write, false);
      }
      await assert.rejects(
        readPool.query(`UPDATE ${schema}.token SET owner=owner WHERE false`),
        { code: "42501" }
      );
      await assert.rejects(
        readPool.query(
          `UPDATE ${target}._unified_read_release SET identity=identity WHERE false`
        ),
        { code: "42501" }
      );
    } finally {
      await closeMarketplaceOwnershipIndexer();
      await readPool?.end();
      configureMarketplaceOwnershipIndexer(original, {
        pool: source,
        now: () => now
      });
      await source.query(
        `DROP OWNED BY ${quote(role)};DROP ROLE ${quote(role)}`
      );
    }
  }
);

test(
  "single-connection readers serialize canonical reads and signature cleanup closes owned connections",
  { skip: !enabled, timeout: 15000 },
  async () => {
    const config = {
      mode: "unified" as const,
      databaseUrl: sourceUrl!,
      releaseId: release.id,
      readSchema: `${schema}_read`,
      poolMax: 1
    };
    const shared = await openSharedConsumer(config);
    assert.ok(shared);
    try {
      assert.equal(shared.pool.options.max, 1);
      const snapshots = await Promise.all(
        Array.from({ length: 4 }, () =>
          shared.reader.snapshot(
            "ownership:base",
            { kind: "latest" },
            async (db) => {
              const value = await db.query(
                "SELECT current_setting('transaction_isolation') AS isolation"
              );
              return value.rows[0].isolation;
            }
          )
        )
      );
      assert.deepEqual(snapshots, Array(4).fill("repeatable read"));
      assert.equal(shared.pool.totalCount, 1);
    } finally {
      await shared.pool.end();
    }
    await closeMarketplaceOwnershipIndexer();
    let owned: Pool | undefined;
    const expectedFailure = new Error("signature work failed");
    try {
      await assert.rejects(
        withMarketplaceOwnershipIndexer(config, async () => {
          const selected = marketplaceOwnershipIndexer()!;
          owned = selected.pool;
          assert.equal(owned.options.max, 1);
          const values = await Promise.all(
            Array.from({ length: 4 }, () => selected.status("base"))
          );
          assert.ok(values.every((value) => value.number === 100n));
          assert.equal(owned.totalCount, 1);
          // Exercising the same path signature preflight uses proves the
          // initialized reader does not fall back to legacy ownership tables.
          const asset = {
            chain: "base" as const,
            chainId: 8453 as const,
            contractAddress: marketplaceChains.base.contractAddress,
            tokenId
          };
          const value = await readIndexedOpenSeaAsset(local, asset);
          assert.equal(value.owner.toLowerCase(), alice);
          throw expectedFailure;
        }),
        (error) => error === expectedFailure
      );
      assert.equal(marketplaceOwnershipIndexer(), undefined);
      assert.ok(owned);
      await assert.rejects(owned.query("SELECT 1"), /after calling end/);
    } finally {
      await closeMarketplaceOwnershipIndexer();
      configureMarketplaceOwnershipIndexer(config, {
        pool: source,
        now: () => now
      });
    }
  }
);
