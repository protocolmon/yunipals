// Real React components with local request/receipt fixtures; no chain or wallet.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import ts from "typescript";
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
    },
    output: {
      type: "string",
      default: "/tmp/yunipals-booster-opening-ui.json"
    },
    "components-only": { type: "boolean", default: false }
  }
});
const root = fileURLToPath(new URL("..", import.meta.url));
process.chdir(root);
const report = {
  format: "yunipals-booster-opening-component-ui-v1",
  observedAt: new Date().toISOString(),
  fixturesOnly: true,
  packVisualIncluded: !values["components-only"],
  providerCalls: 0,
  transactions: 0,
  signatures: 0,
  externalRequests: [],
  browserErrors: [],
  checks: []
};
const sourcePaths = [
  "src/pages/boosters/BoosterPackOpening.tsx",
  "src/pages/boosters/booster-pack-opening.css",
  "src/pages/boosters/BoosterTransactions.tsx",
  "src/pages/boosters/BoosterRequestOpening.tsx",
  "src/pages/boosters/BoosterClaimPacks.tsx",
  "src/lib/boosterReveal.ts",
  "src/pages/boosters/BoosterPackSection.tsx",
  "src/pages/collection/page.tsx",
  "src/components/Nav.tsx"
];
const sourceSha256 = Object.fromEntries(
  await Promise.all(
    sourcePaths.map(async (path) => [
      path,
      createHash("sha256")
        .update(await readFile(`${root}/${path}`))
        .digest("hex")
    ])
  )
);
report.sourceSha256 = sourceSha256;
const collectionPath = `${root}/src/pages/collection/page.tsx`;
const collectionText = await readFile(collectionPath, "utf8");
const collectionTree = ts.createSourceFile(
  collectionPath,
  collectionText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const rendered = new Set();
function inspect(node) {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
    rendered.add(node.tagName.getText(collectionTree));
  ts.forEachChild(node, inspect);
}
inspect(collectionTree);
assert(
  !rendered.has("BoosterPackSection"),
  "Home must not mount the purchase component, including hidden JSX"
);
assert(!/import\s.*BoosterPackSection/.test(collectionText));
assert(
  !rendered.has("BoosterCollection"),
  "Homepage must not mount a separate booster gallery"
);
assert(
  rendered.has("CollectionPackCard"),
  "Pack cards share the normal collection grid"
);
assert(
  collectionText.includes("useBoosterCollectionCards"),
  "Normal collection includes global pack pagination"
);
const navText = await readFile(`${root}/src/components/Nav.tsx`, "utf8");
assert(/<ScanSearch\b/.test(navText), "Grading uses the inspection icon");
assert(navText.includes("Grading is coming soon"));
assert(!navText.includes("Battles are coming soon"));
report.checks.push({
  name: "Homepage omits purchase/separate booster sections and integrates pack cards into normal collection; Grading uses ScanSearch",
  passed: true
});

const ids = {
  entry: "virtual:booster-opening-ui.tsx",
  boosters: "virtual:booster-opening-fixture.ts",
  wagmi: "virtual:booster-opening-wagmi.ts",
  action: "virtual:booster-opening-action.tsx"
};
const fixture = `
import {encodeEventTopics,encodeAbiParameters,parseAbiParameters} from 'viem';
import {boosterPacksAbi} from '@protopals/yunipals-market-core/boosterAbi';
export const owner='0xB3883Cd96d72B08b8226452305A28D65974a3727';
const registry='0x1111111111111111111111111111111111111111';
const engine='0x2222222222222222222222222222222222222222';
const monsters='0x3333333333333333333333333333333333333333';
const hash='0x'+'a'.repeat(64),zero='0x'+'0'.repeat(64);
export const scenario=()=>new URLSearchParams(location.search).get('scenario')||'revealed';
const fixturePack={id:'fixture-pack-2',packTypeId:'2',registry,engine,manifestUri:'ipfs://fixture-standard',totalVariants:264,mintsPerInterval:1,intervalSeconds:'86400',maxBatch:scenario()==='daily-ten'?32:7,paymentToken:'0xe5a54a517cde8ed48a336b173044b1138aa2c1a3',price:'1000000000000000000',salesPaused:false};
export const fixtureArtwork={name:'Fixture Yunidragon',image:'/__fixture-card.svg',attributes:{type:'Yunidragon',color:'Blue',horn:'Spiral',glitter:'No'},status:'ready',holo:null};
export const boosterQueryKey=['booster-opening-local-fixture'];
export const boosterAddresses=()=>({registry,engine,monsters});
export const visibleBoosterTypes=(rows)=>rows;
export const readBoosterTransactions=()=>scenario()==='empty'?[]:[{hash,kind:scenario()==='claim'?'claim':'open',cancelled:scenario()==='cancelled',submittedAt:1}];
export const readBoosterTransactionReceipt=(read)=>read();
export const fetchBoosterMonster=async(collection,tokenId)=>{(window.__openingMonsterFetches??=[]).push(tokenId);return{item:{tokenId,metadataUri:'fixture:'+tokenId,collection,isOriginal:tokenId==='7',owner}}};
export const fetchMonsterArtwork=async(uri)=>({...fixtureArtwork,name:uri?.startsWith('fixture:')?'Fixture Yunipal #'+uri.slice(8):fixtureArtwork.name});
export const fetchBoosterOwner=async()=>{const selected=scenario(),daily=selected.startsWith('daily-'),credits=selected==='daily-ten'?10:selected==='daily-zero'?0:3;return{items:daily?[{id:'8453:'+monsters+':7',tokenId:'7',collection:monsters,engine,owner:selected==='daily-foreign'?'0x9999999999999999999999999999999999999999':owner,revealedAt:String(1792740601-credits*86400),dailyCommitted:'0',minted:'1',remaining:'263',pendingRequest:null,burned:false,pack:fixturePack}]:[],nextCursor:null,requestsPaused:selected==='daily-paused'}};
export const fetchBoosterRequestMonsters=async()=>({items:(scenario()==='claim'?['17','41','99']:['7']).map(tokenId=>({tokenId,collection:monsters,requestKey:'8453:'+engine+':9',originalKey:'8453:'+monsters+':7',isOriginal:scenario()!=='claim',metadataUri:'fixture:'+tokenId}))});
export const fetchBoosterTypes=async()=>({requestsPaused:false,items:[fixturePack]});
export const client={
 async readContract({functionName}){
  if(functionName==='refundCredits')return 0n;
  if(functionName==='getRequest')return {originalId:7n,quantity:scenario()==='claim'?3:1,status:scenario()==='pending'?1:scenario()==='recovery'?2:3,opening:scenario()!=='non-opening'&&scenario()!=='claim'};
  throw Error('Unexpected local fixture read: '+functionName);
 },
 async getTransactionReceipt(){
  if(scenario()==='unconfirmed')return null;
  if(scenario()==='reverted')return {status:'reverted',logs:[]};
  const topics=encodeEventTopics({abi:boosterPacksAbi,eventName:'RequestCreated',args:{requestId:9n,originalId:7n,packTypeId:2n}});
  const data=encodeAbiParameters(parseAbiParameters('address,uint32,bool,uint256,bytes32,uint32'),[owner,scenario()==='claim'?3:1,scenario()!=='claim',10n**18n,zero,900000]);
  return {status:'success',logs:[{address:engine,topics,data}]};
 },
 async getBlock(){return{timestamp:1792740601n};}
};`;
const entry = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {BoosterPackOpening} from '/src/pages/boosters/BoosterPackOpening';
import {BoosterTransactions} from '/src/pages/boosters/BoosterTransactions';
import {BoosterPackSection} from '/src/pages/boosters/BoosterPackSection';
import {fixtureArtwork,boosterAddresses} from '${ids.boosters}';
import '/src/globals.css';
const query=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
function Harness(){
 const mode=new URLSearchParams(location.search).get('mode')||'opening';
 const [open,setOpen]=useState(false),[closed,setClosed]=useState(0);
 return <MemoryRouter><QueryClientProvider client={query}><main>
  {mode==='opening'||mode==='batch'?<><button onClick={()=>setOpen(true)}>Start local opening</button><output aria-label="Close count">{closed}</output>{open&&(mode==='batch'?<BoosterPackOpening collection={boosterAddresses().monsters} tokenId="7" additionalCards={[{collection:boosterAddresses().monsters,tokenId:'21'},{collection:boosterAddresses().monsters,tokenId:'99'}]} onClose={()=>{setOpen(false);setClosed(n=>n+1);}}/>:<BoosterPackOpening mode="demo" artwork={fixtureArtwork} onClose={()=>{setOpen(false);setClosed(n=>n+1);}}/>)}</>:mode==='pack'?<BoosterPackSection/>:<BoosterTransactions/>}
 </main></QueryClientProvider></MemoryRouter>;
}
createRoot(document.getElementById('root')).render(<Harness/>);`;
const modules = {
  [ids.entry]: entry,
  [ids.boosters]: fixture,
  [ids.wagmi]: `import {owner,client} from '${ids.boosters}';export const useAccount=()=>({address:owner,isConnected:true,chainId:8453});export const usePublicClient=()=>client;`,
  [ids.action]: `import React from 'react';export function BoosterActionButton({children,disabled,action}){return <button type="button" disabled={disabled} data-fixture-action={JSON.stringify(action)}>{children}</button>}`
};
const server = await createServer({
  root,
  configFile: false,
  server: { host: "127.0.0.1", port: 5198, strictPort: true },
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": `${root}/src`,
      "@protopals/yunipals-market-core": fileURLToPath(
        new URL("../../../packages/yunipals-market-core/src", import.meta.url)
      )
    }
  },
  plugins: [
    {
      name: "booster-opening-component-check",
      enforce: "pre",
      resolveId(id, importer) {
        if (Object.hasOwn(modules, id)) return "\0" + id;
        if (id === "wagmi") return "\0" + ids.wagmi;
        if (id === "@/lib/boosters" || id === `${root}/src/lib/boosters`)
          return "\0" + ids.boosters;
        if (
          id.endsWith("/BoosterActionButton") &&
          importer?.includes("/pages/boosters/")
        )
          return "\0" + ids.action;
      },
      load(id) {
        if (!id.startsWith("\0") || !Object.hasOwn(modules, id.slice(1)))
          return;
        return transformWithEsbuild(modules[id.slice(1)], id.slice(1), {
          loader: "tsx",
          jsx: "automatic"
        });
      },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (req.url === "/__fixture-card.svg") {
            res.setHeader("Content-Type", "image/svg+xml");
            return res.end(
              '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" rx="25" fill="#c4b5fd"/><text x="25" y="300" font-size="30">Fixture Yunidragon</text></svg>'
            );
          }
          if (req.url?.split("?")[0] !== "/__booster-opening-check")
            return next();
          const html = await vite.transformIndexHtml(
            req.url,
            `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/__x00__${ids.entry}"></script></body></html>`
          );
          res.setHeader("Content-Type", "text/html");
          res.end(html);
        });
      }
    }
  ]
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const { chromium } = await import(pathToFileURL(values.playwright).href);
const browser = await chromium.launch({
  executablePath: values.chromium,
  args: ["--no-sandbox"]
});
const context = await browser.newContext({
  viewport: { width: 1100, height: 1000 }
});
await context.route("**/*", (route) => {
  const request = route.request();
  if (request.url().startsWith(origin + "/") && request.method() === "GET")
    return route.continue();
  report.externalRequests.push({
    method: request.method(),
    type: request.resourceType()
  });
  return route.abort("blockedbyclient");
});
await context.routeWebSocket("**/*", (socket) => socket.close());
const page = await context.newPage();
page.setDefaultTimeout(12000);
page.on("pageerror", (error) => report.browserErrors.push(error.message));
const visit = (query) =>
  page.goto(`${origin}/__booster-opening-check?${query}`, {
    waitUntil: "networkidle"
  });
const dialog = () =>
  page.getByRole("dialog", { name: "Yunipals pack opening", exact: true });
const stage = () => page.locator("[data-stage]").first();
async function waitStage(value, target = page) {
  await target.waitForFunction(
    (value) =>
      document.querySelector("[data-stage]")?.getAttribute("data-stage") ===
      value,
    value
  );
}
async function drag(locator, dx, dy, cancel = false) {
  const box = await locator.boundingBox();
  assert(box);
  const x = box.x + box.width * 0.12,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  if (cancel)
    await locator.dispatchEvent("pointercancel", {
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true
    });
  await page.mouse.up();
}
async function run(name, fn) {
  await fn();
  assert.deepEqual(report.browserErrors, []);
  report.checks.push({ name, passed: true });
}
async function extractionGeometry(target = page) {
  return target.evaluate(() => {
    const card = document.querySelector(
      ".yunipals-opening-extract-card .tilt-card"
    );
    const front = document.querySelector(".yunipals-opening-body");
    const window = document.querySelector(".yunipals-opening-extract-window");
    const controls = document.querySelector(
      ".yunipals-opening-extract-controls"
    );
    const rectangle = card.getBoundingClientRect();
    const body = front.getBoundingClientRect();
    // The highest torn edge in the actual wrapper geometry is at 8.3%.
    const mouth = body.top + body.height * 0.083;
    const changed = [];
    const pointer = (element, value) => {
      changed.push([element, element.getAttribute("style")]);
      element.style.pointerEvents = value;
    };
    // Probe the browser's actual clipping/paint hit-test tree, without letting
    // transparent gesture buttons or pointer-events:none hide a layering bug.
    for (const element of [card, ...card.querySelectorAll("*")])
      pointer(element, "auto");
    // The wrapper div itself has no painted surface above the torn edge.
    pointer(front.parentElement, "none");
    pointer(front, "auto");
    for (const element of controls?.querySelectorAll("button") ?? [])
      pointer(element, "none");
    const onCard = (x, y) => card.contains(document.elementFromPoint(x, y));
    const below = Math.min(rectangle.bottom - 1, mouth + 12);
    const result = {
      cardTop: rectangle.top,
      cardBottom: rectangle.bottom,
      cardHeight: rectangle.height,
      mouth,
      visibleFraction: Math.max(
        0,
        Math.min(1, (mouth - rectangle.top) / rectangle.height)
      ),
      visibleTopOnCard: onCard(
        rectangle.left + rectangle.width / 2,
        rectangle.top +
          Math.min(
            rectangle.height * 0.05,
            Math.max(1, (mouth - rectangle.top) * 0.5)
          )
      ),
      belowMouthCardInHitStack:
        rectangle.bottom > mouth &&
        [rectangle.left + 1, rectangle.left + rectangle.width / 2].some((x) =>
          document
            .elementsFromPoint(x, below)
            .some((element) => card.contains(element))
        ),
      frontLayer: Number(getComputedStyle(front.parentElement).zIndex),
      cardLayer: Number(getComputedStyle(window).zIndex)
    };
    for (const [element, style] of changed.reverse()) {
      if (style === null) element.removeAttribute("style");
      else element.setAttribute("style", style);
    }
    return result;
  });
}
try {
  if (!values["components-only"])
    await run(
      "Real pack offer uses decoded portrait artwork, correct price/rules and demo entry",
      async () => {
        await visit("mode=pack&scenario=empty");
        const offer = page.locator("#booster-packs article").first();
        await offer.waitFor();
        const art = offer.locator(
          'img[src="/images/boosters/yunipals-pack-v1.png"]'
        );
        await art.evaluate((image) => image.decode());
        assert(
          await art.evaluate(
            (image) =>
              image.naturalHeight > image.naturalWidth &&
              image.naturalWidth >= 400
          )
        );
        assert((await offer.innerText()).includes("264"));
        assert((await offer.innerText()).includes("1 PROTO"));
        await page
          .getByRole("heading", { name: "Unwrap a little magic.", exact: true })
          .waitFor();
        await offer
          .getByRole("heading", { name: "Yunipals booster pack", exact: true })
          .waitFor();
        await offer
          .getByRole("button", { name: "Open pack", exact: true })
          .waitFor();
        await page.setViewportSize({ width: 390, height: 844 });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1
          ),
          "Portrait offer fits mobile width"
        );
        report.packScreenshot =
          "/tmp/yunipals-booster-pack-offer-mobile-20261022.png";
        await page.screenshot({ path: report.packScreenshot, fullPage: true });
        await page
          .getByRole("button", { name: "Try the opening", exact: true })
          .first()
          .click();
        await dialog().waitFor();
        await page
          .getByText("Demo preview — no NFT is minted.", { exact: true })
          .waitFor();
        await page.keyboard.press("Escape");
        assert.equal(await dialog().count(), 0);
        await page.setViewportSize({ width: 1100, height: 1000 });
      }
    );
  await run(
    "Three accrued credits make one daily pack with an exact quantity-three claim",
    async () => {
      await visit("mode=pack&scenario=daily-three");
      const packs = page.locator("#daily-packs");
      const claim = packs.getByRole("button", {
        name: "Open daily pack · 3 pulls",
        exact: true
      });
      await claim.waitFor();
      await page.waitForFunction(
        () =>
          !document.querySelector(
            '#daily-packs button[data-fixture-action*="claim"]'
          )?.disabled
      );
      assert.equal(await packs.locator("article").count(), 1);
      assert.deepEqual(
        JSON.parse(await claim.getAttribute("data-fixture-action")),
        { kind: "claim", packTypeId: "2", originalId: "7", quantity: 3 }
      );
    }
  );
  await run(
    "Ten accrued credits cap one daily pack at seven and preserve three saved pulls",
    async () => {
      await visit("mode=pack&scenario=daily-ten");
      const packs = page.locator("#daily-packs");
      const claim = packs.getByRole("button", {
        name: "Open daily pack · 7 pulls",
        exact: true
      });
      await claim.waitFor();
      await page.waitForFunction(
        () =>
          !document.querySelector(
            '#daily-packs button[data-fixture-action*="claim"]'
          )?.disabled
      );
      assert.equal(await packs.locator("article").count(), 1);
      assert.equal(
        JSON.parse(await claim.getAttribute("data-fixture-action")).quantity,
        7
      );
      await packs
        .getByText("3 more saved pulls stay available for your next pack.", {
          exact: true
        })
        .waitFor();
    }
  );
  await run(
    "Zero credits, a paused source and a foreign owner never enable a daily claim",
    async () => {
      await visit("mode=pack&scenario=daily-zero");
      await page
        .getByRole("heading", {
          name: "Your next pack is growing",
          exact: true
        })
        .waitFor();
      assert.equal(
        await page
          .locator(
            '#daily-packs button[data-fixture-action*="claim"]:not(:disabled)'
          )
          .count(),
        0
      );
      await visit("mode=pack&scenario=daily-paused");
      const paused = page
        .locator("#daily-packs")
        .getByRole("button", { name: "Claims paused", exact: true });
      await paused.waitFor();
      assert(await paused.isDisabled());
      await visit("mode=pack&scenario=daily-foreign");
      await page
        .getByRole("heading", { name: "Yunipals booster pack", exact: true })
        .waitFor();
      await page
        .locator("#daily-packs [role=status]")
        .waitFor({ state: "hidden" });
      assert.equal(await page.locator("#daily-packs").count(), 0);
    }
  );
  await run(
    "Card stays behind the opaque wrapper and emerges through its moving mouth; cancelled draw retracts",
    async () => {
      await visit("mode=opening");
      await page.getByRole("button", { name: "Start local opening" }).click();
      await page.getByRole("button", { name: "Rip pack seal" }).focus();
      await page.keyboard.press("Enter");
      await waitStage("opening");
      assert.equal(
        await page
          .locator(".yunipals-opening-extract-window")
          .evaluate((element) => getComputedStyle(element).visibility),
        "hidden",
        "No card face is exposed during the tear"
      );
      await waitStage("extracting");
      const peek = page.locator(".yunipals-opening-card-peek");
      const seek = (time) =>
        peek.evaluate((element, time) => {
          const animation = element
            .getAnimations()
            .find((value) => value.animationName === "yunipals-card-peek");
          animation.pause();
          animation.currentTime = time;
          return animation.effect.getTiming();
        }, time);
      const timing = await seek(0);
      assert.equal(timing.duration, 900);
      assert.equal(timing.iterations, 1);
      const closed = await extractionGeometry();
      assert.equal(closed.visibleFraction, 0);
      assert.equal(closed.belowMouthCardInHitStack, false);
      await seek(450);
      const halfPeek = await extractionGeometry();
      await seek(900);
      const smallPeek = await extractionGeometry();
      assert(halfPeek.visibleFraction > 0);
      assert(smallPeek.visibleFraction > halfPeek.visibleFraction);
      assert(smallPeek.visibleFraction < 0.08);
      assert(smallPeek.frontLayer > smallPeek.cardLayer);
      assert(smallPeek.visibleTopOnCard);
      assert.equal(smallPeek.belowMouthCardInHitStack, false);
      await page.screenshot({
        path: "/tmp/yunipals-extraction-peek-desktop-20261023.png"
      });
      const grab = page.getByRole("button", { name: "Pull card upward" });
      const box = await grab.boundingBox();
      const x = box.x + box.width / 2,
        y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y - 140, { steps: 14 });
      assert(await grab.evaluate((element) => element.hasPointerCapture(1)));
      const partial = await extractionGeometry();
      report.extractionGeometry = { closed, halfPeek, smallPeek, partial };
      assert(partial.visibleFraction > 0.25 && partial.visibleFraction < 0.8);
      assert(partial.visibleTopOnCard);
      assert.equal(partial.belowMouthCardInHitStack, false);
      await page.screenshot({
        path: "/tmp/yunipals-extraction-desktop-20261023.png"
      });
      // Missing pointercancel coordinates must not jump to a fully drawn card.
      await grab.dispatchEvent("pointercancel", {
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true
      });
      assert(
        (await extractionGeometry()).visibleFraction <=
          partial.visibleFraction + 0.03
      );
      await page.mouse.up();
      await page.waitForTimeout(750);
      assert.equal(await stage().getAttribute("data-stage"), "extracting");
      const returned = await extractionGeometry();
      assert(
        Math.abs(returned.visibleFraction - smallPeek.visibleFraction) < 0.015
      );
      assert.equal(returned.belowMouthCardInHitStack, false);
      report.extractionGeometry = {
        closed,
        halfPeek,
        smallPeek,
        partial,
        returned
      };
      await page.keyboard.press("Escape");
    }
  );
  await run(
    "Mobile touch pulls the wrapper down with real pointer capture, cancels safely and fully clears the card on completion",
    async () => {
      const mobileContext = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true
      });
      await mobileContext.route("**/*", (route) => {
        const request = route.request();
        if (
          request.url().startsWith(origin + "/") &&
          request.method() === "GET"
        )
          return route.continue();
        report.externalRequests.push({
          method: request.method(),
          type: request.resourceType()
        });
        return route.abort("blockedbyclient");
      });
      await mobileContext.routeWebSocket("**/*", (socket) => socket.close());
      const mobile = await mobileContext.newPage();
      mobile.on("pageerror", (error) =>
        report.browserErrors.push(error.message)
      );
      await mobile.goto(`${origin}/__booster-opening-check?mode=opening`, {
        waitUntil: "networkidle"
      });
      await mobile.getByRole("button", { name: "Start local opening" }).click();
      await mobile
        .getByRole("button", { name: "Rip open", exact: true })
        .click();
      await waitStage("extracting", mobile);
      await mobile.waitForTimeout(950);
      const smallPeek = await extractionGeometry(mobile);
      assert(smallPeek.visibleFraction > 0 && smallPeek.visibleFraction < 0.08);
      const grab = mobile.getByRole("button", { name: "Pull pack downward" });
      const cdp = await mobileContext.newCDPSession(mobile);
      const touch = (type, x, y) =>
        cdp.send("Input.dispatchTouchEvent", {
          type,
          touchPoints: x === undefined ? [] : [{ x, y, id: 7 }]
        });
      const pull = async (amount) => {
        const box = await grab.boundingBox();
        const x = box.x + box.width / 2,
          y = box.y + box.height * 0.3;
        await touch("touchStart", x, y);
        for (let step = 1; step <= 12; step++)
          await touch("touchMove", x, y + (amount * step) / 12);
      };
      await pull(125);
      assert(await grab.evaluate((element) => element.hasPointerCapture(2)));
      const partial = await extractionGeometry(mobile);
      assert(partial.visibleFraction > 0.25 && partial.visibleFraction < 0.8);
      assert(partial.visibleTopOnCard);
      assert.equal(partial.belowMouthCardInHitStack, false);
      await mobile.screenshot({
        path: "/tmp/yunipals-extraction-mobile-20261023.png"
      });
      await touch("touchCancel");
      await mobile.waitForTimeout(750);
      const returned = await extractionGeometry(mobile);
      assert(
        Math.abs(returned.visibleFraction - smallPeek.visibleFraction) < 0.015
      );
      assert.equal(
        await mobile.locator("[data-stage]").first().getAttribute("data-stage"),
        "extracting"
      );
      await pull(280);
      await touch("touchEnd");
      await mobile.waitForTimeout(240);
      const completed = await extractionGeometry(mobile);
      assert.equal(completed.visibleFraction, 1);
      assert(completed.cardBottom <= completed.mouth);
      await waitStage("revealing", mobile);
      assert(
        await mobile.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      );
      report.mobileExtractionGeometry = {
        smallPeek,
        partial,
        returned,
        completed
      };
      await mobileContext.close();
    }
  );
  await run(
    "Ready demo uses actual strip drag; short/cancelled gestures never reveal",
    async () => {
      await visit("mode=opening");
      await page
        .getByRole("button", { name: "Start local opening", exact: true })
        .click();
      await dialog().waitFor();
      const rip = page.getByRole("button", {
        name: "Rip pack seal",
        exact: true
      });
      const box = await rip.boundingBox();
      await drag(rip, box.width * 0.12, 0);
      assert.equal(await stage().getAttribute("data-stage"), "sealed");
      await drag(rip, box.width * 0.25, 0, true);
      assert.equal(await stage().getAttribute("data-stage"), "sealed");
      await drag(rip, box.width * 0.9, 0);
      await waitStage("extracting");
      assert.equal(
        await page
          .getByRole("button", { name: "Replay opening", exact: true })
          .count(),
        0
      );
      await drag(
        page.getByRole("button", { name: "Pull card upward", exact: true }),
        0,
        -320
      );
      await waitStage("revealing");
      await drag(
        page.getByRole("button", { name: "Reveal card", exact: true }),
        300,
        0
      );
      await waitStage("results");
      await page
        .getByRole("button", { name: "Replay opening", exact: true })
        .click();
      await waitStage("sealed");
      await page.keyboard.press("Escape");
      assert.equal(await dialog().count(), 0);
    }
  );
  await run(
    "Keyboard and reduced motion complete the same steps without looping animations",
    async () => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await visit("mode=opening");
      await page
        .getByRole("button", { name: "Start local opening", exact: true })
        .click();
      const rip = page.getByRole("button", {
        name: "Rip pack seal",
        exact: true
      });
      await rip.focus();
      await page.keyboard.press("Enter");
      await waitStage("extracting");
      await page
        .getByRole("button", { name: "Pull pack downward", exact: true })
        .focus();
      await page.keyboard.press("Space");
      await waitStage("revealing");
      await page
        .getByRole("button", { name: "Reveal card", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await waitStage("results");
      assert.equal(
        await dialog().evaluate(
          (element) =>
            element
              .getAnimations({ subtree: true })
              .filter(
                (animation) =>
                  animation.effect?.getTiming().iterations === Infinity
              ).length
        ),
        0
      );
      await page
        .getByRole("button", { name: "Close pack opening", exact: true })
        .click();
      assert.equal(await page.getByLabel("Close count").innerText(), "1");
      await page.emulateMedia({ reducedMotion: "no-preference" });
    }
  );
  await run(
    "Real transaction component never offers an opening for cancelled, failed, VRF-pending, recovery or mismatched requests",
    async () => {
      for (const [scenario, status] of [
        ["cancelled", "Cancelled"],
        ["unconfirmed", "Waiting for confirmation"],
        ["reverted", "Transaction reverted"],
        ["pending", "Awaiting randomness"],
        ["recovery", "Ready for recovery"],
        ["non-opening", "Revealed"]
      ]) {
        await visit(`mode=transactions&scenario=${scenario}`);
        await page.getByText(status, { exact: true }).waitFor();
        assert.equal(
          await page
            .getByRole("button", { name: "Reveal Yunipal", exact: true })
            .count(),
          0,
          scenario
        );
        assert.equal(await dialog().count(), 0, scenario);
      }
    }
  );
  await run(
    "One torn pack pulls nonsequential NFT identities in order without another tear or mint",
    async () => {
      await visit("mode=batch");
      await page.getByRole("button", { name: "Start local opening" }).click();
      await page.getByRole("button", { name: "Rip pack seal" }).focus();
      await page.keyboard.press("Enter");
      for (const [index, tokenId] of ["7", "21", "99"].entries()) {
        await waitStage("extracting");
        await page
          .getByText(`Card ${index + 1} of 3`, { exact: true })
          .waitFor();
        assert.equal(
          await page.getByRole("button", { name: "Rip pack seal" }).count(),
          0
        );
        await page.getByRole("button", { name: "Pull card upward" }).focus();
        await page.keyboard.press("Enter");
        await waitStage("revealing");
        await page.getByRole("button", { name: "Reveal card" }).focus();
        await page.keyboard.press("Enter");
        await waitStage("results");
        await page
          .getByRole("heading", {
            name: `Fixture Yunipal #${tokenId}`,
            exact: true
          })
          .waitFor();
        const link = page.getByRole("link", {
          name: `View Yunipal #${tokenId}`,
          exact: true
        });
        assert((await link.getAttribute("href")).endsWith("/" + tokenId));
        if (index < 2)
          await page
            .getByRole("button", { name: "Pull next card", exact: true })
            .click();
      }
      assert.deepEqual(
        await page.evaluate(() => window.__openingMonsterFetches),
        ["7", "21", "99"]
      );
      await page
        .getByRole("link", { name: "View collection", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "Done", exact: true }).click();
      assert.equal(await dialog().count(), 0);
    }
  );
  await run(
    "A confirmed daily request opens only its three verified request cards",
    async () => {
      await visit("mode=transactions&scenario=claim");
      const open = page.getByRole("button", {
        name: "Open daily pack · 3 pulls",
        exact: true
      });
      await open.waitFor();
      assert.equal(await dialog().count(), 0);
      await open.click();
      await dialog().waitFor();
      await page.getByText("Card 1 of 3", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Rip pack seal" }).focus();
      await page.keyboard.press("Enter");
      await waitStage("extracting");
      await page.getByRole("button", { name: "Pull card upward" }).focus();
      await page.keyboard.press("Enter");
      await waitStage("revealing");
      await page.getByRole("button", { name: "Reveal card" }).focus();
      await page.keyboard.press("Enter");
      await waitStage("results");
      await page
        .getByRole("heading", { name: "Fixture Yunipal #17", exact: true })
        .waitFor();
      await page.keyboard.press("Escape");
    }
  );
  await run(
    "Only confirmed onchain opening+Revealed can explicitly launch the genuine NFT opening",
    async () => {
      await visit("mode=transactions&scenario=revealed");
      const reveal = page.getByRole("button", {
        name: "Reveal Yunipal",
        exact: true
      });
      await reveal.waitFor();
      assert.equal(
        await dialog().count(),
        0,
        "Do not auto-play an opening on a poll"
      );
      await reveal.click();
      await dialog().waitFor();
      await waitStage("sealed");
      assert.equal(
        await page
          .getByText("Demo preview — no NFT is minted.", { exact: true })
          .count(),
        0
      );
      await page
        .getByRole("button", { name: "Rip pack seal", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await waitStage("extracting");
      await page
        .getByRole("button", { name: "Pull card upward", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await waitStage("revealing");
      await page
        .getByRole("button", { name: "Reveal card", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await waitStage("results");
      await page
        .getByRole("link", { name: /View.*Yunipal|View.*collection/i })
        .first()
        .waitFor();
      await page.keyboard.press("Escape");
    }
  );
  assert.deepEqual(
    report.externalRequests,
    [],
    "Component harness never calls a remote API/provider"
  );
  for (const path of sourcePaths)
    assert.equal(
      createHash("sha256")
        .update(await readFile(`${root}/${path}`))
        .digest("hex"),
      sourceSha256[path],
      `Source changed during browser check: ${path}`
    );
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = String(error.stack ?? error);
} finally {
  report.completedAt = new Date().toISOString();
  await writeFile(values.output, JSON.stringify(report, null, 2) + "\n");
  await browser.close();
  await server.close();
}
console.log(
  JSON.stringify({
    output: values.output,
    passed: report.passed,
    checks: report.checks,
    failure: report.failure
  })
);
if (!report.passed) process.exitCode = 1;
