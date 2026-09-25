import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  erc721Abi,
  getAddress,
  http,
  keccak256,
  parseAbi,
  toHex,
  zeroAddress
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { inspectOrderCreation } from "../src/lib/marketplace/creationState.ts";
import {
  parsePreparedOrder,
  parsePublishedOrder
} from "../src/lib/marketplace/marketApi.ts";
import { openSeaPublicationFixture } from "../src/lib/marketplace/openseaPublication.testFixtures.ts";
import {
  saveRecoverableOrder,
  readRecoverableOrders
} from "../src/lib/marketplace/orderRecovery.ts";
import { publishOrder } from "../src/lib/marketplace/publishOrder.ts";
import { verifySeaportOrderMaker } from "../src/lib/marketplace/verifyOrderMaker.ts";

import { executeMarketTransaction } from "../src/lib/marketplace/executeTransaction.ts";
import { observeMarketSale } from "../src/lib/marketplace/settledSale.ts";
import { openSeaFixture } from "../src/lib/marketplace/opensea.testFixtures.ts";
import { buildOpenSeaFulfillment } from "../src/lib/marketplace/openseaFulfillment.ts";
import {
  openseaConduit,
  openseaCurrencies,
  openseaSignedZone
} from "../src/lib/marketplace/openseaRegistry.ts";
import {
  conduitControllerAbi,
  inspectOpenSeaTrade
} from "../src/lib/marketplace/openseaTradeState.ts";
import {
  decodePendingTransactions,
  pendingTransaction
} from "../src/lib/marketplace/pendingTransactions.ts";
import {
  marketplaceChains,
  seaportDeployment
} from "../src/lib/marketplace/registry.ts";
import {
  seaportOrderHash,
  seaportReadAbi,
  seaportSigningData
} from "../src/lib/marketplace/seaport.ts";
import {
  assertMarketReceipt,
  buildSeaportCancellation,
  wrappedNativeAbi
} from "../src/lib/marketplace/transactionIntent.ts";

const { values } = parseArgs({
  options: {
    chain: { type: "string" },
    rpc: { type: "string" },
    "token-id": { type: "string" },
    output: { type: "string", default: "/tmp/yunipals-opensea-fork.json" }
  }
});
if (
  !values.rpc ||
  !values["token-id"] ||
  !["ethereum", "base", "polygon"].includes(values.chain)
)
  throw new Error("Pass --chain, --rpc and an existing --token-id.");
const endpoint = new URL(values.rpc);
if (
  endpoint.protocol !== "http:" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
  endpoint.username ||
  endpoint.password
)
  throw new Error("Only verified loopback Anvil forks are permitted.");
const chain = values.chain;
const config = marketplaceChains[chain];
const currency = openseaCurrencies[chain];
const tokenId = BigInt(values["token-id"]);
const collection = config.contractAddress;
const client = createPublicClient({
  transport: http(values.rpc, { retryCount: 0 }),
  cacheTime: 0
});
const rpc = (method, params = []) => client.request({ method, params });
assert.match(await rpc("web3_clientVersion"), /anvil/i);
assert.equal(await client.getChainId(), config.chainId);
const metadata = await rpc("anvil_metadata");
assert.equal(metadata.forkedNetwork?.chainId, config.chainId);
assert.ok(metadata.forkedNetwork?.forkBlockNumber);
const initial = await rpc("evm_snapshot");
const seller = privateKeyToAccount(`0x${"1".padStart(64, "0")}`);
const buyer = privateKeyToAccount(`0x${"2".padStart(64, "0")}`);
const feeRecipient = privateKeyToAccount(`0x${"3".padStart(64, "0")}`).address;
const report = {
  checkedAt: new Date().toISOString(),
  chain,
  chainId: config.chainId,
  forkBlock: metadata.forkedNetwork.forkBlockNumber,
  tokenId: tokenId.toString(),
  scope:
    "Actual Yunipals, Seaport 1.6, official OpenSea conduit/controller and WETH on a verified local Anvil fork. Provider-shaped fixture payloads and local EOA signatures. No OpenSea API acceptance/authorization or live transactions are claimed. Protected-zone authorization rejection is tested; successful protected fulfillment needs live provider authorization.",
  tests: [],
  deployments: {},
  saleObservations: []
};
let salt = 50000n;
let polygonFunding;
const balance = (account) =>
  client.readContract({
    address: currency.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account]
  });
async function transaction(from, to, data, value = 0n) {
  await rpc("anvil_impersonateAccount", [from]);
  try {
    const hash = await rpc("eth_sendTransaction", [
      { from, to, data, value: toHex(value), gas: toHex(2_000_000) }
    ]);
    const receipt = await client.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success");
    return receipt;
  } finally {
    await rpc("anvil_stopImpersonatingAccount", [from]);
  }
}
async function transferNft(to) {
  const owner = await client.readContract({
    address: collection,
    abi: erc721Abi,
    functionName: "ownerOf",
    args: [tokenId]
  });
  if (getAddress(owner) === getAddress(to)) return;
  await rpc("anvil_setBalance", [owner, toHex(100n * 10n ** 18n)]);
  await transaction(
    owner,
    collection,
    encodeFunctionData({
      abi: erc721Abi,
      functionName: "transferFrom",
      args: [owner, to, tokenId]
    })
  );
}
async function nftApproval(account) {
  await transaction(
    account,
    collection,
    encodeFunctionData({
      abi: erc721Abi,
      functionName: "approve",
      args: [openseaConduit.address, tokenId]
    })
  );
}
async function tokenApproval(account, amount) {
  await transaction(
    account,
    currency.address,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [openseaConduit.address, amount]
    })
  );
}
async function clearWeth(account) {
  const amount = await balance(account);
  if (amount)
    await transaction(
      account,
      currency.address,
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [feeRecipient, amount]
      })
    );
  await tokenApproval(account, 0n);
}
async function fundWeth(account, amount) {
  if (currency.canWrapNative)
    return transaction(
      account,
      currency.address,
      encodeFunctionData({ abi: wrappedNativeAbi, functionName: "deposit" }),
      amount
    );
  if (!polygonFunding) {
    // Find a source from actual recent WETH Transfer logs, then check its
    // balance. Only this local fork impersonates it; no storage is fabricated.
    const end = BigInt(metadata.forkedNetwork.forkBlockNumber);
    for (let offset = 0n; offset < 2000n && !polygonFunding; offset += 250n) {
      const logs = await client.getContractEvents({
        address: currency.address,
        abi: erc20Abi,
        eventName: "Transfer",
        fromBlock: end - offset - 249n,
        toBlock: end - offset
      });
      const candidates = [
        ...new Set(
          logs.flatMap((log) => [log.args.to, log.args.from]).filter(Boolean)
        )
      ].filter(
        (address) =>
          ![zeroAddress, seller.address, buyer.address, feeRecipient].some(
            (excluded) => getAddress(address) === getAddress(excluded)
          )
      );
      for (const candidate of candidates.slice(0, 50))
        if ((await balance(candidate)) >= 10n * 10n ** 18n) {
          polygonFunding = candidate;
          break;
        }
    }
    assert.ok(
      polygonFunding,
      "Could not find a sufficiently funded WETH holder on this fork."
    );
    report.polygonWethFunding = polygonFunding;
    await rpc("anvil_setBalance", [polygonFunding, toHex(100n * 10n ** 18n)]);
  }
  return transaction(
    polygonFunding,
    currency.address,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [account, amount]
    })
  );
}
async function fixture(side, method, payment, wrongChain = false) {
  const block = await client.getBlock();
  const maker = side === "listing" ? seller : buyer;
  const counter = await client.readContract({
    address: seaportDeployment.address,
    abi: seaportReadAbi,
    functionName: "getCounter",
    args: [maker.address]
  });
  const options = {
    chain,
    side,
    method,
    currency: payment,
    tokenId: tokenId.toString(),
    startTime: block.timestamp - 1n,
    endTime: block.timestamp + 3600n,
    expiresAt: block.timestamp + 120n,
    counter,
    salt: salt++
  };
  const unsigned = openSeaFixture(options);
  const domain = {
    name: seaportDeployment.name,
    version: seaportDeployment.version,
    verifyingContract: seaportDeployment.address,
    chainId: wrongChain ? config.chainId + 1 : config.chainId
  };
  const signature = await maker.signTypedData(
    seaportSigningData(domain, unsigned.order)
  );
  const signed = openSeaFixture({ ...options, signature });
  return {
    ...signed,
    trade: buildOpenSeaFulfillment(
      signed.quote,
      signed.reviewed,
      signed.actor,
      block.timestamp
    )
  };
}
async function execute(intent) {
  let saved;
  const checkedAt = (await client.getBlock()).timestamp;
  const wallet = {
    context: () => ({ address: intent.account, chainId: intent.chainId }),
    switchChain: async () => {
      throw new Error("Unexpected chain switch");
    },
    simulate: async ({ account, to, data, value }) => {
      await client.call({ account, to, data, value });
    },
    send: async ({ account, to, data, value }) => {
      await rpc("anvil_impersonateAccount", [account]);
      try {
        return await rpc("eth_sendTransaction", [
          {
            from: account,
            to,
            data,
            value: toHex(value),
            gas: toHex(2_000_000)
          }
        ]);
      } finally {
        await rpc("anvil_stopImpersonatingAccount", [account]);
      }
    },
    wait: async (hash) => client.waitForTransactionReceipt({ hash })
  };
  const receipt = await executeMarketTransaction(intent, wallet, {
    now: () => checkedAt,
    onStage: () => {},
    onSubmitted: (hash) => {
      saved = decodePendingTransactions(
        JSON.stringify([pendingTransaction(hash, intent)], (_, value) =>
          typeof value === "bigint" ? value.toString() : value
        )
      )[0];
    }
  });
  assert.ok(saved, "The action must survive recovery serialization.");
  assertMarketReceipt(saved.expectation, receipt);
  return receipt;
}
async function ready(trade) {
  const steps = [];
  for (let i = 0; i < 4; i++) {
    const state = await inspectOpenSeaTrade(client, trade);
    if (!state.next) return steps;
    steps.push(state.next.intent.kind);
    await execute(state.next.intent);
  }
  throw new Error("Prerequisites did not converge.");
}
async function recordSale(order, receipt) {
  const block = await client.getBlock({ blockHash: receipt.blockHash });
  const sale = observeMarketSale(order, receipt, block);
  assert.equal(sale.seller, seller.address);
  assert.equal(sale.nftRecipient, buyer.address);
  assert.equal(sale.grossAmount, order.grossAmount);
  assert.equal(sale.sellerProceeds, order.sellerProceeds);
  report.saleObservations.push(sale);
}
function pass(name) {
  report.tests.push({ name, status: "passed" });
  process.stdout.write(`PASS ${chain}: ${name}\n`);
}

async function createOrder(side, grossAmount, replacing) {
  const maker = side === "listing" ? seller : buyer;
  const block = await client.getBlock();
  const fixture = openSeaPublicationFixture({
    chain,
    side,
    grossAmount,
    maker: maker.address,
    tokenId: tokenId.toString(),
    timestamp: block.timestamp,
    counter: await client.readContract({
      address: seaportDeployment.address,
      abi: seaportReadAbi,
      functionName: "getCounter",
      args: [maker.address]
    }),
    salt: BigInt(7000 + report.tests.length) + grossAmount
  });
  const { intent } = fixture;
  const inspect = async () =>
    inspectOrderCreation(
      client,
      intent,
      {
        policy: {
          ...fixture.policy,
          expiresAt: (await client.getBlock()).timestamp + 100n
        },
        capabilities: {
          [chain]: {
            read: true,
            buy: true,
            createListing: true,
            createOffer: true,
            acceptOffer: true,
            cancel: true
          }
        },
        asset: {
          asset: intent.asset,
          lifecycle: 2,
          owner: await client.readContract({
            address: collection,
            abi: erc721Abi,
            functionName: "ownerOf",
            args: [tokenId]
          }),
          hidden: false,
          burned: false,
          sourceStatus: "available",
          updatedAt: new Date().toISOString(),
          listings: [],
          offers: []
        }
      },
      replacing
        ? { summary: replacing.intent.summary, order: replacing.intent.order }
        : undefined
    );
  const steps = [];
  for (let i = 0; i < 4; i++) {
    const next = (await inspect()).prerequisite;
    if (!next) break;
    steps.push(next.kind);
    await execute(next);
  }
  assert.equal((await inspect()).prerequisite, null);
  const memory = new Map();
  const storage = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value)
  };
  let signature;
  const at = (await client.getBlock()).timestamp;
  const published = await publishOrder(intent, {
    wallet: {
      context: () => ({
        address: maker.address,
        chainId: intent.asset.chainId
      }),
      switchChain: async () => {
        throw new Error("Unexpected network switch");
      },
      sign: async (data) => {
        signature = await maker.signTypedData(data);
        return signature;
      },
      verify: (_, value) =>
        verifySeaportOrderMaker(
          client,
          chain,
          intent.order,
          value,
          block.number
        )
    },
    api: {
      lookup: async () => null,
      prepare: async (input) =>
        parsePreparedOrder({
          schemaVersion: 1,
          source: "opensea",
          ...input,
          id: "local-publication",
          orderHash: intent.orderHash,
          expiresAt: (at + 100n).toString()
        }),
      submit: async () =>
        parsePublishedOrder({
          schemaVersion: 1,
          persisted: true,
          providerAccepted: true,
          order: { ...intent.summary, status: "active" }
        })
    },
    revalidate: async () => {
      assert.equal((await inspect()).prerequisite, null);
    },
    save: (value, state) => saveRecoverableOrder(value, state, storage),
    onStage: () => {},
    now: () => at
  });
  assert.equal(readRecoverableOrders(storage)[0].state, "accepted");
  assert.equal(published.orderHash, intent.orderHash);
  return { intent, signature, steps };
}

try {
  await rpc("evm_setAutomine", [true]);
  for (const account of [seller.address, buyer.address, feeRecipient]) {
    await rpc("anvil_setCode", [account, "0x"]);
    await rpc("anvil_setNonce", [account, "0x0"]);
    await rpc("anvil_setBalance", [account, toHex(100n * 10n ** 18n)]);
  }
  for (const [name, address] of Object.entries({
    collection,
    seaport: seaportDeployment.address,
    conduit: openseaConduit.address,
    controller: openseaConduit.controller,
    signedZone: openseaSignedZone,
    weth: currency.address
  })) {
    const code = await client.getCode({ address });
    assert.ok(code && code !== "0x", `${name} must be deployed`);
    report.deployments[name] = { address, codeHash: keccak256(code) };
  }
  assert.equal(
    await client.readContract({
      address: currency.address,
      abi: erc20Abi,
      functionName: "decimals"
    }),
    18
  );
  assert.equal(
    await client.readContract({
      address: currency.address,
      abi: erc20Abi,
      functionName: "symbol"
    }),
    "WETH"
  );
  const resolved = await client.readContract({
    address: openseaConduit.controller,
    abi: conduitControllerAbi,
    functionName: "getConduit",
    args: [openseaConduit.key]
  });
  assert.equal(getAddress(resolved[0]), getAddress(openseaConduit.address));
  assert.equal(resolved[1], true);
  pass(
    "Official conduit mapping, deployment bytecode and WETH metadata are present"
  );

  for (const method of [
    "fulfillOrder",
    "fulfillBasicOrder_efficient_6GL6yc",
    "fulfillAdvancedOrder"
  ]) {
    await transferNft(seller.address);
    await nftApproval(seller.address);
    const { trade, reviewed } = await fixture("listing", method, "native");
    assert.deepEqual(await ready(trade), []);
    const before = await client.getBalance({ address: seller.address });
    const feeBefore = await client.getBalance({ address: feeRecipient });
    await recordSale(reviewed, await execute(trade.intent));
    assert.equal(
      (await client.getBalance({ address: seller.address })) - before,
      975n * 10n ** 15n
    );
    assert.equal(
      (await client.getBalance({ address: feeRecipient })) - feeBefore,
      25n * 10n ** 15n
    );
    assert.equal(
      getAddress(
        await client.readContract({
          address: collection,
          abi: erc721Abi,
          functionName: "ownerOf",
          args: [tokenId]
        })
      ),
      buyer.address
    );
    pass(
      `Native purchase via ${method} transfers exact seller/fee amounts and the NFT`
    );
  }

  for (const method of ["fulfillBasicOrder", "fulfillAdvancedOrder"]) {
    await transferNft(seller.address);
    await nftApproval(seller.address);
    await clearWeth(buyer.address);
    if (!currency.canWrapNative) await fundWeth(buyer.address, 10n ** 18n);
    const { trade, reviewed } = await fixture("listing", method, "weth");
    const steps = await ready(trade);
    assert.deepEqual(
      steps,
      currency.canWrapNative
        ? ["wrap", "approve-currency"]
        : ["approve-currency"]
    );
    const before = await balance(seller.address),
      feeBefore = await balance(feeRecipient),
      buyerBefore = await balance(buyer.address);
    await recordSale(reviewed, await execute(trade.intent));
    assert.equal((await balance(seller.address)) - before, 975n * 10n ** 15n);
    assert.equal((await balance(feeRecipient)) - feeBefore, 25n * 10n ** 15n);
    assert.equal(buyerBefore - (await balance(buyer.address)), 10n ** 18n);
    pass(
      `WETH purchase via ${method} uses exact approvals, recovery and payment deltas`
    );
  }

  for (const method of ["fulfillBasicOrder", "fulfillAdvancedOrder"]) {
    await transferNft(seller.address);
    await clearWeth(seller.address);
    await clearWeth(buyer.address);
    await transaction(
      seller.address,
      collection,
      encodeFunctionData({
        abi: erc721Abi,
        functionName: "approve",
        args: [zeroAddress, tokenId]
      })
    );
    await fundWeth(buyer.address, 10n ** 18n);
    await tokenApproval(buyer.address, 10n ** 18n);
    const { trade, reviewed } = await fixture("offer", method, "weth");
    const steps = await ready(trade);
    assert.deepEqual(
      steps,
      method === "fulfillAdvancedOrder"
        ? ["approve-nft", "approve-currency"]
        : ["approve-nft"]
    );
    assert.equal(await balance(seller.address), 0n);
    const feeBefore = await balance(feeRecipient);
    await recordSale(reviewed, await execute(trade.intent));
    assert.equal(await balance(seller.address), 975n * 10n ** 15n);
    assert.equal((await balance(feeRecipient)) - feeBefore, 25n * 10n ** 15n);
    assert.equal(await balance(buyer.address), 0n);
    pass(
      `Offer acceptance via ${method} pays exact proceeds with no prior seller WETH balance`
    );
  }

  await transferNft(seller.address);
  await nftApproval(seller.address);
  const wrong = await fixture(
    "listing",
    "fulfillAdvancedOrder",
    "native",
    true
  );
  await assert.rejects(inspectOpenSeaTrade(client, wrong.trade), /signature/);
  pass(
    "A signature for another chain is rejected before approvals or a wallet send"
  );

  const cancellation = await fixture(
    "listing",
    "fulfillAdvancedOrder",
    "native"
  );
  await execute(
    buildSeaportCancellation(
      chain,
      cancellation.order,
      cancellation.reviewed.orderHash,
      seller.address
    )
  );
  await assert.rejects(
    inspectOpenSeaTrade(client, cancellation.trade),
    /filled, cancelled or invalidated/
  );
  pass(
    "Individual cancellation invalidates the exact conduit-backed order and survives receipt recovery"
  );

  const restricted = await fixture("listing", "fulfillAdvancedOrder", "native");
  const restrictedOrder = {
    ...restricted.order,
    zone: openseaSignedZone,
    orderType: 2
  };
  const signature = await seller.signTypedData(
    seaportSigningData(
      {
        name: seaportDeployment.name,
        version: seaportDeployment.version,
        verifyingContract: seaportDeployment.address,
        chainId: config.chainId
      },
      restrictedOrder
    )
  );
  const payload = restricted.quote.fulfillment.fulfillment_data;
  Object.assign(payload.orders[0].parameters, {
    zone: openseaSignedZone,
    orderType: 2
  });
  payload.orders[0].signature = signature;
  Object.assign(payload.transaction.input_data.advancedOrder.parameters, {
    zone: openseaSignedZone,
    orderType: 2
  });
  payload.transaction.input_data.advancedOrder.signature = signature;
  const hash = seaportOrderHash(restrictedOrder);
  const invalidAuthorization = buildOpenSeaFulfillment(
    { ...restricted.quote, orderHash: hash },
    { ...restricted.reviewed, orderHash: hash },
    buyer.address,
    (await client.getBlock()).timestamp
  );
  await assert.rejects(
    client.call({
      account: buyer.address,
      to: invalidAuthorization.intent.to,
      data: invalidAuthorization.intent.data,
      value: invalidAuthorization.intent.value
    }),
    (error) => /execution reverted/i.test(error.message)
  );
  pass(
    "The real OpenSea signed zone rejects missing provider authorization during simulation"
  );
  await transferNft(seller.address);
  await transaction(
    seller.address,
    collection,
    encodeFunctionData({
      abi: erc721Abi,
      functionName: "approve",
      args: [zeroAddress, tokenId]
    })
  );
  const listed = await createOrder("listing", 10n ** 18n);
  assert.deepEqual(listed.steps, ["approve-nft"]);
  const repriced = await createOrder("listing", 2n * 10n ** 18n, listed);
  assert.equal(repriced.steps[0], "cancel");
  assert.equal(
    (
      await client.readContract({
        address: seaportDeployment.address,
        abi: seaportReadAbi,
        functionName: "getOrderStatus",
        args: [listed.intent.orderHash]
      })
    )[1],
    true
  );
  pass(
    "The creation engine approves, signs and cancels the prior listing before repricing"
  );
  const options = {
    chain,
    side: "listing",
    currency: chain === "polygon" ? "weth" : "native",
    tokenId: tokenId.toString(),
    startTime: repriced.intent.order.startTime,
    endTime: repriced.intent.order.endTime,
    counter: repriced.intent.order.counter,
    salt: repriced.intent.order.salt,
    signature: repriced.signature,
    grossAmount: 2n * 10n ** 18n,
    expiresAt: (await client.getBlock()).timestamp + 100n
  };
  const fulfillment = openSeaFixture(options);
  assert.equal(fulfillment.reviewed.orderHash, repriced.intent.orderHash);
  const trade = buildOpenSeaFulfillment(
    fulfillment.quote,
    fulfillment.reviewed,
    buyer.address,
    (await client.getBlock()).timestamp
  );
  if (chain === "polygon") await fundWeth(buyer.address, 2n * 10n ** 18n);
  await ready(trade);
  const sellerBefore =
    chain === "polygon"
      ? await balance(seller.address)
      : await client.getBalance({ address: seller.address });
  const feeBefore =
    chain === "polygon"
      ? await balance(feeRecipient)
      : await client.getBalance({ address: feeRecipient });
  await execute(trade.intent);
  assert.equal(
    (chain === "polygon"
      ? await balance(seller.address)
      : await client.getBalance({ address: seller.address })) - sellerBefore,
    195n * 10n ** 16n
  );
  assert.equal(
    (chain === "polygon"
      ? await balance(feeRecipient)
      : await client.getBalance({ address: feeRecipient })) - feeBefore,
    5n * 10n ** 16n
  );
  pass(
    "The listing signed by the creation engine settles its exact repriced currency and proceeds"
  );
  await transferNft(seller.address);
  await clearWeth(buyer.address);
  if (chain === "polygon") await fundWeth(buyer.address, 10n ** 18n);
  const offered = await createOrder("offer", 10n ** 18n);
  assert.equal(
    getAddress(offered.intent.order.zone),
    getAddress(openseaSignedZone)
  );
  assert.equal(offered.intent.order.orderType, 2);
  assert.ok(offered.steps.includes("approve-currency"));
  if (chain !== "polygon") assert.ok(offered.steps.includes("wrap"));
  pass(
    "Protected item-offer creation checks funds, exact allowance, chain signature and saved cancellation data"
  );
  if (chain === "polygon") await fundWeth(buyer.address, 10n ** 18n);
  const repricedOffer = await createOrder("offer", 2n * 10n ** 18n, offered);
  assert.equal(repricedOffer.steps[0], "cancel");
  await execute(
    buildSeaportCancellation(
      chain,
      repricedOffer.intent.order,
      repricedOffer.intent.orderHash,
      buyer.address
    )
  );
  assert.equal(
    (
      await client.readContract({
        address: seaportDeployment.address,
        abi: seaportReadAbi,
        functionName: "getOrderStatus",
        args: [repricedOffer.intent.orderHash]
      })
    )[1],
    true
  );
  pass(
    "Protected offer repricing cancels first, raises the exact allowance and retains individual cancellation"
  );
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  report.restored = await rpc("evm_revert", [initial]);
  await writeFile(values.output, `${JSON.stringify(report, null, 2)}\n`);
}
