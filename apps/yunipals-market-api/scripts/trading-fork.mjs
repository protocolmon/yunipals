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
  parseAbiItem,
  toHex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  marketplaceChains,
  bnbOfferCurrency,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import { seaportReadAbi } from "@protopals/yunipals-market-core/seaport";
import { testUrl } from "../src/bnb/fixtures/database.ts";
import { runBrowserTrading } from "./trading-browser.mjs";

const databaseUrl = testUrl("MARKET_TEST_DATABASE_URL");
const runtimeUrl = testUrl("MARKET_TEST_RUNTIME_DATABASE_URL");
const ownerEndpoint = new URL(databaseUrl),
  runtimeEndpoint = new URL(runtimeUrl);
assert.equal(
  `${runtimeEndpoint.hostname}:${runtimeEndpoint.port}${runtimeEndpoint.pathname}`,
  `${ownerEndpoint.hostname}:${ownerEndpoint.port}${ownerEndpoint.pathname}`,
  "Owner and runtime must target the same isolated fixture database"
);
const rpcUrl = process.env.MARKET_TEST_FORK_RPC ?? "http://127.0.0.1:18647";
const appUrl = process.env.MARKET_TEST_BROWSER_URL ?? "http://127.0.0.1:5177";
for (const value of [rpcUrl, appUrl]) {
  const url = new URL(value);
  assert.ok(
    url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
      !url.username &&
      !url.password
  );
}
const client = createPublicClient({
  transport: http(rpcUrl, { retryCount: 0, timeout: 10000 }),
  cacheTime: 0
});
const rpc = (method, params = []) => client.request({ method, params });
assert.match(await rpc("web3_clientVersion"), /anvil/i);
const metadata = await rpc("anvil_metadata");
assert.equal(metadata.forkedNetwork?.chainId, 56);
assert.equal(await client.getChainId(), 56);
const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 4,
  statement_timeout: 5000
});
let indexerPool = pool;
let activeRuntimeUrl = runtimeUrl;
let restore;
const seller = privateKeyToAccount(`0x${"01".repeat(32)}`);
const buyer = privateKeyToAccount(`0x${"02".repeat(32)}`);
const asset = {
  chain: "bnb",
  chainId: 56,
  contractAddress: marketplaceChains.bnb.contractAddress,
  tokenId: process.env.MARKET_TEST_FORK_TOKEN ?? "10000000001"
};
const apiBase = "http://127.0.0.1:19612";
const report = {
  checkedAt: new Date().toISOString(),
  status: "running",
  forkBlock: metadata.forkedNetwork.forkBlockNumber,
  asset,
  scope:
    "Actual Chromium trading UI, built API/worker, restricted PostgreSQL runtime and Seaport on a verified local BNB fork. Simulated test EOA wallet; isolated indexer relations synchronized from fork receipts. No live trades, provider publication or real wallet-connector certification.",
  tests: []
};
const processes = new Map();
let snapshot;
let initialized = false;
let previousSync;
let remote;
const pass = (name) => {
  report.tests.push({ name, status: "passed" });
  process.stdout.write(`PASS ${name}\n`);
};
async function stop(name) {
  if (remote) return remote.stop(name);
  const child = processes.get(name);
  if (!child) return;
  if (child.process.exitCode === null) child.process.kill("SIGTERM");
  const deadline = setTimeout(() => child.process.kill("SIGKILL"), 18000);
  try {
    const [code, signal] = await child.closed;
    assert.equal(signal, null, child.output);
    assert.equal(code, 0, child.output);
  } finally {
    clearTimeout(deadline);
    processes.delete(name);
  }
}
async function start(name, trading = true) {
  await stop(name);
  if (remote) {
    await remote.start(name, trading);
    if (name === "server") {
      const until = Date.now() + 15000;
      while (Date.now() < until) {
        try {
          if ((await fetch(`${apiBase}/health/ready`)).ok) return;
        } catch {}
        await delay(250);
      }
      throw new Error("Remote staging API startup timed out");
    }
    return;
  }
  const env = {
    ...process.env,
    MARKET_DEPLOYMENT: "staging",
    MARKET_DATABASE_URL: activeRuntimeUrl,
    MARKET_PORT: "19612",
    MARKET_ALLOWED_ORIGINS: new URL(appUrl).origin
  };
  if (name === "worker" || trading) env.MARKET_BNB_VALIDATION_RPC = rpcUrl;
  else delete env.MARKET_BNB_VALIDATION_RPC;
  env.MARKET_BNB_VALIDATION_TRADING = name === "server" && trading ? "1" : "0";
  delete env.NODE_TEST_CONTEXT;
  const childProcess = spawn(process.execPath, [`dist/${name}.mjs`], {
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const child = {
    process: childProcess,
    closed: once(childProcess, "close"),
    output: ""
  };
  processes.set(name, child);
  for (const stream of [childProcess.stdout, childProcess.stderr])
    stream.on("data", (chunk) => {
      child.output = (child.output + chunk).slice(-65536);
    });
  if (name === "server") {
    const until = Date.now() + 10000;
    while (Date.now() < until) {
      if (childProcess.exitCode !== null) throw new Error(child.output);
      try {
        if ((await fetch(`${apiBase}/health/ready`)).ok) return;
      } catch {}
      await delay(100);
    }
    throw new Error(`API startup timed out: ${child.output}`);
  }
}
let cursor;
async function syncAsset() {
  const previous = await client.getBlock({ blockTag: "latest" });
  const timestamp = Math.max(
    Number(previous.timestamp) + 1,
    Math.floor(Date.now() / 1000)
  );
  await rpc("evm_setNextBlockTimestamp", [timestamp]);
  await rpc("anvil_mine", ["0x19", "0x0"]);
  const head = await client.getBlock({ blockTag: "latest" });
  const block = await client.getBlock({ blockNumber: head.number - 20n });
  const owner = await client.readContract({
    address: asset.contractAddress,
    abi: erc721Abi,
    functionName: "ownerOf",
    args: [BigInt(asset.tokenId)],
    blockNumber: block.number
  });
  if (cursor !== undefined && cursor < block.number) {
    const logs = await client.getLogs({
      address: asset.contractAddress,
      event: parseAbiItem(
        "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
      ),
      args: { tokenId: BigInt(asset.tokenId) },
      fromBlock: cursor + 1n,
      toBlock: block.number,
      strict: true
    });
    for (const log of logs)
      await indexerPool.query(
        `INSERT INTO yunipals_read_v4.transfer_event(id,collection,token_id,lifecycle,"from","to",block_number,transaction_index,log_index)
      VALUES($1,'bnb',$2,0,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING`,
        [
          `${log.blockHash}:${log.logIndex}`,
          asset.tokenId,
          log.args.from.toLowerCase(),
          log.args.to.toLowerCase(),
          log.blockNumber.toString(),
          log.transactionIndex,
          log.logIndex
        ]
      );
  }
  await indexerPool.query(
    "UPDATE yunipals_read_v4.token SET owner=$1,last_transfer_block=$2 WHERE collection='bnb' AND token_id=$3",
    [owner.toLowerCase(), block.number.toString(), asset.tokenId]
  );
  await indexerPool.query(
    `UPDATE bnb_indexer.sync_state SET next_block=$1,last_scanned_block=$2,last_scanned_hash=$3,caught_up_at=clock_timestamp(),last_error=NULL,updated_at=clock_timestamp() WHERE singleton`,
    [
      (block.number + 1n).toString(),
      block.number.toString(),
      block.hash.toLowerCase()
    ]
  );
  cursor = block.number;
}
async function transaction(from, to, data, value = 0n, sync = true) {
  await rpc("anvil_impersonateAccount", [from]);
  try {
    const hash = await rpc("eth_sendTransaction", [
      { from, to, data, value: toHex(value) }
    ]);
    await rpc("evm_mine");
    const receipt = await client.getTransactionReceipt({ hash });
    assert.equal(receipt.status, "success");
    if (sync) await syncAsset();
    return hash;
  } finally {
    await rpc("anvil_stopImpersonatingAccount", [from]);
  }
}
try {
  if (process.env.MARKET_TEST_STAGING_REMOTE === "1") {
    const { createStagingControl } = await import("./staging-control.mjs");
    remote = await createStagingControl({
      pool,
      fork: metadata,
      appUrl,
      rpcUrl
    });
    report.deployedPreview = remote.identity;
    report.scope =
      "Local Chromium over authenticated SSH tunnels to the server's immutable frontend, API, worker, disposable PostgreSQL database and verified BNB Anvil fork. Scripted test wallet and fork-derived indexer fixtures; no live trades or actual wallet-connector certification.";
  }
  if (process.env.MARKET_TEST_RESTORE === "1") {
    const { createRestoreHarness } = await import("./restore-harness.mjs");
    restore = await createRestoreHarness({
      sourceUrl: databaseUrl,
      sourcePool: pool,
      client
    });
    report.restore = restore.report;
  }
  assert.equal(
    (
      await pool.query(
        "SELECT environment FROM yunipals_market.deployment WHERE singleton"
      )
    ).rows[0]?.environment,
    "staging"
  );
  for (const table of [
    "orders",
    "preparation",
    "sale",
    "sale_receipt",
    "snapshot",
    "activity_block",
    "job"
  ])
    assert.equal(
      (await pool.query(`SELECT count(*) FROM yunipals_market.${table}`))
        .rows[0].count,
      "0",
      `Use the dedicated empty browser fixture database: ${table}`
    );
  assert.equal(
    (await pool.query("SELECT count(*) FROM yunipals_read_v4.token")).rows[0]
      .count,
    "0"
  );
  for (const table of [
    "token_metadata",
    "token_search",
    "token_trait",
    "token_visibility"
  ])
    assert.equal(
      (await pool.query(`SELECT count(*) FROM metadata.${table}`)).rows[0]
        .count,
      "0",
      `Use empty metadata fixture relations: ${table}`
    );
  assert.equal(
    (await pool.query("SELECT count(*) FROM yunipals_read_v4.transfer_event"))
      .rows[0].count,
    "0"
  );
  previousSync = (
    await pool.query("SELECT * FROM bnb_indexer.sync_state WHERE singleton")
  ).rows[0];
  snapshot = await rpc("evm_snapshot");
  initialized = true;
  // Read actual upstream storage into Anvil's fork cache before a public RPC
  // prunes this block. Each future block updates one EIP-2935 history slot;
  // otherwise mining itself can crash after upstream history disappears.
  // https://eips.ethereum.org/EIPS/eip-2935#block-processing
  const historyAddress = "0x0000F90827F1C53a10cb7A02335B175320002935";
  for (let offset = 0; offset < 512; offset += 8) {
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        client.getStorageAt({
          address: historyAddress,
          slot: toHex(
            (BigInt(metadata.forkedNetwork.forkBlockNumber) +
              BigInt(offset + index)) %
              8191n,
            { size: 32 }
          )
        })
      )
    );
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
      assert.match(result.value ?? "", /^0x[0-9a-fA-F]{64}$/);
    }
  }
  const warmReads = await Promise.allSettled(
    [seller, buyer].flatMap((wallet) => [
      client.readContract({
        address: seaportDeployment.address,
        abi: seaportReadAbi,
        functionName: "getCounter",
        args: [wallet.address]
      }),
      client.readContract({
        address: asset.contractAddress,
        abi: erc721Abi,
        functionName: "isApprovedForAll",
        args: [wallet.address, seaportDeployment.address]
      }),
      client.readContract({
        address: bnbOfferCurrency.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [wallet.address]
      }),
      client.readContract({
        address: bnbOfferCurrency.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [wallet.address, seaportDeployment.address]
      })
    ])
  );
  for (const result of warmReads)
    if (result.status === "rejected") throw result.reason;
  report.forkCache = {
    historySlots: 512,
    walletReads: 8,
    source:
      "Actual fork RPC reads; no storage replacement or protocol-rule changes"
  };
  await rpc("evm_setAutomine", [true]);
  for (const wallet of [seller, buyer]) {
    await rpc("anvil_setCode", [wallet.address, "0x"]);
    await rpc("anvil_setBalance", [wallet.address, toHex(100n * 10n ** 18n)]);
  }
  const originalOwner = await client.readContract({
    address: asset.contractAddress,
    abi: erc721Abi,
    functionName: "ownerOf",
    args: [BigInt(asset.tokenId)]
  });
  await rpc("anvil_setBalance", [originalOwner, toHex(100n * 10n ** 18n)]);
  if (originalOwner.toLowerCase() !== seller.address.toLowerCase())
    await transaction(
      originalOwner,
      asset.contractAddress,
      encodeFunctionData({
        abi: erc721Abi,
        functionName: "transferFrom",
        args: [originalOwner, seller.address, BigInt(asset.tokenId)]
      }),
      0n,
      false
    );
  await pool.query(
    `INSERT INTO yunipals_read_v4.token(collection,chain_id,contract_address,token_id,owner,lifecycle,burned) VALUES('bnb',56,$1,$2,$3,0,false)`,
    [
      asset.contractAddress.toLowerCase(),
      asset.tokenId,
      seller.address.toLowerCase()
    ]
  );
  await pool.query(
    `INSERT INTO metadata.token_metadata(collection,token_id,lifecycle,name,attributes) VALUES('bnb',$1,0,'Yunipal browser fixture','[]')`,
    [asset.tokenId]
  );
  await pool.query(
    `INSERT INTO metadata.token_search(collection,token_id,lifecycle,metadata_available,rarity_points,rarity_points_capped) VALUES('bnb',$1,0,true,4,4)`,
    [asset.tokenId]
  );
  await syncAsset();
  await start("worker");
  await start("server");
  const until = Date.now() + 10000;
  let available = false;
  while (Date.now() < until) {
    const res = await fetch(
      `${apiBase}/v1/market/assets/bnb/${asset.contractAddress}/${asset.tokenId}`
    );
    if (res.ok && (await res.json()).sourceStatus === "available") {
      available = true;
      break;
    }
    await delay(100);
  }
  assert.ok(
    available,
    "Real worker/indexer observations establish available BNB reads"
  );
  report.browser = await runBrowserTrading({
    client,
    rpc,
    transaction,
    pool,
    seller,
    buyer,
    asset,
    apiBase,
    appUrl,
    pass,
    stopApi: () => stop("server"),
    startApi: (enabled) => start("server", enabled),
    stopWorker: () => stop("worker"),
    startWorker: () => start("worker"),
    beforeOfferFill: restore
      ? async () => {
          await stop("worker");
          await stop("server");
          await restore.capture();
          await start("worker");
          await start("server");
        }
      : undefined,
    afterOfferFill: restore
      ? async ({ offer, recoverable }) => {
          await stop("worker");
          await stop("server");
          const restored = await restore.restore();
          activeRuntimeUrl = restored.runtimeUrl;
          indexerPool = restored.pool;
          cursor = BigInt(
            (
              await indexerPool.query(
                "SELECT last_scanned_block FROM bnb_indexer.sync_state WHERE singleton"
              )
            ).rows[0].last_scanned_block
          );
          assert.ok(
            cursor >= BigInt(metadata.forkedNetwork.forkBlockNumber),
            "Replay only this fork's isolated indexer gap"
          );
          await syncAsset();
          await start("worker");
          await start("server", false);
          return restore.replayed({
            base: apiBase,
            hash: offer,
            recoverable,
            actor: buyer.address,
            asset
          });
        }
      : undefined
  });
  if (restore) await restore.finish(report.browser.recoverableOrderHash);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = { name: error.name, message: error.message };
  report.processes = Object.fromEntries(
    [...processes.entries()].map(([name, child]) => [name, child.output])
  );
  report.checkpoints = (
    await pool
      .query(
        "SELECT name,state,block_number,checked_at,last_error_code FROM yunipals_market.checkpoint WHERE chain_id=56"
      )
      .catch(() => ({ rows: [] }))
  ).rows;
  throw error;
} finally {
  const failures = [];
  for (const task of [() => stop("server"), () => stop("worker")])
    try {
      await task();
    } catch (error) {
      failures.push(error.message);
    }
  try {
    await restore?.close();
  } catch (error) {
    failures.push(error.message);
  }
  if (initialized)
    try {
      // This runner refuses a nonempty database before initialization, so every
      // marketplace operation below belongs to this disposable browser run.
      for (const table of [
        "snapshot",
        "sale",
        "sale_receipt",
        "activity_block",
        "job",
        "orders",
        "preparation"
      ])
        await pool.query(`DELETE FROM yunipals_market.${table}`);
      await pool.query(`UPDATE yunipals_market.checkpoint SET block_number=NULL,block_hash=NULL,coverage_start=NULL,coverage_start_time=NULL,replay_from=NULL,
      state='syncing',checked_at=NULL,last_error_code=NULL,generation=generation+1,canonical_generation=canonical_generation+1 WHERE source='chain' AND chain_id=56`);
      for (const table of [
        "token_metadata",
        "token_search",
        "token_trait",
        "token_visibility"
      ])
        await pool.query(
          `DELETE FROM metadata.${table} WHERE collection='bnb' AND token_id=$1`,
          [asset.tokenId]
        );
      for (const table of ["transfer_event", "token"])
        await pool.query(
          `DELETE FROM yunipals_read_v4.${table} WHERE collection='bnb' AND token_id=$1`,
          [asset.tokenId]
        );
      if (previousSync)
        await pool.query(
          `UPDATE bnb_indexer.sync_state SET next_block=$1,last_scanned_block=$2,last_scanned_hash=$3,caught_up_at=$4,last_error=$5,updated_at=$6 WHERE singleton`,
          [
            previousSync.next_block,
            previousSync.last_scanned_block,
            previousSync.last_scanned_hash,
            previousSync.caught_up_at,
            previousSync.last_error,
            previousSync.updated_at
          ]
        );
      assert.equal(await rpc("evm_revert", [snapshot]), true);
    } catch (error) {
      failures.push(error.message);
    }
  await pool.end();
  if (failures.length) {
    report.status = "failed";
    report.cleanupFailures = failures;
  }
  await writeFile(
    process.env.MARKET_TEST_FORK_REPORT ??
      "/tmp/yunipals-browser-trading-fork.json",
    JSON.stringify(report, null, 2) + "\n"
  );
  if (failures.length)
    throw new Error("Browser trading fixture cleanup failed.");
}
