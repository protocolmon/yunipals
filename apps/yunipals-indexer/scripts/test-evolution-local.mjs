import geometry from "../test/fixtures/evolution-holo.json" with { type: "json" };
/** Local contract/API/worker/browser rehearsal. Confirmed event delivery is a deterministic fixture;
 * the actual global Ponder schema, rollback and source readiness are verified separately. No paid AI. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { PGlite } from "@electric-sql/pglite";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  decodeEventLog,
  keccak256,
  toHex,
  zeroAddress
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { createServer } from "../../yunipals-home-web/node_modules/vite/dist/node/index.js";
import {
  adventureAbi,
  evolutionAbi,
  evolutionCardsAbi
} from "../../../packages/yunipals-market-core/src/evolutionAbi.ts";
import { portalModels } from "../../../packages/yunipals-market-core/src/portals.ts";
import { EvolutionReader } from "../../../packages/yunipals-indexer-server/src/evolution.ts";
import { EvolutionChain } from "../lib/evolution/chain.ts";
import {
  EvolutionStore,
  evolutionWorkerSchema
} from "../lib/evolution/store.ts";
import { EvolutionWorker } from "../lib/evolution/worker.ts";
import { evolutionRenderingHash } from "../lib/evolution/art.ts";
import { applyEvolutionEvent } from "../lib/evolution/projection.ts";
import { registerEvolutionRoutes } from "../lib/evolution/routes.ts";
import { PortalAssets } from "../lib/portals/assets.ts";
import { PortalChain, portalJson } from "../lib/portals/chain.ts";

const singularity = process.env.EVOLUTION_TEST_SINGULARITY === "1";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const rpc = "http://127.0.0.1:8559",
  api = "http://127.0.0.1:8949",
  origin = "http://127.0.0.1:5199";
// Public deterministic Anvil-only key. Never fund on a public network.
const account = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
);
const anvil = spawn(
  process.env.EVOLUTION_TEST_ANVIL ?? process.env.PORTALS_TEST_ANVIL ?? "anvil",
  ["--host", "127.0.0.1", "--port", "8559", "--chain-id", "8453", "--silent"],
  { stdio: "ignore" }
);
const directory = await mkdtemp(join(tmpdir(), "evolution-local-"));
const db = new PGlite();
const client = createPublicClient({
  chain: base,
  transport: http(rpc),
  pollingInterval: 100
});
const wallet = createWalletClient({
  chain: base,
  account,
  transport: http(rpc),
  pollingInterval: 100
});
let browser,
  vite,
  server,
  eventContracts = new Map(),
  deployment,
  cards,
  adventures,
  evolution,
  grading;
const artifact = async (file) => {
  const [source, name = source] = file.split(":");
  return JSON.parse(
    await readFile(
      join(
        root,
        `contracts/boosters/${process.env.FOUNDRY_PROFILE === "permit" ? "out-permit" : "out"}/${source}.sol/${name}.json`
      ),
      "utf8"
    )
  );
};
async function send(address, file, fn, args = [], value = 0n) {
  const { abi } = await artifact(file);
  const hash = await wallet.sendTransaction({
    to: address,
    data: encodeFunctionData({ abi, functionName: fn, args }),
    value,
    gas: 8_000_000n
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success", fn);
  await client.request({ method: "anvil_mine", params: ["0xd"] });
  await ingest(receipt);
  return receipt;
}
async function deploy(file, args = []) {
  const a = await artifact(file);
  const hash = await wallet.deployContract({
    abi: a.abi,
    bytecode: a.bytecode.object,
    args,
    gas: 25_000_000n
  });
  const r = await client.waitForTransactionReceipt({ hash });
  assert.equal(r.status, "success", file);
  return r.contractAddress;
}
async function proxy(file, args) {
  return deploy("ERC1967Proxy", [
    await deploy(file),
    encodeFunctionData({
      abi: (await artifact(file)).abi,
      functionName: "initialize",
      args
    })
  ]);
}
async function ingest(receipt) {
  if (!deployment) return;
  for (const log of receipt.logs) {
    const abi = eventContracts.get(log.address.toLowerCase());
    if (!abi) continue;
    let decoded;
    try {
      decoded = decodeEventLog({ abi, topics: log.topics, data: log.data });
    } catch {
      continue;
    }
    const args = portalJson(decoded.args ?? {});
    await db.query(
      `INSERT INTO evolution_local.canonical_event VALUES(8453,$1,$2,$3,$4,$5,$6)`,
      [
        log.address.toLowerCase(),
        decoded.eventName,
        JSON.stringify(args),
        receipt.blockNumber.toString(),
        receipt.transactionIndex,
        log.logIndex
      ]
    );
    const store = {
      get: async (domain, id) =>
        (
          await db.query(
            "SELECT value FROM evolution_local.evolution_projection_version WHERE domain=$1 AND entity=$2 ORDER BY block_number DESC,transaction_index DESC,log_index DESC LIMIT 1",
            [domain, `${deployment}:${domain}:${id}`]
          )
        ).rows[0]?.value ?? null,
      put: async (domain, id, value) => {
        await db.query(
          "INSERT INTO evolution_local.evolution_projection_version VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            deployment,
            domain,
            `${deployment}:${domain}:${id}`,
            JSON.stringify(value),
            receipt.blockNumber.toString(),
            receipt.transactionIndex,
            log.logIndex
          ]
        );
      }
    };
    if (decoded.eventName === "Transfer") {
      const old = await store.get("card", String(args.tokenId));
      if (old)
        await store.put("card", String(args.tokenId), {
          ...old,
          owner: String(args.to).toLowerCase(),
          burned: String(args.to).toLowerCase() === zeroAddress
        });
    } else await applyEvolutionEvent(store, decoded.eventName, args);
  }
}
try {
  for (let i = 0; i < 80; i++) {
    try {
      await client.getChainId();
      break;
    } catch {
      await delay(100);
    }
  }
  await db.exec(`CREATE SCHEMA evolution_local;
    CREATE TABLE evolution_local.canonical_event(chain_id integer,address text,name text,args text,block_number bigint,transaction_index integer,log_index integer);
    CREATE TABLE evolution_local.evolution_projection_version(deployment text,domain text,entity text,value jsonb,block_number bigint,transaction_index integer,log_index integer);${evolutionWorkerSchema}`);
  const { multicall3Bytecode } = await import(
    new URL("../node_modules/viem/_esm/constants/contracts.js", import.meta.url)
      .href
  );
  const multicallReceipt = await client.waitForTransactionReceipt({
    hash: await wallet.deployContract({ abi: [], bytecode: multicall3Bytecode })
  });
  await client.request({
    method: "anvil_setCode",
    params: [
      base.contracts.multicall3.address,
      await client.getCode({ address: multicallReceipt.contractAddress })
    ]
  });
  // Wallet multicalls use Base's deployment-height guard. Reach that height in
  // bounded requests: mining all 5,022 blocks at once can time out on CI runners.
  const multicallHeight = BigInt(base.contracts.multicall3.blockCreated);
  const beforeMining = await client.getBlockNumber({ cacheTime: 0 });
  for (let remaining = multicallHeight; remaining > 0n; ) {
    const batch = remaining > 128n ? 128n : remaining;
    await client.request(
      { method: "anvil_mine", params: [toHex(batch)] },
      { retryCount: 0 }
    );
    remaining -= batch;
  }
  assert.equal(
    await client.getBlockNumber({ cacheTime: 0 }),
    beforeMining + multicallHeight
  );
  const packs = await proxy("PackRegistry", [account.address]);
  cards = await proxy("YunipalMonsters", [account.address, packs]);
  const engine = await deploy("Evolution.t:EvolutionTestEngine", [packs]);
  const usdc = await deploy("Portals.t:PortalTestUSDC");
  const wrapper = await deploy("BoosterPacks.t:MockWrapper");
  const rules = await deploy("PortalRules");
  const portals = await proxy("PortalCollection", [
    account.address,
    wrapper,
    3,
    rules
  ]);
  const registry = await proxy("PortalRegistry", [
    account.address,
    portals,
    wrapper,
    3
  ]);
  await send(packs, "PackRegistry", "configureType", [
    0n,
    {
      engine,
      paymentToken: usdc,
      price: 1n,
      intervalSeconds: 86400n,
      mintsPerInterval: 1,
      maxBatch: 7,
      baseGas: 450000,
      perMintGas: 250000,
      confirmations: 3,
      supplyCap: 0n,
      artworkHash: keccak256(toHex("test")),
      manifestURI: "ipfs://test",
      metadataBaseURI: "ipfs://test/"
    },
    {
      types: Array.from({ length: 11 }, (_, i) => i + 1),
      colors: [1, 2, 3, 4, 5, 6],
      horns: [1, 2],
      glitters: [0, 1],
      allowed: []
    }
  ]);
  await send(packs, "PackRegistry", "activate", [1n]);
  grading = await proxy("PortalGrading", [
    account.address,
    cards,
    registry,
    usdc,
    1n,
    "https://evolution.test/v1/portals/cards/"
  ]);
  await send(cards, "YunipalMonsters", "setGradingRegistry", [grading]);
  const catalogue = await deploy("SerumCatalogue");
  adventures = await proxy("YunipalAdventures", [
    account.address,
    cards,
    catalogue,
    wrapper,
    3,
    rules
  ]);
  evolution = await proxy("YunipalEvolution", [
    account.address,
    cards,
    adventures,
    usdc,
    account.address,
    evolutionRenderingHash(portalModels),
    wrapper,
    3,
    rules
  ]);
  deployment = `8453:${evolution.toLowerCase()}`;
  eventContracts = new Map([
    [cards.toLowerCase(), evolutionCardsAbi],
    [adventures.toLowerCase(), adventureAbi],
    [evolution.toLowerCase(), evolutionAbi]
  ]);
  await send(cards, "YunipalMonsters", "configureEvolution", [
    evolution,
    adventures
  ]);
  await send(evolution, "YunipalEvolution", "grantRole", [
    keccak256(toHex("GENERATOR_ROLE")),
    account.address
  ]);
  const assets = new PortalAssets(
    directory,
    "https://evolution.test",
    ["evolution.test"],
    undefined,
    false,
    "/v1/evolution/assets"
  );
  const image = await readFile(
    join(
      root,
      "docs/boosters/artwork-runtime/assets/46a8d68ed975477e528f43272279b3718c57c82bdaea9b5a6a087c2d3c8f8201.png"
    )
  );
  const input = await assets.put(image, "png");
  // Fix the clock away from midnight so all births and the shared draw use one day.
  const now = (await client.getBlock()).timestamp;
  const day = now / 86400n + 1n;
  await client.request({
    method: "evm_setNextBlockTimestamp",
    params: [Number(day * 86400n + 43200n)]
  });
  await send(adventures, "YunipalAdventures", "enableCrewAdventures");
  await send(
    adventures,
    "YunipalAdventures",
    "prepareDailyCrew",
    [day, 10n ** 15n],
    10n ** 15n
  );
  const [drawId] = await client.readContract({
    address: adventures,
    abi: adventureAbi,
    functionName: "dailyCrew",
    args: [day]
  });
  await send(wrapper, "BoosterPacks.t:MockWrapper", "fulfill", [drawId, 93n]);
  const [, color, species, ready] = await client.readContract({
    address: adventures,
    abi: adventureAbi,
    functionName: "dailyCrew",
    args: [day]
  });
  assert.equal(ready, true);
  const firstVariant = (color - 1) * 4;
  const partnerVariant = singularity ? firstVariant : firstVariant + 1;
  const speciesVariant = (species - 1) * 24;
  const variants = [
    ...new Set([firstVariant, partnerVariant, 2, speciesVariant])
  ];
  await send(grading, "PortalGrading", "registerBaseArt", [
    variants,
    variants.map(() => input)
  ]);
  await send(engine, "Evolution.t:EvolutionTestEngine", "original", [
    cards,
    1n,
    account.address,
    firstVariant
  ]);
  await send(
    engine,
    "Evolution.t:EvolutionTestEngine",
    singularity ? "original" : "child",
    [cards, 1n, account.address, partnerVariant, ...(singularity ? [] : [1])]
  );
  // Preserve #2 for the subsequent fusion; #3 and #4 are the sacrificed companions.
  await send(engine, "Evolution.t:EvolutionTestEngine", "original", [
    cards,
    1n,
    account.address,
    2
  ]);
  await send(engine, "Evolution.t:EvolutionTestEngine", "original", [
    cards,
    1n,
    account.address,
    speciesVariant
  ]);
  await send(usdc, "Portals.t:PortalTestUSDC", "mint", [
    account.address,
    10_000_000n
  ]);
  const chain = new EvolutionChain(
    client,
    cards,
    evolution,
    adventures,
    grading
  );
  const reader = new EvolutionReader(db);
  reader.snapshot = async (fn) => {
    const block = await client.getBlock({
      blockNumber: (await client.getBlockNumber({ cacheTime: 0 })) - 12n
    });
    return fn(db, {
      schema: '"evolution_local"',
      deployment,
      block: block.number,
      hash: block.hash,
      timestamp: Number(block.timestamp),
      cards: cards.toLowerCase(),
      evolution: evolution.toLowerCase(),
      adventures: adventures.toLowerCase()
    });
  };
  const store = new EvolutionStore(db, deployment);
  const portal = {
    chain: new PortalChain(client, {
      chainId: 8453,
      cards,
      grading,
      usdc,
      registry,
      collection: portals
    })
  };
  reader.publications = async (hash) =>
    (
      await db.query(
        `SELECT args::jsonb->>'artworkHash' AS "artworkHash", args::jsonb->>'metadataHash' AS "metadataHash" FROM evolution_local.canonical_event WHERE name='EvolutionCompleted' AND (args::jsonb->>'artworkHash'=$1 OR args::jsonb->>'metadataHash'=$1)`,
        [hash]
      )
    ).rows;
  const runtime = { reader, chain, store, assets, portal };
  const app = new Hono();
  app.use("*", cors());
  registerEvolutionRoutes(app, {
    assetRuntime: () => ({ reader, assets }),
    enabled: () => true,
    runtime: async () => runtime
  });
  // Base artworks are already published by pack setup; only completed evolved outputs use the guarded route.
  app.get(
    "/fixture/base.png",
    () => new Response(image, { headers: { "Content-Type": "image/png" } })
  );
  server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 8949 });
  const get = async (path) => {
    const r = await app.request(`http://localhost/v1/evolution${path}`);
    assert.equal(r.status, 200, await r.clone().text());
    return r.json();
  };
  assert.equal((await get(`/owners/${account.address}`)).cards.length, 4);
  const requirements = await get("/crew");
  assert.equal(requirements.enabled, true);
  const adventureQuote = await get(
    `/quote?kind=adventure&tokenId=1&crew=1,3,4&day=${day}&owner=${account.address}`
  );
  const requestReceipt = await client.waitForTransactionReceipt({
    hash: await wallet.sendTransaction({
      to: adventures,
      data: adventureQuote.data,
      value: BigInt(adventureQuote.value)
    })
  });
  assert.equal(requestReceipt.status, "success");
  await client.request({ method: "anvil_mine", params: ["0xd"] });
  await ingest(requestReceipt);
  const requestId = await client.readContract({
    address: adventures,
    abi: adventureAbi,
    functionName: "pendingRequest",
    args: [1n]
  });
  for (const id of [1n, 3n, 4n]) {
    assert.equal(
      await client.readContract({
        address: adventures,
        abi: adventureAbi,
        functionName: "pendingRequest",
        args: [id]
      }),
      requestId
    );
  }
  assert.equal(adventureQuote.odds.weights[0], 0);
  await send(wrapper, "BoosterPacks.t:MockWrapper", "fulfill", [requestId, 1n]);
  assert.deepEqual(
    (await get(`/owners/${account.address}`)).cards
      .map((card) => card.tokenId)
      .sort(),
    ["1", "2"]
  );
  for (const id of [3n, 4n]) {
    await assert.rejects(
      client.readContract({
        address: cards,
        abi: (await artifact("YunipalMonsters")).abi,
        functionName: "ownerOf",
        args: [id]
      })
    );
    assert.equal(
      await client.readContract({
        address: adventures,
        abi: adventureAbi,
        functionName: "pendingRequest",
        args: [id]
      }),
      0n
    );
  }
  const found = (await get("/cards/1")).card;
  assert.ok(found.unused);
  assert.equal(found.pendingAdventure, null);
  let generated = 0,
    inputs = [];
  const worker = new EvolutionWorker(
    reader,
    chain,
    store,
    assets,
    {
      policy: portalModels,
      calibrateHolo: async () => ({
        geometry,
        model: portalModels.grading,
        usage: null
      }),
      editImages: async (prompt, images) => {
        generated++;
        inputs.push(images.length);
        assert.ok(prompt.includes("No bottle"));
        return { bytes: image, usage: null, model: portalModels.image };
      }
    },
    async (id, binding, output) => {
      const receipt = await send(evolution, "YunipalEvolution", "complete", [
        id,
        binding,
        output
      ]);
      return receipt.transactionHash;
    }
  );
  Object.assign(process.env, {
    VITE_EVOLUTION_ENABLED: "true",
    VITE_EVOLUTION_ADDRESS: evolution,
    VITE_ADVENTURES_ADDRESS: adventures,
    VITE_PORTALS_ENABLED: "true",
    VITE_PORTALS_API_URL: api,
    VITE_PORTALS_GRADING_ADDRESS: grading,
    VITE_PORTALS_CHAIN_ID: "8453",
    VITE_BOOSTERS_ENABLED: "true",
    VITE_BOOSTER_REGISTRY: packs,
    VITE_BOOSTER_ENGINE: engine,
    VITE_BOOSTER_MONSTERS: cards,
    VITE_YUNIPALS_INDEXER_URL: api,
    VITE_BASE_RPC_URL: rpc,
    VITE_WALLETCONNECT_PROJECT_ID: ""
  });
  vite = await createServer({
    root: join(root, "apps/yunipals-home-web"),
    server: { host: "127.0.0.1", port: 5199, strictPort: true }
  });
  await vite.listen();
  const { chromium } = await import(
    pathToFileURL(
      process.env.EVOLUTION_TEST_PLAYWRIGHT ??
        process.env.PORTALS_TEST_PLAYWRIGHT
    ).href
  );
  browser = await chromium.launch({
    executablePath:
      process.env.EVOLUTION_TEST_CHROMIUM ?? process.env.PORTALS_TEST_CHROMIUM,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 }
  });
  page.setDefaultTimeout(45000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let usdcApprovals = 0;
  await page.exposeFunction(
    "evolutionTestWallet",
    async ({ method, params = [] }) => {
      if (["eth_accounts", "eth_requestAccounts"].includes(method))
        return [account.address];
      if (method === "eth_chainId") return "0x2105";
      if (
        ["wallet_getPermissions", "wallet_requestPermissions"].includes(method)
      )
        return [{ parentCapability: "eth_accounts" }];
      if (method === "wallet_switchEthereumChain") return null;
      if (method === "eth_sendTransaction") {
        const tx = params[0];
        if (
          tx.to.toLowerCase() === usdc.toLowerCase() &&
          tx.data?.startsWith("0x095ea7b3")
        )
          ++usdcApprovals;
        assert.equal(tx.from.toLowerCase(), account.address.toLowerCase());
        const hash = await wallet.sendTransaction({
          to: tx.to,
          data: tx.data,
          value: BigInt(tx.value ?? "0x0"),
          ...(tx.maxFeePerGas
            ? {
                maxFeePerGas: BigInt(tx.maxFeePerGas),
                maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas)
              }
            : {})
        });
        const receipt = await client.waitForTransactionReceipt({ hash });
        await client.request({ method: "anvil_mine", params: ["0xd"] });
        await ingest(receipt);
        return hash;
      }
      return client.request({ method, params });
    }
  );
  await page.addInitScript(() => {
    window.ethereum = {
      isMetaMask: true,
      request: (input) => window.evolutionTestWallet(input),
      on: () => {},
      removeListener: () => {}
    };
  });
  await page.route("https://evolution.test/**", async (route) => {
    if (route.request().url() === input.uri)
      return route.fulfill({ contentType: "image/png", body: image });
    const response = await app.request(route.request().url());
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer())
    });
  });
  await page.route("**/*", (route) =>
    ["127.0.0.1", "evolution.test"].includes(
      new URL(route.request().url()).hostname
    )
      ? route.fallback()
      : route.abort()
  );
  await page.goto(`${origin}/adventures/cards/1`);
  await page
    .getByRole("heading", { name: "Yunipal #1", exact: true })
    .waitFor();
  const connect = page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .last();
  if (await connect.isVisible()) await connect.click();
  const injected = page
    .getByRole("button", { name: /Browser Wallet|MetaMask|Injected/i })
    .first();
  if (await injected.isVisible()) await injected.click();
  await page.getByRole("button", { name: /Drink serum/ }).click();
  await page
    .getByText("AI generation sponsored · 0 USDC", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Confirm in wallet", exact: true })
    .click();
  await page.waitForFunction(() => !document.querySelector("dialog[open]"));
  const serumJob = await client.readContract({
    address: evolution,
    abi: evolutionAbi,
    functionName: "requestCount"
  });
  const serumRequest = await chain.request(serumJob);
  assert.equal(
    usdcApprovals,
    0,
    "sponsored consumption must not ask for USDC approval"
  );
  assert.equal(
    await client.readContract({
      address: evolution,
      abi: evolutionAbi,
      functionName: "sponsoredSerumsUsed"
    }),
    1n
  );
  assert.equal(
    await client.readContract({
      address: evolution,
      abi: evolutionAbi,
      functionName: "feeLiability"
    }),
    0n
  );
  assert.ok(serumRequest.randomnessId > 0n);
  await send(wrapper, "BoosterPacks.t:MockWrapper", "fulfill", [
    serumRequest.randomnessId,
    321n
  ]);
  await worker.tick();
  await worker.tick();
  assert.equal(generated, 1);
  assert.deepEqual(inputs, [1]);
  const enhanced = (await get("/cards/1")).card;
  assert.equal(enhanced.localDoses, 1);
  assert.ok(enhanced.finish >= 1 && enhanced.finish <= 3);
  assert.equal(enhanced.history.finish, enhanced.finish);
  assert.equal(enhanced.graded, false);
  await page.reload();
  await page
    .getByText(/1\/11 doses/)
    .first()
    .waitFor();
  await page
    .getByRole("button", { name: "Choose fusion partner", exact: true })
    .click();
  await page.getByRole("button", { name: /Yunipal #2/ }).click();
  await page.getByText(/remaining daily claims end/).waitFor();
  if (singularity) {
    await page
      .getByRole("heading", { name: "Create a Singularity", exact: true })
      .waitFor();
    await page.getByText(/Matching mint date/).waitFor();
  }
  await page
    .getByRole("button", { name: "Confirm in wallet", exact: true })
    .click();
  await page.waitForFunction(() => !document.querySelector("dialog[open]"));
  const fusionId = await client.readContract({
    address: evolution,
    abi: evolutionAbi,
    functionName: "requestCount"
  });
  const fusionRequest = await chain.request(fusionId);
  assert.equal(usdcApprovals, 0, "sponsored fusion requires no USDC approval");
  assert.equal(
    await client.readContract({
      address: evolution,
      abi: evolutionAbi,
      functionName: "sponsoredFusionsUsed"
    }),
    1n
  );
  assert.equal(
    await client.readContract({
      address: evolution,
      abi: evolutionAbi,
      functionName: "sponsoredSerumsUsed"
    }),
    1n
  );
  assert.equal(
    await client.readContract({
      address: evolution,
      abi: evolutionAbi,
      functionName: "feeLiability"
    }),
    0n
  );
  assert.ok(fusionRequest.randomnessId > 0n);
  await send(wrapper, "BoosterPacks.t:MockWrapper", "fulfill", [
    fusionRequest.randomnessId,
    123n
  ]);
  await worker.tick();
  await worker.tick();
  assert.equal(generated, 2);
  assert.deepEqual(inputs, [1, 2]);
  const completed = await chain.request(fusionId);
  assert.equal(completed.completed, true);
  await page.waitForURL(`**/adventures/cards/${completed.resultTokenId}`);
  const fused = (await get(`/cards/${completed.resultTokenId}`)).card;
  await page.locator(".has-selective-holo").first().waitFor();
  const layers = (await (await app.request(fused.metadataURI)).json()).yunipals
    .holo;
  for (const uri of Object.values(layers)) {
    const response = await app.request(uri);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
  }
  const viewer = page.locator("[data-live-holo]").first();
  await viewer.focus();
  await viewer.press("ArrowRight");
  await page.waitForFunction(() => {
    const card = document.querySelector(".has-selective-holo");
    return (
      card && getComputedStyle(card).getPropertyValue("--rotate-y") !== "0deg"
    );
  });
  assert.equal(fused.level, singularity ? 3 : 1);
  if (singularity) {
    assert.equal(fused.sources.length, 2);
    assert.equal(fused.effectiveSequence, 0);
    assert.equal(
      Math.floor(fused.sources[0].mintedAt / 86400),
      Math.floor(fused.sources[1].mintedAt / 86400)
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Choose fusion partner", exact: true })
        .isDisabled(),
      true
    );
    assert.match(
      (await (await app.request(fused.metadataURI)).json()).name,
      /Singularity/
    );
  }
  assert.equal(fused.localDoses, 0);
  assert.equal(fused.history.parents[0].doses.length, 1);
  assert.equal(fused.nextAdventureAt, enhanced.nextAdventureAt);
  assert.equal((await get(`/owners/${account.address}`)).cards.length, 1);
  assert.equal(
    (await get("/collection")).cards[0].tokenId,
    completed.resultTokenId.toString()
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  await page.screenshot({
    path: `/tmp/yunipals-${singularity ? "singularity" : "evolution"}-desktop.png`,
    fullPage: true
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `/tmp/yunipals-${singularity ? "singularity" : "evolution"}-mobile.png`,
    fullPage: true
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    ),
    true
  );
  console.log(
    "Evolution local flow passed: daily draw → three-card crew/VRF → two sacrifices and guaranteed survivor serum → browser approval → saved generation → fusion/VRF → atomic burn/mint → inherited history and cooldown → same-collection owner/gallery reads → published holo masks and keyboard tilt; desktop/mobile."
  );
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) {
    console.error(
      "Evolution browser state:",
      (await page.locator("body").innerText()).slice(-5000)
    );
    await page.screenshot({
      path: "/tmp/yunipals-evolution-failure.png",
      fullPage: true
    });
  }
  throw error;
} finally {
  await browser?.close();
  await vite?.close();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  await db.close();
  await rm(directory, { recursive: true, force: true });
  anvil.kill("SIGTERM");
}
