// Real portal form, picker, eligibility reads and API parsers; wallet and data are fixtures.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createServer, transformWithEsbuild } from "vite";

const { values } = parseArgs({
  options: {
    playwright: { type: "string" },
    chromium: { type: "string" }
  }
});
const root = fileURLToPath(new URL("..", import.meta.url));
const owner = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const cards = "0x3333333333333333333333333333333333333333";
const grading = "0x4444444444444444444444444444444444444444";
const hash = "0x" + "a".repeat(64);
const status = {
  enabled: true,
  indexing: false,
  rotationIndexed: true,
  now: Math.floor(Date.now() / 1000),
  deployment: {
    chainId: 8453,
    collection: other,
    registry: other,
    grading,
    cards,
    usdc: other
  },
  asOfBlock: "100",
  asOfBlockHash: hash,
  economicsVersion: "2",
  portalFeeMode: "accumulate_and_burn",
  portalEscrow: grading,
  statusReason: "open",
  supply: { live: "200", minted: "200", burned: "0" },
  escrow: { reserves: "0", liability: "0" },
  round: { id: "2", portalId: "160", startsAt: "1", endsAt: "9999999999" },
  open: true,
  paused: false,
  rubricId: hash,
  rotation: {
    requestId: "0",
    automatic: true,
    ready: false,
    canActivate: false,
    canRequest: true
  },
  portal: {
    id: "160",
    owner,
    retired: false,
    claimable: "0",
    active: true,
    slotEndsAt: "9999999999",
    asOfBlock: "100",
    asOfBlockHash: hash,
    kindId: "1",
    name: "Rainbow Portal",
    imageURI: "/images/portals/rainbow-portal-card.webp",
    gates: {
      sequenceStart: 0,
      sequenceLength: 100,
      colorGate: 0,
      typeGate: 0,
      originalOnly: false,
      glitterGate: false,
      diamondGate: false
    },
    payment: {
      aiFee: "100000",
      portalFee: "100000",
      aiRecipient: other,
      portalRecipient: other,
      version: "1"
    },
    rubric: {
      modelPolicy: hash,
      copyCap: 25,
      uri: "fixture:rubric",
      configured: true
    },
    gradingCase: {
      id: "rainbow-v1",
      title: "Rainbow Portal: color with intention",
      criteria: {
        creativity: "Judge creativity",
        harmony: "Judge harmony",
        craft: "Judge craft",
        impact: "Judge impact"
      }
    }
  }
};
const modules = {
  "virtual:portal-wallet.ts": `
import {useSyncExternalStore} from 'react';
let owner='${owner}';const listeners=new Set();
window.__wallet=value=>{owner=value;listeners.forEach(fn=>fn());};
const client={getBlockNumber:async()=>100n,multicall:async({contracts})=>{
 const response=await fetch('/__checks',{method:'POST',body:JSON.stringify(contracts,(_,v)=>typeof v==='bigint'?v.toString():v)});
 if(!response.ok)throw Error('RPC unavailable');
 const results=await response.json();
 return results.map((result,i)=>({status:'success',result:contracts[i].functionName==='pendingRequest'?BigInt(result):result}));
}};
export function usePortals(){
 const address=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>owner);
 return {address,chainId:8453,client,busy:false,phase:'idle',prepare:async(tokenId,spell)=>{window.__prepared={tokenId,spell};}};
}
export const useSwitchChain=()=>({switchChain:()=>{}});
export const useConnectModal=()=>({openConnectModal:()=>window.__wallet('${owner}')});`,
  "virtual:portal-unrelated.tsx": `export const boosterButtonClass='rounded-full bg-grape p-3 text-white';export const PortalCompetitions=()=>null;`,
  "virtual:portal-entry.tsx": `
import React from 'react';import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {PortalPage} from '/src/pages/portals/PortalPage';import {environment} from '/src/environment';import '/src/globals.css';
environment.portalApiUrl=new URL('/fixture',location.href).href;
environment.yunipalsIndexerUrl=new URL('/fixture',location.href).href;
const query=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
window.__refresh=()=>query.invalidateQueries({queryKey:['portals','active']});
createRoot(document.getElementById('root')).render(<React.StrictMode><MemoryRouter initialEntries={['/portals?card=4']}><QueryClientProvider client={query}><PortalPage/></QueryClientProvider></MemoryRouter></React.StrictMode>);`
};
const cacheDir = await mkdtemp(join(tmpdir(), "portal-picker-vite-"));
const server = await createServer({
  root,
  cacheDir,
  configFile: false,
  esbuild: { jsx: "automatic" },
  define: {
    "import.meta.env.VITE_PORTALS_API_URL": JSON.stringify("/fixture"),
    "import.meta.env.VITE_YUNIPALS_INDEXER_URL": JSON.stringify("/fixture"),
    "import.meta.env.VITE_PORTALS_GRADING_ADDRESS": JSON.stringify(grading),
    "import.meta.env.VITE_PORTALS_ENABLED": JSON.stringify("true")
  },
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
      name: "portal-picker-fixtures",
      enforce: "pre",
      resolveId(id) {
        if (Object.hasOwn(modules, id)) return "\0" + id;
        if (
          id === "wagmi" ||
          id === "@rainbow-me/rainbowkit" ||
          id.endsWith("/hooks/usePortals")
        )
          return "\0virtual:portal-wallet.ts";
        if (
          id.endsWith("/BoosterActionButton") ||
          id.endsWith("/PortalCompetitions")
        )
          return "\0virtual:portal-unrelated.tsx";
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
          if (req.url !== "/__portal-picker") return next();
          res.setHeader("Content-Type", "text/html");
          res.end(
            await vite.transformIndexHtml(
              req.url,
              '<html><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div><script type="module" src="/@id/__x00__virtual:portal-entry.tsx"></script></body></html>'
            )
          );
        });
      }
    }
  ]
});
let browser;
let mode = "normal";
const requests = [];
const monster = (tokenId, address = owner) => ({
  id: `8453:${cards}:${tokenId}`,
  tokenId,
  collection: cards,
  owner: address,
  mintedTo: address,
  originalKey: "original",
  requestKey: "request",
  typeKey: "type",
  variantId: "0",
  monsterType: "1",
  color: "1",
  horn: "1",
  glitter: "0",
  isOriginal: false,
  burned: false,
  mintBlock: "1",
  metadataUri: "/fixture/card.json"
});
try {
  await server.listen();
  const { chromium } = await import(
    values.playwright ? pathToFileURL(values.playwright).href : "playwright"
  );
  browser = await chromium.launch({
    headless: true,
    executablePath: values.chromium,
    args: ["--no-sandbox"]
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 }
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (url.pathname === "/fixture/v1/portals")
      return route.fulfill({ json: status });
    if (url.pathname === "/__checks") {
      if (mode === "error")
        return route.fulfill({ status: 503, body: "unavailable" });
      const contracts = JSON.parse(route.request().postData());
      return route.fulfill({
        json: contracts.map((c) => {
          const id = c.args.at(-1);
          if (c.functionName === "matches")
            return mode !== "empty" && Number(id) >= 3;
          if (c.functionName === "pendingRequest")
            return id === "3" ? "9" : "0";
          if (c.functionName === "ownerOf") return id === "5" ? other : owner;
          throw Error("unexpected function");
        })
      });
    }
    if (url.pathname.endsWith("/booster-monsters")) {
      requests.push(url.searchParams.get("after"));
      const after = url.searchParams.get("after");
      const ids =
        after === null ? ["1", "2"] : after === "2" ? ["3", "4", "5"] : ["6"];
      return route.fulfill({
        json: {
          enabled: true,
          chainId: 8453,
          collection: cards,
          indexedBlock: "100",
          items: ids.map((id) => monster(id)),
          nextCursor: after === null ? "2" : after === "2" ? "5" : null
        }
      });
    }
    if (url.pathname.endsWith(".json") && url.pathname.startsWith("/fixture/"))
      return route.fulfill({
        json: {
          name: "Fixture Yunipal",
          image: new URL("/images/portals/rainbow-portal-card.webp", url).href,
          attributes: [],
          portalVersion: "1"
        }
      });
    return route.continue();
  });
  const origin = server.resolvedUrls.local[0];
  await page.goto(`${origin}__portal-picker`);
  await page
    .getByRole("button", { name: "Choose a card", exact: true })
    .waitFor();
  await page.getByText("How your card is graded", { exact: true }).click();
  await page
    .getByRole("heading", { name: "Rainbow Portal grading criteria" })
    .waitFor();
  assert.equal(
    await page
      .getByText("Rainbow Portal: color with intention", { exact: true })
      .count(),
    0
  );
  assert.equal(
    await page.getByLabel("Card number", { exact: true }).count(),
    0
  );
  await page
    .getByRole("button", { name: "Choose a card", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Choose your card" });
  await dialog.waitFor();
  await dialog
    .getByRole("button", { name: "Choose Yuniair #4", exact: true })
    .waitFor();
  assert.deepEqual([...new Set(requests)], [null, "2"]);
  for (const id of ["1", "2", "3", "5"])
    assert.equal(
      await dialog
        .getByRole("button", { name: `Choose Yuniair #${id}`, exact: true })
        .count(),
      0
    );
  await dialog.getByRole("button", { name: "Check more cards" }).click();
  await dialog
    .getByRole("button", { name: "Choose Yuniair #6", exact: true })
    .waitFor();
  await dialog
    .getByRole("button", { name: "Choose Yuniair #4", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Change card", exact: true })
    .waitFor();
  await page
    .getByLabel("Your spell", { exact: true })
    .fill("A stained-glass crown and a curious expression.");
  await page
    .getByRole("button", { name: "Review your spell", exact: true })
    .click();
  assert.equal(await page.evaluate(() => window.__prepared.tokenId), "4");
  await page.getByRole("button", { name: "Change card", exact: true }).click();
  await dialog.waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    await page
      .getByRole("button", { name: "Change card", exact: true })
      .evaluate((el) => el === document.activeElement),
    true
  );
  // A different portal invalidates the previous selection and closes its picker.
  await page.getByRole("button", { name: "Change card", exact: true }).click();
  status.round.id = "3";
  status.round.portalId = "161";
  status.portal.id = "161";
  await page.evaluate(() => window.__refresh());
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Choose a card", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Choose a card", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Choose Yuniair #4", exact: true })
    .click();
  await page.evaluate(() => window.__wallet(undefined));
  await page
    .getByRole("button", { name: "Connect wallet to choose a card" })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Change card", exact: true })
      .count(),
    0
  );
  await page
    .getByRole("button", { name: "Connect wallet to choose a card" })
    .click();
  await page
    .getByRole("button", { name: "Choose a card", exact: true })
    .click();
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Close card picker" }).click();
  // Error and empty states stay distinct, and Retry recovers without reloading.
  mode = "error";
  await page
    .getByRole("button", { name: "Choose a card", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Try again" }).waitFor();
  assert.equal(
    await dialog.getByText("No matching cards in this wallet").count(),
    0
  );
  mode = "empty";
  await dialog.getByRole("button", { name: "Try again" }).click();
  await dialog
    .getByText("No matching cards in this wallet", { exact: true })
    .waitFor();
  await dialog.getByRole("button", { name: "Close card picker" }).click();
  mode = "normal";
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Choose a card", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Choose Yuniair #4", exact: true })
    .waitFor();
  assert(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth));
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  );
  const artwork = dialog.getByRole("img", { name: "Yuniair #4", exact: true });
  await artwork.waitFor();
  await artwork.evaluate((img) => img.decode());
  await page.screenshot({ path: "/tmp/portal-picker-mobile.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: grading copy, eligibility, pagination, selection, review, keyboard focus, portal/wallet changes, retry, empty state and mobile layout"
  );
} finally {
  await browser?.close();
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
