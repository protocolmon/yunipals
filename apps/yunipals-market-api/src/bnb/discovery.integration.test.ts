import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  type Hex,
  type PublicClient
} from "viem";
import { marketplaceChains, seaportDeployment } from "@protopals/yunipals-market-core/registry";
import { createNativeListing, seaportOrderHash } from "@protopals/yunipals-market-core/seaport";
import { parseMarketOrder } from "@protopals/yunipals-market-core/marketOrder";
import { seaportEventAbi } from "@protopals/yunipals-market-core/seaportEvents";

import { createApp } from "@/app";
import { runBnbDiscoveryPass } from "@/bnb/discovery";
import { BnbRecoveryService } from "@/bnb/recovery";
import { loadBnbTradeOrder } from "@/bnb/storedOrder";
import { createBnbTestDatabase, testUrl } from "@/bnb/fixtures/database";
import { readEnvironment } from "@/environment";
import { BnbDiscoveryReadService } from "@/reads/bnbDiscovery";
import { OrderReadService } from "@/reads/orders";

const db = createBnbTestDatabase();
before(db.initialize);
after(async () => {
  await db.owner.query("DELETE FROM yunipals_market.bnb_discovered_order");
  await db.owner.query("DELETE FROM yunipals_market.bnb_discovery_cursor");
  await db.close();
});

test("rebuilds the public order feed and serves repeated reads without RPC", async () => {
  await db.owner.query("DELETE FROM yunipals_market.bnb_discovered_order");
  await db.owner.query("DELETE FROM yunipals_market.bnb_discovery_cursor");
  const tokenId = db.nextTokenId().toString();
  const maker = "0x2222222222222222222222222222222222222222";
  const now = BigInt(Math.floor(Date.now() / 1000));
  const order = createNativeListing({
    seller: maker,
    collection: marketplaceChains.bnb.contractAddress,
    tokenId: BigInt(tokenId),
    totalPrice: 1_000_000_000_000_000n,
    startTime: now - 100n,
    endTime: now + 3600n,
    counter: 19n,
    salt: 777n
  });
  const { counter: _counter, ...parameters } = order;
  const publication = {
    ...parameters,
    totalOriginalConsiderationItems: BigInt(parameters.consideration.length)
  };
  const hash = seaportOrderHash(order);
  const secondOrder = createNativeListing({
    seller: maker,
    collection: marketplaceChains.bnb.contractAddress,
    tokenId: BigInt(tokenId) + 1n,
    totalPrice: 2_000_000_000_000_000n,
    startTime: now - 100n,
    endTime: now + 3600n,
    counter: 19n,
    salt: 778n
  });
  const { counter: _secondCounter, ...secondParameters } = secondOrder;
  const secondHash = seaportOrderHash(secondOrder);
  const event = seaportEventAbi.find(
    (item) => item.type === "event" && item.name === "OrderValidated"
  );
  assert.ok(event && event.type === "event");
  const blockHash = (number: bigint) =>
    `0x${number.toString(16).padStart(64, "0")}` as Hex;
  const transactionHash = `0x${"ab".repeat(32)}` as Hex;
  let finalHash = blockHash(102n);
  let logCalls = 0;
  let stateCalls = 0;
  const block = (number: bigint) => ({
    number,
    hash: number === 102n ? finalHash : blockHash(number),
    timestamp: number === 0n ? now - 1000n : now - 100n + number - 100n
  });
  const log = {
    address: seaportDeployment.address,
    topics: encodeEventTopics({
      abi: seaportEventAbi,
      eventName: "OrderValidated"
    }),
    data: encodeAbiParameters(event.inputs, [hash, publication]),
    blockNumber: 101n,
    blockHash: blockHash(101n),
    transactionHash,
    transactionIndex: 0,
    logIndex: 0
  };
  const secondLog = {
    ...log,
    data: encodeAbiParameters(event.inputs, [
      secondHash,
      {
        ...secondParameters,
        totalOriginalConsiderationItems: BigInt(secondParameters.consideration.length)
      }
    ]),
    logIndex: 1
  };
  const bytecode = JSON.parse(
    await readFile(
      new URL("./fixtures/seaport-bnb-bytecode.json", import.meta.url),
      "utf8"
    )
  ) as { code: Hex };
  const logClient = {
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
      logCalls++;
      return block(blockNumber);
    },
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      logCalls++;
      return fromBlock <= 101n && 101n <= toBlock ? [log, secondLog] : [];
    }
  } as unknown as PublicClient;
  const stateClient = {
    getChainId: async () => {
      stateCalls++;
      return 56;
    },
    getBlock: async ({ blockTag, blockNumber }: { blockTag?: string; blockNumber?: bigint }) => {
      stateCalls++;
      return block(blockTag === "finalized" ? 102n : blockNumber!);
    },
    getCode: async () => {
      stateCalls++;
      return bytecode.code;
    },
    readContract: async ({ functionName }: { functionName: string }) => {
      stateCalls++;
      if (functionName === "getCounter") return 19n;
      if (functionName === "getOrderStatus") return [true, false, 0n, 0n];
      throw new Error("Unexpected contract read.");
    }
  } as unknown as PublicClient;
  const options = {
    pool: db.runtime,
    logClient,
    stateClient,
    launchBlock: 100n,
    maxRange: 100n,
    policy: {
      version: "test-v1",
      rules: {
        collection: marketplaceChains.bnb.contractAddress,
        offerCurrency: "0xBB4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
        fees: [],
        maxDurationSeconds: 2_592_000n
      }
    }
  } as Parameters<typeof runBnbDiscoveryPass>[0];
  await db.owner.query(
    `INSERT INTO yunipals_read_v4.token(collection,chain_id,contract_address,token_id,owner,lifecycle,burned)
     VALUES('bnb',56,$1,$2,$3,0,false)`,
    [marketplaceChains.bnb.contractAddress.toLowerCase(), tokenId, maker.toLowerCase()]
  );
  await db.owner.query(
    `INSERT INTO yunipals_read_v4.token(collection,chain_id,contract_address,token_id,owner,lifecycle,burned)
     VALUES('bnb',56,$1,$2,$3,0,false)`,
    [marketplaceChains.bnb.contractAddress.toLowerCase(), (BigInt(tokenId) + 1n).toString(), maker.toLowerCase()]
  );
  for (const id of [tokenId, (BigInt(tokenId) + 1n).toString()])
    await db.owner.query(
      `INSERT INTO yunipals_read_v4.transfer_event
       (id,collection,token_id,lifecycle,"from","to",block_number,transaction_index,log_index)
       VALUES($1,'bnb',$2,0,$3,$4,100,0,0)`,
      [
        `discovery-${id}`,
        id,
        "0x0000000000000000000000000000000000000000",
        maker.toLowerCase()
      ]
    );
  await db.owner.query(
    `UPDATE bnb_indexer.sync_state SET last_scanned_block=102,
     last_scanned_hash=$1,caught_up_at=clock_timestamp(),updated_at=clock_timestamp()`,
    [finalHash]
  );
  try {
    const first = await runBnbDiscoveryPass(options);
    assert.equal(first.locked, true);
    assert.equal(first.scanned, 1);
    assert.equal(first.observed, 2);
    assert.equal(first.bound, 2);
    assert.equal(first.lagBlocks, "0");
    assert.equal(first.unbound, 0);
    assert.equal(first.staleActive, 0);
    const service = new BnbDiscoveryReadService(db.runtime);
    const params = new URLSearchParams({ tokenId });
    const view = await service.list(params);
    assert.equal(view.coverage, "complete");
    assert.equal(view.orders.length, 1);
    assert.equal(view.orders[0]?.orderHash, hash.toLowerCase());
    assert.equal(view.orders[0]?.protocolStatus, "active");
    assert.equal(view.orders[0]?.publishedCounter, "19");
    assert.equal(view.orders[0]?.currentAsset.owner, maker.toLowerCase());
    const normalReads = new OrderReadService(db.runtime);
    const assetId = {
      chain: "bnb" as const,
      chainId: 56 as const,
      contractAddress: marketplaceChains.bnb.contractAddress,
      tokenId
    };
    const preview = await normalReads.asset(assetId);
    assert.equal(preview.listings.length, 0);
    await db.owner.query(
      "UPDATE yunipals_market.bnb_discovery_cursor SET mode='live' WHERE singleton"
    );
    const live = await normalReads.asset(assetId);
    assert.equal(live.sourceStatus, "available");
    assert.equal(live.listings.length, 1);
    assert.equal(live.listings[0]?.orderHash.toLowerCase(), hash.toLowerCase());
    const wallet = await normalReads.wallet(
      maker,
      new URLSearchParams({ view: "listings", chain: "bnb" })
    );
    assert.ok(wallet.items.some(
      (item) => parseMarketOrder(item.order).orderHash.toLowerCase() === hash.toLowerCase()
    ));
    await db.owner.query(
      "UPDATE yunipals_read_v4.token SET lifecycle=1 WHERE collection='bnb' AND token_id=$1",
      [tokenId]
    );
    assert.equal((await normalReads.asset(assetId)).listings.length, 0);
    await db.owner.query(
      "UPDATE yunipals_read_v4.token SET lifecycle=0 WHERE collection='bnb' AND token_id=$1",
      [tokenId]
    );
    const executable = await loadBnbTradeOrder(db.runtime, hash);
    assert.equal(executable.signature, "0x");
    assert.equal(executable.hash.toLowerCase(), hash.toLowerCase());
    const cancellation = await new BnbRecoveryService(db.runtime).cancellation(
      hash,
      { actor: maker }
    );
    assert.equal(cancellation.orderHash.toLowerCase(), hash.toLowerCase());
    const accepted = await new BnbRecoveryService(db.runtime).accepted(hash);
    assert.equal(accepted.order.orderHash.toLowerCase(), hash.toLowerCase());
    await db.owner.query(
      `UPDATE yunipals_market.bnb_discovered_order
       SET state_observed_at=clock_timestamp()-interval '20 minutes'
       WHERE order_hash=$1`,
      [hash.toLowerCase()]
    );
    assert.equal((await service.list(params)).coverage, "partial");
    assert.equal((await normalReads.asset(assetId)).sourceStatus, "syncing");
    await db.owner.query(
      `UPDATE yunipals_market.bnb_discovered_order
       SET state_observed_at=clock_timestamp() WHERE order_hash=$1`,
      [hash.toLowerCase()]
    );
    await db.owner.query(
      "UPDATE yunipals_market.bnb_discovery_cursor SET mode='preview' WHERE singleton"
    );
    const firstPage = await service.list(new URLSearchParams({ limit: "1" }));
    assert.equal(firstPage.orders[0]?.orderHash, secondHash.toLowerCase());
    assert.ok(firstPage.nextCursor);
    const secondPage = await service.list(
      new URLSearchParams({ limit: "1", cursor: firstPage.nextCursor })
    );
    assert.equal(secondPage.orders[0]?.orderHash, hash.toLowerCase());
    assert.equal(secondPage.nextCursor, null);
    await assert.rejects(
      service.list(new URLSearchParams({ cursor: "invalid" })),
      /invalid_discovery_query/
    );
    const calls = logCalls + stateCalls;
    assert.equal((await service.list(params)).orders[0]?.orderHash, view.orders[0]?.orderHash);
    assert.equal(logCalls + stateCalls, calls);
    const app = createApp(
      readEnvironment({
        MARKET_DEPLOYMENT: "staging",
        MARKET_DATABASE_URL: testUrl("MARKET_TEST_RUNTIME_DATABASE_URL")
      }),
      async () => {},
      { bnbDiscovery: service }
    );
    const response = await app.request(
      `/v1/market/bnb/discovered-orders?tokenId=${tokenId}`
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).orders[0].orderHash, hash.toLowerCase());
    assert.equal(logCalls + stateCalls, calls);

    const restart = await runBnbDiscoveryPass(options);
    assert.equal(restart.scanned, 0);
    assert.equal((await service.list(params)).orders.length, 1);

    finalHash = `0x${"cd".repeat(32)}`;
    await db.owner.query(
      `UPDATE bnb_indexer.sync_state SET last_scanned_hash=$1,
       updated_at=clock_timestamp()`,
      [finalHash]
    );
    const replay = await runBnbDiscoveryPass(options);
    assert.equal(replay.scanned, 1);
    assert.equal((await service.list(params)).orders[0]?.orderHash, hash.toLowerCase());

    const policyChange = await runBnbDiscoveryPass({
      ...options,
      policy: { ...options.policy, version: "test-v2" }
    });
    assert.equal(policyChange.scanned, 1);
    assert.equal((await service.list(params)).orders[0]?.orderHash, hash.toLowerCase());

    await db.owner.query("DELETE FROM yunipals_market.bnb_discovered_order");
    await db.owner.query("DELETE FROM yunipals_market.bnb_discovery_cursor");
    const rebuilt = await runBnbDiscoveryPass({
      ...options,
      policy: { ...options.policy, version: "test-v2" }
    });
    assert.equal(rebuilt.scanned, 1);
    assert.equal((await service.list(params)).orders[0]?.orderHash, hash.toLowerCase());

    await db.owner.query("DELETE FROM yunipals_market.bnb_discovered_order");
    await db.owner.query("DELETE FROM yunipals_market.bnb_discovery_cursor");
    const split = await runBnbDiscoveryPass({
      ...options,
      logClient: {
        getBlock: logClient.getBlock,
        getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
          if (fromBlock < toBlock) throw new Error("block range limit");
          return fromBlock === 101n ? [log, secondLog] : [];
        }
      } as unknown as PublicClient
    });
    assert.equal(split.scanned, 3);
    assert.equal((await service.list(params)).orders[0]?.orderHash, hash.toLowerCase());

    await db.owner.query("DELETE FROM yunipals_market.bnb_discovered_order");
    await db.owner.query("DELETE FROM yunipals_market.bnb_discovery_cursor");
    await assert.rejects(
      runBnbDiscoveryPass({
        ...options,
        logClient: {
          getBlock: logClient.getBlock,
          getLogs: async () => {
            throw new Error("upstream rate limit 429");
          }
        } as unknown as PublicClient
      }),
      /rate limit/
    );
    const failed = await service.list(params);
    assert.equal(failed.coverage, "partial");
    assert.equal(failed.nextBlock, "100");
  } finally {
    await db.owner.query(
      "DELETE FROM yunipals_read_v4.transfer_event WHERE id=ANY($1::text[])",
      [
        [
          `discovery-${tokenId}`,
          `discovery-${(BigInt(tokenId) + 1n).toString()}`
        ]
      ]
    );
    await db.owner.query(
      "DELETE FROM yunipals_read_v4.token WHERE collection='bnb' AND token_id=ANY($1::text[])",
      [[tokenId, (BigInt(tokenId) + 1n).toString()]]
    );
  }
});
