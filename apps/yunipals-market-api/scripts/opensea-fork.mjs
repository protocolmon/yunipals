import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import {
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  erc721Abi,
  getAddress,
  http,
  parseAbi,
  toHex,
  zeroAddress
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import {
  openseaConduit,
  openseaCurrencies
} from "@protopals/yunipals-market-core/openseaRegistry";
import { parseOpenSeaOrderPolicy } from "@protopals/yunipals-market-core/openseaOrderPolicy";
import { createOpenSeaPublicationIntent } from "@protopals/yunipals-market-core/openseaPublication";
import {
  seaportOrderHash,
  seaportReadAbi,
  seaportSigningData,
  seaportWriteAbi
} from "@protopals/yunipals-market-core/seaport";
import {
  decodeSeaportOrder,
  encodeSeaportOrder
} from "@protopals/yunipals-market-core/seaportWire";
import { createBnbTestDatabase } from "../src/bnb/fixtures/database.ts";
import { buildOpenSeaFulfillment } from "@protopals/yunipals-market-core/openseaFulfillment";
import { summarizeDiscoveredOpenSeaOrder } from "../src/opensea/discoveryOrder.ts";
import { OpenSeaClient } from "../src/opensea/client.ts";
import { verifyCollectionSaleReplay } from "./collection-sale-fork.mjs";
import {
  claimOpenSeaDiscovery,
  processOpenSeaDiscoveryPage
} from "../src/opensea/discovery.ts";
import {
  fixtureProvider,
  fixtureJsonBody,
  fixtureJsonResponse
} from "../src/opensea/fixtures/provider.ts";

// Every write is restricted to an explicitly verified local Anvil fork or the
// disposable database/provider. These are actual built API/worker processes.
const chain = process.env.MARKET_TEST_OPENSEA_CHAIN;
assert.ok(
  ["ethereum", "base", "polygon"].includes(chain),
  "Set MARKET_TEST_OPENSEA_CHAIN."
);
const rpcUrl = process.env.MARKET_TEST_FORK_RPC ?? "http://127.0.0.1:18648";
const rpcEndpoint = new URL(rpcUrl);
assert.equal(rpcEndpoint.protocol, "http:");
assert.ok(["127.0.0.1", "[::1]"].includes(rpcEndpoint.hostname));
assert.ok(
  !rpcEndpoint.username &&
    !rpcEndpoint.password &&
    !rpcEndpoint.search &&
    !rpcEndpoint.hash
);
const config = marketplaceChains[chain];
const currency = openseaCurrencies[chain];
const mint = JSON.parse(
  await readFile(new URL("./opensea-fork-assets.json", import.meta.url), "utf8")
)[chain];
const tokenId = BigInt(mint.tokenId);
const client = createPublicClient({
  transport: http(rpcUrl, { retryCount: 0, timeout: 15000 }),
  cacheTime: 0
});
const rpc = (method, params = []) => client.request({ method, params });
assert.match(await rpc("web3_clientVersion"), /anvil/i);
const fork = await rpc("anvil_metadata");
assert.equal(fork.forkedNetwork?.chainId, config.chainId);
assert.equal(await client.getChainId(), config.chainId);
const db = createBnbTestDatabase();
const pool = db.owner;
const report = {
  status: "running",
  chain,
  chainId: config.chainId,
  checkedAt: new Date().toISOString(),
  forkBlock: fork.forkedNetwork.forkBlockNumber,
  tokenId: mint.tokenId,
  scope:
    "Actual Yunipals/Seaport/conduit/WETH on a verified local Anvil fork, built API/worker processes, restricted PostgreSQL runtime, indexed mint evidence and local transfer receipts, loopback HTTP provider fixture. No actual OpenSea acceptance, protected fulfillment or live trades are claimed.",
  tests: []
};
const pass = (name) => {
  report.tests.push({ name, status: "passed" });
  console.log(`PASS ${name}`);
};
const base = "http://127.0.0.1:19613";
const seller = privateKeyToAccount(`0x${"11".repeat(32)}`);
const buyer = privateKeyToAccount(`0x${"22".repeat(32)}`);
const feeRecipient = "0x3333333333333333333333333333333333333333";
const asset = {
  chain,
  chainId: config.chainId,
  contractAddress: config.contractAddress,
  tokenId: mint.tokenId
};
const price = 10n ** 16n;
const records = new Map();
const hashes = [];
const discovered = [];
const discoveryScans = [];
let listingCurrency = zeroAddress;
let providerOffline = false;
let crashHash;
let heldPost;
let api;
let worker;
let provider;
let transferReceipt;
let heartbeat;
let heartbeats = Promise.resolve();
let seeded = false;
let snapshot;
let priorMeta;
let priorCursor;
let capturedIndexerState = false;
let priorReadCheckpoints;
const sourceSlug = config.collectionSlug;

function ack(record) {
  return {
    chain,
    order_hash: record.hash,
    protocol_address: seaportDeployment.address,
    protocol_data: {
      parameters: {
        ...record.order,
        totalOriginalConsiderationItems: record.order.consideration.length
      },
      signature: "0x"
    },
    status: "ACTIVE",
    remaining_quantity: 1
  };
}
async function until(check, message, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error(message);
    await delay(500);
  }
}
function processEnv(validation) {
  const env = {
    PATH: process.env.PATH,
    MARKET_DEPLOYMENT: "staging",
    MARKET_DATABASE_URL: process.env.MARKET_TEST_RUNTIME_DATABASE_URL,
    MARKET_HOST: "127.0.0.1",
    MARKET_PORT: "19613",
    MARKET_ALLOWED_ORIGINS: "http://127.0.0.1:5177"
  };
  if (validation)
    Object.assign(env, {
      MARKET_OPENSEA_VALIDATION_CHAIN: chain,
      MARKET_OPENSEA_VALIDATION_RPC: rpcUrl,
      MARKET_OPENSEA_VALIDATION_PROVIDER: provider.origin
    });
  return env;
}
function launch(entry, validation = true) {
  const child = spawn(process.execPath, [`dist/${entry}.mjs`], {
    env: processEnv(validation),
    stdio: ["ignore", "pipe", "pipe"]
  });
  const closed = once(child, "close");
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (value) => {
      output = (output + value).slice(-16000);
    });
  return { child, closed, output: () => output };
}
async function stop(process, signal = "SIGTERM") {
  if (
    !process ||
    process.child.exitCode !== null ||
    process.child.signalCode !== null
  )
    return;
  process.child.kill(signal);
  const timer = setTimeout(() => process.child.kill("SIGKILL"), 17000);
  try {
    const [code, actualSignal] = await process.closed;
    if (signal === "SIGTERM") {
      assert.equal(code, 0, process.output());
      assert.equal(actualSignal, null);
    } else assert.equal(actualSignal, signal);
  } finally {
    clearTimeout(timer);
  }
}
async function startApi(validation = true) {
  await stop(api);
  api = launch("server", validation);
  await until(async () => {
    if (api.child.exitCode !== null) throw new Error(api.output());
    try {
      return (
        await fetch(`${base}/health/ready`, {
          signal: AbortSignal.timeout(500)
        })
      ).ok;
    } catch {
      return false;
    }
  }, "API did not start");
}
async function startWorker() {
  await stop(worker);
  worker = launch("opensea-worker");
  await until(async () => {
    if (worker.child.exitCode !== null) throw new Error(worker.output());
    return worker.output().includes('"status":"started"');
  }, "Worker did not start");
}
async function request(path, body, expected = 200) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data));
  return data;
}
const orderPath = (hash) =>
  `/v1/market/orders/${chain}/${seaportDeployment.address}/${hash}`;
async function tx(from, to, data, value = 0n) {
  await rpc("anvil_impersonateAccount", [from]);
  try {
    const hash = await rpc("eth_sendTransaction", [
      { from, to, data, value: toHex(value), gas: toHex(2000000) }
    ]);
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
async function sync() {
  const previous = await client.getBlock({ blockTag: "latest" });
  await rpc("evm_setNextBlockTimestamp", [
    Math.max(Number(previous.timestamp) + 1, Math.floor(Date.now() / 1000))
  ]);
  await rpc("anvil_mine", ["0x19", "0x0"]);
  const head = await client.getBlock({ blockTag: "latest" });
  const checkpoint = `${String(head.timestamp).padStart(10, "0")}${String(config.chainId).padStart(16, "0")}${String(head.number).padStart(16, "0")}${"0".repeat(33)}`;
  await pool.query(
    "INSERT INTO yunipals_indexer_v3._ponder_checkpoint VALUES($1,$2) ON CONFLICT(chain_id) DO UPDATE SET latest_checkpoint=$2",
    [config.chainId, checkpoint]
  );
  await pool.query(
    "INSERT INTO yunipals_indexer_v3._ponder_meta VALUES('app',$1) ON CONFLICT(key) DO UPDATE SET value=$1",
    [JSON.stringify({ version: 6, is_ready: 1, heartbeat_at: Date.now() })]
  );
}
async function publish(side, maker, crash = false) {
  await sync();
  const policy = parseOpenSeaOrderPolicy(
    await request(`/v1/market/policies/${chain}`),
    chain
  );
  const block = await client.getBlock({ blockTag: "latest" });
  const counter = await client.readContract({
    address: seaportDeployment.address,
    abi: seaportReadAbi,
    functionName: "getCounter",
    args: [maker.address]
  });
  const intent = createOpenSeaPublicationIntent(
    {
      asset,
      lifecycle: mint.lifecycle,
      maker: maker.address,
      side,
      currency: side === "listing" ? listingCurrency : currency.address,
      grossAmount: price,
      endTime: block.timestamp + 3600n
    },
    policy,
    { timestamp: block.timestamp - 1n, counter },
    BigInt(Date.now())
  );
  const order = encodeSeaportOrder(intent.order);
  const hash = intent.orderHash.toLowerCase();
  hashes.push(hash);
  const draft = {
    asset,
    lifecycle: mint.lifecycle,
    order,
    policyVersion: policy.version
  };
  const prepared = await request("/v1/market/orders/prepare", draft);
  assert.equal(prepared.orderHash, hash);
  const signature = await maker.signTypedData(
    seaportSigningData(
      {
        name: "Seaport",
        version: "1.6",
        chainId: config.chainId,
        verifyingContract: seaportDeployment.address
      },
      decodeSeaportOrder(prepared.order)
    )
  );
  if (crash) crashHash = hash;
  const payload = { ...draft, preparationId: prepared.id, signature };
  const result = await request("/v1/market/orders", payload);
  assert.equal(result.persisted, true);
  assert.equal(result.providerAccepted, false);
  assert.equal(result.order.status, "unavailable");
  return { hash, intent, payload, maker };
}
async function accepted(order) {
  await until(
    async () => (await request(orderPath(order.hash))).providerAccepted,
    "Provider acknowledgment did not persist"
  );
  assert.equal(
    (await request(orderPath(order.hash))).order.status,
    "unavailable"
  );
}
async function observed(order, expected, reason) {
  let saved;
  await until(
    async () => {
      saved = (
        await pool.query(
          "SELECT state,state_reason,state_block_number::text,state_block_hash,state_observed_at FROM yunipals_market.orders WHERE chain_id=$1 AND order_hash=$2",
          [config.chainId, order.hash]
        )
      ).rows[0];
      return (
        saved?.state === expected &&
        (!reason || saved.state_reason === reason) &&
        saved.state_observed_at &&
        Date.now() - saved.state_observed_at.getTime() < 15000
      );
    },
    `Worker did not observe ${expected}${reason ? ` (${reason})` : ""}`,
    35000
  );
  assert.ok(saved.state_block_number && saved.state_block_hash);
  report.reconciliation ??= [];
  report.reconciliation.push({ orderHash: order.hash, ...saved });
}
async function discoverOrder(original, side) {
  const order = {
    ...original.payload.order,
    salt: String(BigInt(original.payload.order.salt) + 999999n)
  };
  const hash = seaportOrderHash(decodeSeaportOrder(order));
  const signature = await original.maker.signTypedData(
    seaportSigningData(
      {
        name: "Seaport",
        version: "1.6",
        chainId: config.chainId,
        verifyingContract: seaportDeployment.address
      },
      decodeSeaportOrder(order)
    )
  );
  const record = { hash, order, side, signature };
  discovered.push(record);
  await scanSide(side);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM yunipals_market.orders WHERE order_hash=$1",
        [hash]
      )
    ).rows[0].n,
    0
  );
  return record;
}
async function scanSide(side) {
  let scan;
  await until(async () => {
    scan = await claimOpenSeaDiscovery(db.runtime, chain, side, sourceSlug);
    return Boolean(scan);
  }, "Discovery scan did not become due");
  discoveryScans.push(scan);
  await processOpenSeaDiscoveryPage(
    db.runtime,
    new OpenSeaClient({
      apiKey: "yunipals-fixture-only",
      fixtureOrigin: provider.origin
    }),
    chain,
    scan,
    { scanIntervalMs: 10000 }
  );
}
async function verifyFulfillment(order, imported = false) {
  await sync();
  const summary = imported
    ? {
        ...summarizeDiscoveredOpenSeaOrder(
          decodeSeaportOrder(order.order),
          chain,
          "listing",
          seaportDeployment.address,
          mint.lifecycle
        ),
        status: "active"
      }
    : { ...order.intent.summary, status: "active" };
  const body = { actor: buyer.address, lifecycle: mint.lifecycle };
  const preflight = await request(`${orderPath(order.hash)}/preflight`, body);
  assert.equal(preflight.purpose, "preflight");
  assert.equal(preflight.simulated, false);
  const quote = await request(`${orderPath(order.hash)}/fulfillment`, body);
  assert.equal(quote.purpose, "fulfillment");
  assert.equal(quote.simulated, true);
  assert.notEqual(quote.id, preflight.id);
  const trade = buildOpenSeaFulfillment(
    quote,
    summary,
    buyer.address,
    BigInt(Math.floor(Date.now() / 1000))
  );
  const result = await client.call({
    account: buyer.address,
    to: trade.intent.to,
    data: trade.intent.data,
    value: trade.intent.value
  });
  assert.equal(result.data, `0x${"0".repeat(63)}1`);
  report.fulfillment ??= [];
  report.fulfillment.push({
    orderHash: order.hash,
    origin: imported ? "discovered" : "retained",
    currency: summary.currency.symbol,
    method: "fulfillOrder",
    preflight: true,
    backendSimulated: true,
    independentSimulation: true
  });
  pass(
    `Built API verifies ${imported ? "discovered" : "retained"} ${summary.currency.symbol} listing preflight and actual Seaport settlement simulation`
  );
}

async function discoveredObserved(order, expected, reason) {
  let saved;
  await until(
    async () => {
      saved = (
        await pool.query(
          `SELECT state,reason,bound_lifecycle,bound_mint_hash,block_number::text,block_hash,observed_at,summary
      FROM yunipals_market.opensea_discovered_state WHERE chain_id=$1 AND order_hash=$2`,
          [config.chainId, order.hash]
        )
      ).rows[0];
      return (
        saved?.state === expected &&
        (!reason || saved.reason === reason) &&
        saved.observed_at &&
        Date.now() - saved.observed_at.getTime() < 15000
      );
    },
    `Discovered worker did not observe ${expected} (${reason})`,
    45000
  );
  assert.ok(saved.block_number && saved.block_hash);
  assert.equal(saved.bound_lifecycle, mint.lifecycle);
  assert.equal(saved.bound_mint_hash, mint.mintTransaction);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM yunipals_market.orders WHERE order_hash=$1",
        [order.hash]
      )
    ).rows[0].n,
    0
  );
  report.discoveredReconciliation ??= [];
  report.discoveredReconciliation.push({ orderHash: order.hash, ...saved });
}
async function cancel(order) {
  const data = await request(`${orderPath(order.hash)}/cancellation`, {
    actor: order.maker.address
  });
  assert.equal(seaportOrderHash(decodeSeaportOrder(data.order)), order.hash);
  await tx(
    order.maker.address,
    seaportDeployment.address,
    encodeFunctionData({
      abi: seaportWriteAbi,
      functionName: "cancel",
      args: [[decodeSeaportOrder(data.order)]]
    })
  );
  assert.equal(
    (
      await client.readContract({
        address: seaportDeployment.address,
        abi: seaportReadAbi,
        functionName: "getOrderStatus",
        args: [order.hash]
      })
    )[1],
    true
  );
}
async function fundWeth() {
  if (currency.canWrapNative) {
    await tx(
      buyer.address,
      currency.address,
      encodeFunctionData({
        abi: parseAbi(["function deposit() payable"]),
        functionName: "deposit"
      }),
      price
    );
  } else {
    const end = BigInt(fork.forkedNetwork.forkBlockNumber);
    let donor;
    for (let offset = 0n; offset < 1000n && !donor; offset += 100n) {
      const logs = await client.getContractEvents({
        address: currency.address,
        abi: erc20Abi,
        eventName: "Transfer",
        fromBlock: end - offset - 99n,
        toBlock: end - offset
      });
      for (const candidate of [...new Set(logs.map((log) => log.args.to))]
        .filter(Boolean)
        .slice(0, 30)) {
        if (
          candidate !== zeroAddress &&
          (await client.readContract({
            address: currency.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [candidate]
          })) >= price
        ) {
          donor = candidate;
          break;
        }
      }
    }
    assert.ok(donor, "No real Polygon WETH donor found on the fork");
    await rpc("anvil_setBalance", [donor, toHex(10n ** 20n)]);
    await tx(
      donor,
      currency.address,
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [buyer.address, price]
      })
    );
    report.polygonWethDonor = donor;
  }
  await tx(
    buyer.address,
    currency.address,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [openseaConduit.address, price]
    })
  );
}

try {
  await db.initialize();
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM yunipals_market.orders"))
      .rows[0].n,
    0,
    "Use an empty dedicated fork database, not the unit-test database"
  );
  await pool.query(
    await readFile(
      new URL("./opensea-fork-indexer.sql", import.meta.url),
      "utf8"
    )
  );
  await pool.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON yunipals_market.opensea_discovered_order,
    yunipals_market.opensea_discovered_state,yunipals_market.opensea_maker_signature,
    yunipals_market.opensea_discovery_scan,yunipals_market.opensea_discovery_page TO market_test_runtime`);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM yunipals_market.opensea_discovery_scan"
      )
    ).rows[0].n,
    0
  );
  priorMeta = (
    await pool.query(
      "SELECT value FROM yunipals_indexer_v3._ponder_meta WHERE key='app'"
    )
  ).rows[0];
  priorCursor = (
    await pool.query(
      "SELECT latest_checkpoint FROM yunipals_indexer_v3._ponder_checkpoint WHERE chain_id=$1",
      [config.chainId]
    )
  ).rows[0];
  capturedIndexerState = true;
  // A fresh Anvil instance has a different synthetic block history. Preserve
  // the disposable database's prior health anchors, then let this run's worker
  // establish its own observations instead of inheriting an older fork's head.
  priorReadCheckpoints = (
    await pool.query(
      "SELECT to_jsonb(c) AS row FROM yunipals_market.checkpoint c WHERE chain_id=$1 AND name IN ('opensea-order-worker','opensea-read-reorg')",
      [config.chainId]
    )
  ).rows.map((r) => r.row);
  await pool.query(
    "DELETE FROM yunipals_market.checkpoint WHERE chain_id=$1 AND name IN ('opensea-order-worker','opensea-read-reorg')",
    [config.chainId]
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM yunipals_read_v4.token WHERE collection=$1 AND token_id=$2",
        [chain, mint.tokenId]
      )
    ).rowCount,
    0
  );
  snapshot = await rpc("evm_snapshot");
  const mintReceipt = await client.getTransactionReceipt({
    hash: mint.mintTransaction
  });
  assert.equal(mintReceipt.status, "success");
  assert.equal(String(mintReceipt.blockNumber), mint.mintBlock);
  assert.equal(
    (await client.getBlock({ blockNumber: mintReceipt.blockNumber })).hash,
    mintReceipt.blockHash
  );
  assert.ok(
    mintReceipt.logs.some((log) => {
      if (getAddress(log.address) !== getAddress(config.contractAddress))
        return false;
      try {
        const event = decodeEventLog({
          abi: erc721Abi,
          data: log.data,
          topics: log.topics
        });
        return (
          event.eventName === "Transfer" &&
          event.args.tokenId === tokenId &&
          event.args.from === zeroAddress &&
          getAddress(event.args.to) === getAddress(mint.mintedTo)
        );
      } catch {
        return false;
      }
    })
  );
  for (const account of [seller, buyer]) {
    await rpc("anvil_setCode", [account.address, "0x"]);
    await rpc("anvil_setBalance", [account.address, toHex(10n ** 20n)]);
  }
  const owner = await client.readContract({
    address: config.contractAddress,
    abi: erc721Abi,
    functionName: "ownerOf",
    args: [tokenId]
  });
  await rpc("anvil_setBalance", [owner, toHex(10n ** 20n)]);
  transferReceipt = await tx(
    owner,
    config.contractAddress,
    encodeFunctionData({
      abi: erc721Abi,
      functionName: "transferFrom",
      args: [owner, seller.address, tokenId]
    })
  );
  const transfer = transferReceipt.logs.find((log) => {
    if (getAddress(log.address) !== getAddress(config.contractAddress))
      return false;
    try {
      const event = decodeEventLog({
        abi: erc721Abi,
        data: log.data,
        topics: log.topics
      });
      return event.eventName === "Transfer" && event.args.tokenId === tokenId;
    } catch {
      return false;
    }
  });
  assert.ok(transfer);
  await tx(
    seller.address,
    config.contractAddress,
    encodeFunctionData({
      abi: erc721Abi,
      functionName: "approve",
      args: [openseaConduit.address, tokenId]
    })
  );
  await pool.query(
    `INSERT INTO yunipals_read_v4.token(collection,chain_id,contract_address,token_id,owner,lifecycle,burned,mint_block,last_transfer_block,last_transaction_hash)
    VALUES($1,$2,$3,$4,$5,$6,false,$7,$8,$9)`,
    [
      chain,
      config.chainId,
      config.contractAddress.toLowerCase(),
      mint.tokenId,
      seller.address.toLowerCase(),
      mint.lifecycle,
      mint.mintBlock,
      String(transferReceipt.blockNumber),
      transferReceipt.transactionHash
    ]
  );
  seeded = true;
  await pool.query(
    "INSERT INTO yunipals_read_v4.token_lifecycle VALUES($1,$2,$3,$4,$5,$6)",
    [
      chain,
      mint.tokenId,
      mint.lifecycle,
      mint.mintBlock,
      mint.mintTransaction,
      mint.mintedTo
    ]
  );
  await pool.query(
    `INSERT INTO yunipals_read_v4.transfer_event(id,collection,token_id,lifecycle,"from","to",block_number,transaction_index,log_index,transaction_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      `${chain}:${transferReceipt.transactionHash}:${transfer.logIndex}`,
      chain,
      mint.tokenId,
      mint.lifecycle,
      owner.toLowerCase(),
      seller.address.toLowerCase(),
      String(transferReceipt.blockNumber),
      transferReceipt.transactionIndex,
      transfer.logIndex,
      transferReceipt.transactionHash
    ]
  );
  await sync();
  pass(
    "Canonical existing mint and actual fork transfer populate consistent indexed lifecycle evidence"
  );
  provider = await fixtureProvider(async (req, res) => {
    assert.equal(req.headers["x-api-key"], "yunipals-fixture-only");
    if (providerOffline) {
      res.writeHead(503);
      res.end();
      return;
    }
    const path = new URL(req.url, "http://127.0.0.1").pathname;
    if (
      req.method === "GET" &&
      path === `/api/v2/listings/collection/${sourceSlug}/all`
    )
      return fixtureJsonResponse(res, {
        listings: [...records.values(), ...discovered]
          .filter((o) => o.order.offer[0].itemType === 2)
          .map(ack),
        next: null
      });
    if (
      req.method === "GET" &&
      path === `/api/v2/offers/collection/${sourceSlug}/all`
    )
      return fixtureJsonResponse(res, {
        offers: [...records.values(), ...discovered]
          .filter((o) => o.order.offer[0].itemType !== 2)
          .map(ack),
        next: null
      });
    if (req.method === "POST" && path === "/api/v2/listings/fulfillment_data") {
      const body = await fixtureJsonBody(req);
      assert.equal(body.listing.chain, chain);
      assert.equal(getAddress(body.fulfiller.address), buyer.address);
      const record =
        records.get(body.listing.hash.toLowerCase()) ??
        discovered.find((o) => o.hash === body.listing.hash.toLowerCase());
      assert.ok(record?.signature);
      const { counter, ...parameters } = record.order;
      const full = {
        parameters: {
          ...parameters,
          totalOriginalConsiderationItems: parameters.consideration.length
        },
        signature: record.signature
      };
      return fixtureJsonResponse(res, {
        protocol: "seaport1.6",
        fulfillment_data: {
          orders: [{ ...full, parameters: { ...full.parameters, counter } }],
          transaction: {
            chain: config.chainId,
            to: seaportDeployment.address,
            value:
              record.order.consideration[0].itemType === 0
                ? price.toString()
                : "0",
            function: "fulfillOrder",
            input_data: { order: full, fulfillerConduitKey: openseaConduit.key }
          }
        }
      });
    }
    if (path.startsWith("/api/v2/chain/"))
      return fixtureJsonResponse(res, {
        address: config.contractAddress,
        chain,
        collection: sourceSlug,
        contract_standard: "erc721"
      });
    if (path === `/api/v2/collections/${sourceSlug}`)
      return fixtureJsonResponse(res, {
        collection: sourceSlug,
        contracts: [{ address: config.contractAddress, chain }],
        is_disabled: false,
        pricing_currencies: {
          listing_currency: {
            chain,
            address: listingCurrency,
            symbol:
              listingCurrency === zeroAddress ? config.nativeSymbol : "WETH",
            decimals: 18
          },
          offer_currency: {
            chain,
            address: currency.address,
            symbol: "WETH",
            decimals: 18
          }
        },
        fees: [{ recipient: feeRecipient, fee: 2.5, required: true }]
      });
    if (
      req.method === "POST" &&
      path.startsWith(`/api/v2/orders/${chain}/seaport/`)
    ) {
      const body = await fixtureJsonBody(req);
      const parameters = { ...body.parameters };
      delete parameters.totalOriginalConsiderationItems;
      const hash = seaportOrderHash(
        decodeSeaportOrder(parameters)
      ).toLowerCase();
      const stored = (
        await pool.query(
          "SELECT signature,publication_state FROM yunipals_market.orders WHERE chain_id=$1 AND order_hash=$2",
          [config.chainId, hash]
        )
      ).rows[0];
      assert.equal(stored.signature, body.signature);
      assert.equal(stored.publication_state, "indeterminate");
      const old = records.get(hash);
      const record = {
        hash,
        order: parameters,
        signature: body.signature,
        posts: (old?.posts ?? 0) + 1
      };
      records.set(hash, record);
      if (hash === crashHash) {
        heldPost = { hash, at: Date.now() };
        return;
      }
      return fixtureJsonResponse(res, ack(record));
    }
    if (
      req.method === "GET" &&
      path.startsWith(`/api/v2/orders/chain/${chain}/protocol/`)
    ) {
      const record = records.get(path.split("/").at(-1).toLowerCase());
      if (record) return fixtureJsonResponse(res, { order: ack(record) });
      res.writeHead(404);
      res.end();
      return;
    }
    throw new Error(`Unexpected fixture route ${path}`);
  });
  await startApi();
  assert.equal(
    Object.values((await request("/v1/market/capabilities")).chains)
      .flatMap(Object.values)
      .some(Boolean),
    false
  );
  if (process.env.MARKET_TEST_COLLECTION_SALES_ONLY === "1") {
    report.scope =
      "Built sale worker and API with restricted PostgreSQL and actual Yunipals/Seaport/WETH settlements on a verified local Anvil fork. Native and WETH listings and WETH offers are signed locally without provider publication or application admission; restart and reorg checks cover each. No live transactions or OpenSea acceptance.";
    await fundWeth();
    await verifyCollectionSaleReplay({
      chain,
      client,
      pool,
      rpcUrl,
      tx,
      seller,
      buyer,
      tokenId,
      base,
      pass,
      report
    });
  } else {
    const listing = await publish("listing", seller);
    assert.equal(
      (await request("/v1/market/orders", listing.payload)).publicationState,
      "pending"
    );
    await startWorker();
    await accepted(listing);
    assert.equal(records.get(listing.hash).posts, 1);
    pass(
      "Built API and worker admit, persist and acknowledge an actual conduit-backed native listing idempotently"
    );
    await observed(listing, "active");
    await verifyFulfillment(listing);
    const importedListing = await discoverOrder(listing, "listing");
    await discoveredObserved(
      importedListing,
      "authorization-required",
      "maker_signature_required"
    );
    await scanSide("offer");
    const assetPath = `/v1/market/assets/${chain}/${config.contractAddress}/${mint.tokenId}`;
    let unknownBook;
    await until(async () => {
      unknownBook = await request(assetPath);
      return unknownBook.sourceStatus === "syncing";
    }, "Worker health did not establish the unsigned discovery source state");
    assert.deepEqual(unknownBook.listings, []);
    await verifyFulfillment(importedListing, true);
    await discoveredObserved(importedListing, "eligible");
    const makerProof = (
      await pool.query(
        "SELECT signature,validation_actor,block_hash FROM yunipals_market.opensea_maker_signature WHERE chain_id=$1 AND order_hash=$2",
        [config.chainId, importedListing.hash]
      )
    ).rows[0];
    assert.equal(makerProof.signature, importedListing.signature);
    assert.equal(makerProof.validation_actor, buyer.address.toLowerCase());
    assert.ok(makerProof.block_hash);
    assert.equal(
      (
        await client.readContract({
          address: seaportDeployment.address,
          abi: seaportReadAbi,
          functionName: "getOrderStatus",
          args: [importedListing.hash]
        })
      )[0],
      false
    );
    pass(
      "Fulfillment retains the verified maker signature and enables worker eligibility without broadcasting Seaport validation"
    );
    let book;
    await until(async () => {
      book = await request(assetPath);
      return book.sourceStatus === "available";
    }, "Complete scans and actual Seaport validation did not enable reads");
    assert.deepEqual(
      book.listings.map((o) => o.orderHash).sort(),
      [listing.hash, importedListing.hash].sort()
    );
    const wallet = await request(
      `/v1/market/wallets/${seller.address}/orders?chain=${chain}&view=listings&limit=25`
    );
    assert.deepEqual(
      wallet.items.map((o) => o.order.orderHash).sort(),
      [listing.hash, importedListing.hash].sort()
    );
    const catalog = await request(
      `/v1/market/tokens?chain=${chain}&sale=listed&currency=native&sort=price-asc`
    );
    assert.equal(catalog.total, 1);
    assert.equal(catalog.listedTotal, 1);
    assert.deepEqual(
      (
        await request(`${orderPath(importedListing.hash)}/cancellation`, {
          actor: seller.address
        })
      ).order,
      importedListing.order
    );
    report.reads = {
      sourceStatus: book.sourceStatus,
      listedTotal: catalog.listedTotal,
      uniqueWalletOrders: wallet.items.length,
      makerSignatureRetained: true,
      onchainValidated: false
    };
    pass(
      "Built HTTP reads merge retained and independently discovered orders once, with complete scans and real Seaport maker validation"
    );
    await tx(
      seller.address,
      config.contractAddress,
      encodeFunctionData({
        abi: erc721Abi,
        functionName: "approve",
        args: [zeroAddress, tokenId]
      })
    );
    await sync();
    await observed(listing, "unavailable", "nft_approval_required");
    await discoveredObserved(
      importedListing,
      "unavailable",
      "nft_approval_required"
    );
    await tx(
      seller.address,
      config.contractAddress,
      encodeFunctionData({
        abi: erc721Abi,
        functionName: "approve",
        args: [openseaConduit.address, tokenId]
      })
    );
    await sync();
    await observed(listing, "active");
    await discoveredObserved(importedListing, "eligible");
    await tx(
      seller.address,
      seaportDeployment.address,
      encodeFunctionData({
        abi: seaportWriteAbi,
        functionName: "cancel",
        args: [[decodeSeaportOrder(importedListing.order)]]
      })
    );
    await sync();
    await discoveredObserved(importedListing, "cancelled");
    const history = await request(
      `/v1/market/wallets/${seller.address}/orders?chain=${chain}&view=history&limit=25`
    );
    assert.ok(
      history.items.some(
        (o) =>
          o.order.orderHash === importedListing.hash &&
          o.order.status === "cancelled"
      )
    );
    assert.deepEqual(
      (
        await request(`${orderPath(importedListing.hash)}/cancellation`, {
          actor: seller.address
        })
      ).order,
      importedListing.order
    );
    pass(
      "HTTP wallet history and cancellation retain independently discovered orders after confirmed cancellation"
    );
    pass(
      "Discovered unsigned listing follows actual approval changes and cancellation without local submission or invented maker authorization"
    );
    pass(
      "Built worker observes actual NFT approval revocation and restoration after provider acceptance"
    );
    await cancel(listing);
    await sync();
    await observed(listing, "cancelled");
    pass(
      "API cancellation parameters cancel the exact listing through real Seaport"
    );
    const replacement = await publish("listing", seller, true);
    await until(
      async () => heldPost?.hash === replacement.hash,
      "Worker did not reach held provider POST"
    );
    await stop(worker, "SIGKILL");
    const lease = (
      await pool.query(
        "SELECT lease_until FROM yunipals_market.job WHERE kind='opensea_submission' AND payload->>'orderHash'=$1 AND state='running'",
        [replacement.hash]
      )
    ).rows[0];
    assert.ok(lease?.lease_until > new Date());
    const killedAt = Date.now();
    heartbeat = setInterval(() => {
      heartbeats = heartbeats.then(sync);
      void heartbeats.catch(() => {});
    }, 10000);
    await startWorker();
    console.log(`WAIT real worker lease expiry on ${chain}`);
    await until(
      async () => (await request(orderPath(replacement.hash))).providerAccepted,
      "Restart did not reclaim the real expired lease",
      110000
    );
    clearInterval(heartbeat);
    heartbeat = undefined;
    await heartbeats;
    assert.equal(records.get(replacement.hash).posts, 1);
    report.crashRecovery = {
      waitedMs: Date.now() - killedAt,
      originalLeaseUntil: lease.lease_until.toISOString(),
      posts: records.get(replacement.hash).posts
    };
    pass(
      "SIGKILL after remote receipt recovers through exact lookup after the real lease expires, without a second POST"
    );
    await cancel(replacement);
    await fundWeth();
    const offer = await publish("offer", buyer);
    await accepted(offer);
    await observed(offer, "active");
    const importedOffer = await discoverOrder(offer, "offer");
    await discoveredObserved(
      importedOffer,
      "authorization-required",
      "maker_signature_required"
    );
    await tx(
      buyer.address,
      currency.address,
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [openseaConduit.address, 0n]
      })
    );
    await sync();
    await observed(offer, "unavailable", "offer_funding_required");
    await discoveredObserved(
      importedOffer,
      "unavailable",
      "offer_funding_required"
    );
    await tx(
      buyer.address,
      currency.address,
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [openseaConduit.address, price]
      })
    );
    await sync();
    await observed(offer, "active");
    await discoveredObserved(
      importedOffer,
      "authorization-required",
      "maker_signature_required"
    );
    pass(
      "Discovered unsigned offer follows actual WETH allowance revocation and restoration without local admission"
    );
    pass(
      "Built worker observes actual WETH allowance revocation and restoration for a signed-zone offer"
    );
    await cancel(offer);
    await sync();
    await observed(offer, "cancelled");
    pass(
      "Actual WETH funding/allowance and signed-zone offer pass API admission, fixture acceptance and onchain cancellation"
    );
    listingCurrency = currency.address;
    // Policy caching is bounded; the next prepare and worker send force refresh.
    await delay(20500);
    const wethListing = await publish("listing", seller);
    await accepted(wethListing);
    await observed(wethListing, "active");
    pass(
      "Provider-reported WETH listing policy produces the exact admitted and acknowledged ERC20 order"
    );
    await verifyFulfillment(wethListing);
    await stop(worker);
    worker = undefined;
    await verifyCollectionSaleReplay({
      chain,
      client,
      pool,
      rpcUrl,
      tx,
      seller,
      buyer,
      tokenId,
      base,
      pass,
      report
    });
    providerOffline = true;
    await startApi(false);
    for (const order of [listing, replacement, offer, wethListing]) {
      assert.equal(
        (await request(orderPath(order.hash))).providerAccepted,
        true
      );
      assert.ok(
        (
          await request(`${orderPath(order.hash)}/cancellation`, {
            actor: order.maker.address
          })
        ).order
      );
    }
    await request("/v1/market/orders", wethListing.payload, 503);
    await cancel(wethListing);
    pass(
      "Restart with new admission disabled preserves acknowledged-order and cancellation recovery during provider outage"
    );
  }
  report.status = "passed";
  report.orderHashes = hashes;
} catch (error) {
  report.status = "failed";
  report.failure = String(error);
  throw error;
} finally {
  clearInterval(heartbeat);
  const failures = [];
  for (const cleanup of [
    () => heartbeats,
    () => stop(worker),
    () => stop(api),
    () => provider?.close()
  ]) {
    try {
      await cleanup();
    } catch (error) {
      failures.push(String(error));
    }
  }
  try {
    for (const table of [
      "opensea_discovered_state",
      "opensea_discovered_order"
    ])
      await pool.query(
        `DELETE FROM yunipals_market.${table} WHERE chain_id=$1 AND order_hash=ANY($2::text[])`,
        [config.chainId, [...hashes, ...discovered.map((o) => o.hash)]]
      );
    for (const scan of discoveryScans)
      for (const table of ["opensea_discovery_page", "opensea_discovery_scan"])
        await pool.query(
          `DELETE FROM yunipals_market.${table} WHERE chain_id=$1 AND side=$2 AND run_id=$3`,
          [config.chainId, scan.side, scan.run_id]
        );
    await pool.query(
      "DELETE FROM yunipals_market.job WHERE kind IN ('opensea_submission','opensea_order_reconcile') AND payload->>'orderHash'=ANY($1::text[])",
      [hashes]
    );
    for (const table of ["submission_attempt", "orders", "preparation"])
      await pool.query(
        `DELETE FROM yunipals_market.${table} WHERE chain_id=$1 AND order_hash=ANY($2::text[])`,
        [config.chainId, hashes]
      );
    if (seeded)
      for (const table of ["transfer_event", "token_lifecycle", "token"])
        await pool.query(
          `DELETE FROM yunipals_read_v4.${table} WHERE collection=$1 AND token_id=$2`,
          [chain, mint.tokenId]
        );
    if (capturedIndexerState) {
      if (priorCursor)
        await pool.query(
          "UPDATE yunipals_indexer_v3._ponder_checkpoint SET latest_checkpoint=$2 WHERE chain_id=$1",
          [config.chainId, priorCursor.latest_checkpoint]
        );
      else
        await pool.query(
          "DELETE FROM yunipals_indexer_v3._ponder_checkpoint WHERE chain_id=$1",
          [config.chainId]
        );
      if (priorMeta)
        await pool.query(
          "UPDATE yunipals_indexer_v3._ponder_meta SET value=$1 WHERE key='app'",
          [priorMeta.value]
        );
      else
        await pool.query(
          "DELETE FROM yunipals_indexer_v3._ponder_meta WHERE key='app'"
        );
    }
    if (priorReadCheckpoints) {
      await pool.query(
        "DELETE FROM yunipals_market.checkpoint WHERE chain_id=$1 AND name IN ('opensea-order-worker','opensea-read-reorg')",
        [config.chainId]
      );
      await pool.query(
        "INSERT INTO yunipals_market.checkpoint SELECT * FROM jsonb_populate_recordset(NULL::yunipals_market.checkpoint,$1::jsonb)",
        [JSON.stringify(priorReadCheckpoints)]
      );
      report.readCheckpointCleanup = { restored: priorReadCheckpoints.length };
    }
  } catch (error) {
    failures.push(String(error));
  }
  try {
    if (snapshot) assert.equal(await rpc("evm_revert", [snapshot]), true);
  } catch (error) {
    failures.push(String(error));
  }
  try {
    await db.close();
  } catch (error) {
    failures.push(String(error));
  }
  if (failures.length) {
    report.status = "failed";
    report.cleanupFailures = failures;
  }
  await writeFile(
    process.env.MARKET_TEST_FORK_REPORT ??
      `/tmp/yunipals-opensea-${chain}-api-fork.json`,
    JSON.stringify(report, null, 2) + "\n"
  );
  if (failures.length) throw new Error("OpenSea fork harness cleanup failed");
}
