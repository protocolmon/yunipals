// Real storefront, purchase controls, original reader and claim controls.
// Indexer responses, wallet and transaction preparation are deterministic fixtures.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createServer, transformWithEsbuild } from "vite";

const { values } = parseArgs({
  options: { playwright: { type: "string" }, chromium: { type: "string" } }
});
const root = fileURLToPath(new URL("..", import.meta.url));
const owner = "0x1111111111111111111111111111111111111111";
const registry = "0x2222222222222222222222222222222222222222";
const engine = "0x3333333333333333333333333333333333333333";
const collection = "0x4444444444444444444444444444444444444444";
const hash = "0x" + "a".repeat(64);
const now = 2_000_000_000;
const oldPack = {
  id: "old-pack",
  packTypeId: "1",
  registry,
  engine,
  paymentToken: owner,
  price: "1000000000000000000",
  intervalSeconds: "86400",
  mintsPerInterval: 1,
  totalVariants: "264",
  maxBatch: 7,
  catalogHash: hash,
  ruleHash: hash,
  manifestUri: "https://art.example.test/standard/manifest.json",
  metadataBaseUri: "https://art.example.test/standard/",
  salesPaused: true,
  openings: "1",
  dailyClaimsExpire: false
};
const currentPack = {
  ...oldPack,
  id: "current-pack",
  packTypeId: "2",
  salesPaused: false,
  dailyClaimsExpire: true
};
const original = {
  id: "original",
  collection,
  tokenId: "7",
  typeKey: oldPack.id,
  engine,
  owner,
  revealedAt: String(now - 3 * 86400),
  dailyCommitted: "0",
  minted: "1",
  remaining: "263",
  pendingRequest: null,
  burned: false,
  pack: oldPack
};
const snapshot = {
  chainId: 8453,
  collection,
  engine,
  enabled: true,
  requestsPaused: false,
  indexedBlock: "100",
  indexedBlockHash: hash,
  indexedTimestamp: String(now)
};
const modules = {
  "virtual:storefront-wallet.ts": `
    const unexpected=()=>{throw Error('Unexpected RPC or signing request')};
    const client={getBlock:async()=>({timestamp:${now}n}),getStorageAt:async()=>'${hash}',
      readContract:async({functionName})=>functionName==='MAX_OPEN_PACKS'?10:unexpected()};
    export const useAccount=()=>({address:'${owner}',isConnected:true,chainId:8453});
    export const usePublicClient=()=>client;
    export const useSwitchChain=()=>({isPending:false,error:null,switchChain:unexpected});
  `,
  "virtual:storefront-connect.ts": `export const useConnectModal=()=>({});`,
  "virtual:storefront-actions.ts": `
    export const useBoosterActions=()=>({phase:'idle',review:null,error:null,
      prepare:async(action)=>{window.__prepared=action;}});
  `,
  "virtual:storefront-opening.ts": `export const useBoosterOpening=()=>({});`,
  "virtual:storefront-entry.tsx": `
    import React from 'react';import{createRoot}from'react-dom/client';
    import{MemoryRouter}from'react-router-dom';
    import{QueryClient,QueryClientProvider,useQuery}from'@tanstack/react-query';
    import{BoosterPackSection}from'/src/pages/boosters/BoosterPackSection';
    import{BoosterOriginalControls}from'/src/pages/boosters/BoosterOriginalControls';
    import{fetchBoosterOriginal}from'/src/lib/boosters';
    import{environment}from'/src/environment';import'/src/globals.css';
    Object.assign(environment,{boostersEnabled:true,fixtures:false,boosterRegistry:'${registry}',
      boosterEngine:'${engine}',boosterMonsters:'${collection}',boosterLaunchId:'base-ypal-v1',
      boosterPaymentSymbol:'YPAL',boosterEthAdapter:'',yunipalsIndexerUrl:'/fixture'});
    const query=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
    window.__refresh=()=>query.invalidateQueries();
    function ExistingOriginal(){const {data}=useQuery({queryKey:['existing-original'],
      queryFn:()=>fetchBoosterOriginal('${collection}','7')});
      return <section aria-label="Existing original">{data&&<BoosterOriginalControls original={data.item}/>}</section>;}
    createRoot(document.getElementById('root')).render(<MemoryRouter><QueryClientProvider client={query}>
      <BoosterPackSection/><ExistingOriginal/>
    </QueryClientProvider></MemoryRouter>);
  `
};
const cacheDir = await mkdtemp(join(tmpdir(), "storefront-ui-"));
const server = await createServer({
  root,
  cacheDir,
  configFile: false,
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": `${root}/src`,
      "@protopals/yunipals-market-core": fileURLToPath(
        new URL("../../../packages/yunipals-market-core/src", import.meta.url)
      )
    }
  },
  server: { host: "127.0.0.1", port: 0, hmr: false },
  plugins: [
    {
      name: "storefront-fixtures",
      enforce: "pre",
      resolveId(id) {
        if (Object.hasOwn(modules, id)) return "\0" + id;
        if (id === "wagmi") return "\0virtual:storefront-wallet.ts";
        if (id === "@rainbow-me/rainbowkit")
          return "\0virtual:storefront-connect.ts";
        if (id.endsWith("/hooks/useBoosterActions"))
          return "\0virtual:storefront-actions.ts";
        if (id.endsWith("/providers/BoosterOpeningProvider"))
          return "\0virtual:storefront-opening.ts";
      },
      load(id) {
        if (id.startsWith("\0") && modules[id.slice(1)])
          return transformWithEsbuild(modules[id.slice(1)], id.slice(1), {
            loader: "tsx",
            jsx: "automatic"
          });
      },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (req.url !== "/__storefront") return next();
          res.setHeader("Content-Type", "text/html");
          res.end(
            await vite.transformIndexHtml(
              req.url,
              '<html><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div><script type="module" src="/@id/__x00__virtual:storefront-entry.tsx"></script></body></html>'
            )
          );
        });
      }
    }
  ]
});
let browser;
try {
  await server.listen();
  const { chromium } = await import(
    values.playwright ? pathToFileURL(values.playwright).href : "playwright"
  );
  browser = await chromium.launch({
    executablePath: values.chromium,
    args: ["--no-sandbox"]
  });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.setDefaultTimeout(15000);
    const errors = [],
      unexpected = [];
    let requestsPaused = false,
      fail = false,
      allPaused = false,
      originalRead = false;
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) {
        unexpected.push(url.href);
        return route.abort();
      }
      if (url.pathname === "/fixture/v1/boosters/types")
        return route.fulfill({
          status: fail ? 503 : 200,
          json: fail
            ? {}
            : {
                ...snapshot,
                requestsPaused,
                items: [
                  oldPack,
                  { ...currentPack, salesPaused: allPaused },
                  { ...currentPack, id: "other-deployment", registry: owner },
                  {
                    ...currentPack,
                    id: "smoke",
                    manifestUri:
                      "https://art.example.test/base-mainnet-smoke-v1/manifest.json"
                  }
                ]
              }
        });
      if (url.pathname === `/fixture/v1/boosters/originals/${collection}/7`) {
        originalRead = true;
        return route.fulfill({ json: { ...snapshot, item: original } });
      }
      if (url.pathname.startsWith("/fixture/")) {
        unexpected.push(url.pathname);
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(origin + "/__storefront");
    const storefront = page.locator("#booster-packs");
    const heading = storefront.getByRole("heading", {
      name: "Yunipals booster pack",
      exact: true
    });
    await storefront
      .getByText("Each daily claim expires after 24 hours.", { exact: false })
      .waitFor();
    assert.equal(await heading.count(), 1);
    assert.equal(
      await storefront
        .getByText("Saved mints add up while you’re away.", { exact: false })
        .count(),
      0
    );
    await storefront
      .getByRole("heading", { name: "Nightforge", exact: true })
      .waitFor();
    const open = storefront.getByRole("button", {
      name: "Open pack",
      exact: true
    });
    assert.equal(await open.isEnabled(), true);
    await open.click();
    assert.deepEqual(await page.evaluate(() => window.__prepared), {
      kind: "open",
      packTypeId: "2",
      quantity: 1,
      payment: "ypal"
    });
    const claim = page.getByRole("button", {
      name: "Open 3 saved cards from original #7",
      exact: true
    });
    await claim.waitFor();
    assert.equal(await claim.isEnabled(), true);
    await claim.click();
    assert.deepEqual(await page.evaluate(() => window.__prepared), {
      kind: "claim",
      originalId: "7",
      packTypeId: "1",
      quantity: 3
    });
    assert(originalRead);
    const artwork = storefront.getByRole("img").first();
    await artwork.evaluate((el) => el.decode());
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      ),
      true
    );
    await page.screenshot({
      path: `/tmp/yunipals-storefront-${width}.png`,
      fullPage: true
    });
    requestsPaused = true;
    await page.evaluate(() => window.__refresh());
    const paused = storefront.getByRole("button", {
      name: "Openings paused",
      exact: true
    });
    await paused.waitFor();
    assert(await paused.isDisabled());
    assert.equal(await heading.count(), 1);
    allPaused = true;
    await page.evaluate(() => window.__refresh());
    await storefront
      .getByText("No packs are available to open right now.", { exact: false })
      .waitFor();
    assert.equal(await heading.count(), 0);
    assert(await claim.isEnabled());
    await page.screenshot({
      path: `/tmp/yunipals-storefront-empty-${width}.png`,
      fullPage: true
    });
    fail = true;
    await page.evaluate(() => window.__refresh());
    await storefront.getByRole("alert").waitFor();
    fail = false;
    allPaused = false;
    requestsPaused = false;
    await storefront
      .getByRole("button", { name: "Try again", exact: true })
      .click();
    await open.waitFor();
    assert(await open.isEnabled());
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, []);
    console.log(
      JSON.stringify({
        width,
        passed: true,
        existingClaimsAccessible: true,
        pauseAndRecoveryPassed: true
      })
    );
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
