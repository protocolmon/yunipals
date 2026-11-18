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
status.rotation.queueCapacity = 11;
status.rotation.refillCount = 0;
status.rotation.canRequest = false;
status.rotation.upcoming = Array.from({ length: 11 }, (_, i) => ({
  id: String(i + 3),
  portalId: String(170 + i),
  startsAt: String(status.now + 660 * (i + 1)),
  endsAt: String(status.now + 660 * (i + 2)),
  portal: {
    ...status.portal,
    id: String(170 + i),
    active: false,
    retired: i === 2
  }
}));
status.rotation.scheduled = status.rotation.upcoming[0];
const modules = {
  "virtual:portal-wallet.ts": `
import {useSyncExternalStore} from 'react';
let owner='${owner}';const listeners=new Set();
window.__wallet=value=>{owner=value;listeners.forEach(fn=>fn());};
const client={getBlockNumber:async()=>100n,multicall:async({contracts})=>{
 const response=await fetch('/__checks',{method:'POST',body:JSON.stringify(contracts,(_,v)=>typeof v==='bigint'?v.toString():v)});
 if(!response.ok)throw Error('RPC unavailable');
 const results=await response.json();
 return results.map((result,i)=>({status:'success',result:['pendingRequest','artVersion'].includes(contracts[i].functionName)?BigInt(result):result}));
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
import {MemoryRouter,Routes,Route} from 'react-router-dom';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {PortalPage} from '/src/pages/portals/PortalPage';import {PortalCardHistory} from '/src/pages/portals/PortalCardHistory';import {environment} from '/src/environment';import '/src/globals.css';
environment.portalApiUrl=new URL('/fixture',location.href).href;
environment.yunipalsIndexerUrl=new URL('/fixture',location.href).href;
const query=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
window.__refresh=()=>query.invalidateQueries({queryKey:['portals','active']});
window.__refreshCounts=()=>query.invalidateQueries({queryKey:['portals','matching-cards']});
window.__refreshCard=()=>query.invalidateQueries({queryKey:['portals','card']});
createRoot(document.getElementById('root')).render(<React.StrictMode><MemoryRouter initialEntries={[location.pathname==='/__portal-progress'?'/grading/cards/508':'/grading?card=4']}><QueryClientProvider client={query}><Routes><Route path="/grading/cards/:tokenId" element={<PortalCardHistory/>}/><Route path="*" element={<PortalPage/>}/></Routes></QueryClientProvider></MemoryRouter></React.StrictMode>);`
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
          if (!["/__portal-picker", "/__portal-progress"].includes(req.url))
            return next();
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
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let countMode = "normal";
  const progressCard = {
    tokenId: "508",
    pending: "7",
    historyCount: "0",
    nextBefore: null,
    history: [],
    publication: [],
    publicationPending: false,
    originalArtwork: { uri: "/images/portals/rainbow-portal-card.webp", hash },
    processing: {
      requestId: "7",
      acceptedAt: String(Math.floor(Date.now() / 1000)),
      stage: "queued",
      estimate: null
    }
  };
  const selectedRounds = [];
  let cardRpcChecks = 0;
  const countRequests = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (url.pathname === "/fixture/v1/portals/cards/508")
      return route.fulfill({ json: progressCard });
    if (url.pathname === "/fixture/v1/portals") {
      const roundId = url.searchParams.get("roundId");
      selectedRounds.push(roundId);
      const selected = status.rotation.upcoming.find(
        (item) => item.id === roundId
      );
      return route.fulfill({
        json: selected
          ? {
              ...status,
              round: selected,
              portal: { ...status.portal, ...selected.portal }
            }
          : status
      });
    }
    if (url.pathname === "/fixture/v1/boosters/portal-card-counts") {
      countRequests.push(url.searchParams.get("portalIds"));
      if (countMode === "error")
        return route.fulfill({ status: 503, json: { error: "Unavailable" } });
      return route.fulfill({
        json: {
          owner: url.searchParams.get("owner"),
          grading,
          collection: other,
          cards,
          chainId: 8453,
          indexedBlock: "100",
          items: url.searchParams
            .get("portalIds")
            .split(",")
            .map((portalId, i) => ({
              portalId,
              count:
                countMode === "empty" || url.searchParams.get("owner") !== owner
                  ? 0
                  : i === 0
                    ? 3
                    : 0,
              retired: false
            }))
        }
      });
    }
    if (url.pathname === "/__checks") {
      cardRpcChecks++;
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
          if (c.functionName === "artVersion") return id === "7" ? "1" : "0";
          if (c.functionName === "ownerOf") return id === "5" ? other : owner;
          throw Error("unexpected function");
        })
      });
    }
    if (url.pathname.endsWith("/booster-monsters")) {
      requests.push(url.searchParams.get("after"));
      const after = url.searchParams.get("after");
      const ids =
        after === null
          ? ["1", "2"]
          : after === "2"
            ? ["3", "4", "5"]
            : ["6", "7"];
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
  const schedule = page.getByRole("region", { name: "Upcoming portals" });
  await schedule.getByText("11 of 11 future windows revealed").waitFor();
  assert.equal(await schedule.getByRole("listitem").count(), 11);
  await schedule.getByText("3 matching cards", { exact: true }).waitFor();
  assert.equal(
    await schedule.getByText("No matching cards", { exact: true }).count(),
    9
  );
  assert.equal(countRequests[0].split(",").length, 10); // retired portal excluded
  const requestCount = countRequests.length;
  await page.evaluate(() => window.__refresh());
  await page.waitForTimeout(3500); // status polling / countdown do not reload counts
  assert.equal(countRequests.length, requestCount);
  assert.equal(cardRpcChecks, 0, "badges do not trigger card RPC checks");
  await schedule.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/portal-counts-desktop.png" });
  assert(
    await page
      .getByRole("button", { name: "Schedule full", exact: true })
      .isDisabled()
  );
  await schedule.getByText("Redeemed · this window stays closed").waitFor();
  await schedule
    .getByText("Entry requirements", { exact: true })
    .first()
    .click();
  await schedule.getByText("Sequence 0–99", { exact: true }).first().waitFor();
  status.revealedAdmissions = true;
  await page.evaluate(() => window.__refresh());
  const revealed = page.getByRole("region", {
    name: "Revealed portals · submit now"
  });
  await revealed.waitFor();
  assert.equal(
    await revealed
      .getByRole("link", { name: "Submit a monster", exact: true })
      .count(),
    1
  );
  await revealed
    .getByRole("link", { name: "Submit a monster", exact: true })
    .last()
    .click();
  await page
    .getByRole("link", { name: "Selected portal", exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "Rainbow Portal #170", exact: true })
    .first()
    .waitFor();
  assert(selectedRounds.includes("3"));
  assert(
    await page
      .getByRole("button", { name: "Review your spell", exact: true })
      .isEnabled()
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await revealed.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/revealed-portals-mobile.png" });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  );
  await page
    .getByRole("link", { name: "Return to the current portal" })
    .click();
  await page
    .getByRole("heading", { name: "Rainbow Portal #160", exact: true })
    .waitFor();
  const submitLinks = revealed.getByRole("link", {
    name: "Submit a monster",
    exact: true
  });
  countMode = "error";
  await page.evaluate(() => window.__refreshCounts());
  await revealed.getByRole("button", { name: "Retry card counts" }).waitFor();
  assert.equal(await submitLinks.count(), 0);
  countMode = "empty";
  await revealed.getByRole("button", { name: "Retry card counts" }).click();
  await revealed
    .getByText("No matching cards", { exact: true })
    .first()
    .waitFor();
  assert.equal(await submitLinks.count(), 0);
  await page.evaluate(() => window.__wallet(undefined));
  await revealed.getByText(/Connect your wallet/).waitFor();
  assert.equal(await submitLinks.count(), 0);
  countMode = "normal";
  await page.evaluate((value) => window.__wallet(value), owner);
  await page.evaluate(() => window.__refreshCounts());
  await revealed.getByText("3 matching cards", { exact: true }).waitFor();
  assert.equal(await submitLinks.count(), 1);
  status.revealedAdmissions = false;
  await page.evaluate(() => window.__refresh());
  await schedule.waitFor();
  await page.setViewportSize({ width: 1280, height: 1000 });
  status.rotation.upcoming.pop();
  status.rotation.refillCount = 1;
  status.rotation.canRequest = true;
  await page.evaluate(() => window.__refresh());
  await schedule.getByText("10 of 11 future windows revealed").waitFor();
  assert(
    await page
      .getByRole("button", { name: "Refill upcoming portals", exact: true })
      .isEnabled()
  );
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
  assert.equal(
    await dialog
      .getByRole("button", { name: "Choose Yuniair #7", exact: true })
      .count(),
    0
  );
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
  await dialog.getByRole("button", { name: "Close card picker" }).click();
  await schedule.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/portal-schedule-mobile.png" });
  await page.evaluate((value) => window.__wallet(value), other);
  await page.waitForFunction(
    () =>
      !document.querySelector("main").textContent.includes("3 matching cards")
  );
  await schedule
    .getByText("No matching cards", { exact: true })
    .first()
    .waitFor();
  await page.evaluate((value) => window.__wallet(value), owner);
  await schedule.getByText("3 matching cards", { exact: true }).waitFor();
  countMode = "error";
  await page.evaluate(() => window.__refreshCounts());
  await schedule.getByRole("button", { name: "Retry card counts" }).waitFor();
  assert.equal(
    await schedule.getByText("No matching cards", { exact: true }).count(),
    0
  );
  await schedule
    .getByText("Count unavailable", { exact: true })
    .first()
    .waitFor();
  countMode = "empty";
  await schedule.getByRole("button", { name: "Retry card counts" }).click();
  await schedule
    .getByText("No matching cards", { exact: true })
    .first()
    .waitFor();
  await page.evaluate(() => window.__wallet(undefined));
  await schedule
    .getByText(
      "Connect your wallet to see how many of your cards match each portal."
    )
    .waitFor();
  assert.equal(
    await schedule.getByText("No matching cards", { exact: true }).count(),
    0
  );
  status.rotation.upcoming = [];
  status.rotation.scheduled = null;
  status.rotation.refillCount = 12;
  await page.evaluate(() => window.__refresh());
  await schedule.getByText("0 of 11 future windows revealed").waitFor();
  await schedule
    .getByText("The next chapter is still a surprise.", { exact: false })
    .waitFor();
  progressCard.processing.acceptedAt = String(Math.floor(Date.now() / 1000));
  await page.goto(`${origin}__portal-progress`);
  const progress = page.getByRole("region", {
    name: "Your spell is in the portal"
  });
  await progress.waitFor();
  await progress.getByText(/Estimated 3–10 min remaining/).waitFor();
  for (const [stage, title] of [
    ["creating", "A little magic is taking shape"],
    ["grading", "Time for the finishing touches"],
    ["publishing", "Getting ready for the big reveal"]
  ]) {
    progressCard.processing.stage = stage;
    await page.evaluate(() => window.__refreshCard());
    await page.getByRole("heading", { name: title }).waitFor();
  }
  const finalProgress = page.getByRole("region", {
    name: "Getting ready for the big reveal"
  });
  progressCard.processing.estimate = {
    minSeconds: 120,
    maxSeconds: 240,
    sampleSize: 10
  };
  progressCard.processing.acceptedAt = String(
    Math.floor(Date.now() / 1000) - 300
  );
  await page.evaluate(() => window.__refreshCard());
  await finalProgress
    .getByText("Taking a little longer", { exact: true })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  );
  await finalProgress.screenshot({
    path: "/tmp/portal-spell-progress-mobile.png"
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await finalProgress
      .locator("img")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none"
  );
  progressCard.pending = "0";
  progressCard.publicationPending = true;
  progressCard.processing = null;
  await page.evaluate(() => window.__refreshCard());
  await finalProgress.waitFor();
  progressCard.publicationPending = false;
  await page.evaluate(() => window.__refreshCard());
  await finalProgress.waitFor({ state: "hidden" });
  await page
    .getByRole("heading", { name: "Original artwork", exact: true })
    .waitFor();
  const original = page.getByRole("img", {
    name: "Original artwork for card #508",
    exact: true
  });
  assert(await original.isVisible());
  progressCard.historyCount = "1";
  progressCard.history = [
    {
      id: "7",
      request: {
        submitter: owner,
        portalId: "160",
        kindId: "1",
        roundId: "2",
        acceptedAt: "1",
        artVersion: "0"
      },
      result: {
        artwork: progressCard.originalArtwork,
        scores: [87, 79, 69, 89],
        copied: false,
        reportURI: "fixture:report",
        spellURI: "fixture:spell",
        completedAt: "2"
      }
    }
  ];
  progressCard.publication = [
    {
      requestId: "7",
      spell: "Turn this pal into a rainbow guardian.",
      result: {
        slab: {
          ...progressCard.originalArtwork,
          version: "1",
          renderer: "fixture",
          manifest: progressCard.originalArtwork,
          rawArtworkHash: hash
        },
        gradingReason: "A colorful transformation."
      }
    }
  ];
  await page.evaluate(() => window.__refreshCard());
  await page.getByText("Latest transformation", { exact: true }).waitFor();
  await page.getByText("81.0", { exact: true }).waitFor();
  assert.equal(await original.isVisible(), false);
  const originalToggle = page
    .locator("summary")
    .filter({ hasText: "Original artwork" });
  await originalToggle.focus();
  await page.keyboard.press("Enter");
  assert(await original.isVisible());
  await page.keyboard.press("Enter");
  assert.equal(await original.isVisible(), false);
  await page.getByText("Spell and grading notes", { exact: true }).click();
  await page
    .getByText(progressCard.publication[0].spell, { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("link", { name: "View full-size card" })
      .getAttribute("href"),
    progressCard.originalArtwork.uri
  );
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: grading copy, eligibility, pagination, selection, review, keyboard focus, portal/wallet changes, retry, empty state and mobile layout"
  );
} finally {
  await browser?.close();
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
