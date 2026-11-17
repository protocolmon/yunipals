// Real recent-openings query, parser and component; fixture API and artwork only.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createServer, transformWithEsbuild } from "vite";

const { values } = parseArgs({
  options: {
    playwright: {
      type: "string",
      default: "/tmp/yunipals-foundry/node_modules/playwright-core/index.mjs"
    },
    chromium: {
      type: "string",
      default: "/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome"
    }
  }
});
const root = fileURLToPath(new URL("..", import.meta.url));
const engine = "0x3333333333333333333333333333333333333333";
const collection = "0x4444444444444444444444444444444444444444";
const wallet = "0x1111111111111111111111111111111111111111";
const requestKey = `8453:${engine}:1`;
const pageData = {
  chainId: 8453,
  enabled: true,
  collection,
  engine,
  indexedBlock: "500",
  indexedTimestamp: "1800000500",
  items: [
    {
      requestKey,
      requestId: "1",
      engine,
      opening: true,
      quantity: 1,
      revealedAt: "1800000490",
      monster: {
        id: `8453:${collection}:1`,
        collection,
        tokenId: "1",
        requestKey,
        isOriginal: true,
        burned: false,
        owner: wallet,
        mintedTo: wallet,
        mintBlock: "490",
        monsterType: "4",
        color: "1",
        horn: "1",
        glitter: "1",
        variantId: "73",
        metadataUri: "https://example.test/73.json"
      }
    }
  ]
};
const modules = {
  "virtual:recent-boosters.ts": `export const boosterQueryKey=['recent-fixture'];
export const boosterAddresses=()=>({engine:'${engine}',monsters:'${collection}'});
export const boosterAssetUrl=uri=>uri;`,
  "virtual:recent-env.ts": `export const environment={yunipalsIndexerUrl:window.location.origin};`,
  "virtual:recent-art.tsx": `export const BoosterArtwork=({label})=><div role="img" aria-label={label}/>;`,
  "virtual:recent-entry.tsx": `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider,onlineManager} from '@tanstack/react-query';
import {BoosterRecentOpenings} from '/src/pages/boosters/BoosterRecentOpenings';
import '/src/globals.css';
const queries=new QueryClient({defaultOptions:{queries:{refetchOnWindowFocus:false}}});
window.__online=value=>onlineManager.setOnline(value);
function App(){const [shown,setShown]=useState(true);window.__show=setShown;
return shown&&<BoosterRecentOpenings/>;}
createRoot(document.getElementById('root')).render(<MemoryRouter><QueryClientProvider client={queries}><App/></QueryClientProvider></MemoryRouter>);`
};
const cacheDir = await mkdtemp(join(tmpdir(), "recent-openings-vite-"));
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
      name: "recent-openings-regression",
      enforce: "pre",
      resolveId(id) {
        if (Object.hasOwn(modules, id)) return "\0" + id;
        if (id === "@/lib/boosters" || id === `${root}/src/lib/boosters`)
          return "\0virtual:recent-boosters.ts";
        if (id === "@/environment" || id === `${root}/src/environment`)
          return "\0virtual:recent-env.ts";
        if (id === "./BoosterCollection") return "\0virtual:recent-art.tsx";
      },
      async load(id) {
        if (id.startsWith("\0virtual:"))
          return (
            await transformWithEsbuild(modules[id.slice(1)], id.slice(1), {
              loader: id.endsWith("tsx") ? "tsx" : "ts",
              jsx: "automatic"
            })
          ).code;
      },
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          if (req.url !== "/") return next();
          res.setHeader("Content-Type", "text/html");
          res.end(
            '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/__x00__virtual:recent-entry.tsx"></script></body></html>'
          );
        });
      }
    }
  ]
});
let browser;
try {
  await server.listen();
  const { chromium } = await import(pathToFileURL(values.playwright).href);
  browser = await chromium.launch({
    executablePath: values.chromium,
    headless: true,
    args: ["--no-sandbox"]
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let mode = "error",
    requests = 0;
  await page.route("**/v1/boosters/recent-openings?limit=12", async (route) => {
    requests++;
    if (mode === "hang") return;
    if (mode === "error") {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return route.fulfill({
        status: 503,
        json: { error: "booster_index_unavailable" }
      });
    }
    return route.fulfill({
      json: mode === "empty" ? { ...pageData, items: [] } : pageData
    });
  });
  const url = `http://127.0.0.1:${server.httpServer.address().port}`;
  await page.goto(url);
  await page.getByText("Loading recent openings…", { exact: true }).waitFor();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByLabel("Loading recent openings").count(), 0);
  assert.equal(
    requests,
    1,
    "failure should not silently keep retrying with skeletons"
  );
  mode = "success";
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.getByRole("list", { name: "Recently opened packs" }).waitFor();
  assert.equal(await page.getByRole("listitem").count(), 1);
  assert.equal(await page.getByRole("alert").count(), 0);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth
    ),
    false
  );
  mode = "empty";
  await page.reload();
  await page.getByText("The next reveal could be yours.").waitFor();
  mode = "hang";
  await page.reload();
  await page.getByRole("alert").waitFor({ timeout: 13_000 });
  assert.equal(
    await page.getByLabel("Loading recent openings").count(),
    0,
    "timeout must replace placeholders"
  );
  mode = "success";
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.getByRole("list", { name: "Recently opened packs" }).waitFor();
  // A fresh query while offline must explain the paused state.
  await page.reload();
  await page.evaluate(() => {
    window.__show(false);
    window.__online(false);
  });
  await page.evaluate(() => window.__show(true));
  await page.getByText(/Waiting for a connection/).waitFor();
  await page.evaluate(() => window.__online(true));
  await page.getByText(/Waiting for a connection/).waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: loading, 503, retry, real 10s timeout, empty, offline recovery, mobile layout"
  );
} finally {
  await browser?.close();
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
