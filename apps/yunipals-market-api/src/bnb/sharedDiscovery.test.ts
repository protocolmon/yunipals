import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import pg from "pg";
import {
  encodeAbiParameters,
  encodeEventTopics,
  type Hex,
  type PublicClient
} from "viem";
import {
  createIndexerReader,
  type IndexerReader
} from "@protopals/yunipals-indexer-server/readers";
import {
  CanonicalCursorInvalidated,
  CanonicalSourceUnavailable
} from "@protopals/yunipals-indexer-server/readers";
import {
  manifestDigest,
  sourceManifestHash
} from "@protopals/yunipals-indexer-server/identity";
import {
  marketplaceChains,
  bnbOfferCurrency,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import {
  createNativeListing,
  seaportOrderHash
} from "@protopals/yunipals-market-core/seaport";
import { seaportEventAbi } from "@protopals/yunipals-market-core/seaportEvents";
import { decodeValidatedPublication } from "@protopals/yunipals-market-core/bnbDiscovery";

import { createBnbTestDatabase } from "@/bnb/fixtures/database";
import { runBnbDiscoveryPass } from "@/bnb/discovery";
import { selectLegacyMarketplaceConsumer } from "@/indexer/consumerRollback";
import { selectSharedMarketplaceConsumer } from "@/indexer/consumerSelection";
import {
  reconstructSharedPublishedComponents,
  runSharedBnbDiscoveryPass,
  sharedBnbDiscoveryConfiguration,
  type SharedBnbCursor,
  type SharedBnbEvent
} from "@/bnb/sharedDiscovery";

const db = createBnbTestDatabase();
const maker = "0x2222222222222222222222222222222222222222";
const now = BigInt(Math.floor(Date.now() / 1000));
const hash = (number: number) =>
  `0x${number.toString(16).padStart(64, "0")}` as Hex;
const releaseId = hash(981);
const abiHash = manifestDigest(seaportEventAbi);
const policy = {
  version: "shared-discovery-test-v1",
  rules: {
    collection: marketplaceChains.bnb.contractAddress,
    offerCurrency: bnbOfferCurrency.address,
    fees: [],
    maxDurationSeconds: 2_592_000n
  }
};
const source = {
  id: "marketplace:bnb:seaport",
  feature: "marketplace",
  chainId: 56,
  contractName: "BnbSeaport",
  address: seaportDeployment.address.toLowerCase(),
  startBlock: "100",
  endBlock: null,
  enabled: true,
  abiHash,
  events: seaportEventAbi.map((event) => event.name),
  receiptRequirement: "full",
  policies: [{ kind: "finalized" }]
} as const;
const publicationAbi = seaportEventAbi.find(
  (item) => item.name === "OrderValidated"
)!;

function publication(
  tokenId: bigint,
  logIndex: number,
  counter = 19n
): SharedBnbEvent {
  const order = createNativeListing({
    seller: maker,
    collection: marketplaceChains.bnb.contractAddress,
    tokenId,
    totalPrice: 1_000_000_000_000_000n,
    startTime: now - 100n,
    endTime: now + 3600n,
    counter,
    salt: tokenId
  });
  const { counter: _counter, ...parameters } = order;
  return {
    id: `shared-bnb-discovery-${tokenId}-${logIndex}`,
    sourceId: source.id,
    chainId: 56,
    address: source.address,
    name: "OrderValidated",
    abiHash,
    args: {},
    blockNumber: "101",
    blockHash: hash(101),
    timestamp: (now - 99n).toString(),
    transactionHash: hash(20_000 + logIndex),
    transactionIndex: 1,
    logIndex,
    topics: encodeEventTopics({
      abi: seaportEventAbi,
      eventName: "OrderValidated"
    }) as readonly Hex[],
    data: encodeAbiParameters(publicationAbi.inputs, [
      seaportOrderHash(order),
      {
        ...parameters,
        totalOriginalConsiderationItems: BigInt(parameters.consideration.length)
      }
    ])
  };
}

function increment(
  logIndex: number,
  newCounter: bigint,
  offerer = maker
): SharedBnbEvent {
  return {
    ...publication(1n, logIndex),
    id: `shared-bnb-counter-${logIndex}`,
    name: "CounterIncremented",
    topics: encodeEventTopics({
      abi: seaportEventAbi,
      eventName: "CounterIncremented",
      args: { offerer: offerer as Hex }
    }) as readonly Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [newCounter])
  };
}

function fixture(events: SharedBnbEvent[]) {
  let unavailable = false;
  let invalidate = false;
  let sideEffect: (() => Promise<void>) | undefined;
  let chainCounter = 19n;
  let pageCalls = 0;
  let indexed = 102;
  const pages: Array<{
    receipts: boolean | undefined;
    cursor: SharedBnbCursor | null | undefined;
  }> = [];
  const block = (number: bigint) => ({
    number,
    hash: hash(Number(number)),
    timestamp: number === 0n ? now - 1000n : now - 100n + number - 100n
  });
  const reader = {
    release: {
      id: releaseId,
      schema: "shared_bnb_fixture",
      buildId: "shared-bnb-fixture",
      manifestHash: hash(982),
      manifest: {
        version: 1,
        ponderVersion: "0.17.5",
        ordering: "multichain",
        coverage: "ponder-live-blocks-v1",
        sources: [source]
      }
    },
    status: async () => {
      if (unavailable) throw new CanonicalSourceUnavailable("fixture outage");
      return {
        source,
        readiness: { reason: "ready", availableThroughBlock: BigInt(indexed) },
        anchor: { number: indexed.toString(), hash: hash(indexed) }
      };
    },
    page: async (
      _id: string,
      _policy: unknown,
      options: {
        cursor?: SharedBnbCursor | null;
        limit?: number;
        includeReceipts?: boolean;
      }
    ) => {
      pageCalls++;
      pages.push({ cursor: options.cursor, receipts: options.includeReceipts });
      if (unavailable) throw new CanonicalSourceUnavailable("fixture outage");
      if (invalidate) {
        invalidate = false;
        throw new CanonicalCursorInvalidated("fixture branch replaced");
      }
      const cursor = options.cursor!;
      const target = cursor.target ?? { number: "102", hash: hash(102) };
      const from = cursor.completed
        ? BigInt(cursor.completed.number) + 1n
        : 100n;
      const eligible = events.filter(
        (event) =>
          BigInt(event.blockNumber) >= from &&
          BigInt(event.blockNumber) <= BigInt(target.number) &&
          (!cursor.after || event.logIndex > cursor.after.logIndex)
      );
      const selected = eligible.slice(0, options.limit ?? 250);
      const complete = selected.length === eligible.length;
      const last = selected.at(-1);
      const next: SharedBnbCursor = complete
        ? { ...cursor, completed: target, target: null, after: null }
        : {
            ...cursor,
            target,
            after: last
              ? {
                  id: last.id,
                  blockNumber: last.blockNumber,
                  blockHash: last.blockHash,
                  transactionIndex: last.transactionIndex,
                  logIndex: last.logIndex
                }
              : cursor.after
          };
      await sideEffect?.();
      sideEffect = undefined;
      return {
        events: selected,
        receipts: [],
        cursor: next,
        complete,
        waitingReceipt: false
      };
    }
  } as unknown as IndexerReader;
  let code: Hex;
  const stateClient = {
    getChainId: async () => 56,
    getBlock: async ({
      blockTag,
      blockNumber
    }: {
      blockTag?: string;
      blockNumber?: bigint;
    }) =>
      blockTag === "latest"
        ? { ...block(107n), timestamp: now }
        : block(blockTag === "finalized" ? 102n : blockNumber!),
    getCode: async () => code,
    readContract: async ({
      functionName,
      blockNumber
    }: {
      functionName: string;
      blockNumber: bigint;
    }) => {
      if (functionName === "getCounter")
        return blockNumber >= 101n ? chainCounter : 19n;
      if (functionName === "getOrderStatus") return [true, false, 0n, 0n];
      throw new Error("Unexpected shared discovery contract read.");
    },
    getLogs: async () => {
      throw new Error("Shared discovery must never scan RPC logs.");
    }
  } as unknown as PublicClient;
  const options = {
    pool: db.runtime,
    reader,
    stateClient,
    policy,
    launchBlock: 100n
  };
  return {
    reader,
    options,
    pages,
    pageCalls: () => pageCalls,
    indexed: (number: number) => {
      indexed = number;
    },
    fail: (value: boolean) => {
      unavailable = value;
    },
    reorg: () => {
      invalidate = true;
    },
    counter: (value: bigint) => {
      chainCounter = value;
    },
    sideEffect: (effect: () => Promise<void>) => {
      sideEffect = effect;
    },
    initialize: async (boundReader: IndexerReader = reader) => {
      code = (
        JSON.parse(
          await readFile(
            new URL("./fixtures/seaport-bnb-bytecode.json", import.meta.url),
            "utf8"
          )
        ) as { code: Hex }
      ).code;
      await db.owner.query("DELETE FROM yunipals_market.bnb_discovered_order");
      await db.owner.query("DELETE FROM yunipals_market.bnb_discovery_cursor");
      await db.owner.query(
        "DELETE FROM yunipals_market.shared_indexer_consumer WHERE consumer='bnb-discovery'"
      );
      const configuration = sharedBnbDiscoveryConfiguration(
        boundReader,
        policy,
        100n
      );
      await db.owner.query(
        `INSERT INTO yunipals_market.bnb_discovery_cursor
        (singleton,launch_block,next_block,policy_fingerprint,reader_mode) VALUES(true,100,100,$1,'unified')`,
        [configuration.policyFingerprint]
      );
      await db.owner.query(
        `INSERT INTO yunipals_market.shared_indexer_consumer
        (consumer,chain_id,release_id,source_id,confirmation_policy,configuration_hash)
        VALUES($1,56,$2,$3,$4::jsonb,$5)`,
        [
          configuration.consumer,
          boundReader.release.id,
          configuration.sourceId,
          JSON.stringify(configuration.confirmationPolicy),
          configuration.configurationHash
        ]
      );
      // Binding is covered by the dedicated ownership tests; this fixture leaves
      // it pending without making an external or legacy ownership scan.
      await db.owner.query(
        "UPDATE bnb_indexer.sync_state SET caught_up_at=NULL WHERE singleton"
      );
    }
  };
}

before(async () => {
  await db.initialize();
  await db.owner
    .query(`GRANT SELECT ON yunipals_market.shared_indexer_consumer TO market_test_runtime;
    GRANT UPDATE(cursor,generation,updated_at) ON yunipals_market.shared_indexer_consumer TO market_test_runtime`);
});
after(async () => {
  await db.owner.query("DELETE FROM yunipals_market.bnb_discovered_order");
  await db.owner.query("DELETE FROM yunipals_market.bnb_discovery_cursor");
  await db.owner.query(
    "DELETE FROM yunipals_market.shared_indexer_consumer WHERE consumer='bnb-discovery'"
  );
  await db.close();
});

test("shared BNB source registration pins the decoder, launch and financial policy", () => {
  const test = fixture([]);
  const registered = sharedBnbDiscoveryConfiguration(test.reader, policy, 100n);
  assert.equal(registered.sourceId, source.id);
  assert.notEqual(
    registered.configurationHash,
    sharedBnbDiscoveryConfiguration(
      test.reader,
      { ...policy, version: "changed-policy" },
      100n
    ).configurationHash
  );
  assert.throws(
    () => sharedBnbDiscoveryConfiguration(test.reader, policy, 99n),
    /decoder or launch/
  );
  const altered = {
    ...test.reader,
    release: {
      ...test.reader.release,
      manifest: {
        ...test.reader.release.manifest,
        sources: [{ ...source, abiHash: hash(55) }]
      }
    }
  } as IndexerReader;
  assert.throws(
    () => sharedBnbDiscoveryConfiguration(altered, policy, 100n),
    /decoder or launch/
  );
});

test("shared BNB discovery pages into the existing preview feed without RPC logs and resumes exactly", async () => {
  const tokenId = db.nextTokenId();
  const test = fixture([publication(tokenId, 1), publication(tokenId + 1n, 2)]);
  await test.initialize();
  const partial = await runSharedBnbDiscoveryPass({
    ...test.options,
    maxPages: 1,
    pageSize: 1
  });
  assert.equal(partial.scanned, 1);
  assert.equal(partial.lagBlocks, "3");
  let rows = await db.owner.query(
    "SELECT * FROM yunipals_market.bnb_discovered_order ORDER BY publication_log_index"
  );
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0].published_counter, "19");
  assert.equal(rows.rows[0].publication_transaction_index, 1);
  const checkpoint = await db.owner.query(
    "SELECT mode,reader_mode,next_block::text FROM yunipals_market.bnb_discovery_cursor"
  );
  assert.deepEqual(checkpoint.rows[0], {
    mode: "preview",
    reader_mode: "unified",
    next_block: "100"
  });
  const completed = await runSharedBnbDiscoveryPass({
    ...test.options,
    maxPages: 1,
    pageSize: 1
  });
  assert.equal(completed.lagBlocks, "0");
  rows = await db.owner.query(
    "SELECT * FROM yunipals_market.bnb_discovered_order"
  );
  assert.equal(rows.rowCount, 2);
  assert.equal(
    rows.rows.every((row) => row.state === "active"),
    true
  );
  assert.equal(
    test.pages.every((page) => page.receipts === false),
    true
  );
  await db.owner.query(
    "UPDATE yunipals_market.bnb_discovery_cursor SET mode='live'"
  );
  await runSharedBnbDiscoveryPass(test.options);
  assert.equal(
    (
      await db.owner.query(
        "SELECT mode FROM yunipals_market.bnb_discovery_cursor"
      )
    ).rows[0].mode,
    "live"
  );
});

test("shared discovery reconstructs a publication before a later same-block counter increment", async () => {
  const test = fixture([publication(db.nextTokenId(), 1), increment(2, 20n)]);
  await test.initialize();
  test.counter(20n);
  await runSharedBnbDiscoveryPass({ ...test.options, pageSize: 1 });
  const rows = await db.owner.query(
    "SELECT published_counter,state FROM yunipals_market.bnb_discovered_order"
  );
  assert.equal(rows.rows[0].published_counter, "19");
  assert.equal(rows.rows[0].state, "counter-changed");
  assert.ok(
    test.pageCalls() > 2,
    "the counter fallback must page indexed events in the publication block"
  );
});

test("counter reconstruction applies only preceding increments by the same maker", async () => {
  const event = publication(27n, 3, 20n);
  const parsed = decodeValidatedPublication({
    topics: event.topics as readonly Hex[],
    data: event.data as Hex
  });
  const client = {
    readContract: async ({ blockNumber }: { blockNumber: bigint }) =>
      blockNumber === 101n ? 21n : 19n
  } as unknown as PublicClient;
  const result = await reconstructSharedPublishedComponents(
    parsed,
    event,
    client,
    async () => [
      increment(1, 20n),
      increment(2, 999n, "0x3333333333333333333333333333333333333333"),
      increment(4, 21n)
    ]
  );
  assert.equal(result.counter, 20n);
  await assert.rejects(
    reconstructSharedPublishedComponents(parsed, event, client, async () => []),
    /does not match/
  );
});

test("source outage retains the cursor and derived rows while marking coverage unavailable", async () => {
  const test = fixture([publication(db.nextTokenId(), 1)]);
  await test.initialize();
  await runSharedBnbDiscoveryPass(test.options);
  const before = (
    await db.owner.query(
      "SELECT cursor,generation::text FROM yunipals_market.shared_indexer_consumer WHERE consumer='bnb-discovery'"
    )
  ).rows[0];
  test.fail(true);
  await assert.rejects(
    runSharedBnbDiscoveryPass(test.options),
    /fixture outage/
  );
  const after = (
    await db.owner.query(
      "SELECT cursor,generation::text FROM yunipals_market.shared_indexer_consumer WHERE consumer='bnb-discovery'"
    )
  ).rows[0];
  assert.deepEqual(after, before);
  assert.equal(
    (
      await db.owner.query(
        "SELECT count(*)::int AS count FROM yunipals_market.bnb_discovered_order"
      )
    ).rows[0].count,
    1
  );
  assert.equal(
    (
      await db.owner.query(
        "SELECT last_error_code FROM yunipals_market.bnb_discovery_cursor"
      )
    ).rows[0].last_error_code,
    "discovery_pass_failed"
  );
  test.fail(false);
  await runSharedBnbDiscoveryPass(test.options);
  assert.equal(
    (
      await db.owner.query(
        "SELECT last_error_code FROM yunipals_market.bnb_discovery_cursor"
      )
    ).rows[0].last_error_code,
    null
  );
});

test("shared source rollback cannot refresh already-applied discovery coverage", async () => {
  const test = fixture([publication(db.nextTokenId(), 1)]);
  await test.initialize();
  await runSharedBnbDiscoveryPass(test.options);
  const before = (
    await db.owner.query(
      "SELECT cursor,generation::text FROM yunipals_market.shared_indexer_consumer WHERE consumer='bnb-discovery'"
    )
  ).rows[0];
  test.indexed(101);
  await assert.rejects(
    runSharedBnbDiscoveryPass(test.options),
    /recovering previously applied coverage/
  );
  assert.deepEqual(
    (
      await db.owner.query(
        "SELECT cursor,generation::text FROM yunipals_market.shared_indexer_consumer WHERE consumer='bnb-discovery'"
      )
    ).rows[0],
    before
  );
  assert.equal(
    (
      await db.owner.query(
        "SELECT last_error_code FROM yunipals_market.bnb_discovery_cursor"
      )
    ).rows[0].last_error_code,
    "discovery_pass_failed"
  );
});

test("canonical invalidation rebuilds the derived feed and preserves live selection", async () => {
  const events = [publication(db.nextTokenId(), 1)];
  const test = fixture(events);
  await test.initialize();
  await runSharedBnbDiscoveryPass(test.options);
  await db.owner.query(
    "UPDATE yunipals_market.bnb_discovery_cursor SET mode='live'"
  );
  events.splice(0, 1, publication(db.nextTokenId(), 3));
  test.reorg();
  await runSharedBnbDiscoveryPass(test.options);
  const rows = await db.owner.query(
    "SELECT publication_log_index FROM yunipals_market.bnb_discovered_order"
  );
  assert.deepEqual(rows.rows, [{ publication_log_index: 3 }]);
  assert.equal(
    (
      await db.owner.query(
        "SELECT mode FROM yunipals_market.bnb_discovery_cursor"
      )
    ).rows[0].mode,
    "live"
  );
});

test("configuration mismatch and competing cursor CAS cannot advance discovery", async () => {
  const test = fixture([publication(db.nextTokenId(), 1)]);
  await test.initialize();
  await assert.rejects(
    runSharedBnbDiscoveryPass({
      ...test.options,
      policy: { ...policy, version: "mismatched-worker-policy" }
    }),
    /registration differs/
  );
  assert.equal(test.pageCalls(), 0);
  await test.initialize();
  test.sideEffect(async () => {
    await db.owner.query(
      "UPDATE yunipals_market.shared_indexer_consumer SET generation=generation+1 WHERE consumer='bnb-discovery'"
    );
  });
  await assert.rejects(
    runSharedBnbDiscoveryPass(test.options),
    /changed concurrently/
  );
  assert.equal(
    (
      await db.owner.query(
        "SELECT count(*)::int AS count FROM yunipals_market.bnb_discovered_order"
      )
    ).rows[0].count,
    0
  );
  assert.equal(
    (
      await db.owner.query(
        "SELECT next_block::text FROM yunipals_market.bnb_discovery_cursor"
      )
    ).rows[0].next_block,
    "100"
  );
});

test("legacy scanner is fenced before RPC and shared consumer is fenced in legacy mode", async () => {
  const test = fixture([]);
  await test.initialize();
  const noRpc = new Proxy(
    {},
    {
      get: () => {
        throw new Error("Unexpected RPC");
      }
    }
  ) as PublicClient;
  await assert.rejects(
    runBnbDiscoveryPass({
      pool: db.runtime,
      logClient: noRpc,
      stateClient: noRpc,
      policy,
      launchBlock: 100n
    }),
    /disabled in unified mode/
  );
  await db.owner.query(
    "UPDATE yunipals_market.bnb_discovery_cursor SET reader_mode='legacy'"
  );
  await assert.rejects(runSharedBnbDiscoveryPass(test.options), /not selected/);
  assert.equal(test.pageCalls(), 0);
});

test("reviewed discovery rollback clears the feed, preserves live mode and rebuilds before returning to unified", async () => {
  const event = publication(db.nextTokenId(), 1);
  const f = fixture([event]);
  await f.initialize();
  try {
    await runSharedBnbDiscoveryPass(f.options);
    await db.owner.query(
      "UPDATE yunipals_market.bnb_discovery_cursor SET mode='live'"
    );
    const config = {
      kind: "bnb-discovery",
      policy,
      launchBlock: 100n
    } as const;
    await assert.rejects(
      selectLegacyMarketplaceConsumer(db.owner, {
        ...config,
        launchBlock: 99n
      }),
      /launch block/
    );
    const review = await selectLegacyMarketplaceConsumer(db.owner, config);
    await selectLegacyMarketplaceConsumer(db.owner, config, review.reviewHash);
    const reset = (
      await db.owner.query(
        "SELECT reader_mode,mode,target_block,scanned_block_hash,updated_at FROM yunipals_market.bnb_discovery_cursor"
      )
    ).rows[0];
    assert.equal(reset.reader_mode, "legacy");
    assert.equal(reset.mode, "live");
    assert.equal(reset.target_block, null);
    assert.equal(reset.scanned_block_hash, null);
    assert.equal(reset.updated_at.getTime(), 0);
    assert.equal(
      (
        await db.owner.query(
          "SELECT count(*) FROM yunipals_market.bnb_discovered_order"
        )
      ).rows[0].count,
      "0"
    );
    await assert.rejects(runSharedBnbDiscoveryPass(f.options), /not selected/);
    const noRpc = new Proxy(
      {},
      {
        get: () => {
          throw new Error("Unexpected RPC");
        }
      }
    ) as PublicClient;
    await assert.rejects(
      runBnbDiscoveryPass({
        pool: db.runtime,
        stateClient: noRpc,
        logClient: noRpc,
        policy: { ...policy, version: "changed-policy" },
        launchBlock: 100n
      }),
      /selection differs/
    );
    let boundaryReads = 0;
    const logs = {
      ...f.options.stateClient,
      getBlock: async (args: Parameters<PublicClient["getBlock"]>[0]) => {
        if (args?.blockNumber === 0n) boundaryReads++;
        return f.options.stateClient.getBlock(args);
      },
      getLogs: async () => [
        { ...event, blockNumber: BigInt(event.blockNumber), removed: false }
      ]
    } as unknown as PublicClient;
    await runBnbDiscoveryPass({
      pool: db.runtime,
      stateClient: f.options.stateClient,
      logClient: logs,
      policy,
      launchBlock: 100n
    });
    assert.ok(
      boundaryReads > 0,
      "The stale reset timestamp forces the rolling-window calculation."
    );
    assert.equal(
      (
        await db.owner.query(
          "SELECT count(*) FROM yunipals_market.bnb_discovered_order"
        )
      ).rows[0].count,
      "1"
    );
    const forward = await selectSharedMarketplaceConsumer(
      db.owner,
      f.reader,
      config
    );
    await selectSharedMarketplaceConsumer(
      db.owner,
      f.reader,
      config,
      forward.reviewHash
    );
    assert.equal(
      (
        await db.owner.query(
          "SELECT count(*) FROM yunipals_market.marketplace_legacy_selection WHERE consumer='bnb-discovery'"
        )
      ).rows[0].count,
      "0"
    );
    assert.equal(
      (
        await db.owner.query(
          "SELECT count(*) FROM yunipals_market.bnb_discovered_order"
        )
      ).rows[0].count,
      "0"
    );
    await runSharedBnbDiscoveryPass(f.options);
    assert.equal(
      (
        await db.owner.query(
          "SELECT count(*) FROM yunipals_market.bnb_discovered_order"
        )
      ).rows[0].count,
      "1"
    );
    assert.equal(
      (
        await db.owner.query(
          "SELECT reader_mode,mode FROM yunipals_market.bnb_discovery_cursor"
        )
      ).rows[0].mode,
      "live"
    );
  } finally {
    await db.owner.query(
      "DELETE FROM yunipals_market.legacy_sale_receipt_qualification WHERE consumer='bnb-discovery'"
    );
    await db.owner.query(
      "DELETE FROM yunipals_market.marketplace_legacy_selection WHERE consumer='bnb-discovery'"
    );
  }
});

test("actual shared canonical pager applies and invalidates the discovery event cursor", async (t) => {
  const connectionString = process.env.PONDER_UNIFIED_TEST_DATABASE_URL;
  if (!connectionString)
    return t.skip(
      "Set PONDER_UNIFIED_TEST_DATABASE_URL for the real shared pager integration."
    );
  const url = new URL(connectionString);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.equal(url.pathname, "/yunipals_ponder_dependency_test");
  assert.equal(url.search, "");
  const sourcePool = new pg.Pool({
    connectionString,
    max: 4,
    statement_timeout: 5000
  });
  const schema = "shared_bnb_discovery_native_test";
  const buildId = "shared-bnb-discovery-native-test";
  const manifest: IndexerReader["release"]["manifest"] = {
    version: 1,
    ponderVersion: "0.17.5",
    ordering: "multichain",
    coverage: "ponder-live-blocks-v1",
    sources: [source]
  };
  const manifestHash = sourceManifestHash(manifest);
  const id = manifestDigest({ schema, buildId, manifestHash });
  const events = [
    publication(db.nextTokenId(), 1),
    publication(db.nextTokenId(), 2)
  ];
  try {
    assert.ok(
      (
        await sourcePool.query(
          "SELECT to_regclass('dependency_check.canonical_event') AS relation"
        )
      ).rows[0]?.relation,
      "The real patched Ponder schema must exist in the disposable source database."
    );
    await sourcePool.query(
      `DELETE FROM yunipals_indexer_control.chain_status WHERE release_id=$1`,
      [id]
    );
    await sourcePool.query(
      `DELETE FROM yunipals_indexer_control.chain_anchor WHERE release_id=$1`,
      [id]
    );
    await sourcePool.query(
      `DELETE FROM yunipals_indexer_control.release WHERE id=$1`,
      [id]
    );
    await sourcePool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await sourcePool.query(`CREATE SCHEMA ${schema}`);
    for (const table of [
      "_ponder_meta",
      "_ponder_checkpoint",
      "indexer_source",
      "canonical_event",
      "transaction_candidate",
      "chain_checkpoint",
      "chain_block"
    ])
      await sourcePool.query(
        `CREATE TABLE ${schema}.${table} (LIKE dependency_check.${table} INCLUDING ALL)`
      );
    await sourcePool.query(
      `INSERT INTO ${schema}._ponder_meta VALUES('app',$1)`,
      [
        JSON.stringify({
          version: "6",
          build_id: buildId,
          heartbeat_at: Date.now(),
          is_ready: 1,
          is_locked: 1,
          is_dev: 0
        })
      ]
    );
    const checkpoint = `0000001000${"56".padStart(16, "0")}${"102".padStart(16, "0")}${"9".repeat(33)}`;
    await sourcePool.query(
      `INSERT INTO ${schema}._ponder_checkpoint VALUES('bnb',56,$1,$1,$1)`,
      [checkpoint]
    );
    await sourcePool.query(
      `INSERT INTO ${schema}.indexer_source VALUES($1,56,$2,$3)`,
      [source.id, manifestHash, JSON.stringify(source)]
    );
    await sourcePool.query(
      `INSERT INTO ${schema}.chain_checkpoint VALUES('56',56,102,$1,$2,$3)`,
      [hash(102), hash(101), now.toString()]
    );
    for (let number = 99; number <= 102; number++)
      await sourcePool.query(
        `INSERT INTO ${schema}.chain_block VALUES($1,56,$2,$3,$4,$5)`,
        [
          `56:${number}`,
          number,
          hash(number),
          hash(number - 1),
          (now - 100n + BigInt(number) - 100n).toString()
        ]
      );
    await sourcePool.query(
      `INSERT INTO yunipals_indexer_control.release
      (id,physical_schema,build_id,manifest_hash,manifest) VALUES($1,$2,$3,$4,$5)`,
      [id, schema, buildId, manifestHash, JSON.stringify(manifest)]
    );
    await sourcePool.query(
      `INSERT INTO yunipals_indexer_control.chain_status
      (release_id,chain_id,revision,head_number,head_hash,head_timestamp,finalized_number,finalized_hash,
       witness_number,witness_hash,observed_at_ms,provider_id,anchors,error_code,finality_error_code)
      VALUES($1,56,1,102,$2,$3,102,$2,102,$2,$4,'local-shared-bnb-discovery-test',$5,NULL,NULL)`,
      [
        id,
        hash(102),
        now.toString(),
        Date.now().toString(),
        JSON.stringify({
          "102": { number: "102", hash: hash(102), timestamp: now.toString() }
        })
      ]
    );
    const insertEvent = async (event: SharedBnbEvent) => {
      await sourcePool.query(
        `INSERT INTO ${schema}.canonical_event
        (id,source_id,chain_id,address,name,args,abi_hash,block_number,block_hash,timestamp,
         transaction_hash,transaction_index,log_index,topics,data)
        VALUES($1,$2,56,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          event.id,
          event.sourceId,
          event.address,
          event.name,
          JSON.stringify(event.args),
          event.abiHash,
          event.blockNumber,
          event.blockHash,
          event.timestamp,
          event.transactionHash,
          event.transactionIndex,
          event.logIndex,
          JSON.stringify(event.topics),
          event.data
        ]
      );
    };
    for (const event of events) await insertEvent(event);
    const reader = await createIndexerReader(sourcePool, { releaseId: id });
    const test = fixture(events);
    await test.initialize(reader);
    const options = { ...test.options, reader, pageSize: 1, maxPages: 1 };
    await runSharedBnbDiscoveryPass(options);
    assert.equal(
      (
        await db.owner.query(
          "SELECT count(*)::int AS count FROM yunipals_market.bnb_discovered_order"
        )
      ).rows[0].count,
      1
    );
    const checkpointRow = (
      await db.owner.query(
        "SELECT cursor FROM yunipals_market.shared_indexer_consumer WHERE consumer='bnb-discovery'"
      )
    ).rows[0];
    assert.equal(checkpointRow.cursor.after.id, events[0]!.id);
    // A rollback removes a previously applied event. The real pager rejects its
    // saved position, so the consumer must rebuild before claiming coverage.
    await sourcePool.query(
      `DELETE FROM ${schema}.canonical_event WHERE id=$1`,
      [events[0]!.id]
    );
    const replacement = publication(db.nextTokenId(), 3);
    await insertEvent(replacement);
    await runSharedBnbDiscoveryPass({ ...options, maxPages: 4 });
    const rows = await db.owner.query(
      "SELECT publication_log_index FROM yunipals_market.bnb_discovered_order ORDER BY publication_log_index"
    );
    assert.deepEqual(rows.rows, [
      { publication_log_index: 2 },
      { publication_log_index: 3 }
    ]);
    const status = (
      await db.owner.query(
        "SELECT next_block::text,last_error_code FROM yunipals_market.bnb_discovery_cursor"
      )
    ).rows[0];
    assert.deepEqual(status, { next_block: "103", last_error_code: null });
    await sourcePool.query(
      "UPDATE yunipals_indexer_control.chain_status SET error_code='rpc_unavailable' WHERE release_id=$1 AND chain_id=56",
      [id]
    );
    await assert.rejects(
      runSharedBnbDiscoveryPass(options),
      /source is unavailable/
    );
  } finally {
    await sourcePool.query(
      "DELETE FROM yunipals_indexer_control.chain_status WHERE release_id=$1",
      [id]
    );
    await sourcePool.query(
      "DELETE FROM yunipals_indexer_control.chain_anchor WHERE release_id=$1",
      [id]
    );
    await sourcePool.query(
      "DELETE FROM yunipals_indexer_control.release WHERE id=$1",
      [id]
    );
    await sourcePool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await sourcePool.end();
  }
});
