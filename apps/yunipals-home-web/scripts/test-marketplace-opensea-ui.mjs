import { parseCollectionFilters } from "../src/lib/collectionFilters.ts";
import {
  parseCatalogPage,
  validateCatalogFilters
} from "../src/lib/marketplace/catalog.ts";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  erc721Abi,
  http,
  parseAbi,
  toHex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createOpenSeaPublicationIntent } from "../src/lib/marketplace/openseaPublication.ts";
import { openSeaPublicationFixture } from "../src/lib/marketplace/openseaPublication.testFixtures.ts";
import {
  decodeSeaportOrder,
  encodeSeaportOrder
} from "../src/lib/marketplace/seaportWire.ts";
import { seaportOrderHash } from "../src/lib/marketplace/seaport.ts";

import { buildOpenSeaFulfillment } from "../src/lib/marketplace/openseaFulfillment.ts";
import { inspectOpenSeaTrade } from "../src/lib/marketplace/openseaTradeState.ts";
import { openSeaFixture } from "../src/lib/marketplace/opensea.testFixtures.ts";
import {
  openseaConduit,
  openseaCurrencies
} from "../src/lib/marketplace/openseaRegistry.ts";
import {
  marketplaceChains,
  seaportDeployment
} from "../src/lib/marketplace/registry.ts";
import {
  seaportReadAbi,
  seaportSigningData
} from "../src/lib/marketplace/seaport.ts";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:5177" },
    rpc: { type: "string", default: "http://127.0.0.1:18548" },
    playwright: { type: "string" },
    chromium: { type: "string" },
    "token-id": { type: "string", default: "2000" },
    output: { type: "string", default: "/tmp/yunipals-opensea-ui-report.json" },
    screenshot: { type: "string", default: "/tmp/yunipals-opensea-ui.png" }
  }
});
for (const input of [values.url, values.rpc]) {
  const url = new URL(input);
  assert.equal(url.protocol, "http:");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.ok(!url.username && !url.password);
}
assert.ok(
  values.playwright,
  "Pass a local Playwright module via --playwright."
);
const { chromium } = await import(pathToFileURL(values.playwright).href);
const client = createPublicClient({
  transport: http(values.rpc, { retryCount: 0 }),
  cacheTime: 0
});
const rpc = (method, params = []) => client.request({ method, params });
assert.match(await rpc("web3_clientVersion"), /anvil/i);
assert.equal(await client.getChainId(), 1);
const metadata = await rpc("anvil_metadata");
assert.equal(
  metadata.forkedNetwork?.chainId,
  1,
  "An actual Ethereum fork is required before local mutations."
);
const initial = await rpc("evm_snapshot");
const seller = privateKeyToAccount(`0x${"1".padStart(64, "0")}`);
const buyer = privateKeyToAccount(`0x${"2".padStart(64, "0")}`);
const feeRecipient = privateKeyToAccount(`0x${"3".padStart(64, "0")}`).address;
const collection = marketplaceChains.ethereum.contractAddress;
const protocol = seaportDeployment.address;
const weth = openseaCurrencies.ethereum.address;
const tokenId = BigInt(values["token-id"]);
const price = 10n ** 18n;
const fee = price / 40n;
const report = {
  checkedAt: new Date().toISOString(),
  forkBlock: metadata.forkedNetwork.forkBlockNumber,
  scope:
    "Chromium with a fixture OpenSea-shaped API, injected EOA wallet and real contracts on a verified local Ethereum fork. External browser requests blocked. No live trades, provider authorization or production backend verification.",
  tests: []
};
let browser;
const json = (value) =>
  JSON.stringify(value, (_, item) =>
    typeof item === "bigint" ? item.toString() : item
  );
async function transaction(from, to, data, value = 0n) {
  await rpc("anvil_impersonateAccount", [from]);
  try {
    const hash = await rpc("eth_sendTransaction", [
      { from, to, data, value: toHex(value), gas: toHex(2_000_000) }
    ]);
    assert.equal(
      (await client.waitForTransactionReceipt({ hash })).status,
      "success"
    );
    return hash;
  } finally {
    await rpc("anvil_stopImpersonatingAccount", [from]);
  }
}
const owner = () =>
  client.readContract({
    address: collection,
    abi: erc721Abi,
    functionName: "ownerOf",
    args: [tokenId]
  });
const balance = (account) =>
  client.readContract({
    address: weth,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account]
  });
async function transferNft(to) {
  const from = await owner();
  if (from.toLowerCase() === to.toLowerCase()) return;
  await rpc("anvil_setBalance", [from, toHex(100n * price)]);
  await transaction(
    from,
    collection,
    encodeFunctionData({
      abi: erc721Abi,
      functionName: "transferFrom",
      args: [from, to, tokenId]
    })
  );
}
async function clearWeth(account) {
  const amount = await balance(account);
  if (amount)
    await transaction(
      account,
      weth,
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [feeRecipient, amount]
      })
    );
  await transaction(
    account,
    weth,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [openseaConduit.address, 0n]
    })
  );
}
function pass(name) {
  report.tests.push({ name, status: "passed" });
  process.stdout.write(`PASS ${name}\n`);
}
try {
  await rpc("evm_setAutomine", [true]);
  for (const account of [seller.address, buyer.address, feeRecipient]) {
    await rpc("anvil_setCode", [account, "0x"]);
    await rpc("anvil_setNonce", [account, "0x0"]);
    await rpc("anvil_setBalance", [account, toHex(100n * price)]);
  }
  await transferNft(seller.address);
  await clearWeth(buyer.address);
  await transaction(
    seller.address,
    collection,
    encodeFunctionData({
      abi: erc721Abi,
      functionName: "approve",
      args: [openseaConduit.address, tokenId]
    })
  );
  let prepared;
  const publications = new Map();
  const preparations = new Map();
  let failNextPublication = false;
  let marketDown = false;
  let walletSignatures = 0;
  const currentPolicy = async () => ({
    ...openSeaPublicationFixture({
      timestamp: (await client.getBlock()).timestamp
    }).rawPolicy,
    maxDurationSeconds: "2592000"
  });
  async function publicationIntent(order) {
    const block = await client.getBlock();
    const { policy } = openSeaPublicationFixture({
      timestamp: block.timestamp
    });
    const side = order.offer[0].itemType === 2 ? "listing" : "offer";
    const grossAmount =
      side === "listing"
        ? order.consideration.reduce((sum, item) => sum + item.startAmount, 0n)
        : order.offer[0].startAmount;
    const currency =
      side === "listing" ? order.consideration[0].token : order.offer[0].token;
    const intent = createOpenSeaPublicationIntent(
      {
        asset: prepared.reviewed.asset,
        lifecycle: 2,
        maker: order.offerer,
        side,
        grossAmount,
        currency,
        endTime: order.endTime
      },
      {
        ...policy,
        maxDurationSeconds: 2592000n,
        expiresAt: order.startTime + 100n
      },
      { timestamp: order.startTime, counter: order.counter },
      order.salt
    );
    assert.equal(intent.orderHash, seaportOrderHash(order));
    return intent;
  }
  let salt = 6000n;
  async function prepare(side = "listing", currency = "weth") {
    const maker = side === "listing" ? seller : buyer;
    const now = (await client.getBlock()).timestamp;
    const options = {
      chain: "ethereum",
      side,
      currency,
      tokenId: tokenId.toString(),
      startTime: now - 1n,
      endTime: now + 3600n,
      expiresAt: now + 100n,
      salt: ++salt,
      counter: await client.readContract({
        address: protocol,
        abi: seaportReadAbi,
        functionName: "getCounter",
        args: [maker.address]
      })
    };
    const fixture = openSeaFixture(options);
    const signature = await maker.signTypedData(
      seaportSigningData(
        {
          name: "Seaport",
          version: "1.6",
          chainId: 1,
          verifyingContract: protocol
        },
        fixture.order
      )
    );
    prepared = openSeaFixture({ ...options, signature });
  }
  await prepare();
  browser = await chromium.launch({
    headless: true,
    ...(values.chromium ? { executablePath: values.chromium } : {}),
    args: ["--no-sandbox"]
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 960 }
  });
  let authorized = false;
  let account = buyer.address;
  let sends = 0;
  let unavailable = false;
  let redirectRecipient = false;
  let prepareRequests = 0;
  let pausePreparation;
  await context.exposeBinding("marketplaceFixtureRpc", async (_, request) => {
    if (request.method === "eth_accounts") return authorized ? [account] : [];
    if (request.method === "eth_requestAccounts") {
      authorized = true;
      return [account];
    }
    if (
      ["wallet_getPermissions", "wallet_requestPermissions"].includes(
        request.method
      )
    ) {
      authorized = true;
      return [{ parentCapability: "eth_accounts" }];
    }
    if (request.method === "wallet_switchEthereumChain") {
      assert.equal(request.params[0].chainId, "0x1");
      return null;
    }
    if (request.method === "eth_signTypedData_v4") {
      assert.equal(request.params[0].toLowerCase(), account.toLowerCase());
      const data = JSON.parse(request.params[1]);
      assert.equal(Number(data.domain.chainId), 1);
      assert.equal(
        data.domain.verifyingContract.toLowerCase(),
        protocol.toLowerCase()
      );
      const order = decodeSeaportOrder(data.message);
      assert.equal(order.offerer.toLowerCase(), account.toLowerCase());
      await publicationIntent(order);
      walletSignatures++;
      const maker =
        account.toLowerCase() === seller.address.toLowerCase() ? seller : buyer;
      return maker.signTypedData({ ...data, message: order });
    }
    if (request.method === "eth_sendTransaction") {
      const call = request.params[0];
      assert.equal(call.from.toLowerCase(), account.toLowerCase());
      assert.ok(
        [protocol, collection, weth].some(
          (address) => address.toLowerCase() === call.to.toLowerCase()
        )
      );
      sends++;
      return transaction(
        account,
        call.to,
        call.data,
        BigInt(call.value ?? "0x0")
      );
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
      on: (event, callback) =>
        listeners.set(event, [...(listeners.get(event) ?? []), callback]),
      removeListener: (event, callback) =>
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((item) => item !== callback)
        )
    };
    window.ethereum = provider;
    window.marketplaceFixtureAccountsChanged = (accounts) => {
      for (const callback of listeners.get("accountsChanged") ?? [])
        callback(accounts);
    };
    const detail = {
      provider,
      info: {
        uuid: "a04cf572-15c3-4e2d-8467-d96508d59407",
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
  // Register first: subsequent specific routes take precedence.
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === new URL(values.url).origin
      ? route.continue()
      : route.abort()
  );
  await context.route("**/__indexer-test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/collection"))
      return route.fulfill({
        json: {
          chain: "ethereum",
          chains: ["ethereum"],
          activeSupply: 1,
          knownTokens: 1,
          burnedTokens: 0,
          lifecycles: 2
        }
      });
    if (path.endsWith("/traits"))
      return route.fulfill({
        json: {
          chain: "ethereum",
          chains: ["ethereum"],
          items: [],
          metadata: { available: 1, missing: 0 },
          updatedAt: new Date().toISOString()
        }
      });
    return route.fulfill({
      json: {
        token: {
          ...prepared.reviewed.asset,
          token_id: tokenId.toString(),
          owner: await owner(),
          burned: false,
          hidden: false,
          lifecycle: 2,
          mintBlock: "1",
          last_transfer_block: String(
            await client.getBlockNumber({ cacheTime: 0 })
          ),
          name: "Yunipal test fixture",
          image: null,
          attributes: [],
          tokenUri: null,
          metadataAvailable: true,
          rarityPoints: "4",
          rarityPointsCapped: "4"
        },
        transfers: [],
        lifecycles: []
      }
    });
  });
  await context.route("**/__market-test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/tokens")) {
      const filters = parseCollectionFilters(
        new URL(route.request().url()).searchParams
      );
      const coverage = {
        status: "complete",
        completedAt: null,
        revision: null
      };
      // Intentionally retain the pre-sale listing even after settlement. The UI
      // must use the verified receipt instead of trusting this lagging snapshot.
      const catalog = {
        schemaVersion: 2,
        query: validateCatalogFilters(filters).key,
        snapshot: {
          id: "lagging-catalog",
          observedAt: new Date().toISOString()
        },
        sources: { ethereum: "available" },
        availability: {
          ethereum: {
            chain: "ethereum",
            evidence: "current",
            listings: coverage,
            offers: coverage
          }
        },
        listingCompleteness: "complete",
        total: 1,
        listedTotal: 1,
        verifiedListedTotal: 1,
        nextCursor: null,
        items: [
          {
            token: {
              ...prepared.reviewed.asset,
              owner: seller.address,
              lifecycle: 2,
              burned: false,
              hidden: false,
              metadataAvailable: true,
              mintBlock: "1",
              lastTransferBlock: "1",
              name: "Yunipal test fixture",
              image: null,
              attributes: [],
              tokenUri: null,
              rarityPoints: "4",
              rarityPointsCapped: "4"
            },
            market: {
              status: "listed",
              listings: [{ ...prepared.reviewed, status: "active" }]
            }
          }
        ]
      };
      parseCatalogPage(catalog, filters);
      return route.fulfill({ json: catalog });
    }
    if (path.endsWith("/activity"))
      return route.fulfill({
        status: 404,
        json: {
          error: "Activity is covered by the separate read-only harness."
        }
      });
    if (marketDown)
      return route.fulfill({
        status: 503,
        json: { error: "Fixture marketplace offline" }
      });
    if (path.endsWith("/policies/ethereum"))
      return route.fulfill({ json: await currentPolicy() });
    if (path.endsWith("/orders/prepare")) {
      const request = route.request().postDataJSON();
      const order = decodeSeaportOrder(request.order);
      const intent = await publicationIntent(order);
      assert.equal(request.policyVersion, intent.policyVersion);
      const id = `preparation-${intent.orderHash}`;
      preparations.set(id, intent.orderHash);
      return route.fulfill({
        json: {
          schemaVersion: 1,
          source: "opensea",
          ...request,
          id,
          orderHash: intent.orderHash,
          expiresAt: ((await client.getBlock()).timestamp + 100n).toString()
        }
      });
    }
    if (path.endsWith("/orders") && route.request().method() === "POST") {
      const request = route.request().postDataJSON();
      const order = decodeSeaportOrder(request.order);
      const intent = await publicationIntent(order);
      assert.equal(preparations.get(request.preparationId), intent.orderHash);
      assert.equal(request.policyVersion, intent.policyVersion);
      publications.set(intent.orderHash, {
        intent,
        signature: request.signature
      });
      if (failNextPublication) {
        failNextPublication = false;
        return route.fulfill({
          status: 503,
          json: { error: "Fixture acknowledgement lost" }
        });
      }
      return route.fulfill({
        json: {
          schemaVersion: 1,
          persisted: true,
          providerAccepted: true,
          order: { ...intent.summary, status: "active" }
        }
      });
    }
    if (
      path.includes("/orders/ethereum/") &&
      route.request().method() === "GET"
    ) {
      const entry = publications.get(path.split("/").at(-1));
      return entry
        ? route.fulfill({
            json: {
              schemaVersion: 1,
              persisted: true,
              providerAccepted: true,
              order: { ...entry.intent.summary, status: "active" }
            }
          })
        : route.fulfill({
            status: 404,
            json: { error: "Fixture unknown order" }
          });
    }
    if (path.endsWith("/cancellation")) {
      const entry = publications.get(path.split("/").at(-2));
      assert.ok(entry);
      return route.fulfill({
        json: {
          schemaVersion: 1,
          chainId: 1,
          protocolAddress: protocol,
          orderHash: entry.intent.orderHash,
          order: encodeSeaportOrder(entry.intent.order)
        }
      });
    }
    if (path.endsWith("/capabilities"))
      return route.fulfill({
        json: {
          schemaVersion: 1,
          chains: {
            ethereum: {
              read: true,
              buy: true,
              acceptOffer: true,
              createListing: true,
              createOffer: true,
              cancel: true
            }
          }
        }
      });
    if (path.includes("/assets/")) {
      const status = await client.readContract({
        address: protocol,
        abi: seaportReadAbi,
        functionName: "getOrderStatus",
        args: [prepared.reviewed.orderHash]
      });
      const order = {
        ...prepared.reviewed,
        status: status[1] ? "cancelled" : status[2] > 0n ? "filled" : "active"
      };
      const rows = [order];
      for (const { intent } of publications.values()) {
        const status = await client.readContract({
          address: protocol,
          abi: seaportReadAbi,
          functionName: "getOrderStatus",
          args: [intent.orderHash]
        });
        rows.push({
          ...intent.summary,
          status: status[1] ? "cancelled" : status[2] > 0n ? "filled" : "active"
        });
      }
      return route.fulfill({
        json: {
          schemaVersion: 2,
          availability: {
            chain: "ethereum",
            evidence: "current",
            listings: { status: "complete", completedAt: null, revision: null },
            offers: { status: "complete", completedAt: null, revision: null }
          },
          listingState:
            order.status === "active" && order.side === "listing"
              ? "listed"
              : "unlisted",
          offerAvailability: "complete",
          asset: order.asset,
          owner: await owner(),
          lifecycle: 2,
          hidden: false,
          burned: false,
          sourceStatus: "available",
          updatedAt: new Date().toISOString(),
          listings: rows.filter((item) => item.side === "listing"),
          offers: rows.filter((item) => item.side === "offer")
        }
      });
    }
    if (
      ["/fulfillment", "/preflight", "/prepare"].some((suffix) =>
        path.endsWith(suffix)
      )
    ) {
      const purpose = path.split("/").at(-1);
      assert.equal(
        purpose,
        "prepare",
        "Browser purchases must use the unified preparation endpoint."
      );
      prepareRequests++;
      if (pausePreparation) await pausePreparation;
      if (unavailable)
        return route.fulfill({
          status: 503,
          json: { error: "Fixture provider unavailable" }
        });
      const entry = publications.get(path.split("/").at(-2));
      let quote = structuredClone(prepared.quote);
      if (entry) {
        const { order } = entry.intent;
        const { counter, ...parameters } = encodeSeaportOrder(order);
        parameters.totalOriginalConsiderationItems = order.consideration.length;
        quote = {
          id: "published-fulfillment",
          asset: entry.intent.asset,
          lifecycle: 2,
          actor: route.request().postDataJSON().actor,
          orderHash: entry.intent.orderHash,
          fulfillment: {
            protocol: "seaport1.6",
            fulfillment_data: {
              orders: [
                {
                  parameters: { ...parameters, counter },
                  signature: entry.signature
                }
              ],
              transaction: {
                chain: 1,
                to: protocol,
                function: "fulfillOrder",
                value:
                  entry.intent.summary.currency.symbol === "ETH"
                    ? entry.intent.summary.grossAmount
                    : "0",
                input_data: {
                  order: { parameters, signature: entry.signature },
                  fulfillerConduitKey: openseaConduit.key
                }
              }
            }
          }
        };
      }
      quote.expiresAt = (
        BigInt(Math.floor(Date.now() / 1000)) + 100n
      ).toString();
      let simulated = purpose === "fulfillment";
      if (purpose === "prepare") {
        const reviewed = entry
          ? { ...entry.intent.summary, status: "active" }
          : prepared.reviewed;
        const trade = buildOpenSeaFulfillment(
          quote,
          reviewed,
          quote.actor,
          BigInt(Math.floor(Date.now() / 1000))
        );
        simulated = !(await inspectOpenSeaTrade(client, trade)).next;
      }
      if (redirectRecipient)
        quote.fulfillment.fulfillment_data.transaction.input_data.recipient =
          seller.address;
      return route.fulfill({
        contentType: "application/json",
        body: json({
          schemaVersion: 1,
          source: "opensea",
          purpose,
          simulated,
          ...quote
        })
      });
    }
    throw new Error(`Unexpected API request: ${path}`);
  });
  for (const endpoint of [
    "https://ethereum-rpc.publicnode.com/**",
    "https://eth.drpc.org/**"
  ]) {
    await context.route(endpoint, async (route) => {
      const body = route.request().postDataJSON();
      const call = async (item) => {
        assert.ok(
          item.method.startsWith("eth_") && !/send|sign/i.test(item.method),
          "Browser public RPC stays read-only."
        );
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
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error("Browser error:", error.stack);
  });
  page.setDefaultTimeout(25_000);
  const visit = () =>
    page.goto(`${values.url}/collection/ethereum/${tokenId}`, {
      waitUntil: "domcontentloaded"
    });
  await page.goto(`${values.url}/?chain=ethereum&sale=listed`, {
    waitUntil: "domcontentloaded"
  });
  const tradingNotice = page.getByRole("dialog", {
    name: "Buying and selling on Yunipals"
  });
  assert.equal(await tradingNotice.count(), 0);
  await page.getByRole("button", { name: "Buy", exact: true }).click();
  await tradingNotice.getByRole("checkbox").check();
  await tradingNotice
    .getByRole("button", { name: "Accept and continue", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Review purchase" })
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await page.getByText("Yunipals test wallet", { exact: true }).last().click();
  await page.getByRole("button", { name: "Buy", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Review purchase" });
  const confirm = () =>
    dialog
      .getByRole("button", { name: "Confirm purchase", exact: true })
      .click();
  const stepConfirmed = () =>
    page
      .getByText("Step confirmed. Review the trade when ready.", {
        exact: true
      })
      .waitFor();
  await confirm();
  await dialog.getByRole("button", { name: /Wrap .*ETH/ }).waitFor();
  assert.equal(
    sends,
    0,
    "Reviewing a prerequisite never submits it automatically."
  );
  await page.screenshot({ path: values.screenshot });
  await dialog.getByRole("button", { name: /Wrap .*ETH/ }).click();
  await stepConfirmed();
  assert.equal(await balance(buyer.address), price);
  assert.equal(sends, 1);
  assert.equal(
    await page.locator("article").count(),
    1,
    "Wrapping does not remove the listing"
  );
  pass("WETH purchase requests explicit wrapping of exactly the missing ETH");
  await confirm();
  await dialog.getByRole("button", { name: /Approve .*WETH/ }).click();
  await stepConfirmed();
  assert.equal(
    await client.readContract({
      address: weth,
      abi: erc20Abi,
      functionName: "allowance",
      args: [buyer.address, openseaConduit.address]
    }),
    price
  );
  assert.equal(sends, 2);
  assert.equal(
    await page.locator("article").count(),
    1,
    "Approval does not remove the listing"
  );
  pass(
    "WETH purchase approves the exact price to the verified OpenSea conduit"
  );
  const sellerBefore = await balance(seller.address);
  const feeBefore = await balance(feeRecipient);
  const beforePurchaseRequests = prepareRequests;
  await confirm();
  await page.getByText("Purchase confirmed.", { exact: true }).waitFor();
  assert.equal((await owner()).toLowerCase(), buyer.address.toLowerCase());
  assert.equal((await balance(seller.address)) - sellerBefore, price - fee);
  assert.equal((await balance(feeRecipient)) - feeBefore, fee);
  assert.equal(sends, 3);
  assert.equal(prepareRequests - beforePurchaseRequests, 1);
  pass(
    "OpenSea-shaped advanced purchase transfers the NFT and exact WETH proceeds through the browser"
  );
  assert.equal(
    await page.locator("article").count(),
    0,
    "Sold card disappears while catalog still returns it"
  );
  assert.equal(await dialog.isVisible(), true, "Success dialog stays open");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(1000);
  assert.equal(await page.locator("article").count(), 0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get("sale"), "listed");
  assert.equal(
    await page.evaluate(() => document.activeElement?.tagName),
    "H2",
    "Closing returns focus to the collection heading after the Buy button disappears"
  );
  pass(
    "Confirmed collection purchase removes its card despite a deliberately stale catalog and keeps filters/dialog intact"
  );
  await page.goto(`${values.url}/?chain=ethereum`, {
    waitUntil: "domcontentloaded"
  });
  await page.getByText("Purchased", { exact: true }).waitFor();
  assert.equal(
    await page
      .locator("article")
      .getByRole("button", { name: "Buy", exact: true })
      .count(),
    0
  );
  pass(
    "Recovered receipt protects All NFTs from stale prices after navigation"
  );
  await visit();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Purchase · Confirmed", { exact: true }).waitFor();
  // Close the receipt inspector before continuing with the page underneath.
  await page
    .getByLabel("Your transactions")
    .locator("details[open] > summary")
    .click();
  pass(
    "Reload restores and validates the OpenSea purchase and prerequisite receipts"
  );
  await transferNft(seller.address);
  await transaction(
    seller.address,
    collection,
    encodeFunctionData({
      abi: erc721Abi,
      functionName: "approve",
      args: [openseaConduit.address, tokenId]
    })
  );
  await prepare("listing", "native");
  await visit();
  await page.getByRole("button", { name: "Buy", exact: true }).click();
  unavailable = true;
  await confirm();
  await dialog
    .getByRole("status")
    .getByText(/unavailable|could not/i)
    .waitFor();
  assert.equal(sends, 3);
  unavailable = false;
  redirectRecipient = true;
  await confirm();
  await dialog
    .getByRole("status")
    .getByText(/another wallet/i)
    .waitFor();
  assert.equal(sends, 3);
  redirectRecipient = false;
  pass(
    "Provider outages and redirected NFT recipients fail before a wallet send"
  );
  await page
    .getByRole("button", { name: "Close trade review", exact: true })
    .click();
  await page.getByRole("button", { name: "Buy", exact: true }).click();
  let releasePreparation;
  pausePreparation = new Promise((resolve) => {
    releasePreparation = resolve;
  });
  const waitingRequest = page.waitForRequest((request) =>
    request.url().endsWith("/prepare")
  );
  await confirm();
  await waitingRequest;
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  releasePreparation();
  pausePreparation = undefined;
  await page.waitForTimeout(1000);
  assert.equal(sends, 3);
  assert.equal(await dialog.count(), 0);
  pass("Closing preparation prevents a late wallet request");
  await clearWeth(seller.address);
  await transaction(
    buyer.address,
    weth,
    encodeFunctionData({
      abi: parseAbi(["function deposit() payable"]),
      functionName: "deposit"
    }),
    price
  );
  await transaction(
    buyer.address,
    weth,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [openseaConduit.address, price]
    })
  );
  // Clear the seller's per-NFT approval so both prerequisites are exercised.
  await transaction(
    seller.address,
    collection,
    encodeFunctionData({
      abi: erc721Abi,
      functionName: "approve",
      args: ["0x0000000000000000000000000000000000000000", tokenId]
    })
  );
  await prepare("offer");
  account = seller.address;
  await page.evaluate(
    (account) => window.marketplaceFixtureAccountsChanged([account]),
    account
  );
  await visit();
  await page.getByRole("button", { name: "Accept offer", exact: true }).click();
  const offerDialog = page.getByRole("dialog", {
    name: "Review offer acceptance"
  });
  const accept = () =>
    offerDialog
      .getByRole("button", { name: "Accept offer", exact: true })
      .click();
  await accept();
  await offerDialog
    .getByRole("button", { name: "Approve this NFT", exact: true })
    .click();
  await stepConfirmed();
  await accept();
  await offerDialog.getByRole("button", { name: /Approve .*WETH/ }).click();
  await stepConfirmed();
  assert.equal(await balance(seller.address), 0n);
  const offerFeeBefore = await balance(feeRecipient);
  await accept();
  await page
    .getByText("Offer acceptance confirmed.", { exact: true })
    .waitFor();
  assert.equal((await owner()).toLowerCase(), buyer.address.toLowerCase());
  assert.equal(await balance(seller.address), price - fee);
  assert.equal((await balance(feeRecipient)) - offerFeeBefore, fee);
  assert.equal(sends, 6);
  pass(
    "Advanced offer acceptance uses exact NFT and fee approvals without prefunding seller WETH"
  );
  await page
    .getByRole("button", { name: "Close trade review", exact: true })
    .click();
  account = buyer.address;
  await page.evaluate(
    (address) => window.marketplaceFixtureAccountsChanged([address]),
    account
  );
  await visit();
  await page
    .getByRole("button", { name: "List for sale", exact: true })
    .click();
  await page
    .getByLabel("Expires after", { exact: true })
    .selectOption("2592000");
  await page.getByLabel("Buyer pays (ETH)", { exact: true }).fill("0.2");
  await page
    .getByRole("button", { name: "Review listing", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Approve this NFT", exact: true })
    .click();
  failNextPublication = true;
  await page
    .getByRole("button", { name: "Sign and publish listing", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Retry publication", exact: true })
    .click();
  await page.getByText("Listing published.", { exact: true }).waitFor();
  assert.equal(walletSignatures, 1);
  const first = [...publications.values()][0];
  assert.equal(
    first.intent.order.endTime - first.intent.order.startTime,
    2592000n
  );
  await page
    .getByRole("button", { name: "Close order review", exact: true })
    .click();
  pass(
    "OpenSea listing signs through the wallet and resolves lost acceptance without another signature"
  );
  const inspector = page
    .getByLabel("Your transactions")
    .locator("details[open] > summary");
  if (await inspector.count()) await inspector.click();
  await page.getByRole("button", { name: "Change price", exact: true }).click();
  await page.getByLabel("Buyer pays (ETH)", { exact: true }).fill("0.3");
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
  assert.equal(walletSignatures, 1);
  assert.equal(
    (
      await client.readContract({
        address: protocol,
        abi: seaportReadAbi,
        functionName: "getOrderStatus",
        args: [first.intent.orderHash]
      })
    )[1],
    true
  );
  await page
    .getByRole("button", { name: "Sign and publish listing", exact: true })
    .click();
  await page.getByText("Listing published.", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Close order review", exact: true })
    .click();
  account = seller.address;
  await page.evaluate(
    (address) => window.marketplaceFixtureAccountsChanged([address]),
    account
  );
  await visit();
  const makerBefore = await client.getBalance({ address: buyer.address });
  assert.equal(
    await page
      .getByLabel("Your transactions")
      .locator("details")
      .evaluate((details) => details.open),
    false,
    "A dismissed receipt inspector stays closed across full-page navigation."
  );
  await page.getByRole("button", { name: "Buy", exact: true }).click();
  await confirm();
  await page.getByText("Purchase confirmed.", { exact: true }).waitFor();
  assert.equal(
    (await client.getBalance({ address: buyer.address })) - makerBefore,
    2925n * 10n ** 14n
  );
  assert.equal((await owner()).toLowerCase(), seller.address.toLowerCase());
  pass(
    "Browser repricing cancels the old OpenSea listing before signing and settles the exact replacement price"
  );
  await page
    .getByRole("button", { name: "Close trade review", exact: true })
    .click();
  await clearWeth(buyer.address);
  account = buyer.address;
  await page.evaluate(
    (address) => window.marketplaceFixtureAccountsChanged([address]),
    account
  );
  await visit();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Make an offer", exact: true })
    .click();
  await page.getByLabel("Offer amount (WETH)", { exact: true }).fill("0.5");
  await page.getByRole("button", { name: "Review offer", exact: true }).click();
  await page.getByRole("button", { name: "Wrap 0.5 ETH", exact: true }).click();
  await page
    .getByRole("button", { name: "Approve 0.5 WETH", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Sign and publish offer", exact: true })
    .click();
  await page.getByText("Offer published.", { exact: true }).waitFor();
  assert.equal(walletSignatures, 3);
  const madeOffer = [...publications.values()].find(
    (entry) => entry.intent.summary.side === "offer"
  );
  assert.ok(madeOffer);
  assert.equal(madeOffer.intent.order.orderType, 2);
  assert.equal(await balance(buyer.address), 5n * 10n ** 17n);
  await page.screenshot({
    path: values.screenshot.replace(/\.png$/, "-offer.png")
  });
  await page
    .getByRole("button", { name: "Close order review", exact: true })
    .click();
  pass(
    "Mobile OpenSea item-offer creation explicitly wraps, approves and signs the protected WETH offer"
  );
  await page.getByRole("button", { name: "Cancel offer", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm cancellation", exact: true })
    .click();
  await page.getByText("Order cancelled onchain.", { exact: true }).waitFor();
  assert.equal(
    (
      await client.readContract({
        address: protocol,
        abi: seaportReadAbi,
        functionName: "getOrderStatus",
        args: [madeOffer.intent.orderHash]
      })
    )[1],
    true
  );
  await page
    .getByRole("button", { name: "Close cancellation review", exact: true })
    .click();
  // A fresh listing is saved locally, then cancellation is recovered with the
  // provider offline and the NFT transferred away from the maker.
  await transferNft(buyer.address);
  await visit();
  await page
    .getByRole("button", { name: "List for sale", exact: true })
    .click();
  await page.getByLabel("Buyer pays (ETH)", { exact: true }).fill("0.4");
  await page
    .getByRole("button", { name: "Review listing", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Approve this NFT", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Sign and publish listing", exact: true })
    .click();
  await page.getByText("Listing published.", { exact: true }).waitFor();
  const recovery = [...publications.values()].at(-1);
  await transferNft(seller.address);
  marketDown = true;
  await page.goto(`${values.url}/orders/recovery`, {
    waitUntil: "domcontentloaded"
  });
  const saved = page
    .getByRole("listitem")
    .filter({ hasText: recovery.intent.orderHash });
  await saved
    .getByRole("button", { name: "Review cancellation", exact: true })
    .click();
  await saved
    .getByRole("button", { name: "Confirm cancellation", exact: true })
    .click();
  await saved.getByText("Order cancelled onchain.", { exact: true }).waitFor();
  await page.reload({ waitUntil: "domcontentloaded" });
  await saved.getByText("Cancelled onchain", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    ),
    true
  );
  pass(
    "OpenSea offer cancellation and transferred-listing recovery work on mobile while the API is offline"
  );
  assert.deepEqual(errors, []);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) {
    report.pageUrl = page.url();
    report.pageText = await page
      .locator("main")
      .innerText()
      .catch(() => "");
    await page
      .screenshot({ path: values.screenshot.replace(/\.png$/, "-failure.png") })
      .catch(() => {});
  }
  throw error;
} finally {
  await browser?.close();
  report.restored = await rpc("evm_revert", [initial]);
  await writeFile(values.output, `${JSON.stringify(report, null, 2)}\n`);
}
