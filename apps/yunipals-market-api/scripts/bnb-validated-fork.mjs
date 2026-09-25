import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  erc721Abi,
  http,
  parseAbi,
  toEventSelector,
  toHex,
  zeroAddress,
  zeroHash
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";

import { bnbOfferCurrency, marketplaceChains, seaportDeployment } from "@protopals/yunipals-market-core/registry";
import {
  createItemOffer,
  createNativeListing,
  seaportOrderHash,
  seaportReadAbi,
  seaportWriteAbi
} from "@protopals/yunipals-market-core/seaport";
import { seaportEventAbi } from "@protopals/yunipals-market-core/seaportEvents";
import { migrate } from "../src/db/migrate.ts";
import { runBnbDiscoveryPass } from "../src/bnb/discovery.ts";
import { BnbDiscoveryReadService } from "../src/reads/bnbDiscovery.ts";
import { OrderReadService } from "../src/reads/orders.ts";

const httpChild = fileURLToPath(new URL("./bnb-validated-http-child.mjs", import.meta.url));
async function startHttp(databaseUrl) {
  const child = fork(httpChild, [], {
    execArgv: ["--import", "tsx"],
    env: {
      PATH: process.env.PATH,
      MARKET_TEST_DATABASE_URL: databaseUrl
    },
    stdio: ["ignore", "ignore", "inherit", "ipc"]
  });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Fork HTTP child did not start")), 15_000);
    child.once("message", (message) => {
      clearTimeout(timeout);
      if (typeof message?.port === "number") resolve(message.port);
      else reject(new Error("Fork HTTP child returned no port"));
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Fork HTTP child exited during startup: ${code}`));
    });
  });
  return { child, url: `http://127.0.0.1:${port}` };
}
async function stopHttp(server) {
  if (!server || server.child.exitCode !== null || server.child.signalCode !== null) return;
  const stopped = once(server.child, "exit");
  server.child.kill("SIGTERM");
  await stopped;
}

const urls = [process.env.MARKET_TEST_DATABASE_URL_A, process.env.MARKET_TEST_DATABASE_URL_B];
assert.ok(urls.every(Boolean), "Set two disposable fork database URLs");
assert.notEqual(urls[0], urls[1]);
const endpoints = urls.map((value) => new URL(value));
assert.notEqual(endpoints[0].port, endpoints[1].port, "Use two independent database hosts");
assert.notEqual(endpoints[0].username, endpoints[1].username, "Use separate database roles");
for (const [index, url] of endpoints.entries()) {
  assert.equal(url.pathname, `/yunipals_bnb_fork_${index === 0 ? "a" : "b"}`);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
}
const forbidden = new URL(endpoints[1]);
forbidden.host = endpoints[0].host;
forbidden.pathname = endpoints[0].pathname;
const forbiddenPool = new pg.Pool({ connectionString: forbidden.toString(), connectionTimeoutMillis: 2000 });
try {
  await assert.rejects(forbiddenPool.query("SELECT 1"));
} finally {
  await forbiddenPool.end();
}
const rpcUrl = process.env.MARKET_TEST_FORK_RPC ?? "http://127.0.0.1:18647";
const rpcEndpoint = new URL(rpcUrl);
assert.equal(rpcEndpoint.protocol, "http:");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(rpcEndpoint.hostname));
const client = createPublicClient({ chain: bsc, transport: http(rpcUrl, { retryCount: 0 }) });
const history = createPublicClient({
  chain: bsc,
  transport: http("https://bsc-dataseed.bnbchain.org", { retryCount: 0 })
});
const rpc = (method, params = []) => client.request({ method, params });
async function localReceipt(hash) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { return await client.getTransactionReceipt({ hash }); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Fork receipt did not become available for ${hash}`);
}
function hasValidatedEvent(receipt, hash) {
  return receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== seaportDeployment.address.toLowerCase()) return false;
    try {
      const event = decodeEventLog({ abi: seaportEventAbi, data: log.data, topics: log.topics });
      return event.eventName === "OrderValidated" && event.args.orderHash.toLowerCase() === hash;
    } catch { return false; }
  });
}
const metadata = await rpc("anvil_metadata");
assert.equal(metadata.forkedNetwork?.chainId, 56, "Use a verified BNB Anvil fork");
const seller = privateKeyToAccount(`0x${"01".repeat(32)}`);
const buyer = privateKeyToAccount(`0x${"02".repeat(32)}`);
const collection = marketplaceChains.bnb.contractAddress;
const tokenId = 10_000_000_001n;
const mintTx = "0xe0c903050845974390f395be62925bb5d66c7bb825be777e3817115e6448ceef";
const mint = await history.getTransactionReceipt({ hash: mintTx });
assert.equal(mint.blockNumber, 7_581_735n);
const mintLog = mint.logs.find((log) => {
  if (log.address.toLowerCase() !== collection.toLowerCase()) return false;
  try {
    const event = decodeEventLog({ abi: erc721Abi, data: log.data, topics: log.topics });
    return event.eventName === "Transfer" && event.args.from === zeroAddress && event.args.tokenId === tokenId;
  } catch { return false; }
});
assert.ok(mintLog, "Mint fixture must be verified from the public chain receipt");
const originalOwner = await client.readContract({
  address: collection, abi: erc721Abi, functionName: "ownerOf", args: [tokenId]
});
await rpc("anvil_setBalance", [originalOwner, toHex(100n * 10n ** 18n)]);
await rpc("anvil_setBalance", [seller.address, toHex(100n * 10n ** 18n)]);
await rpc("anvil_setBalance", [buyer.address, toHex(100n * 10n ** 18n)]);
await rpc("anvil_impersonateAccount", [originalOwner]);
const transferHash = await rpc("eth_sendTransaction", [{
  from: originalOwner, to: collection,
  data: encodeFunctionData({
    abi: erc721Abi, functionName: "transferFrom",
    args: [originalOwner, seller.address, tokenId]
  })
}]);
const transfer = await localReceipt(transferHash);
await rpc("anvil_stopImpersonatingAccount", [originalOwner]);
assert.equal(transfer.status, "success");
const wallet = createWalletClient({ account: seller, chain: bsc, transport: http(rpcUrl) });
const approval = await wallet.writeContract({
  address: collection, abi: erc721Abi, functionName: "setApprovalForAll",
  args: [seaportDeployment.address, true]
});
assert.equal((await localReceipt(approval)).status, "success");
const counter = await client.readContract({
  address: seaportDeployment.address, abi: seaportReadAbi,
  functionName: "getCounter", args: [seller.address]
});
const head = await client.getBlock();
const order = createNativeListing({
  seller: seller.address, collection, tokenId, totalPrice: 10n ** 15n,
  startTime: head.timestamp - 30n, endTime: head.timestamp + 3_600n,
  counter, salt: 17_000_000_000n + BigInt(Date.now() % 1_000_000)
});
const expectedHash = seaportOrderHash(order).toLowerCase();
const { counter: _counter, ...withoutCounter } = order;
const parameters = {
  ...withoutCounter,
  totalOriginalConsiderationItems: BigInt(order.consideration.length)
};
const validationTx = await wallet.writeContract({
  address: seaportDeployment.address, abi: seaportWriteAbi,
  functionName: "validate", args: [[{ parameters, signature: "0x" }]]
});
const validation = await localReceipt(validationTx);
assert.equal(validation.status, "success");
assert.ok(hasValidatedEvent(validation, expectedHash));
const status = await client.readContract({
  address: seaportDeployment.address, abi: seaportReadAbi,
  functionName: "getOrderStatus", args: [expectedHash]
});
assert.equal(status[0], true);

await rpc("anvil_mine", ["0x42", "0x0"]);
const anchor = await client.getBlock({ blockTag: "finalized" });
assert.ok(anchor.number >= validation.blockNumber);
const pools = urls.map((url) => new pg.Pool({ connectionString: url }));
const policy = {
  version: "fork-test-v1",
  rules: {
    collection,
    offerCurrency: "0xBB4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    fees: [],
    maxDurationSeconds: 2_592_000n
  }
};
const results = [];
const httpServers = [];
try {
  for (const [index, pool] of pools.entries()) {
    await migrate(pool, "staging");
    await pool.query(`CREATE SCHEMA yunipals_read_v4;
      CREATE SCHEMA bnb_indexer;
      CREATE SCHEMA metadata;
      CREATE TABLE yunipals_read_v4.token(collection text,chain_id integer,contract_address text,
        token_id text,owner text,lifecycle integer,burned boolean,PRIMARY KEY(collection,token_id));
      CREATE TABLE yunipals_read_v4.transfer_event(id text PRIMARY KEY,collection text,
        token_id text,lifecycle integer,"from" text,"to" text,block_number bigint,
        transaction_index integer,log_index integer);
      CREATE TABLE metadata.token_visibility(collection text,token_id numeric,owner text,
        lifecycle integer,anchor_event_id text,anchor_block bigint,
        anchor_transaction_index integer,anchor_log_index integer);
      CREATE TABLE bnb_indexer.sync_state(singleton boolean PRIMARY KEY,next_block bigint,
        last_scanned_block bigint,last_scanned_hash text,caught_up_at timestamptz,
        last_error text,updated_at timestamptz);`);
    await pool.query(
      `INSERT INTO yunipals_read_v4.token VALUES('bnb',56,$1,$2,$3,1,false)`,
      [collection.toLowerCase(), tokenId.toString(), seller.address.toLowerCase()]
    );
    for (const receipt of [mint, transfer]) {
      const eventLog = receipt.logs.find((log) =>
        log.address.toLowerCase() === collection.toLowerCase() &&
        log.topics[0] === toEventSelector("Transfer(address,address,uint256)") &&
        log.topics[3]?.toLowerCase() === toHex(tokenId, { size: 32 }).toLowerCase()
      );
      assert.ok(eventLog);
      const decoded = decodeEventLog({ abi: erc721Abi, data: eventLog.data, topics: eventLog.topics });
      assert.equal(decoded.eventName, "Transfer");
      await pool.query(
        `INSERT INTO yunipals_read_v4.transfer_event VALUES($1,'bnb',$2,1,$3,$4,$5,$6,$7)`,
        [`${receipt.transactionHash}:${eventLog.logIndex}`, tokenId.toString(),
          decoded.args.from.toLowerCase(), decoded.args.to.toLowerCase(),
          receipt.blockNumber.toString(), eventLog.transactionIndex, eventLog.logIndex]
      );
    }
    await pool.query(
      `INSERT INTO bnb_indexer.sync_state VALUES(true,$1,$2,$3,clock_timestamp(),NULL,clock_timestamp())`,
      [(anchor.number + 1n).toString(), anchor.number.toString(), anchor.hash]
    );
    const pass = await runBnbDiscoveryPass({
      pool, logClient: client, stateClient: client, policy,
      launchBlock: validation.blockNumber, maxRange: 10n
    });
    assert.equal(pass.locked, true);
    const feed = await new BnbDiscoveryReadService(pool).list(
      new URLSearchParams({ tokenId: tokenId.toString() })
    );
    assert.equal(feed.coverage, "complete");
    assert.equal(feed.orders[0]?.orderHash, expectedHash);
    assert.equal(feed.orders[0]?.boundLifecycle, 1);
    await pool.query("UPDATE yunipals_market.bnb_discovery_cursor SET mode='live' WHERE singleton");
    const asset = await new OrderReadService(pool).asset({
      chain: "bnb", chainId: 56, contractAddress: collection, tokenId: tokenId.toString()
    });
    assert.ok(asset.listings.some((item) => item.orderHash.toLowerCase() === expectedHash));
    results.push({
      hashes: feed.orders.map((item) => item.orderHash),
      lifecycle: feed.orders[0].boundLifecycle,
      owner: feed.orders[0].currentAsset.owner,
      sourceStatus: asset.sourceStatus
    });
    if (index === 0) {
      await pool.end();
      pools[0] = null;
    }
  }
  assert.deepEqual(results[0], results[1]);
  pools[0] = new pg.Pool({ connectionString: urls[0] });
  for (const url of urls) httpServers.push(await startHttp(url));
  for (const server of httpServers) {
    const response = await fetch(
      `${server.url}/v1/market/bnb/discovered-orders?tokenId=${tokenId}`
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).orders[0].orderHash, expectedHash);
    const assetResponse = await fetch(
      `${server.url}/v1/market/assets/bnb/${collection}/${tokenId}`
    );
    assert.equal(assetResponse.status, 200);
    assert.ok((await assetResponse.json()).listings.some(
      (item) => item.orderHash.toLowerCase() === expectedHash
    ));
  }
  await stopHttp(httpServers[0]);
  const independent = await fetch(
    `${httpServers[1].url}/v1/market/bnb/discovered-orders?tokenId=${tokenId}`
  );
  assert.equal(independent.status, 200);
  assert.equal((await independent.json()).orders[0].orderHash, expectedHash);
  const buyerWallet = createWalletClient({ account: buyer, chain: bsc, transport: http(rpcUrl) });
  const fulfillmentHash = await buyerWallet.writeContract({
    address: seaportDeployment.address, abi: seaportWriteAbi,
    functionName: "fulfillOrder",
    args: [{ parameters, signature: "0x" }, zeroHash], value: 10n ** 15n
  });
  const fulfillment = await localReceipt(fulfillmentHash);
  assert.equal(fulfillment.status, "success");
  assert.equal(await client.readContract({
    address: collection, abi: erc721Abi, functionName: "ownerOf", args: [tokenId]
  }), buyer.address);
  assert.ok((await client.readContract({
    address: seaportDeployment.address, abi: seaportReadAbi,
    functionName: "getOrderStatus", args: [expectedHash]
  }))[2] > 0n);
  await rpc("anvil_mine", ["0x42", "0x0"]);
  const settledAnchor = await client.getBlock({ blockTag: "finalized" });
  assert.ok(settledAnchor.number >= fulfillment.blockNumber);
  const settled = [];
  for (const pool of pools) {
    await pool.query(
      "UPDATE yunipals_read_v4.token SET owner=$1 WHERE collection='bnb' AND token_id=$2",
      [buyer.address.toLowerCase(), tokenId.toString()]
    );
    const transferLog = fulfillment.logs.find((log) =>
      log.address.toLowerCase() === collection.toLowerCase() &&
      log.topics[0] === toEventSelector("Transfer(address,address,uint256)") &&
      log.topics[3]?.toLowerCase() === toHex(tokenId, { size: 32 }).toLowerCase()
    );
    assert.ok(transferLog);
    await pool.query(
      `INSERT INTO yunipals_read_v4.transfer_event VALUES($1,'bnb',$2,1,$3,$4,$5,$6,$7)`,
      [`${fulfillment.transactionHash}:${transferLog.logIndex}`,
        tokenId.toString(), seller.address.toLowerCase(), buyer.address.toLowerCase(),
        fulfillment.blockNumber.toString(), transferLog.transactionIndex, transferLog.logIndex]
    );
    await pool.query(
      `UPDATE bnb_indexer.sync_state SET next_block=$1,last_scanned_block=$2,
        last_scanned_hash=$3,caught_up_at=clock_timestamp(),updated_at=clock_timestamp() WHERE singleton`,
      [(settledAnchor.number + 1n).toString(), settledAnchor.number.toString(), settledAnchor.hash]
    );
    await runBnbDiscoveryPass({
      pool, logClient: client, stateClient: client, policy,
      launchBlock: validation.blockNumber, maxRange: 100n
    });
    const feed = await new BnbDiscoveryReadService(pool).list(
      new URLSearchParams({ tokenId: tokenId.toString() })
    );
    const asset = await new OrderReadService(pool).asset({
      chain: "bnb", chainId: 56, contractAddress: collection, tokenId: tokenId.toString()
    });
    assert.equal(asset.listings.length, 0);
    settled.push({ status: feed.orders[0]?.protocolStatus, owner: feed.orders[0]?.currentAsset.owner });
  }
  assert.deepEqual(settled[0], settled[1]);
  assert.equal(settled[0].owner, buyer.address.toLowerCase());
  const buyerApproval = await buyerWallet.writeContract({
    address: collection, abi: erc721Abi, functionName: "setApprovalForAll",
    args: [seaportDeployment.address, true]
  });
  assert.equal((await localReceipt(buyerApproval)).status, "success");
  const buyerCounter = await client.readContract({
    address: seaportDeployment.address, abi: seaportReadAbi,
    functionName: "getCounter", args: [buyer.address]
  });
  async function publishBuyerListing(salt) {
    const current = await client.getBlock();
    const listing = createNativeListing({
      seller: buyer.address, collection, tokenId, totalPrice: 2n * 10n ** 15n,
      startTime: current.timestamp - 30n, endTime: current.timestamp + 3_600n,
      counter: buyerCounter, salt
    });
    const { counter: _counter, ...withoutCounter } = listing;
    const transaction = await buyerWallet.writeContract({
      address: seaportDeployment.address, abi: seaportWriteAbi,
      functionName: "validate", args: [[{
        parameters: {
          ...withoutCounter,
          totalOriginalConsiderationItems: BigInt(listing.consideration.length)
        },
        signature: "0x"
      }]]
    });
    const receipt = await localReceipt(transaction);
    assert.equal(receipt.status, "success");
    assert.ok(hasValidatedEvent(receipt, seaportOrderHash(listing).toLowerCase()));
    return listing;
  }
  async function catchUpBoth() {
    await rpc("anvil_mine", ["0x42", "0x0"]);
    const currentAnchor = await client.getBlock({ blockTag: "finalized" });
    const observations = [];
    for (const pool of pools) {
      await pool.query(
        `UPDATE bnb_indexer.sync_state SET next_block=$1,last_scanned_block=$2,
          last_scanned_hash=$3,caught_up_at=clock_timestamp(),updated_at=clock_timestamp() WHERE singleton`,
        [(currentAnchor.number + 1n).toString(), currentAnchor.number.toString(), currentAnchor.hash]
      );
      await runBnbDiscoveryPass({
        pool, logClient: client, stateClient: client, policy,
        launchBlock: validation.blockNumber, maxRange: 100n
      });
      const feed = await new BnbDiscoveryReadService(pool).list(
        new URLSearchParams({ tokenId: tokenId.toString() })
      );
      const asset = await new OrderReadService(pool).asset({
        chain: "bnb", chainId: 56, contractAddress: collection, tokenId: tokenId.toString()
      });
      observations.push({ feed, asset });
    }
    assert.deepEqual(
      observations[0].feed.orders.map((item) => [item.orderHash, item.protocolStatus]),
      observations[1].feed.orders.map((item) => [item.orderHash, item.protocolStatus])
    );
    return observations;
  }
  const cancelledListing = await publishBuyerListing(18_000_000_001n);
  const cancelledHash = seaportOrderHash(cancelledListing).toLowerCase();
  assert.equal((await catchUpBoth())[0].asset.listings.length, 1);
  const cancelTx = await buyerWallet.writeContract({
    address: seaportDeployment.address, abi: seaportWriteAbi,
    functionName: "cancel", args: [[cancelledListing]]
  });
  assert.equal((await localReceipt(cancelTx)).status, "success");
  assert.equal((await client.readContract({
    address: seaportDeployment.address, abi: seaportReadAbi,
    functionName: "getOrderStatus", args: [cancelledHash]
  }))[1], true);
  const afterCancel = await catchUpBoth();
  assert.equal(afterCancel[0].asset.listings.length, 0);
  const replacementListing = await publishBuyerListing(18_000_000_002n);
  const replacementHash = seaportOrderHash(replacementListing).toLowerCase();
  const afterReplacement = await catchUpBoth();
  assert.equal(afterReplacement[0].asset.listings.length, 1);
  assert.equal(afterReplacement[0].asset.listings[0].orderHash.toLowerCase(), replacementHash);
  assert.notEqual(replacementHash, cancelledHash);
  const offerAmount = 10n ** 15n;
  const depositTx = await wallet.writeContract({
    address: bnbOfferCurrency.address,
    abi: parseAbi(["function deposit() payable"]),
    functionName: "deposit", value: offerAmount
  });
  assert.equal((await localReceipt(depositTx)).status, "success");
  const paymentApproval = await wallet.writeContract({
    address: bnbOfferCurrency.address, abi: erc20Abi,
    functionName: "approve", args: [seaportDeployment.address, offerAmount]
  });
  assert.equal((await localReceipt(paymentApproval)).status, "success");
  const offerHead = await client.getBlock();
  const offer = createItemOffer({
    buyer: seller.address, collection, tokenId,
    paymentToken: bnbOfferCurrency.address, totalPrice: offerAmount,
    startTime: offerHead.timestamp - 30n,
    endTime: offerHead.timestamp + 3_600n,
    counter, salt: 19_000_000_001n
  });
  const offerHash = seaportOrderHash(offer).toLowerCase();
  const { counter: _offerCounter, ...offerWithoutCounter } = offer;
  const offerValidationTx = await wallet.writeContract({
    address: seaportDeployment.address, abi: seaportWriteAbi,
    functionName: "validate", args: [[{
      parameters: {
        ...offerWithoutCounter,
        totalOriginalConsiderationItems: BigInt(offer.consideration.length)
      }, signature: "0x"
    }]]
  });
  const offerValidation = await localReceipt(offerValidationTx);
  assert.equal(offerValidation.status, "success");
  assert.ok(hasValidatedEvent(offerValidation, offerHash));
  const withOffer = await catchUpBoth();
  assert.ok(withOffer[0].asset.offers.some((item) => item.orderHash.toLowerCase() === offerHash));
  const offerFillTx = await buyerWallet.writeContract({
    address: seaportDeployment.address, abi: seaportWriteAbi,
    functionName: "fulfillOrder",
    args: [{
      parameters: {
        ...offerWithoutCounter,
        totalOriginalConsiderationItems: BigInt(offer.consideration.length)
      }, signature: "0x"
    }, zeroHash]
  });
  const offerFill = await localReceipt(offerFillTx);
  assert.equal(offerFill.status, "success");
  assert.equal(await client.readContract({
    address: collection, abi: erc721Abi, functionName: "ownerOf", args: [tokenId]
  }), seller.address);
  const offerTransfer = offerFill.logs.find((log) =>
    log.address.toLowerCase() === collection.toLowerCase() &&
    log.topics[0] === toEventSelector("Transfer(address,address,uint256)") &&
    log.topics[3]?.toLowerCase() === toHex(tokenId, { size: 32 }).toLowerCase()
  );
  assert.ok(offerTransfer);
  for (const pool of pools) {
    await pool.query(
      "UPDATE yunipals_read_v4.token SET owner=$1 WHERE collection='bnb' AND token_id=$2",
      [seller.address.toLowerCase(), tokenId.toString()]
    );
    await pool.query(
      `INSERT INTO yunipals_read_v4.transfer_event VALUES($1,'bnb',$2,1,$3,$4,$5,$6,$7)`,
      [`${offerFill.transactionHash}:${offerTransfer.logIndex}`,
        tokenId.toString(), buyer.address.toLowerCase(), seller.address.toLowerCase(),
        offerFill.blockNumber.toString(), offerTransfer.transactionIndex, offerTransfer.logIndex]
    );
  }
  const afterOfferFill = await catchUpBoth();
  assert.equal(afterOfferFill[0].asset.offers.length, 0);
  assert.equal(afterOfferFill[0].asset.listings.length, 0);
  console.log(JSON.stringify({ forkBlock: metadata.forkedNetwork.forkBlockNumber,
    validationBlock: validation.blockNumber.toString(), orderHash: expectedHash,
    result: "two independent databases and HTTP processes rebuilt listing, buy, cancellation, replacement and offer acceptance" }));
} finally {
  for (const server of httpServers) await stopHttp(server);
  for (const pool of pools) if (pool) await pool.end();
}
