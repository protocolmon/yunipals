import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  erc721Abi,
  http,
  parseAbi,
  toHex,
  zeroHash
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  bnbOfferCurrency,
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import {
  createNativeListing,
  createItemOffer,
  seaportSigningData,
  seaportOrderHash,
  seaportReadAbi,
  seaportWriteAbi,
  seaportFulfillmentOrder,
  seaportBasicOfferParameters
} from "@protopals/yunipals-market-core/seaport";
import {
  decodeSeaportOrder,
  encodeSeaportOrder
} from "@protopals/yunipals-market-core/seaportWire";

// This harness changes only an explicitly verified local fork and the dedicated
// disposable database. It starts the built HTTP server; no fixture market API is used.
const rpcUrl = process.env.MARKET_TEST_FORK_RPC ?? "http://127.0.0.1:18647";
const databaseUrl = process.env.MARKET_TEST_DATABASE_URL;
const runtimeUrl = process.env.MARKET_TEST_RUNTIME_DATABASE_URL;
for (const value of [databaseUrl, runtimeUrl]) {
  if (!value)
    throw new Error("Set both explicit marketplace test database URLs.");
  const url = new URL(value);
  if (
    url.pathname !== "/yunipals_market_test" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error(
      "Fork admission requires the disposable loopback yunipals_market_test database."
    );
}
const rpcEndpoint = new URL(rpcUrl);
if (
  rpcEndpoint.protocol !== "http:" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(rpcEndpoint.hostname) ||
  rpcEndpoint.username ||
  rpcEndpoint.password
)
  throw new Error("Fork admission requires a loopback HTTP RPC.");
const client = createPublicClient({
  transport: http(rpcUrl, { retryCount: 0, timeout: 20000 }),
  cacheTime: 0
});
const rpc = (method, params = []) => client.request({ method, params });
assert.match(await rpc("web3_clientVersion"), /anvil/i);
const metadata = await rpc("anvil_metadata");
assert.equal(metadata.forkedNetwork?.chainId, 56);
assert.equal(await client.getChainId(), 56);
const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 2,
  statement_timeout: 5000
});
assert.equal(
  (
    await pool.query(
      "SELECT environment FROM yunipals_market.deployment WHERE singleton"
    )
  ).rows[0]?.environment,
  "staging"
);
const seller = privateKeyToAccount(`0x${"01".repeat(32)}`);
const buyer = privateKeyToAccount(`0x${"02".repeat(32)}`);
const tokenId = BigInt(process.env.MARKET_TEST_FORK_TOKEN ?? "10000000001");
const collection = marketplaceChains.bnb.contractAddress;
const protocol = seaportDeployment.address;
const asset = {
  chain: "bnb",
  chainId: 56,
  contractAddress: collection,
  tokenId: tokenId.toString()
};
const price = 10n ** 16n;
const hashes = [];
const report = {
  status: "running",
  chainId: 56,
  forkBlock: metadata.forkedNetwork.forkBlockNumber,
  validation:
    "Built HTTP API including preflight and simulated fulfillment quotes, restricted PostgreSQL runtime role, actual Seaport on verified local BNB Anvil fork. Indexer read relations are isolated fixtures synchronized to this fork. Settlement uses API-returned signed components with a scripted wallet. Activity mode additionally verifies read-only Chromium against the actual API; it does not certify a real wallet connector or browser signing. No live publication or trades.",
  tests: []
};
let child;
let closed;
let serverOutput = "";
let seeded = false;
let worker;
let activity;
let activityBrowser;
let beforeOfferFill;
const priorSync = (
  await pool.query("SELECT * FROM bnb_indexer.sync_state WHERE singleton")
).rows[0];
const snapshot = await rpc("evm_snapshot");
const base = "http://127.0.0.1:19612";

function pass(name) {
  report.tests.push({ name, status: "passed" });
  process.stdout.write(`PASS ${name}\n`);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 18000);
  try {
    const [code, signal] = await closed;
    assert.equal(signal, null, serverOutput);
    assert.equal(code, 0, serverOutput);
  } finally {
    clearTimeout(timer);
  }
}
async function start(validation) {
  await stop();
  const env = {
    ...process.env,
    MARKET_DEPLOYMENT: "staging",
    MARKET_DATABASE_URL: runtimeUrl,
    MARKET_HOST: "127.0.0.1",
    MARKET_PORT: "19612",
    MARKET_ALLOWED_ORIGINS: "http://127.0.0.1:5177"
  };
  if (validation) env.MARKET_BNB_VALIDATION_RPC = rpcUrl;
  else delete env.MARKET_BNB_VALIDATION_RPC;
  delete env.NODE_TEST_CONTEXT;
  serverOutput = "";
  child = spawn(process.execPath, ["dist/server.mjs"], {
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  closed = once(child, "close");
  child.stdout.on("data", (chunk) => {
    serverOutput += chunk;
  });
  child.stderr.on("data", (chunk) => {
    serverOutput += chunk;
  });
  for (let attempt = 0; attempt < 70; attempt++) {
    if (child.exitCode !== null)
      throw new Error(`Built API failed to start: ${serverOutput}`);
    try {
      const response = await fetch(`${base}/health/ready`, {
        signal: AbortSignal.timeout(500)
      });
      if (response.status === 200) return;
    } catch {
      /* Listener is still starting. */
    }
    await delay(100);
  }
  throw new Error(`Built API did not become ready: ${serverOutput}`);
}
async function request(path, body, expected = 200) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data));
  return data;
}
function orderPath(hash) {
  return `/v1/market/orders/bnb/${protocol}/${hash}`;
}
async function quote(input, actor) {
  const result = await request(`${orderPath(input.hash)}/fulfillment`, {
    actor,
    lifecycle: 0
  });
  assert.equal(result.orderHash, input.hash);
  assert.equal(result.actor, actor);
  assert.deepEqual(result.order, encodeSeaportOrder(input.order));
  assert.equal(result.signature, input.signature);
  return {
    order: decodeSeaportOrder(result.order),
    signature: result.signature
  };
}
async function transaction(from, to, data, value = 0n) {
  await rpc("anvil_impersonateAccount", [from]);
  try {
    const hash = await rpc("eth_sendTransaction", [
      { from, to, data, value: toHex(value) }
    ]);
    // Advance the local fork explicitly: with automining alone a receipt can
    // arrive just after the block watcher observes the only new block.
    await rpc("evm_mine");
    const receipt = await client.waitForTransactionReceipt({
      hash,
      timeout: 20000,
      pollingInterval: 100
    });
    assert.equal(receipt.status, "success");
    return receipt;
  } finally {
    await rpc("anvil_stopImpersonatingAccount", [from]);
  }
}
async function syncAsset() {
  await rpc("anvil_mine", ["0x19", "0x0"]);
  const head = await client.getBlock({ blockTag: "latest" });
  const cursor = await client.getBlock({ blockNumber: head.number - 20n });
  const owner = await client.readContract({
    address: collection,
    abi: erc721Abi,
    functionName: "ownerOf",
    args: [tokenId],
    blockNumber: cursor.number
  });
  await pool.query(
    "UPDATE yunipals_read_v4.token SET owner=$1 WHERE collection='bnb' AND token_id=$2",
    [owner.toLowerCase(), tokenId.toString()]
  );
  await pool.query(
    `UPDATE bnb_indexer.sync_state SET next_block=$1,last_scanned_block=$2,last_scanned_hash=$3,
    caught_up_at=clock_timestamp(),last_error=NULL,updated_at=clock_timestamp() WHERE singleton`,
    [
      (cursor.number + 1n).toString(),
      cursor.number.toString(),
      cursor.hash.toLowerCase()
    ]
  );
}
async function publish(side, maker, salt) {
  const block = await client.getBlock({ blockTag: "latest" });
  const counter = await client.readContract({
    address: protocol,
    abi: seaportReadAbi,
    functionName: "getCounter",
    args: [maker.address]
  });
  const fields = {
    collection,
    tokenId,
    totalPrice: price,
    startTime: block.timestamp - 1n,
    endTime: block.timestamp + 3600n,
    counter,
    salt
  };
  const order =
    side === "listing"
      ? createNativeListing({ ...fields, seller: maker.address })
      : createItemOffer({
          ...fields,
          buyer: maker.address,
          paymentToken: bnbOfferCurrency.address
        });
  const hash = seaportOrderHash(order);
  hashes.push(hash.toLowerCase());
  const draft = { asset, lifecycle: 0, order: encodeSeaportOrder(order) };
  const prepared = await request("/v1/market/orders/prepare", draft);
  assert.equal(prepared.orderHash, hash);
  assert.deepEqual(prepared.order, draft.order);
  const signature = await maker.signTypedData(
    seaportSigningData(
      {
        name: "Seaport",
        version: "1.6",
        chainId: 56,
        verifyingContract: protocol
      },
      order
    )
  );
  const payload = { ...draft, preparationId: prepared.id, signature };
  const published = await request("/v1/market/orders", payload);
  assert.equal(published.persisted, true);
  assert.equal(published.order.orderHash, hash);
  assert.equal(published.order.status, "active");
  assert.equal((await request(orderPath(hash))).persisted, true);
  const row = (
    await pool.query(
      `SELECT o.signature,o.components,count(j.id)::integer AS jobs
    FROM yunipals_market.orders o LEFT JOIN yunipals_market.job j ON j.kind='bnb_order_reconcile' AND j.deduplication_key=o.order_hash
    WHERE o.chain_id=56 AND o.order_hash=$1 GROUP BY o.chain_id,o.protocol_address,o.order_hash`,
      [hash.toLowerCase()]
    )
  ).rows[0];
  assert.equal(row.signature, signature);
  assert.deepEqual(row.components, draft.order);
  assert.equal(row.jobs, 1);
  return { order, hash, signature, payload };
}

try {
  const { createActivityHarness } = await import("./activity-harness.mjs");
  activity = await createActivityHarness({
    pool,
    rpc,
    orderHashes: hashes,
    base
  });
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM yunipals_read_v4.token WHERE collection='bnb' AND token_id=$1",
        [tokenId.toString()]
      )
    ).rowCount,
    0,
    "Do not overwrite an existing local token fixture."
  );
  await rpc("evm_setAutomine", [true]);
  for (const address of [seller.address, buyer.address]) {
    await rpc("anvil_setCode", [address, "0x"]);
    await rpc("anvil_setBalance", [address, toHex(100n * 10n ** 18n)]);
  }
  const owner = await client.readContract({
    address: collection,
    abi: erc721Abi,
    functionName: "ownerOf",
    args: [tokenId]
  });
  await rpc("anvil_setBalance", [owner, toHex(100n * 10n ** 18n)]);
  await transaction(
    owner,
    collection,
    encodeFunctionData({
      abi: erc721Abi,
      functionName: "transferFrom",
      args: [owner, seller.address, tokenId]
    })
  );
  await transaction(
    seller.address,
    collection,
    encodeFunctionData({
      abi: erc721Abi,
      functionName: "approve",
      args: [protocol, tokenId]
    })
  );
  await pool.query(
    "INSERT INTO yunipals_read_v4.token(collection,chain_id,contract_address,token_id,owner,lifecycle,burned) VALUES('bnb',56,$1,$2,$3,0,false)",
    [collection.toLowerCase(), tokenId.toString(), seller.address.toLowerCase()]
  );
  seeded = true;
  await syncAsset();
  await start(true);
  const policy = await request("/v1/market/policies/bnb");
  assert.deepEqual(policy.fees, []);
  const capabilities = await request("/v1/market/capabilities");
  assert.equal(
    Object.values(capabilities.chains).flatMap(Object.values).some(Boolean),
    false
  );
  pass(
    "Built API validates local fork identity and keeps public capabilities disabled"
  );

  const listing = await publish("listing", seller, BigInt(Date.now()));
  if (process.env.MARKET_TEST_WORKER === "1") {
    const { createWorkerHarness } = await import("./worker-harness.mjs");
    worker = await createWorkerHarness({ pool, rpcUrl, runtimeUrl });
    await worker.start();
    await worker.state(listing.hash, "active");
    pass(
      "Built worker starts with restricted storage and reconciles its admitted listing"
    );
  }
  assert.equal(
    (await request("/v1/market/orders", listing.payload)).order.orderHash,
    listing.hash
  );
  const listingQuote = await quote(listing, buyer.address);
  await transaction(
    buyer.address,
    protocol,
    encodeFunctionData({
      abi: seaportWriteAbi,
      functionName: "fulfillOrder",
      args: [
        seaportFulfillmentOrder(listingQuote.order, listingQuote.signature),
        zeroHash
      ]
    }),
    price
  );
  assert.equal(
    await client.readContract({
      address: collection,
      abi: erc721Abi,
      functionName: "ownerOf",
      args: [tokenId]
    }),
    buyer.address
  );
  const filled = await client.readContract({
    address: protocol,
    abi: seaportReadAbi,
    functionName: "getOrderStatus",
    args: [listing.hash]
  });
  assert.ok(filled[2] > 0n && filled[2] === filled[3]);
  if (worker) {
    report.nativeSale = await activity.confirm(listing.hash, "listing-filled");
    pass(
      "Built worker confirms the actual native sale and retains its receipt and canonical checkpoint"
    );
    await worker.state(listing.hash, "filled");
    assert.equal(
      (await request(orderPath(listing.hash))).order.status,
      "filled"
    );
    pass(
      "Worker automatically observes a fill through its recurring schedule without browser notification"
    );
  }
  pass(
    "HTTP-admitted native listing persists idempotently and its simulated quote settles through Seaport"
  );

  await transaction(
    seller.address,
    bnbOfferCurrency.address,
    encodeFunctionData({
      abi: parseAbi(["function deposit() payable"]),
      functionName: "deposit"
    }),
    price
  );
  await transaction(
    seller.address,
    bnbOfferCurrency.address,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [protocol, price]
    })
  );
  await syncAsset();
  const offer = await publish("offer", seller, BigInt(Date.now()));
  const cancellation = await request(`${orderPath(offer.hash)}/cancellation`, {
    actor: seller.address
  });
  assert.equal("signature" in cancellation, false);
  await transaction(
    seller.address,
    protocol,
    encodeFunctionData({
      abi: seaportWriteAbi,
      functionName: "cancel",
      args: [[decodeSeaportOrder(cancellation.order)]]
    })
  );
  assert.equal(
    (
      await client.readContract({
        address: protocol,
        abi: seaportReadAbi,
        functionName: "getOrderStatus",
        args: [offer.hash]
      })
    )[1],
    true
  );
  pass("HTTP cancellation parameters cancel the exact WBNB offer onchain");
  if (worker) {
    await worker.due([offer.hash]);
    await worker.state(offer.hash, "cancelled");
  }

  const replacement = await publish("offer", seller, BigInt(Date.now()) + 1n);
  const preflightPath = `${orderPath(replacement.hash)}/preflight`;
  const actorRequest = { actor: buyer.address, lifecycle: 0 };
  assert.equal(
    (await request(preflightPath, actorRequest)).needsNftApproval,
    true
  );
  assert.equal(
    (
      await request(
        `${orderPath(replacement.hash)}/fulfillment`,
        actorRequest,
        409
      )
    ).error.code,
    "nft_approval_required"
  );
  await transaction(
    buyer.address,
    collection,
    encodeFunctionData({
      abi: erc721Abi,
      functionName: "approve",
      args: [protocol, tokenId]
    })
  );
  assert.equal(
    (await request(preflightPath, actorRequest)).needsNftApproval,
    false
  );
  const offerQuote = await quote(replacement, buyer.address);
  pass(
    "Preflight identifies missing approval and fulfillment is quoted only after actual approval and simulation"
  );
  if (process.env.MARKET_TEST_ACTIVITY === "1")
    beforeOfferFill = await rpc("evm_snapshot");
  const buyerBefore = await client.readContract({
    address: bnbOfferCurrency.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [buyer.address]
  });
  await transaction(
    buyer.address,
    protocol,
    encodeFunctionData({
      abi: seaportWriteAbi,
      functionName: "fulfillBasicOrder",
      args: [
        seaportBasicOfferParameters(offerQuote.order, offerQuote.signature)
      ]
    })
  );
  assert.equal(
    await client.readContract({
      address: collection,
      abi: erc721Abi,
      functionName: "ownerOf",
      args: [tokenId]
    }),
    seller.address
  );
  assert.equal(
    (await client.readContract({
      address: bnbOfferCurrency.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [buyer.address]
    })) - buyerBefore,
    price
  );
  pass(
    "Replacement passes actual cancelled-history check and pays WBNB on settlement"
  );

  if (worker) {
    report.wbnbSale = await activity.confirm(
      replacement.hash,
      "offer-accepted"
    );
    pass(
      "Built worker confirms actual WBNB acceptance with seller and NFT recipient roles"
    );
    await worker.due([replacement.hash]);
    await worker.state(replacement.hash, "filled");
    if (process.env.MARKET_TEST_ACTIVITY === "1") {
      const { createActivityBrowser } = await import("./activity-browser.mjs");
      activityBrowser = await createActivityBrowser({
        base,
        seller: seller.address,
        buyer: buyer.address,
        nativeSale: report.nativeSale,
        wbnbSale: report.wbnbSale
      });
      pass(
        "Chromium reads actual API sale history with seller/recipient filters, account changes and mobile layout"
      );
      const activityPath = `/v1/market/wallets/${seller.address}/activity?chain=bnb&view=all&limit=1`;
      const oldPage = await request(activityPath);
      assert.ok(oldPage.nextCursor);
      assert.equal(await rpc("evm_revert", [beforeOfferFill]), true);
      await rpc("anvil_mine", ["0x19", "0x0"]);
      const until = Date.now() + 20000;
      let retracted = false;
      while (Date.now() < until) {
        retracted =
          (
            await pool.query(
              "SELECT 1 FROM yunipals_market.sale WHERE chain_id=56 AND order_hash=$1 AND NOT canonical",
              [replacement.hash.toLowerCase()]
            )
          ).rowCount === 1;
        if (retracted) break;
        await delay(100);
      }
      assert.ok(retracted, "Actual fork reorg retracts the offer sale");
      await request(
        `${activityPath}&snapshot=${oldPage.snapshot.id}&cursor=${oldPage.nextCursor}`,
        undefined,
        409
      );
      await activityBrowser.afterReorg();
      pass(
        "Actual fork reorg retracts the orphan, invalidates its HTTP cursor and removes it from refreshed browser activity"
      );
      const replayQuote = await quote(replacement, buyer.address);
      await transaction(
        buyer.address,
        protocol,
        encodeFunctionData({
          abi: seaportWriteAbi,
          functionName: "fulfillBasicOrder",
          args: [
            seaportBasicOfferParameters(
              replayQuote.order,
              replayQuote.signature
            )
          ]
        })
      );
      report.replayedSale = await activity.confirm(
        replacement.hash,
        "offer-accepted"
      );
      assert.notEqual(report.replayedSale.eventId, report.wbnbSale.eventId);
      report.browser = await activityBrowser.afterReplay(report.replayedSale);
      await activityBrowser.close();
      activityBrowser = undefined;
      pass(
        "Fresh settlement on the replacement branch retains both proofs and returns one canonical sale through API and browser"
      );
    } else {
      await worker.outage(hashes);
      for (const hash of hashes) {
        const accepted = await request(orderPath(hash));
        assert.equal(accepted.persisted, true);
        assert.equal(accepted.order.status, "unavailable");
      }
      assert.deepEqual(
        (
          await request(`${orderPath(replacement.hash)}/cancellation`, {
            actor: seller.address
          })
        ).order,
        encodeSeaportOrder(replacement.order)
      );
      pass(
        "RPC outage marks orders unavailable while durable acceptance and cancellation remain accessible"
      );
      await worker.recover([
        [listing.hash, "filled"],
        [offer.hash, "cancelled"],
        [replacement.hash, "filled"]
      ]);
      pass(
        "Restored RPC recovers actual fill and cancellation state without deleting signed orders"
      );
      report.workerCrashRecovery = await worker.crashAndRecover(
        replacement.hash,
        "filled"
      );
      pass(
        "SIGKILL during an RPC read is recovered after the real lease expires, with one fenced completion"
      );
      await activity.retained();
      pass(
        "Process crash and restart retain one canonical receipt-backed observation per filled order"
      );
    }
    await worker.close();
    worker = undefined;
  }

  await start(false);
  await request("/v1/market/orders", replacement.payload, 503);
  assert.equal((await request(orderPath(replacement.hash))).persisted, true);
  const recovered = await request(
    `${orderPath(replacement.hash)}/cancellation`,
    { actor: seller.address }
  );
  assert.deepEqual(recovered.order, encodeSeaportOrder(replacement.order));
  pass(
    "Process restart with admission disabled preserves durable acceptance and unsigned recovery"
  );
  report.status = "passed";
  report.orderHashes = hashes;
} catch (error) {
  report.status = "failed";
  report.failureType = error.name;
  throw error;
} finally {
  const wasPassed = report.status === "passed";
  const cleanupErrors = [];
  for (const cleanup of [
    () => activityBrowser?.close(),
    () => worker?.close(),
    stop
  ]) {
    try {
      await cleanup();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    await pool.query(
      "DELETE FROM yunipals_market.job WHERE kind='bnb_order_reconcile' AND lower(payload->>'orderHash')=ANY($1::text[])",
      [hashes]
    );
    for (const table of ["orders", "preparation"])
      await pool.query(
        `DELETE FROM yunipals_market.${table} WHERE chain_id=56 AND order_hash=ANY($1::text[])`,
        [hashes]
      );
    if (seeded)
      await pool.query(
        "DELETE FROM yunipals_read_v4.token WHERE collection='bnb' AND token_id=$1",
        [tokenId.toString()]
      );
    if (priorSync)
      await pool.query(
        `UPDATE bnb_indexer.sync_state SET next_block=$1,last_scanned_block=$2,last_scanned_hash=$3,
      caught_up_at=$4,last_error=$5,updated_at=$6 WHERE singleton`,
        [
          priorSync.next_block,
          priorSync.last_scanned_block,
          priorSync.last_scanned_hash,
          priorSync.caught_up_at,
          priorSync.last_error,
          priorSync.updated_at
        ]
      );
  } catch (error) {
    cleanupErrors.push(error);
  }
  for (const cleanup of [
    () => activity?.close(),
    () => pool.end(),
    () => rpc("evm_revert", [snapshot])
  ]) {
    try {
      await cleanup();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length) {
    report.status = "failed";
    report.cleanupFailures = cleanupErrors.map((error) => error.name);
  }
  await writeFile(
    process.env.MARKET_TEST_FORK_REPORT ??
      "/tmp/yunipals-admission-fork-report.json",
    `${JSON.stringify(report, null, 2)}\n`
  );
  if (wasPassed && cleanupErrors.length)
    throw new Error("Fork validation cleanup failed.");
}
