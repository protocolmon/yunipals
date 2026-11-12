/** Real local contracts + private API + durable worker + browser wallet. AI is deterministic here. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { PGlite } from "@electric-sql/pglite";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  toHex,
  type Abi,
  type Address,
  type Hex,
  type PublicClient
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import {
  portalModels,
  portalModelPolicyHash
} from "@protopals/yunipals-market-core/portals";
import { createServer } from "../../yunipals-home-web/node_modules/vite/dist/node/index.js";
import { PortalAssets } from "../lib/portals/assets.js";
import { PortalLedgerStore } from "../lib/portals/ledger-store.js";
import { PortalLedger } from "../lib/portals/ledger.js";
import { PortalStore } from "../lib/portals/store.js";
import { PortalChain } from "../lib/portals/chain.js";
import { PortalWorker } from "../lib/portals/worker.js";
import { rainbowPortalOdds } from "../lib/portals/prepare.js";
import { registerPortalRoutes } from "../lib/portals/routes.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const rpc = "http://127.0.0.1:8549",
  origin = "http://127.0.0.1:5191",
  api = "http://127.0.0.1:8931";
const binary = process.env.PORTALS_TEST_ANVIL;
if (!binary) throw new Error("Set PORTALS_TEST_ANVIL to a local Anvil binary.");
const browserModule = process.env.PORTALS_TEST_PLAYWRIGHT;
if (!browserModule)
  throw new Error(
    "Set PORTALS_TEST_PLAYWRIGHT to a local playwright-core entry point."
  );
// Public, deterministic Anvil test wallets; never use these on any public network.
const admin = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
);
const alice = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
);
const bob = "0x3333333333333333333333333333333333333333" as Address;
const anvil = spawn(
  binary,
  ["--host", "127.0.0.1", "--port", "8549", "--chain-id", "8453", "--silent"],
  { stdio: "ignore" }
);
const directory = await mkdtemp(join(tmpdir(), "portal-local-"));
const db = new PGlite();
const publicClient = createPublicClient({
  transport: http(rpc, { retryCount: 0 }),
  pollingInterval: 100
});
const wallet = createWalletClient({
  account: admin,
  chain: base,
  transport: http(rpc),
  pollingInterval: 100
});
const aliceWallet = createWalletClient({
  account: alice,
  chain: base,
  transport: http(rpc),
  pollingInterval: 100
});
let browser: { close(): Promise<void> } | undefined;
let vite: Awaited<ReturnType<typeof createServer>> | undefined;
let server: ReturnType<typeof serve> | undefined;
const artifact = async (file: string, name?: string) => {
  const [source, contract] = file.split(":");
  return JSON.parse(
    await readFile(
      join(
        root,
        `contracts/boosters/out-permit/${source}.sol/${name ?? contract ?? source}.json`
      ),
      "utf8"
    )
  ) as { abi: Abi; bytecode: { object: Hex } };
};
async function deploy(
  file: string,
  name = file,
  args: readonly unknown[] = []
) {
  const compiled = await artifact(file, name);
  const hash = await wallet.deployContract({
    abi: compiled.abi,
    bytecode: compiled.bytecode.object,
    args
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
  return receipt.contractAddress!;
}
async function call(
  to: Address,
  file: string,
  fn: string,
  args: readonly unknown[] = [],
  value = 0n
) {
  const { abi } = await artifact(file);
  const hash = await wallet.sendTransaction({
    to,
    data: encodeFunctionData({ abi, functionName: fn, args }),
    value
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
  return receipt;
}
async function proxy(file: string, args: readonly unknown[]) {
  const impl = await deploy(file);
  const { abi } = await artifact(file);
  return deploy("ERC1967Proxy", "ERC1967Proxy", [
    impl,
    encodeFunctionData({ abi, functionName: "initialize", args })
  ]);
}
try {
  for (let n = 0; n < 50; n++) {
    try {
      await publicClient.getBlockNumber();
      break;
    } catch {
      await delay(100);
    }
  }
  assert.equal(await publicClient.getChainId(), 8453);
  // Base provides Multicall3; mirror it locally for wagmi's batched reads.
  const { multicall3Bytecode } = await import(
    new URL("../node_modules/viem/_esm/constants/contracts.js", import.meta.url)
      .href
  );
  const multicallHash = await wallet.deployContract({
    abi: [],
    bytecode: multicall3Bytecode
  });
  const multicallReceipt = await publicClient.waitForTransactionReceipt({
    hash: multicallHash
  });
  const multicallCode = await publicClient.getCode({
    address: multicallReceipt.contractAddress!
  });
  await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "anvil_setCode",
      params: [base.contracts.multicall3.address, multicallCode]
    })
  });
  const packs = await proxy("PackRegistry", [admin.address]);
  const cards = await proxy("YunipalMonsters", [admin.address, packs]);
  const engine = await deploy("Portals.t", "PortalTestEngine", [packs]);
  const usdc = await deploy("Portals.t", "PortalTestUSDC");
  const wrapper = await deploy("BoosterPacks.t", "MockWrapper");
  const rules = await deploy("PortalRules");
  const collection = await proxy("PortalCollection", [
    admin.address,
    wrapper,
    3,
    rules
  ]);
  const registry = await proxy("PortalRegistry", [
    admin.address,
    collection,
    wrapper,
    3
  ]);
  await call(packs, "PackRegistry", "configureType", [
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
  await call(packs, "PackRegistry", "activate", [1n]);
  const grading = await proxy("PortalGrading", [
    admin.address,
    cards,
    registry,
    usdc,
    1n,
    "https://portal.test/v1/portals/cards/"
  ]);
  const competition = await proxy("PortalGradingCompetition", [
    admin.address,
    grading,
    usdc
  ]);
  await call(grading, "PortalGrading", "configureCompetition", [competition]);
  const chain = new PortalChain(publicClient as PublicClient, {
    chainId: 8453,
    collection,
    registry,
    grading,
    cards,
    usdc
  });
  const assets = new PortalAssets(directory, "https://portal.test", [
    "portal.test"
  ]);
  const image = await readFile(
    join(
      root,
      "docs/boosters/artwork-runtime/assets/7cc78b1050c1c9cadf78b74057c4f059499c123c7217e14ca9efc6c18550d08a.png"
    )
  );
  const original = await assets.put(image, "png");
  await call(cards, "YunipalMonsters", "setGradingRegistry", [grading]);
  await call(collection, "PortalCollection", "bindClaimController", [grading]);
  await call(grading, "PortalGrading", "grantRole", [
    keccak256(toHex("GRADER_ROLE")),
    admin.address
  ]);
  await call(grading, "PortalGrading", "registerBaseArt", [[0], [original]]);
  await call(grading, "PortalGrading", "configureRubric", [
    keccak256(toHex(portalModels.rubric)),
    portalModelPolicyHash(),
    20,
    "ipfs://rubric-v1"
  ]);
  const odds = {
    ...rainbowPortalOdds,
    originalBps: 10000,
    glitterBps: 0,
    diamondBps: 0,
    colorWeights: [1, 0, 0, 0, 0, 0],
    typeWeights: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  };
  await call(collection, "PortalCollection", "configureKind", [
    0n,
    {
      name: "Rainbow Portal",
      imageURI: "https://portal.test/rainbow.png",
      artworkHash: keccak256(toHex("rainbow")),
      cap: 1000,
      odds
    }
  ]);
  await call(
    collection,
    "PortalCollection",
    "mintBatch",
    [1n, [admin.address, admin.address, admin.address], 100000000000000n],
    100000000000000n
  );
  await call(wrapper, "BoosterPacks.t:MockWrapper", "fulfill", [1n, 42n]);
  await call(collection, "PortalCollection", "finishMint", [1n, 32]);
  await call(grading, "PortalGrading", "setPaymentPolicy", [
    1n,
    245000n,
    245000n,
    admin.address
  ]);
  await call(engine, "Portals.t:PortalTestEngine", "original", [
    cards,
    1n,
    alice.address,
    0
  ]);
  await call(usdc, "Portals.t:PortalTestUSDC", "mint", [
    alice.address,
    1000000n
  ]);
  await call(
    registry,
    "PortalRegistry",
    "requestRotation",
    [100000000000000n],
    100000000000000n
  );
  await call(wrapper, "BoosterPacks.t:MockWrapper", "fulfill", [2n, 43n]);
  await call(registry, "PortalRegistry", "activateNext");
  const store = new PortalStore(db as never, "local-e2e");
  await store.migrate();
  const ledgerStore = new PortalLedgerStore(db as never, "local-e2e");
  await ledgerStore.migrate();
  const ledger = new PortalLedger(chain, ledgerStore, 1n, 0n);
  await ledger.tick();
  const app = new Hono();
  app.use("*", cors({ origin }));
  registerPortalRoutes(app, {
    enabled: () => true,
    runtime: async () => ({
      chain,
      assets,
      store,
      ledger: ledgerStore,
      close: async () => {}
    })
  });
  server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 8931 });
  Object.assign(process.env, {
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
    server: { host: "127.0.0.1", port: 5191, strictPort: true }
  });
  await vite.listen();
  const { chromium } = await import(pathToFileURL(browserModule).href);
  const launched = await chromium.launch({
    executablePath: process.env.PORTALS_TEST_CHROMIUM,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
  browser = launched;
  const page = await launched.newPage({
    viewport: { width: 1280, height: 1000 }
  });
  // Playwright is a temporary verification dependency, loaded from the operator-supplied path.
  if (process.env.PORTALS_TEST_ADMIN_ONLY !== "true") {
    const runBrowser = await import(
      new URL("./test-portals-browser.mjs", import.meta.url).href
    );
    await runBrowser
      .verifyPortalBrowser({
        page,
        origin,
        rpc,
        app,
        image,
        root,
        alice,
        aliceWallet,
        publicClient,
        chain,
        assets,
        store,
        ledger,
        adminWallet: wallet,
        call,
        cards,
        usdc,
        grading,
        collection,
        registry,
        wrapper,
        bob,
        db
      })
      .catch(async (error: unknown) => {
        console.error(
          "Portal browser alerts:",
          await page.getByRole("alert").allTextContents()
        );
        console.error(
          "Portal browser status:",
          await page.getByRole("status").allTextContents()
        );
        await page.screenshot({
          path: "/tmp/yunipals-portals-failure.png",
          fullPage: true
        });
        throw error;
      });
    const { verifyCompetitionBrowser } = await import(
      new URL("./test-portal-competition-browser.mjs", import.meta.url).href
    );
    await verifyCompetitionBrowser({
      page,
      origin,
      rpc,
      app,
      chain,
      publicClient,
      call,
      engine,
      cards,
      usdc,
      grading,
      bob,
      ledger,
      alice,
      store,
      assets
    });
  }
  const { verifyPortalAdminBrowser } = await import(
    new URL("./test-portals-admin-browser.mjs", import.meta.url).href
  );
  await verifyPortalAdminBrowser({
    browser: launched,
    visitor: page,
    origin,
    rpc,
    adminWallet: wallet,
    chain,
    wrapper,
    call,
    ledger
  });
  console.log(
    process.env.PORTALS_TEST_ADMIN_ONLY === "true"
      ? "Portal local admin flow passed."
      : "Portal local end-to-end passed: escrow credit, burn/claim and post-burn grading, metadata, 111-entry admission pause, winner-spell theme extraction, durable provider/publication recovery, onchain theme publication, entry 112 reopening, exact top-three payouts and mobile/desktop."
  );
} finally {
  await browser?.close();
  await vite?.close();
  await new Promise<void>((resolve) =>
    server ? server.close(() => resolve()) : resolve()
  );
  await db.close();
  await rm(directory, { recursive: true, force: true });
  anvil.kill("SIGTERM");
}
