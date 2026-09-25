import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  erc721Abi,
  http,
  parseAbi,
  toHex,
  zeroAddress,
  zeroHash
} from "viem";
import { seaportEventAbi } from "@protopals/yunipals-market-core/seaportEvents";
import { privateKeyToAccount } from "viem/accounts";

import {
  bnbOfferCurrency,
  marketplaceChains,
  seaportDeployment
} from "../src/lib/marketplace/registry.ts";
import {
  createItemOffer,
  createNativeListing,
  seaportOrderHash,
  seaportReadAbi,
  seaportSigningData,
  seaportWriteAbi,
  seaportFulfillmentOrder,
  seaportBasicOfferParameters
} from "../src/lib/marketplace/seaport.ts";
import {
  decodeSeaportOrder,
  encodeSeaportOrder
} from "../src/lib/marketplace/seaportWire.ts";
import { validateOwnSeaportOrder } from "../src/lib/marketplace/orderPolicy.ts";
import { createBnbPublicationIntent } from "../src/lib/marketplace/orderPublication.ts";
import { saveRecoverableOrder } from "../src/lib/marketplace/orderRecovery.ts";
import {
  publishOrder,
  SignedOrderPublicationError
} from "../src/lib/marketplace/publishOrder.ts";
import { verifyBnbOrderMaker } from "../src/lib/marketplace/verifyOrderMaker.ts";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:5177" },
    rpc: { type: "string", default: "http://127.0.0.1:18547" },
    playwright: { type: "string" },
    chromium: { type: "string" },
    "token-id": { type: "string", default: "10000000001" },
    "onchain-only": { type: "boolean", default: false },
    output: {
      type: "string",
      default: "/tmp/yunipals-marketplace-ui-report.json"
    },
    screenshot: {
      type: "string",
      default: "/tmp/yunipals-marketplace-review.png"
    }
  }
});
for (const value of [values.url, values.rpc]) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error("UI tests require loopback HTTP for both app and fork.");
}
if (!values.playwright)
  throw new Error("Pass --playwright with a local Playwright module path.");
const { chromium } = await import(pathToFileURL(values.playwright).href);
const client = createPublicClient({
  transport: http(values.rpc, { retryCount: 0 }),
  cacheTime: 0
});
const rpc = (method, params = []) => client.request({ method, params });
assert.match(await rpc("web3_clientVersion"), /anvil/i);
assert.equal(await client.getChainId(), 56);
const metadata = await rpc("anvil_metadata");
assert.ok(
  metadata.forkedNetwork,
  "A real BNB fork is required before any local mutation."
);
const snapshot = await rpc("evm_snapshot");
const seller = privateKeyToAccount(`0x${"1".padStart(64, "0")}`);
const buyer = privateKeyToAccount(`0x${"2".padStart(64, "0")}`);
const feeRecipient = privateKeyToAccount(`0x${"3".padStart(64, "0")}`).address;
const collection = marketplaceChains.bnb.contractAddress;
const protocol = seaportDeployment.address;
const tokenId = BigInt(values["token-id"]);
const price = 10n ** 17n;
const fee = price / 40n;
const asset = {
  chain: "bnb",
  chainId: 56,
  contractAddress: collection,
  tokenId: tokenId.toString()
};
const report = {
  checkedAt: new Date().toISOString(),
  forkBlock: metadata.forkedNetwork.forkBlockNumber,
  asset,
  scope:
    "Chromium UI with fixture API responses, an injected test EOA wallet, and actual contracts on a verified loopback Anvil fork. No live trades or production backend requests.",
  tests: []
};
let browser;
async function transaction(from, to, data, value = 0n) {
  await rpc("anvil_impersonateAccount", [from]);
  try {
    const hash = await rpc("eth_sendTransaction", [
      { from, to, data, value: toHex(value) }
    ]);
    await rpc("evm_mine");
    assert.equal(
      (await client.getTransactionReceipt({ hash })).status,
      "success"
    );
    return hash;
  } finally {
    await rpc("anvil_stopImpersonatingAccount", [from]);
  }
}
function pass(name) {
  report.tests.push({ name, status: "passed" });
  process.stdout.write(`PASS ${name}\n`);
}
try {
  await rpc("evm_setAutomine", [true]);
  for (const address of [seller.address, buyer.address, feeRecipient]) {
    await rpc("anvil_setCode", [address, "0x"]);
    await rpc("anvil_setNonce", [address, "0x0"]);
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
      functionName: "setApprovalForAll",
      args: [protocol, true]
    })
  );
  let mode = "listing";
  let marketUnavailable = false;
  let tradingPaused = false;
  let historyHidden = false;
  let historyNextPageUnavailable = false;
  const historySnapshots = new Map();
  let failNextPublication = false;
  let walletSignatures = 0;
  const liveDiscovery = values["onchain-only"];
  let lastValidationTx;
  let advertisedDuration = "86400";
  let indexerOwnershipDelayed = false;
  const publishedOrders = new Map();
  const preparedOrders = new Map();
  const policy = {
    collection,
    offerCurrency: bnbOfferCurrency.address,
    maxDurationSeconds: 2592000n,
    fees: [{ recipient: feeRecipient, basisPoints: 250 }]
  };
  let order;
  let signature;
  async function prepare(side) {
    mode = side;
    const block = await client.getBlock();
    const input = {
      seller: seller.address,
      buyer: seller.address,
      collection,
      tokenId,
      totalPrice: price,
      paymentToken: bnbOfferCurrency.address,
      startTime: block.timestamp,
      endTime: block.timestamp + 3600n,
      salt: side === "listing" ? 1001n : 1002n,
      counter: await client.readContract({
        address: protocol,
        abi: seaportReadAbi,
        functionName: "getCounter",
        args: [seller.address]
      }),
      fees: [{ recipient: feeRecipient, amount: fee }]
    };
    order =
      side === "listing" ? createNativeListing(input) : createItemOffer(input);
    signature = await seller.signTypedData(
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
  }
  await prepare("listing");
  const getOwner = () =>
    client.readContract({
      address: collection,
      abi: erc721Abi,
      functionName: "ownerOf",
      args: [tokenId]
    });
  async function summary(parameters = order) {
    const checked = validateOwnSeaportOrder(parameters, policy);
    const orderHash = seaportOrderHash(parameters);
    const status = await client.readContract({
      address: protocol,
      abi: seaportReadAbi,
      functionName: "getOrderStatus",
      args: [orderHash]
    });
    return {
      asset,
      lifecycle: 1,
      orderHash,
      protocolAddress: protocol,
      source: "yunipals",
      side: checked.side,
      maker: checked.maker,
      currency: {
        address: checked.currency,
        symbol: checked.side === "listing" ? "BNB" : "WBNB",
        decimals: 18
      },
      grossAmount: checked.grossAmount.toString(),
      sellerProceeds: checked.sellerProceeds.toString(),
      fees: checked.fees.map((fee) => ({
        ...fee,
        amount: fee.amount.toString()
      })),
      startTime: parameters.startTime.toString(),
      endTime: parameters.endTime.toString(),
      status: status[1] ? "cancelled" : status[2] > 0n ? "filled" : "active"
    };
  }
  browser = await chromium.launch({
    headless: true,
    ...(values.chromium ? { executablePath: values.chromium } : {}),
    args: ["--no-sandbox"]
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 960 }
  });
  let authorized = false;
  let activeAccount = buyer.address;
  await context.exposeBinding("marketplaceFixtureRpc", async (_, request) => {
    process.stdout.write(`Fixture wallet: ${request.method}\n`);
    if (request.method === "eth_accounts")
      return authorized ? [activeAccount] : [];
    if (request.method === "eth_requestAccounts") {
      authorized = true;
      return [activeAccount];
    }
    if (request.method === "wallet_getPermissions")
      return [{ parentCapability: "eth_accounts" }];
    if (request.method === "wallet_requestPermissions") {
      authorized = true;
      return [{ parentCapability: "eth_accounts" }];
    }
    if (request.method === "wallet_switchEthereumChain") {
      assert.equal(request.params[0].chainId, "0x38");
      return null;
    }
    if (request.method === "eth_signTypedData_v4") {
      assert.equal(
        request.params[0].toLowerCase(),
        buyer.address.toLowerCase()
      );
      const data = JSON.parse(request.params[1]);
      assert.equal(Number(data.domain.chainId), 56);
      assert.equal(
        data.domain.verifyingContract.toLowerCase(),
        protocol.toLowerCase()
      );
      const parameters = decodeSeaportOrder(data.message);
      assert.equal(
        parameters.offerer.toLowerCase(),
        buyer.address.toLowerCase()
      );
      assert.equal(
        validateOwnSeaportOrder(parameters, policy).tokenId,
        tokenId
      );
      walletSignatures++;
      return buyer.signTypedData({ ...data, message: parameters });
    }
    if (request.method === "eth_sendTransaction") {
      const call = request.params[0];
      assert.equal(call.from.toLowerCase(), activeAccount.toLowerCase());
      assert.ok(
        [
          protocol.toLowerCase(),
          collection.toLowerCase(),
          bnbOfferCurrency.address.toLowerCase()
        ].includes(call.to.toLowerCase())
      );
      const hash = await transaction(
        activeAccount,
        call.to,
        call.data,
        BigInt(call.value ?? "0x0")
      );
      if (liveDiscovery && call.to.toLowerCase() === protocol.toLowerCase())
        lastValidationTx = hash;
      return hash;
    }
    if (!request.method.startsWith("eth_") || /send|sign/i.test(request.method))
      throw new Error("Unsupported fixture wallet method.");
    return rpc(request.method, request.params ?? []);
  });
  await context.addInitScript(() => {
    const listeners = new Map();
    const provider = {
      isConnected: () => true,
      request: (request) => window.marketplaceFixtureRpc(request),
      on: (event, callback) => {
        listeners.set(event, [...(listeners.get(event) ?? []), callback]);
      },
      removeListener: (event, callback) => {
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter(
            (listener) => listener !== callback
          )
        );
      }
    };
    window.ethereum = provider;
    window.marketplaceFixtureAccountsChanged = (addresses) => {
      for (const listener of listeners.get("accountsChanged") ?? [])
        listener(addresses);
    };
    const detail = {
      provider,
      info: {
        uuid: "ae4cf572-15c3-4e2d-8467-d96508d59407",
        name: "Yunipals test wallet",
        rdns: "test.yunipals.localwallet",
        icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='purple'/></svg>"
      }
    };
    const announce = () =>
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", { detail })
      );
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  });
  await context.route("**/__indexer-test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const indexedOwner = indexerOwnershipDelayed
      ? seller.address
      : await getOwner();
    const indexedToken = {
      ...asset,
      owner: indexedOwner,
      burned: false,
      hidden: false,
      lifecycle: 1,
      mintBlock: "1",
      lastTransferBlock: indexerOwnershipDelayed
        ? "1"
        : String(await client.getBlockNumber({ cacheTime: 0 })),
      name: "Yunipal test fixture",
      image: null,
      attributes: [],
      tokenUri: null,
      metadataAvailable: true,
      rarityPoints: "4",
      rarityPointsCapped: "4"
    };
    if (path.includes("/owners/") && path.endsWith("/tokens"))
      return route.fulfill({
        json: {
          owner: buyer.address,
          ownerInput: buyer.address,
          ownerName: null,
          resolvedAddresses: { bnb: buyer.address },
          chain: null,
          chains: ["bnb"],
          visibility: "visible",
          items: indexerOwnershipDelayed ? [] : [indexedToken],
          nextCursor: null
        }
      });
    if (path.endsWith("/leaderboard"))
      return route.fulfill({
        status: 404,
        json: { error: "owner_not_found" }
      });
    await route.fulfill({
      json: {
        token: {
          ...indexedToken,
          token_id: tokenId.toString(),
          last_transfer_block: String(
            indexerOwnershipDelayed
              ? 1
              : await client.getBlockNumber({ cacheTime: 0 })
          ),
          lastTransferBlock: undefined
        },
        transfers: [],
        lifecycles: []
      }
    });
  });
  await context.route("**/__market-test/**", async (route) => {
    if (marketUnavailable)
      return route.fulfill({
        status: 503,
        json: { error: "Fixture source unavailable" }
      });
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname;
    if (path.endsWith("/bnb/discovered-orders"))
      return route.fulfill({
        json: {
          schemaVersion: 1,
          mode: liveDiscovery ? "live" : "preview",
          coverage: "complete"
        }
      });
    if (path.endsWith("/activity"))
      return route.fulfill({
        status: 404,
        json: {
          error: "Activity is covered by the separate read-only harness."
        }
      });
    if (path.includes("/wallets/") && path.endsWith("/orders")) {
      const params = requestUrl.searchParams;
      const wallet = path.split("/").at(-2);
      const view = params.get("view");
      const chain = params.get("chain");
      assert.equal(params.get("limit"), "25");
      if (params.has("cursor") && historyNextPageUnavailable)
        return route.fulfill({
          status: 503,
          json: { error: "Fixture next page unavailable" }
        });
      let id = params.get("snapshot");
      if (!id) {
        id = `history-${historySnapshots.size + 1}`;
        const owner = await getOwner();
        const candidates = new Map([
          [seaportOrderHash(order), order],
          ...[...publishedOrders].map(([hash, entry]) => [hash, entry.order])
        ]);
        const items = [];
        for (const raw of candidates.values()) {
          const normalized = await summary(raw);
          if (
            normalized.status === "active" &&
            (historyHidden ||
              (normalized.side === "listing" &&
                normalized.maker.toLowerCase() !== owner.toLowerCase()))
          )
            normalized.status = "unavailable";
          const own = normalized.maker.toLowerCase() === wallet.toLowerCase();
          const open = ["active", "unavailable"].includes(normalized.status);
          const include =
            view === "listings"
              ? own && open && normalized.side === "listing"
              : view === "offers-made"
                ? own && open && normalized.side === "offer"
                : view === "offers-received"
                  ? !own &&
                    open &&
                    normalized.side === "offer" &&
                    owner.toLowerCase() === wallet.toLowerCase()
                  : own && !open;
          if (include && ["all", "bnb"].includes(chain))
            items.push({
              order: normalized,
              currentAsset: {
                owner,
                lifecycle: 1,
                hidden: historyHidden,
                burned: false
              }
            });
        }
        items.sort((a, b) =>
          a.order.orderHash.localeCompare(b.order.orderHash)
        );
        historySnapshots.set(id, {
          wallet,
          view,
          chain,
          items,
          observedAt: new Date().toISOString()
        });
      }
      const snapshot = historySnapshots.get(id);
      assert.ok(snapshot);
      assert.equal(snapshot.wallet, wallet);
      assert.equal(snapshot.view, view);
      assert.equal(snapshot.chain, chain);
      const offset = params.has("cursor")
        ? Number(params.get("cursor").replace("offset-", ""))
        : 0;
      const items = snapshot.items.slice(offset, offset + 25);
      return route.fulfill({
        json: {
          schemaVersion: 1,
          wallet,
          view,
          chain,
          snapshot: { id, observedAt: snapshot.observedAt },
          sources:
            chain === "all"
              ? {
                  bnb: "available",
                  ethereum: "unavailable",
                  base: "unavailable",
                  polygon: "unavailable"
                }
              : { [chain]: chain === "bnb" ? "available" : "unavailable" },
          items,
          nextCursor:
            offset + items.length < snapshot.items.length
              ? `offset-${offset + items.length}`
              : null
        }
      });
    }
    if (path.endsWith("/capabilities"))
      return route.fulfill({
        json: {
          schemaVersion: 1,
          chains: {
            bnb: {
              read: !tradingPaused,
              buy: !tradingPaused,
              createListing: !tradingPaused,
              createOffer: !tradingPaused,
              acceptOffer: !tradingPaused,
              cancel: !tradingPaused
            }
          }
        }
      });
    if (path.endsWith("/policies/bnb"))
      return route.fulfill({
        json: {
          schemaVersion: 1,
          collection,
          offerCurrency: bnbOfferCurrency.address,
          maxDurationSeconds: advertisedDuration,
          fees: [{ recipient: feeRecipient, basisPoints: 250 }]
        }
      });
    if (path.includes("/assets/")) {
      const items = await Promise.all([
        ...(liveDiscovery ? [] : [summary()]),
        ...[...publishedOrders.values()].map((entry) => summary(entry.order))
      ]);
      return route.fulfill({
        json: {
          schemaVersion: 2,
          availability: {
            chain: "bnb",
            evidence: "current",
            listings: { status: "complete", completedAt: null, revision: null },
            offers: { status: "complete", completedAt: null, revision: null }
          },
          listingState: items.some(
            (item) => item.side === "listing" && item.status === "active"
          )
            ? "listed"
            : "unlisted",
          offerAvailability: "complete",
          asset,
          owner: await getOwner(),
          lifecycle: 1,
          hidden: false,
          burned: false,
          sourceStatus: "available",
          updatedAt: new Date().toISOString(),
          listings: items.filter((item) => item.side === "listing"),
          offers: items.filter((item) => item.side === "offer")
        }
      });
    }
    if (path.endsWith("/orders/prepare")) {
      const input = route.request().postDataJSON();
      const parameters = decodeSeaportOrder(input.order);
      validateOwnSeaportOrder(parameters, policy);
      const orderHash = seaportOrderHash(parameters);
      const id = `fixture-preparation-${orderHash}`;
      preparedOrders.set(id, orderHash);
      return route.fulfill({
        json: {
          schemaVersion: 1,
          source: "yunipals",
          id,
          ...input,
          orderHash,
          expiresAt: ((await client.getBlock()).timestamp + 120n).toString()
        }
      });
    }
    if (route.request().method() === "GET" && path.includes("/orders/bnb/")) {
      const entry = publishedOrders.get(path.split("/").at(-1));
      if (!entry)
        return route.fulfill({
          status: 404,
          json: { error: "Fixture order absent" }
        });
      return route.fulfill({
        json: {
          schemaVersion: 1,
          persisted: true,
          order: await summary(entry.order)
        }
      });
    }
    if (path.endsWith("/orders")) {
      const input = route.request().postDataJSON();
      const parameters = decodeSeaportOrder(input.order);
      const orderHash = seaportOrderHash(parameters);
      assert.equal(preparedOrders.get(input.preparationId), orderHash);
      const normalized = await summary(parameters);
      assert.equal(
        await verifyBnbOrderMaker(
          client,
          {
            asset,
            lifecycle: 1,
            orderHash,
            order: parameters,
            summary: normalized
          },
          input.signature,
          await client.getBlockNumber({ cacheTime: 0 })
        ),
        true
      );
      publishedOrders.set(orderHash, {
        order: parameters,
        signature: input.signature
      });
      if (failNextPublication) {
        failNextPublication = false;
        return route.fulfill({
          status: 503,
          json: { error: "Fixture response lost after acceptance" }
        });
      }
      return route.fulfill({
        json: { schemaVersion: 1, persisted: true, order: normalized }
      });
    }
    if (path.endsWith("/cancellation")) {
      const orderHash = path.split("/").at(-2);
      const entry = publishedOrders.get(orderHash);
      assert.ok(entry, "Cancellation identifies a stored fixture order");
      return route.fulfill({
        json: {
          schemaVersion: 1,
          chainId: 56,
          protocolAddress: protocol,
          orderHash,
          order: encodeSeaportOrder(entry.order)
        }
      });
    }
    if (path.endsWith("/preflight")) {
      const input = route.request().postDataJSON();
      const [operator, approved] = await Promise.all([
        client.readContract({
          address: collection,
          abi: erc721Abi,
          functionName: "isApprovedForAll",
          args: [input.actor, protocol]
        }),
        client.readContract({
          address: collection,
          abi: erc721Abi,
          functionName: "getApproved",
          args: [tokenId]
        })
      ]);
      return route.fulfill({
        json: {
          schemaVersion: 1,
          source: "yunipals",
          asset,
          lifecycle: 1,
          actor: input.actor,
          protocolAddress: protocol,
          orderHash: seaportOrderHash(order),
          expiresAt: (BigInt(Math.floor(Date.now() / 1000)) + 30n).toString(),
          needsNftApproval:
            !operator && approved.toLowerCase() !== protocol.toLowerCase()
        }
      });
    }
    if (path.endsWith("/fulfillment"))
      return route.fulfill({
        json: {
          schemaVersion: 1,
          source: "yunipals",
          id: "ui-fork-quote",
          asset,
          lifecycle: 1,
          actor: buyer.address,
          orderHash: seaportOrderHash(order),
          expiresAt: (BigInt(Math.floor(Date.now() / 1000)) + 60n).toString(),
          order: encodeSeaportOrder(order),
          signature
        }
      });
    throw new Error(`Unexpected fixture API request: ${path}`);
  });
  for (const endpoint of [
    "https://bsc-rpc.publicnode.com/**",
    "https://bsc-dataseed-public.bnbchain.org/**"
  ]) {
    await context.route(endpoint, async (route) => {
      const body = route.request().postDataJSON();
      const call = async (item) => {
        try {
          return {
            jsonrpc: "2.0",
            id: item.id,
            result: await rpc(item.method, item.params)
          };
        } catch {
          return {
            jsonrpc: "2.0",
            id: item.id,
            error: { code: -32000, message: "Local fixture RPC failed" }
          };
        }
      };
      await route.fulfill({
        json: Array.isArray(body)
          ? await Promise.all(body.map(call))
          : await call(body)
      });
    });
  }
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.setDefaultTimeout(20_000);
  if (values["onchain-only"]) {
    activeAccount = seller.address;
    await page.goto(`${values.url}/collection/bnb/${tokenId}`, {
      waitUntil: "domcontentloaded"
    });
    const notice = page.getByRole("dialog", {
      name: "Buying and selling on Yunipals"
    });
    assert.equal(await notice.count(), 0);
    await page
      .locator("footer")
      .getByRole("button", { name: "Buying and selling information" })
      .click();
    await notice.getByRole("checkbox").check();
    await notice.getByRole("button", { name: "Accept and continue" }).click();
    await page.getByRole("button", { name: /Connect/ }).first().click();
    await page.getByText("Yunipals test wallet", { exact: true }).last().click();
    await page.goto(`${values.url}/collection/bnb/${tokenId}`, {
      waitUntil: "domcontentloaded"
    });
    await page.getByRole("button", { name: "List for sale", exact: true }).click();
    await page.getByLabel("Buyer pays (BNB)", { exact: true }).fill("0.1");
    await page.getByRole("button", { name: "Review listing", exact: true }).click();
    const publish = page.getByRole("button", {
      name: "Publish on chain listing",
      exact: true
    });
    assert.equal(
      await page.getByRole("button", { name: "Review network fee" }).count(),
      0
    );
    await publish.click();
    await page.getByText(
      "Order validated on chain. It will appear when the shared indexer catches up; your receipt and cancellation parameters are saved.",
      { exact: true }
    ).waitFor();
    assert.equal(walletSignatures, 0);
    assert.ok(lastValidationTx, "The wallet must submit a validation transaction");
    const receipt = await client.getTransactionReceipt({
      hash: lastValidationTx
    });
    const hashes = receipt.logs.flatMap((log) => {
      if (log.address.toLowerCase() !== protocol.toLowerCase()) return [];
      try {
        const event = decodeEventLog({
          abi: seaportEventAbi,
          data: log.data,
          topics: log.topics
        });
        return event.eventName === "OrderValidated"
          ? [event.args.orderHash.toLowerCase()]
          : [];
      } catch {
        return [];
      }
    });
    assert.equal(hashes.length, 1);
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("yunipals-market-order-recovery-v1") ?? "[]")
    );
    assert.ok(saved.some((item) => item.orderHash.toLowerCase() === hashes[0]));
    assert.equal(
      preparedOrders.size,
      0,
      "No private order preparation POST is needed"
    );
    assert.equal(
      publishedOrders.size,
      0,
      "No private order POST should publish a validated order"
    );
    assert.deepEqual(pageErrors, []);
    pass(
      "browser maker wallet validates a listing on chain and waits for public indexing without a private order POST"
    );
  } else {
  await page.goto(`${values.url}/collection/bnb/${tokenId}`, {
    waitUntil: "domcontentloaded"
  });
  const tradingNotice = page.getByRole("dialog", {
    name: "Buying and selling on Yunipals"
  });
  assert.equal(await tradingNotice.count(), 0);
  await page
    .locator("footer")
    .getByRole("button", { name: "Buying and selling information" })
    .click();
  await tradingNotice.getByRole("checkbox").check();
  await tradingNotice
    .getByRole("button", { name: "Accept and continue", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connect to buy", exact: true })
    .click();
  await page.getByText("Yunipals test wallet", { exact: true }).last().click();
  const primaryNavigation = page.getByRole("navigation", {
    name: "Primary navigation"
  });
  assert.equal(
    await primaryNavigation
      .getByRole("link", { name: "My orders", exact: true })
      .count(),
    0
  );
  const accountMenuTrigger = page.getByRole("button", {
    name: "Account menu",
    exact: true
  });
  await accountMenuTrigger.click();
  const accountMenu = page.getByRole("menu", { name: "Account menu" });
  await accountMenu.waitFor();
  await accountMenu
    .getByRole("menuitem", { name: "My collection", exact: true })
    .waitFor();
  const walletSettings = accountMenu.getByRole("menuitem", {
    name: "Wallet settings",
    exact: true
  });
  await walletSettings.waitFor();
  assert.equal(await walletSettings.isEnabled(), true);
  await page.keyboard.press("Escape");
  assert.equal(await accountMenu.count(), 0);
  assert.equal(
    await accountMenuTrigger.evaluate(
      (button) => button === document.activeElement
    ),
    true
  );
  await accountMenuTrigger.click();
  await accountMenu
    .getByRole("menuitem", { name: "My orders", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "My orders", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/orders");
  await accountMenuTrigger.click();
  assert.equal(
    await accountMenu
      .getByRole("menuitem", { name: "My orders", exact: true })
      .getAttribute("aria-current"),
    "page"
  );
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await accountMenuTrigger.click();
  const mobileAccountMenuBounds = await accountMenu.boundingBox();
  assert.ok(mobileAccountMenuBounds);
  assert.ok(mobileAccountMenuBounds.x >= 0);
  assert.ok(mobileAccountMenuBounds.x + mobileAccountMenuBounds.width <= 390);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.goto(`${values.url}/collection/bnb/${tokenId}`, {
    waitUntil: "domcontentloaded"
  });
  pass(
    "connected account menu owns collection, orders and wallet settings with keyboard dismissal"
  );
  await page.getByRole("button", { name: "Buy", exact: true }).click();
  await page.getByRole("dialog", { name: "Review purchase" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(
    await page
      .getByRole("button", { name: "Buy", exact: true })
      .evaluate((button) => button === document.activeElement),
    true
  );
  pass("review dialog supports Escape and restores focus to the trade button");
  await page.getByRole("button", { name: "Buy", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Review purchase" })
    .getByRole("button", { name: "Confirm purchase", exact: true })
    .waitFor();
  await page.screenshot({ path: values.screenshot, fullPage: false });
  const sellerBefore = await client.getBalance({ address: seller.address });
  const feeBefore = await client.getBalance({ address: feeRecipient });
  indexerOwnershipDelayed = true;
  await page
    .getByRole("button", { name: "Confirm purchase", exact: true })
    .click();
  await page.getByText("Purchase confirmed.", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Buy", exact: true }).count(),
    0,
    "BNB purchase immediately removes the stale Buy action"
  );
  assert.equal((await getOwner()).toLowerCase(), buyer.address.toLowerCase());
  assert.equal(
    (await client.getBalance({ address: seller.address })) - sellerBefore,
    price - fee
  );
  assert.equal(
    (await client.getBalance({ address: feeRecipient })) - feeBefore,
    fee
  );
  pass("browser purchase settles the NFT and exact native seller/fee proceeds");
  await page.goto(`${values.url}/collector/${buyer.address.toLowerCase()}`, {
    waitUntil: "domcontentloaded"
  });
  await page.getByText("Yunipal test fixture · BNB Chain", { exact: true }).waitFor();
  assert.equal(
    await page.getByText(/^Showing 0 visible results/).count(),
    1
  );
  pass(
    "confirmed purchase appears in the recently acquired notice while indexed ownership is delayed"
  );
  indexerOwnershipDelayed = false;
  await page.goto(`${values.url}/collection/bnb/${tokenId}`, {
    waitUntil: "domcontentloaded"
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Purchase · Confirmed", { exact: true }).waitFor();
  // Close the receipt inspector before continuing with the page underneath.
  await page
    .getByLabel("Your transactions")
    .locator("details[open] > summary")
    .click();
  pass("page refresh recovers and verifies the submitted purchase receipt");
  await page
    .getByRole("button", { name: "List for sale", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review listing", exact: true })
    .waitFor();
  await page
    .getByLabel("Expires after", { exact: true })
    .locator('option[value="86400"]')
    .waitFor({ state: "attached" });
  assert.deepEqual(
    await page
      .getByLabel("Expires after", { exact: true })
      .locator("option")
      .evaluateAll((options) => options.map((option) => option.value)),
    ["3600", "86400"]
  );
  await page
    .getByRole("button", { name: "Close order review", exact: true })
    .click();
  advertisedDuration = "2592000";
  await page.reload({ waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "List for sale", exact: true })
    .click();
  await page
    .getByLabel("Expires after", { exact: true })
    .selectOption("2592000");
  pass(
    "Expiry choices follow the BNB policy and allow a 30-day listing after the cap increases"
  );
  await page.getByLabel("Buyer pays (BNB)", { exact: true }).fill("0.1");
  await page
    .getByRole("button", { name: "Review listing", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Approve this NFT", exact: true })
    .click();
  failNextPublication = true;
  await page.screenshot({
    path: "/tmp/yunipals-marketplace-listing-review.png"
  });
  await page
    .getByRole("button", { name: "Sign and publish listing", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Retry publication", exact: true })
    .waitFor();
  assert.equal(walletSignatures, 1);
  await page
    .getByRole("button", { name: "Retry publication", exact: true })
    .click();
  await page.getByText("Listing published.", { exact: true }).waitFor();
  assert.equal(walletSignatures, 1);
  const [firstListingHash] = [...publishedOrders.keys()];
  const firstPublished = publishedOrders.get(firstListingHash).order;
  assert.equal(firstPublished.endTime - firstPublished.startTime, 2592000n);
  await page
    .getByRole("button", { name: "Close order review", exact: true })
    .click();
  pass(
    "browser listing approves the NFT and retries an accepted order without another signature"
  );
  await page.getByRole("button", { name: "Change price", exact: true }).click();
  await page.getByLabel("Buyer pays (BNB)", { exact: true }).fill("0.15");
  await page
    .getByRole("button", { name: "Review listing", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel previous order", exact: true })
    .click();
  await page
    .getByText(
      "Previous order cancelled. Review the replacement before signing.",
      { exact: true }
    )
    .waitFor();
  assert.equal(
    (
      await client.readContract({
        address: protocol,
        abi: seaportReadAbi,
        functionName: "getOrderStatus",
        args: [firstListingHash]
      })
    )[1],
    true
  );
  assert.equal(walletSignatures, 1);
  await page
    .getByRole("button", { name: "Sign and publish listing", exact: true })
    .click();
  await page.getByText("Listing published.", { exact: true }).waitFor();
  assert.equal(walletSignatures, 2);
  const [newListingHash, newListing] = [...publishedOrders.entries()].find(
    ([hash]) => hash !== firstListingHash
  );
  await page
    .getByRole("button", { name: "Close order review", exact: true })
    .click();
  const listingSnapshot = await rpc("evm_snapshot");
  try {
    const proceedsBefore = await client.getBalance({ address: buyer.address });
    const feeBalanceBefore = await client.getBalance({ address: feeRecipient });
    const repricedTotal = 15n * 10n ** 16n;
    await transaction(
      seller.address,
      protocol,
      encodeFunctionData({
        abi: seaportWriteAbi,
        functionName: "fulfillOrder",
        args: [
          seaportFulfillmentOrder(newListing.order, newListing.signature),
          zeroHash
        ]
      }),
      repricedTotal
    );
    assert.equal(
      (await getOwner()).toLowerCase(),
      seller.address.toLowerCase()
    );
    assert.equal(
      (await client.getBalance({ address: buyer.address })) - proceedsBefore,
      repricedTotal - repricedTotal / 40n
    );
    assert.equal(
      (await client.getBalance({ address: feeRecipient })) - feeBalanceBefore,
      repricedTotal / 40n
    );
  } finally {
    assert.equal(await rpc("evm_revert", [listingSnapshot]), true);
  }
  pass(
    "browser repricing cancels the old order before signing, and its new order settles for the exact reviewed price"
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "Cancel listing", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm cancellation", exact: true })
    .click();
  await page.getByText("Order cancelled onchain.", { exact: true }).waitFor();
  assert.equal(
    (
      await client.readContract({
        address: protocol,
        abi: seaportReadAbi,
        functionName: "getOrderStatus",
        args: [newListingHash]
      })
    )[1],
    true
  );
  await page
    .getByRole("button", { name: "Close cancellation review", exact: true })
    .click();
  pass("a published listing can be cancelled directly from the token page");
  const recovery = new Map();
  const recoveryBlock = await client.getBlock();
  const recoveryIntent = createBnbPublicationIntent(
    {
      asset,
      lifecycle: 1,
      maker: buyer.address,
      side: "listing",
      grossAmount: price,
      endTime: recoveryBlock.timestamp + 3600n
    },
    {
      collection,
      offerCurrency: bnbOfferCurrency.address,
      maxDurationSeconds: 3600n,
      fees: [{ recipient: feeRecipient, basisPoints: 250 }]
    },
    {
      timestamp: recoveryBlock.timestamp,
      counter: await client.readContract({
        address: protocol,
        abi: seaportReadAbi,
        functionName: "getCounter",
        args: [buyer.address]
      })
    },
    9876n
  );
  await assert.rejects(
    publishOrder(recoveryIntent, {
      wallet: {
        context: () => ({ address: buyer.address, chainId: 56 }),
        switchChain: async () => {
          throw new Error("The fixture is already on BNB");
        },
        sign: (data) => buyer.signTypedData(data),
        verify: async (_, signature) =>
          verifyBnbOrderMaker(
            client,
            recoveryIntent,
            signature,
            await client.getBlockNumber({ cacheTime: 0 })
          )
      },
      api: {
        prepare: async (input) => ({
          ...input,
          id: "recovery-fixture",
          orderHash: recoveryIntent.orderHash,
          expiresAt: ((await client.getBlock()).timestamp + 120n).toString()
        }),
        submit: async () => {
          throw new Error("Fixture publication response lost");
        }
      },
      revalidate: async () => {
        assert.equal(
          (await getOwner()).toLowerCase(),
          buyer.address.toLowerCase()
        );
      },
      save: (intent, state) =>
        saveRecoverableOrder(intent, state, {
          getItem: (key) => recovery.get(key) ?? null,
          setItem: (key, value) => recovery.set(key, value)
        }),
      onStage: () => {},
      now: () => recoveryBlock.timestamp
    }),
    SignedOrderPublicationError
  );
  assert.equal(
    JSON.parse([...recovery.values()][0])[0].state,
    "publication-unknown"
  );
  pass(
    "a failed publication retains cancellation data for a real BNB maker signature"
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
  await transaction(
    buyer.address,
    collection,
    encodeFunctionData({
      abi: erc721Abi,
      functionName: "approve",
      args: [zeroAddress, tokenId]
    })
  );
  await prepare("offer");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Accept offer", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Accept offer", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Approve this NFT", exact: true })
    .click();
  await page
    .getByText(
      "NFT approval confirmed. Review and accept the offer when ready.",
      { exact: true }
    )
    .waitFor();
  assert.equal(
    (
      await client.readContract({
        address: collection,
        abi: erc721Abi,
        functionName: "getApproved",
        args: [tokenId]
      })
    ).toLowerCase(),
    protocol.toLowerCase()
  );
  const paymentBefore = await client.readContract({
    address: bnbOfferCurrency.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [buyer.address]
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Accept offer", exact: true })
    .click();
  await page
    .getByText("Offer acceptance confirmed.", { exact: true })
    .waitFor();
  assert.equal((await getOwner()).toLowerCase(), seller.address.toLowerCase());
  assert.equal(
    (await client.readContract({
      address: bnbOfferCurrency.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [buyer.address]
    })) - paymentBefore,
    price - fee
  );
  pass(
    "browser offer acceptance performs an explicit NFT approval and receives exact WBNB proceeds"
  );
  await page
    .getByRole("button", { name: "Close trade review", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Make an offer", exact: true })
    .click();
  await page.getByLabel("Offer amount (WBNB)", { exact: true }).fill("0.2");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Review offer", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Wrap 0.1025 BNB", exact: true })
    .waitFor();
  await page.screenshot({ path: "/tmp/yunipals-marketplace-offer-review.png" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    ),
    true
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Wrap 0.1025 BNB", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Approve 0.2 WBNB", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Sign and publish offer", exact: true })
    .click();
  await page.getByText("Offer published.", { exact: true }).waitFor();
  assert.equal(walletSignatures, 3);
  const [, createdOffer] = [...publishedOrders.entries()].find(
    ([, entry]) => entry.order.offer[0].itemType === 1
  );
  assert.equal(
    await client.readContract({
      address: bnbOfferCurrency.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [buyer.address]
    }),
    2n * 10n ** 17n
  );
  assert.equal(
    await client.readContract({
      address: bnbOfferCurrency.address,
      abi: erc20Abi,
      functionName: "allowance",
      args: [buyer.address, protocol]
    }),
    2n * 10n ** 17n
  );
  await page
    .getByRole("button", { name: "Close order review", exact: true })
    .click();
  pass(
    "browser offer creation wraps only the WBNB deficit and approves the exact offered amount before signing"
  );
  const offerSnapshot = await rpc("evm_snapshot");
  try {
    const sellerBalance = await client.readContract({
      address: bnbOfferCurrency.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [seller.address]
    });
    const feesBefore = await client.readContract({
      address: bnbOfferCurrency.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [feeRecipient]
    });
    await transaction(
      seller.address,
      protocol,
      encodeFunctionData({
        abi: seaportWriteAbi,
        functionName: "fulfillBasicOrder",
        args: [
          seaportBasicOfferParameters(
            createdOffer.order,
            createdOffer.signature
          )
        ]
      })
    );
    assert.equal((await getOwner()).toLowerCase(), buyer.address.toLowerCase());
    assert.equal(
      (await client.readContract({
        address: bnbOfferCurrency.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [seller.address]
      })) - sellerBalance,
      195n * 10n ** 15n
    );
    assert.equal(
      (await client.readContract({
        address: bnbOfferCurrency.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [feeRecipient]
      })) - feesBefore,
      5n * 10n ** 15n
    );
  } finally {
    assert.equal(await rpc("evm_revert", [offerSnapshot]), true);
  }
  pass(
    "the offer signed through the browser settles the NFT and exact WBNB seller and fee proceeds"
  );
  await page.getByRole("button", { name: "Change price", exact: true }).click();
  await page.getByLabel("Offer amount (WBNB)", { exact: true }).fill("0.25");
  await page.getByRole("button", { name: "Review offer", exact: true }).click();
  await page
    .getByRole("button", { name: "Cancel previous order", exact: true })
    .click();
  await page
    .getByText(
      "Previous order cancelled. Review the replacement before signing.",
      { exact: true }
    )
    .waitFor();
  assert.equal(
    (
      await client.readContract({
        address: protocol,
        abi: seaportReadAbi,
        functionName: "getOrderStatus",
        args: [seaportOrderHash(createdOffer.order)]
      })
    )[1],
    true
  );
  assert.equal(walletSignatures, 3);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Wrap 0.05 BNB", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Approve 0.25 WBNB", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Sign and publish offer", exact: true })
    .click();
  await page.getByText("Offer published.", { exact: true }).waitFor();
  assert.equal(walletSignatures, 4);
  const [repricedOfferHash] = [...publishedOrders.entries()].find(
    ([, entry]) =>
      entry.order.offer[0].itemType === 1 &&
      entry.order.offer[0].startAmount === 25n * 10n ** 16n
  );
  await page
    .getByRole("button", { name: "Close order review", exact: true })
    .click();
  pass(
    "mobile offer repricing cancels first, wraps the additional deficit and raises the exact allowance"
  );
  await page.getByRole("button", { name: "Cancel offer", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm cancellation", exact: true })
    .click();
  await page.getByText("Order cancelled onchain.", { exact: true }).waitFor();
  assert.equal(
    (
      await client.readContract({
        address: protocol,
        abi: seaportReadAbi,
        functionName: "getOrderStatus",
        args: [repricedOfferHash]
      })
    )[1],
    true
  );
  await page
    .getByRole("button", { name: "Close cancellation review", exact: true })
    .click();
  pass(
    "a published offer can be cancelled directly from the token page on mobile"
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    ),
    true
  );
  pass("token trading view fits a mobile viewport without horizontal overflow");
  await page.evaluate(
    (records) => {
      for (const [key, value] of records)
        localStorage.setItem(
          key,
          JSON.stringify([
            ...JSON.parse(localStorage.getItem(key) ?? "[]"),
            ...JSON.parse(value)
          ])
        );
    },
    [...recovery.entries()]
  );
  marketUnavailable = true;
  await page.goto(`${values.url}/orders/recovery`, {
    waitUntil: "domcontentloaded"
  });
  await page
    .getByRole("heading", { name: "Order recovery", exact: true })
    .waitFor();
  await page
    .getByText("Publication could not be confirmed.", { exact: true })
    .waitFor();
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export cancellation records", exact: true })
    .click();
  const exportPath = "/tmp/yunipals-marketplace-recovery-export.json";
  await (await downloaded).saveAs(exportPath);
  const exported = await readFile(exportPath, "utf8");
  const exportedRecords = JSON.parse(exported);
  assert.ok(
    exportedRecords.some(
      (record) => record.orderHash === recoveryIntent.orderHash
    )
  );
  assert.ok(
    exportedRecords.every(
      (record) =>
        record.order.offerer.toLowerCase() === buyer.address.toLowerCase()
    )
  );
  assert.ok(!exported.includes('"signature":'));
  // Simulate moving the export into empty recovery storage. Wallet connection
  // and RPC interception stay in this browser; this is not a real mobile wallet.
  await page.evaluate(() =>
    localStorage.removeItem("yunipals-market-order-recovery-v1")
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page
    .getByText("No orders for this wallet are saved in this browser.", {
      exact: true
    })
    .waitFor();
  const damaged = structuredClone(exportedRecords);
  damaged[0].asset.tokenId = "999999999999";
  await page.getByLabel("Cancellation records file").setInputFiles({
    name: "invalid-recovery.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(damaged))
  });
  await page
    .getByRole("alert")
    .filter({ hasText: "Saved order does not match its NFT." })
    .waitFor();
  assert.equal(await page.getByRole("listitem").count(), 0);
  pass(
    "invalid recovery import leaves empty browser records unchanged during an API outage"
  );
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Import cancellation records", exact: true })
    .click();
  await (await chooser).setFiles(exportPath);
  await page.getByText(/^Imported \d+ cancellation records?\./).waitFor();
  await page
    .getByText("Imported cancellation record; publication is unconfirmed.", {
      exact: true
    })
    .first()
    .waitFor();
  const restored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("yunipals-market-order-recovery-v1"))
  );
  assert.equal(restored.length, exportedRecords.length);
  assert.ok(restored.every((record) => record.state === "imported"));
  await page.getByLabel("Cancellation records file").setInputFiles(exportPath);
  await page
    .getByText(
      "These cancellation records are already saved in this browser.",
      { exact: true }
    )
    .waitFor();
  assert.equal(
    await page.getByRole("listitem").count(),
    exportedRecords.length
  );
  pass(
    "exported cancellation parameters import into empty storage without publication claims or duplicate records"
  );
  const recoveryCard = page
    .getByRole("listitem")
    .filter({ hasText: recoveryIntent.orderHash });
  await recoveryCard
    .getByRole("button", { name: "Review cancellation", exact: true })
    .click();
  await recoveryCard
    .getByRole("button", { name: "Confirm cancellation", exact: true })
    .click();
  await recoveryCard
    .getByText("Order cancelled onchain.", { exact: true })
    .waitFor();
  await page.getByLabel("Your transactions").locator("summary").click();
  await page
    .getByText("Cancellation · Confirmed", { exact: true })
    .last()
    .waitFor();
  assert.equal(
    (
      await client.readContract({
        address: protocol,
        abi: seaportReadAbi,
        functionName: "getOrderStatus",
        args: [recoveryIntent.orderHash]
      })
    )[1],
    true
  );
  assert.equal((await getOwner()).toLowerCase(), seller.address.toLowerCase());
  await page.reload({ waitUntil: "domcontentloaded" });
  await recoveryCard.getByText("Cancelled onchain", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    ),
    true
  );
  pass(
    "imported-order cancellation works after NFT transfer and refresh while the marketplace API is unavailable"
  );
  marketUnavailable = false;
  tradingPaused = true;
  historyHidden = true;
  async function seedOwnerOrder(salt, side = "listing") {
    const block = await client.getBlock();
    const intent = createBnbPublicationIntent(
      {
        asset,
        lifecycle: 1,
        maker: buyer.address,
        side,
        grossAmount: price,
        endTime: block.timestamp + 3600n
      },
      policy,
      {
        timestamp: block.timestamp,
        counter: await client.readContract({
          address: protocol,
          abi: seaportReadAbi,
          functionName: "getCounter",
          args: [buyer.address]
        })
      },
      salt
    );
    const signature = await buyer.signTypedData(
      seaportSigningData(
        {
          name: "Seaport",
          version: "1.6",
          chainId: 56,
          verifyingContract: protocol
        },
        intent.order
      )
    );
    publishedOrders.set(intent.orderHash, { order: intent.order, signature });
    return intent;
  }
  const management = [];
  for (let i = 0; i < 26; i++)
    management.push(await seedOwnerOrder(50_000n + BigInt(i)));
  await page.evaluate(() =>
    localStorage.removeItem("yunipals-market-order-recovery-v1")
  );
  await page.goto(`${values.url}/orders?chain=bnb`, {
    waitUntil: "domcontentloaded"
  });
  const rows = page
    .getByRole("list", { name: "Listings orders", exact: true })
    .getByRole("listitem");
  await rows.nth(24).waitFor();
  assert.equal(await rows.count(), 25);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    ),
    true
  );
  await page.screenshot({
    path: "/tmp/yunipals-marketplace-wallet-listings-mobile.png"
  });
  await rows.first().getByText("Hidden NFT", { exact: true }).waitFor();
  await rows
    .first()
    .getByText("No longer in your wallet", { exact: true })
    .waitFor();
  assert.equal(
    await rows
      .first()
      .getByRole("button", { name: "Change price", exact: true })
      .count(),
    0
  );
  await seedOwnerOrder(50_026n);
  historyNextPageUnavailable = true;
  await page
    .getByRole("button", { name: "Load more orders", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "More orders could not be loaded" })
    .waitFor();
  assert.equal(await rows.count(), 25);
  historyNextPageUnavailable = false;
  await page
    .getByRole("button", { name: "Retry order history", exact: true })
    .click();
  await rows.nth(24).waitFor();
  // New records after a first page appear only after a deliberate refresh.
  await seedOwnerOrder(50_027n);
  await page
    .getByRole("button", { name: "Load more orders", exact: true })
    .click();
  await rows.nth(26).waitFor();
  assert.equal(await rows.count(), 27);
  assert.equal(
    await page
      .getByRole("button", { name: "Load more orders", exact: true })
      .count(),
    0
  );
  pass(
    "wallet history pages survive a next-page outage and keep one snapshot despite newly added orders"
  );
  await page.getByLabel("Network", { exact: true }).selectOption("all");
  await page.getByText(/Some orders may be missing or out of date:/).waitFor();
  await page.getByLabel("Network", { exact: true }).selectOption("bnb");
  await rows.nth(24).waitFor();
  const cancellingHash = await rows
    .first()
    .getByLabel("Order hash")
    .innerText();
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("yunipals-market-order-recovery-v1")
    ),
    null
  );
  await rows
    .first()
    .getByRole("button", { name: "Cancel listing", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm cancellation", exact: true })
    .click();
  await page.getByText("Order cancelled onchain.", { exact: true }).waitFor();
  assert.equal(
    (
      await client.readContract({
        address: protocol,
        abi: seaportReadAbi,
        functionName: "getOrderStatus",
        args: [cancellingHash]
      })
    )[1],
    true
  );
  assert.equal((await getOwner()).toLowerCase(), seller.address.toLowerCase());
  await page
    .getByRole("button", { name: "Close cancellation review", exact: true })
    .click();
  pass(
    "wallet history retrieves cancellation evidence without local records and cancels a hidden transferred listing while trading is paused"
  );
  await page.getByRole("button", { name: "Past orders", exact: true }).click();
  await page
    .getByRole("list", { name: "Past orders orders", exact: true })
    .getByRole("listitem")
    .filter({ hasText: cancellingHash })
    .waitFor();
  historyHidden = false;
  tradingPaused = false;
  const ownerOffer = await seedOwnerOrder(60_000n, "offer");
  await page.getByRole("button", { name: "Offers made", exact: true }).click();
  await page
    .getByRole("button", { name: "Refresh orders", exact: true })
    .click();
  const offerRow = page
    .getByRole("listitem")
    .filter({ hasText: ownerOffer.orderHash });
  await offerRow
    .getByRole("button", { name: "Change price", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Offer amount (WBNB)", { exact: true })
    .fill("0.12");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Review offer", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel previous order", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign and publish offer", exact: true })
    .click();
  await page.getByText("Offer published.", { exact: true }).waitFor();
  assert.equal(
    (
      await client.readContract({
        address: protocol,
        abi: seaportReadAbi,
        functionName: "getOrderStatus",
        args: [ownerOffer.orderHash]
      })
    )[1],
    true
  );
  await page
    .getByRole("button", { name: "Close order review", exact: true })
    .click();
  pass(
    "offers made can be repriced from wallet history with cancellation before the replacement signature"
  );
  await transaction(
    seller.address,
    collection,
    encodeFunctionData({
      abi: erc721Abi,
      functionName: "transferFrom",
      args: [seller.address, buyer.address, tokenId]
    })
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
  await prepare("offer");
  await page
    .getByRole("button", { name: "Offers received", exact: true })
    .click();
  const incoming = page
    .getByRole("listitem")
    .filter({ hasText: seaportOrderHash(order) });
  await incoming
    .getByRole("button", { name: "Accept offer", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Accept offer", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Approve this NFT", exact: true })
    .click();
  await page
    .getByText(
      "NFT approval confirmed. Review and accept the offer when ready.",
      { exact: true }
    )
    .waitFor();
  const beforeReceived = await client.readContract({
    address: bnbOfferCurrency.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [buyer.address]
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Accept offer", exact: true })
    .click();
  await page
    .getByText("Offer acceptance confirmed.", { exact: true })
    .waitFor();
  assert.equal((await getOwner()).toLowerCase(), seller.address.toLowerCase());
  assert.equal(
    (await client.readContract({
      address: bnbOfferCurrency.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [buyer.address]
    })) - beforeReceived,
    price - fee
  );
  await page
    .getByRole("button", { name: "Close trade review", exact: true })
    .click();
  pass(
    "offers received can be approved and accepted from wallet history with exact WBNB proceeds"
  );
  await page.getByRole("button", { name: "Offers made", exact: true }).click();
  await page
    .getByRole("button", { name: "Refresh orders", exact: true })
    .click();
  await page
    .getByRole("list", { name: "Offers made orders", exact: true })
    .getByRole("button", { name: "Cancel offer", exact: true })
    .click();
  await page.getByRole("dialog").waitFor();
  activeAccount = seller.address;
  await page.evaluate(
    (address) => window.marketplaceFixtureAccountsChanged([address]),
    activeAccount
  );
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByText("No orders in this view.", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("list", { name: "Offers made orders", exact: true })
      .count(),
    0
  );
  pass(
    "changing the connected wallet clears the previous order rows and an open cancellation review"
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    ),
    true
  );
  await page.screenshot({
    path: "/tmp/yunipals-marketplace-owner-orders-mobile.png",
    fullPage: true
  });
  assert.deepEqual(pageErrors, []);
  }
} catch (error) {
  report.tests.push({
    name: "browser flow",
    status: "failed",
    error: error.message
  });
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page) {
      await page
        .screenshot({ path: "/tmp/yunipals-marketplace-ui-failure.png" })
        .catch(() => {});
      process.stdout.write(
        (await page.locator("body").innerText()).slice(-6000)
      );
    }
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  assert.equal(await rpc("evm_revert", [snapshot]), true);
  await writeFile(values.output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
