import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { erc20Abi, erc721Abi, parseEther } from "viem";
import {
  bnbOfferCurrency,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import {
  seaportOrderHash,
  seaportReadAbi
} from "@protopals/yunipals-market-core/seaport";
import { decodeSeaportOrder } from "@protopals/yunipals-market-core/seaportWire";
import { validateOwnSeaportOrder } from "@protopals/yunipals-market-core/orderPolicy";
import { bnbValidationPolicy } from "../src/bnb/validation.ts";

// Only wallet and indexer transport are simulated. Every marketplace response,
// accepted order, quote and reconciliation comes from the running API/worker.
export async function runBrowserTrading({
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
  stopApi,
  startApi,
  stopWorker,
  startWorker,
  beforeOfferFill,
  afterOfferFill
}) {
  assert.ok(
    process.env.MARKET_TEST_PLAYWRIGHT,
    "Set the local Playwright module path"
  );
  const { chromium } = await import(
    pathToFileURL(process.env.MARKET_TEST_PLAYWRIGHT).href
  );
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.MARKET_TEST_CHROMIUM,
    args: ["--no-sandbox"]
  });
  const app = new URL(appUrl),
    api = new URL(apiBase),
    protocol = seaportDeployment.address;
  const requests = [],
    signatures = [],
    transactions = [],
    errors = [],
    transportErrors = [];
  let account = seller,
    authorized = false,
    dropPublication = false;
  let page;
  const owner = () =>
    client.readContract({
      address: asset.contractAddress,
      abi: erc721Abi,
      functionName: "ownerOf",
      args: [BigInt(asset.tokenId)]
    });
  const balance = (address) =>
    client.readContract({
      address: bnbOfferCurrency.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address]
    });
  const status = (hash) =>
    client.readContract({
      address: protocol,
      abi: seaportReadAbi,
      functionName: "getOrderStatus",
      args: [hash]
    });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 960 }
    });
    context.setDefaultTimeout(20000);
    await context.exposeBinding("marketTradingWallet", async (_, request) => {
      if (request.method === "eth_chainId") return "0x38";
      if (request.method === "eth_accounts")
        return authorized ? [account.address] : [];
      if (request.method === "eth_requestAccounts") {
        authorized = true;
        return [account.address];
      }
      if (request.method === "wallet_getPermissions")
        return authorized ? [{ parentCapability: "eth_accounts" }] : [];
      if (request.method === "wallet_requestPermissions") {
        authorized = true;
        return [{ parentCapability: "eth_accounts" }];
      }
      if (request.method === "wallet_getCapabilities") return {};
      if (request.method === "wallet_switchEthereumChain") {
        assert.equal(request.params[0].chainId, "0x38");
        return null;
      }
      if (request.method === "eth_signTypedData_v4") {
        assert.equal(
          request.params[0].toLowerCase(),
          account.address.toLowerCase()
        );
        const data = JSON.parse(request.params[1]);
        assert.equal(Number(data.domain.chainId), 56);
        assert.equal(
          data.domain.verifyingContract.toLowerCase(),
          protocol.toLowerCase()
        );
        const order = decodeSeaportOrder(data.message);
        assert.equal(
          order.offerer.toLowerCase(),
          account.address.toLowerCase()
        );
        assert.equal(
          validateOwnSeaportOrder(order, bnbValidationPolicy.rules).tokenId,
          BigInt(asset.tokenId)
        );
        const signature = await account.signTypedData({
          ...data,
          message: order
        });
        signatures.push({
          orderHash: seaportOrderHash(order),
          maker: account.address
        });
        return signature;
      }
      if (request.method === "eth_sendTransaction") {
        const call = request.params[0];
        assert.equal(call.from.toLowerCase(), account.address.toLowerCase());
        assert.ok(
          [protocol, asset.contractAddress, bnbOfferCurrency.address].some(
            (address) => address.toLowerCase() === call.to.toLowerCase()
          )
        );
        const hash = await transaction(
          account.address,
          call.to,
          call.data ?? "0x",
          BigInt(call.value ?? "0x0")
        );
        transactions.push({
          hash,
          from: account.address,
          to: call.to,
          value: BigInt(call.value ?? "0x0").toString()
        });
        return hash;
      }
      if (
        !request.method.startsWith("eth_") ||
        /send|sign/i.test(request.method)
      )
        throw new Error(`Unsupported test wallet method: ${request.method}`);
      return rpc(request.method, request.params ?? []);
    });
    await context.addInitScript(() => {
      const listeners = new Map();
      const provider = {
        isConnected: () => true,
        request: (request) => window.marketTradingWallet(request),
        on: (event, callback) =>
          listeners.set(event, [...(listeners.get(event) ?? []), callback]),
        removeListener: (event, callback) =>
          listeners.set(
            event,
            (listeners.get(event) ?? []).filter((item) => item !== callback)
          )
      };
      window.ethereum = provider;
      window.marketTradingAccounts = (accounts) => {
        for (const callback of listeners.get("accountsChanged") ?? [])
          callback(accounts);
      };
      const detail = {
        provider,
        info: {
          uuid: "018e97b9-2ca7-4dd2-a434-302339dd8b02",
          name: "Yunipals API trading wallet",
          rdns: "test.yunipals.api.trading",
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
    await context.route("**/*", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      try {
        if (url.origin === api.origin) {
          requests.push({
            method: request.method(),
            path: url.pathname,
            query: url.search
          });
          if (
            dropPublication &&
            request.method() === "POST" &&
            url.pathname === "/v1/market/orders"
          ) {
            dropPublication = false;
            const response = await route.fetch();
            assert.ok(
              response.ok(),
              `Lost publication must first be durably accepted: ${await response.text()}`
            );
            return route.abort("connectionclosed");
          }
          return route.continue();
        }
        if (
          (url.origin === app.origin &&
            url.pathname.startsWith("/__indexer-test/")) ||
          (process.env.MARKET_TEST_STAGING_REMOTE === "1" &&
            url.origin === "https://api.yunipals.com" &&
            url.pathname.startsWith("/yunipals-indexer/"))
        ) {
          assert.equal(request.method(), "GET");
          if (url.pathname.endsWith("/v1/collection"))
            return route.fulfill({
              json: {
                chain: "bnb",
                chains: ["bnb"],
                knownTokens: 1,
                activeSupply: 1,
                burnedTokens: 0,
                lifecycles: 1
              }
            });
          if (url.pathname.endsWith("/v1/traits"))
            return route.fulfill({
              json: {
                chain: "bnb",
                chains: ["bnb"],
                items: [],
                metadata: { available: 1, missing: 0 },
                updatedAt: new Date().toISOString()
              }
            });
          const row = (
            await pool.query(
              "SELECT owner,last_transfer_block FROM yunipals_read_v4.token WHERE collection='bnb' AND token_id=$1",
              [asset.tokenId]
            )
          ).rows[0];
          return route.fulfill({
            json: {
              token: {
                ...asset,
                token_id: asset.tokenId,
                owner: row.owner,
                burned: false,
                hidden: false,
                lifecycle: 0,
                mintBlock: "100",
                lastTransferBlock: row.last_transfer_block,
                name: "Yunipal browser fixture",
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
        }
        if (
          [
            "bsc-rpc.publicnode.com",
            "bsc-dataseed-public.bnbchain.org"
          ].includes(url.hostname)
        ) {
          const body = request.postDataJSON();
          const forward = async (call) => {
            assert.ok(
              call.method.startsWith("eth_") && !/send|sign/i.test(call.method)
            );
            return {
              jsonrpc: "2.0",
              id: call.id,
              result: await rpc(call.method, call.params ?? [])
            };
          };
          return route.fulfill({
            json: Array.isArray(body)
              ? await Promise.all(body.map(forward))
              : await forward(body)
          });
        }
        if (url.origin === app.origin) return route.continue();
        return route.abort();
      } catch (error) {
        transportErrors.push({ path: url.pathname, message: error.message });
        return route.abort();
      }
    });
    page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", async (response) => {
      if (
        new URL(response.url()).origin === api.origin &&
        response.status() >= 400
      )
        requests.push({
          status: response.status(),
          path: new URL(response.url()).pathname,
          body: (await response.text().catch(() => "")).slice(0, 1200)
        });
    });
    const button = (name) => page.getByRole("button", { name, exact: true });
    const dialogButton = (name) =>
      page.getByRole("dialog").getByRole("button", { name, exact: true });
    const message = (text) => page.getByText(text, { exact: true }).waitFor();
    const tokenPage = async () => {
      await available();
      await page.goto(`${app.origin}/collection/bnb/${asset.tokenId}`, {
        waitUntil: "domcontentloaded"
      });
    };
    async function switchWallet(wallet) {
      account = wallet;
      await page.evaluate(
        (address) => window.marketTradingAccounts([address]),
        wallet.address
      );
      await tokenPage();
    }
    async function publish(side) {
      await button(`Sign and publish ${side}`).click();
      await message(
        side === "listing" ? "Listing published." : "Offer published."
      );
      await button("Close order review").click();
      return signatures.at(-1).orderHash;
    }
    async function available() {
      const until = Date.now() + 20000;
      while (Date.now() < until) {
        const response = await fetch(
          `${apiBase}/v1/market/assets/bnb/${asset.contractAddress}/${asset.tokenId}`
        );
        if (response.ok && (await response.json()).sourceStatus === "available")
          return;
        await delay(1000);
      }
      throw new Error("Actual BNB worker did not restore asset availability.");
    }
    async function reconciled(hash, state) {
      const until = Date.now() + 20000;
      while (Date.now() < until) {
        const row = (
          await pool.query(
            "SELECT state FROM yunipals_market.orders WHERE chain_id=56 AND order_hash=$1",
            [hash.toLowerCase()]
          )
        ).rows[0];
        if (row?.state === state) return;
        await delay(500);
      }
      throw new Error(`Worker did not reconcile ${hash} as ${state}`);
    }
    async function nextRequirement(next) {
      const refresh = button("Refresh order requirements");
      await Promise.race([button(next).waitFor(), refresh.waitFor()]);
      if (await refresh.isVisible()) {
        const txCount = transactions.length,
          signatureCount = signatures.length;
        await available();
        await refresh.click();
        await button(next).waitFor();
        assert.equal(
          transactions.length,
          txCount,
          "Refreshing requirements never repeats a confirmed transaction"
        );
        assert.equal(
          signatures.length,
          signatureCount,
          "Refreshing requirements never prompts a signature"
        );
      }
    }
    await page.goto(`${app.origin}/orders/activity?chain=bnb&view=all`);
    await button("Connect wallet").click();
    await page
      .getByText("Yunipals API trading wallet", { exact: true })
      .last()
      .click();
    await page
      .getByRole("heading", { name: "My activity", exact: true })
      .waitFor();
    await tokenPage();
    await button("List for sale").click();
    await page.getByLabel("Buyer pays (BNB)", { exact: true }).fill("0.01");
    await button("Review listing").click();
    await stopWorker();
    await dialogButton("Approve this NFT").click();
    await button("Refresh order requirements").waitFor();
    assert.equal(signatures.length, 0);
    assert.equal(transactions.length, 1);
    await startWorker();
    await nextRequirement("Sign and publish listing");
    pass(
      "Confirmed approval survives an actual worker outage; explicit refresh restores review without a duplicate transaction or signature"
    );
    dropPublication = true;
    await button("Sign and publish listing").click();
    await button("Retry publication").waitFor();
    assert.equal(signatures.length, 1);
    assert.equal(
      (await pool.query("SELECT count(*) FROM yunipals_market.orders")).rows[0]
        .count,
      "1"
    );
    await button("Retry publication").click();
    await message("Listing published.");
    assert.equal(signatures.length, 1);
    assert.equal(
      (await pool.query("SELECT count(*) FROM yunipals_market.orders")).rows[0]
        .count,
      "1"
    );
    const firstListing = signatures[0].orderHash;
    await button("Close order review").click();
    pass(
      "Actual API accepts a browser listing once; lost response retries without another signature or duplicate order"
    );

    await page.goto(`${app.origin}/orders?chain=bnb&view=listings`, {
      waitUntil: "domcontentloaded"
    });
    await button("Change price").click();
    await page.getByLabel("Buyer pays (BNB)", { exact: true }).fill("0.02");
    await button("Review listing").click();
    await button("Cancel previous order").click();
    await nextRequirement("Sign and publish listing");
    assert.equal((await status(firstListing))[1], true);
    assert.equal(signatures.length, 1);
    const listing = await publish("listing");
    assert.notEqual(listing, firstListing);
    assert.equal(signatures.length, 2);
    pass(
      "Actual wallet-order discovery reprices a listing only after cancelling its original order"
    );

    await switchWallet(buyer);
    // Admit the recovery order while the public fork upstream still retains its
    // original state. Keep it signed and unfilled through the ownership cycle;
    // the final outage check must cancel this actual earlier admission.
    await button("Make an offer").click();
    await page.getByLabel("Offer amount (WBNB)", { exact: true }).fill("0.001");
    await button("Review offer").click();
    await dialogButton("Wrap 0.001 BNB").click();
    await nextRequirement("Approve 0.001 WBNB");
    await dialogButton("Approve 0.001 WBNB").click();
    await nextRequirement("Sign and publish offer");
    const recoverable = await publish("offer");
    await reconciled(firstListing, "cancelled");
    await available();
    await page.goto(
      `${app.origin}/?chain=bnb&sale=listed&currency=native&sort=price-asc`,
      { waitUntil: "domcontentloaded" }
    );
    await page.getByText("0.02 BNB", { exact: true }).waitFor();
    await button("Buy").click();
    await page
      .getByRole("dialog", { name: "Review purchase", exact: true })
      .waitFor();
    const nativeBefore = await client.getBalance({ address: seller.address });
    await button("Confirm purchase").click();
    await message("Purchase confirmed.");
    assert.equal((await owner()).toLowerCase(), buyer.address.toLowerCase());
    assert.equal(
      (await client.getBalance({ address: seller.address })) - nativeBefore,
      parseEther("0.02")
    );
    assert.ok((await status(listing))[2] > 0n);
    await page.reload({ waitUntil: "domcontentloaded" });
    await message("Purchase · Confirmed");
    await page
      .getByLabel("Marketplace transactions")
      .locator("details[open] > summary")
      .click();
    pass(
      "Actual catalog discovers the repriced listing; its API quote settles exactly 0.02 BNB and reload verifies the receipt"
    );

    await switchWallet(seller);
    await button("Make an offer").click();
    await page.getByLabel("Offer amount (WBNB)", { exact: true }).fill("0.03");
    await button("Review offer").click();
    await dialogButton("Wrap 0.03 BNB").click();
    await nextRequirement("Approve 0.03 WBNB");
    await dialogButton("Approve 0.03 WBNB").click();
    await nextRequirement("Sign and publish offer");
    const firstOffer = await publish("offer");
    assert.equal(await balance(seller.address), parseEther("0.03"));
    assert.equal(
      await client.readContract({
        address: bnbOfferCurrency.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [seller.address, protocol]
      }),
      parseEther("0.03")
    );
    pass(
      "Browser creates an actual API WBNB offer after wrapping its deficit and approving the exact amount"
    );

    await button("Change price").click();
    await page.getByLabel("Offer amount (WBNB)", { exact: true }).fill("0.04");
    await button("Review offer").click();
    await button("Cancel previous order").click();
    await nextRequirement("Wrap 0.01 BNB");
    assert.equal((await status(firstOffer))[1], true);
    await dialogButton("Wrap 0.01 BNB").click();
    await nextRequirement("Approve 0.04 WBNB");
    await dialogButton("Approve 0.04 WBNB").click();
    await nextRequirement("Sign and publish offer");
    const offer = await publish("offer");
    assert.notEqual(offer, firstOffer);
    pass(
      "Offer repricing cancels first, wraps only the additional BNB and admits a distinct replacement"
    );

    await reconciled(firstOffer, "cancelled");
    await beforeOfferFill?.();
    await switchWallet(buyer);
    await button("Accept offer").click();
    await dialogButton("Accept offer").click();
    await dialogButton("Approve this NFT").click();
    await message(
      "NFT approval confirmed. Review and accept the offer when ready."
    );
    await available();
    const wbnbBefore = await balance(buyer.address);
    await dialogButton("Accept offer").click();
    await message("Offer acceptance confirmed.");
    assert.equal((await owner()).toLowerCase(), seller.address.toLowerCase());
    assert.equal(
      (await balance(buyer.address)) - wbnbBefore,
      parseEther("0.04")
    );
    assert.ok((await status(offer))[2] > 0n);
    await button("Close trade review").click();
    pass(
      "Actual API preflight, NFT approval and fresh quote settle the browser offer acceptance for exactly 0.04 WBNB"
    );

    assert.equal((await status(recoverable))[1], false);
    assert.equal((await status(recoverable))[2], 0n);
    const restoredRecovery = await afterOfferFill?.({ offer, recoverable });
    if (restoredRecovery) {
      await page.evaluate(() =>
        localStorage.removeItem("yunipals-market-order-recovery-v1")
      );
    }
    await stopApi();
    await page.goto(`${app.origin}/orders/recovery`, {
      waitUntil: "domcontentloaded"
    });
    if (restoredRecovery) {
      await message("No orders for this wallet are saved in this browser.");
      await page.getByLabel("Cancellation records file").setInputFiles({
        name: "restored-order-cancellation.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify([restoredRecovery]))
      });
      await page.getByText(/^Imported 1 cancellation record\./).waitFor();
      assert.equal(await page.getByRole("listitem").count(), 1);
      pass(
        "Empty browser recovery storage imports the exact cancellation record obtained from the restored API"
      );
    }
    const recovery = page
      .getByRole("listitem")
      .filter({ hasText: recoverable });
    await recovery
      .getByRole("button", { name: "Review cancellation", exact: true })
      .click();
    await recovery
      .getByRole("button", { name: "Confirm cancellation", exact: true })
      .click();
    await recovery
      .getByText("Order cancelled onchain.", { exact: true })
      .waitFor();
    assert.equal((await status(recoverable))[1], true);
    pass(
      "Browser recovery cancels a genuinely admitted order onchain while the API process is stopped"
    );
    await startApi(false);
    const accepted = await fetch(
      `${apiBase}/v1/market/orders/bnb/${protocol}/${recoverable}`
    );
    assert.equal(accepted.status, 200);
    const acceptedBody = await accepted.json();
    assert.equal(acceptedBody.order.orderHash, recoverable);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path:
        process.env.MARKET_TEST_BROWSER_SCREENSHOT ??
        "/tmp/yunipals-browser-trading-mobile.png",
      fullPage: true
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      ),
      true
    );
    assert.equal(errors.length, 0, JSON.stringify(errors));
    assert.equal(transportErrors.length, 0, JSON.stringify(transportErrors));
    pass(
      "Accepted-order recovery survives API restart with trading disabled and the mobile recovery view fits without overflow"
    );
    return {
      recoverableOrderHash: recoverable,
      signatures,
      transactions,
      requests,
      pageErrors: errors,
      transportErrors
    };
  } catch (error) {
    let fulfillmentDiagnostic;
    const lastQuote = requests.findLast(
      (item) => item.status >= 400 && item.path.endsWith("/fulfillment")
    );
    if (lastQuote && process.env.MARKET_TEST_STAGING_REMOTE === "1") {
      // Read/simulate the same fixture request before cleanup, without sending a
      // transaction or substituting a result into the browser journey.
      const { BnbFulfillmentService } = await import(
        "../src/bnb/fulfillment.ts"
      );
      try {
        await new BnbFulfillmentService(pool, client, bnbValidationPolicy, {
          confirmations: 20n,
          indexerMaxAgeMs: 720000
        }).quote(lastQuote.path.split("/").at(-2), {
          actor: account.address,
          lifecycle: 0
        });
        fulfillmentDiagnostic = { repeatedReadOnlyCheck: "passed" };
      } catch (failure) {
        fulfillmentDiagnostic = [];
        for (
          let cause = failure;
          cause && fulfillmentDiagnostic.length < 5;
          cause = cause.cause
        )
          fulfillmentDiagnostic.push({
            name: cause.name,
            code: cause.code,
            shortMessage: cause.shortMessage,
            details: cause.details?.slice(0, 1000)
          });
      }
    }
    if (page) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(
        "/tmp/yunipals-browser-trading-failure.json",
        JSON.stringify(
          {
            error: error.message,
            fulfillmentDiagnostic,
            signatures,
            transactions,
            requests,
            pageErrors: errors,
            transportErrors,
            body: (
              await page
                .locator("body")
                .innerText()
                .catch(() => "")
            ).slice(0, 16000)
          },
          null,
          2
        )
      );
      await page
        .screenshot({
          path: "/tmp/yunipals-browser-trading-failure.png",
          fullPage: true
        })
        .catch(() => {});
    }
    throw error;
  } finally {
    await browser.close();
  }
}
