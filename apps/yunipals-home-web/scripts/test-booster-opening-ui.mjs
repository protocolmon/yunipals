// Real React components with local request/receipt fixtures; no chain or wallet.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    "components-only": { type: "boolean", default: false },
    "layout-only": { type: "boolean", default: false },
    "claims-only": { type: "boolean", default: false },
    port: { type: "string", default: "5198" }
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
  "src/pages/boosters/BoosterOpeningShare.tsx",
  "src/pages/boosters/BoosterClaimPacks.tsx",
  "src/pages/boosters/BoosterOriginalThumbnail.tsx",
  "src/pages/boosters/BoosterOriginalControls.tsx",
  "src/components/ui/select.tsx",
  "src/components/YunipalsLoader.tsx",
  "src/globals.css",
  "src/lib/boosterReveal.ts",
  "src/lib/boosters.ts",
  "src/pages/boosters/BoosterPackSection.tsx",
  "src/pages/collection/page.tsx",
  "src/components/Nav.tsx",
  "scripts/test-booster-opening-ui.mjs"
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
import {encodeEventTopics,encodeAbiParameters,encodeFunctionData,parseAbiParameters} from 'viem';
import {boosterPacksAbi} from '@protopals/yunipals-market-core/boosterAbi';
import {boosterPurchaseAbi} from '/src/lib/boosterPurchase';
import {readBoosterTransactions as readStored,saveBoosterTransaction,visibleBoosterTypes as actualVisibleBoosterTypes} from '/src/lib/boosters.ts';
export const owner='0xB3883Cd96d72B08b8226452305A28D65974a3727';
const registry='0x1111111111111111111111111111111111111111';
const engine='0x2222222222222222222222222222222222222222';
const monsters='0x3333333333333333333333333333333333333333';
const hash='0x'+'a'.repeat(64),zero='0x'+'0'.repeat(64),blockHash='0x'+'b'.repeat(64);
export const scenario=()=>new URLSearchParams(location.search).get('scenario')||(location.pathname==='/boosters'?sessionStorage.getItem('fixture-opening-scenario'):null)||'revealed';
const multi=()=>scenario().startsWith('multi')||scenario()==='submission';
const requestIds=()=>multi()?['9','250','31']:['9'];
const originalId=(id)=>multi()?({'9':'7','250':'21','31':'99'}[id]):'7';
const fulfilled=()=>window.__completeMulti||sessionStorage.getItem('fixture-multi-fulfilled')==='yes';
const fixturePack={id:'fixture-pack-2',packTypeId:'2',registry,engine,manifestUri:'ipfs://fixture-standard',totalVariants:264,mintsPerInterval:1,intervalSeconds:'86400',maxBatch:scenario()==='daily-ten'?32:7,paymentToken:'0xe5a54a517cde8ed48a336b173044b1138aa2c1a3',price:'1000000000000000000',salesPaused:false};
export const fixtureArtwork={name:'Fixture Yunidragon',image:'/__fixture-card.svg',attributes:{type:'Yunidragon',color:'Blue',horn:'Spiral',glitter:'No'},status:'ready',holo:null};
export const boosterQueryKey=['booster-opening-local-fixture'];
export const boosterAddresses=()=>({registry,engine,monsters});
export const visibleBoosterTypes=actualVisibleBoosterTypes;
const fixtureStorageKey='yunipals/boosters/v1/8453/'+engine+'/'+owner.toLowerCase();
if(sessionStorage.getItem('fixture-opening-scenario')!==scenario()){
 localStorage.removeItem(fixtureStorageKey);sessionStorage.removeItem('fixture-multi-fulfilled');
 sessionStorage.setItem('fixture-opening-scenario',scenario());
}
if(scenario()!=='empty'&&!readStored(owner,engine).length)saveBoosterTransaction(owner,engine,{
 hash,kind:scenario()==='claim'?'claim':'open',cancelled:scenario()==='cancelled',
 ...(multi()&&scenario()!=='multi-legacy'?{expectedRequestCount:3,packTypeId:'2',quantity:1}:{}),
 ...(scenario()==='claim'?{expectedRequestCount:1,packTypeId:'2',quantity:3,originalId:'7'}:{})
});
export const readBoosterTransactions=()=>readStored(owner,engine);
export const readBoosterTransactionReceipt=(read)=>read();
export const fetchBoosterMonster=async(collection,tokenId)=>{(window.__openingMonsterFetches??=[]).push(tokenId);return{item:{tokenId,metadataUri:'fixture:'+tokenId,collection,isOriginal:tokenId==='7',owner}}};
export const fetchMonsterArtwork=async(uri)=>({...fixtureArtwork,...(scenario().startsWith('daily-')?{image:'/__fixture-card.svg?original='+uri?.slice(8)}:{}),name:uri?.startsWith('fixture:')?'Fixture Yunipal #'+uri.slice(8):fixtureArtwork.name,...(scenario()==='artwork-queued'&&!window.__artworkReady?{status:'queued',image:null}:{}),...(scenario()==='artwork-queued'&&window.__artworkReady?{status:'ready'}:{})});
const fixtureOriginal=(tokenId)=>({id:'8453:'+monsters+':'+tokenId,tokenId,collection:monsters,engine,owner:scenario()==='daily-foreign'||tokenId==='999'?'0x9999999999999999999999999999999999999999':owner,revealedAt:String(1792740601-(tokenId==='21'||tokenId==='800'?5:scenario()==='daily-ten'?10:scenario()==='daily-zero'?0:3)*86400),dailyCommitted:'0',minted:'1',remaining:'263',pendingRequest:null,burned:false,pack:fixturePack});
export const fetchBoosterOriginal=async(_collection,tokenId)=>({item:fixtureOriginal(tokenId)});
export const fetchBoosterRequest=async()=>({item:{status:'completed'}});
export const fetchBoosterOwner=async()=>({items:scenario().startsWith('daily-')?(scenario()==='daily-grouped'?['7','21','99']:['7']).map(fixtureOriginal):[],nextCursor:null,requestsPaused:scenario()==='daily-paused'});
export const fetchBoosterRequestMonsters=async(_engine,id)=>{(window.__openingRequestCardFetches??=[]).push(id);return{items:scenario()==='multi-incomplete'&&!fulfilled()&&id==='31'?[]:(scenario()==='claim'?['17','41','99']:[originalId(id)]).map(tokenId=>({id:'8453:'+monsters+':'+tokenId,tokenId,collection:monsters,requestKey:'8453:'+engine+':'+id,originalKey:'8453:'+monsters+':'+originalId(id),typeKey:'8453:'+registry+':2',isOriginal:scenario()!=='claim',metadataUri:'fixture:'+tokenId,owner:id==='31'?engine:owner,mintedTo:owner,burned:id==='250'}))};};
export const fetchBoosterTypes=async()=>({requestsPaused:false,items:[{...fixturePack,id:"fixture-smoke-1",packTypeId:"1",manifestUri:"https://api.example.invalid/boosters/base-mainnet-smoke-v1/manifest.json"},fixturePack]});
export const client={
 async readContract({functionName,args}){
  if(functionName==='refundCredits')return 0n;
  if(functionName==='MAX_OPEN_PACKS')return 10;
  if(functionName==='getRequest'){
   if(window.__deferRequestStates)await new Promise(resolve=>{(window.__releaseRequestStates??=[]).push(resolve);});
   const id=String(args[0]);let status=scenario()==='pending'?1:scenario()==='recovery'?2:3;
   if(scenario()==='multi-pending'&&!fulfilled()&&id!=='9')status=1;
   if(scenario()==='submission'&&!fulfilled())status=1;
   if(scenario()==='multi-recovery'&&!fulfilled()&&id==='250')status=2;
   if(scenario()==='multi-forfeit'&&id==='31')status=4;
   return {originalId:BigInt(originalId(id)),quantity:scenario()==='claim'?3:1,status,opening:scenario()!=='non-opening'&&scenario()!=='claim',payer:owner,paid:10n**18n,ruleHash:zero};
  }
  throw Error('Unexpected local fixture read: '+functionName);
 },
 async getTransactionReceipt(){
  if(scenario()==='unconfirmed'||(scenario()==='submission'&&!window.__receiptConfirmed))return null;
  if(scenario()==='reverted')return {status:'reverted',transactionHash:hash,blockHash,blockNumber:1234n,logs:[]};
  let ids=requestIds();if(scenario()==='multi-missing')ids=ids.slice(0,2);if(scenario()==='multi-duplicate')ids=['9','9','31'];
  const logs=ids.map((id,index)=>({address:engine,blockHash,blockNumber:1234n,transactionHash:hash,transactionIndex:0,logIndex:10+index,removed:false,
   topics:encodeEventTopics({abi:boosterPacksAbi,eventName:'RequestCreated',args:{requestId:BigInt(id),originalId:BigInt(originalId(id)),packTypeId:2n}}),
   data:encodeAbiParameters(parseAbiParameters('address,uint32,bool,uint256,bytes32,uint32'),[owner,scenario()==='claim'?3:1,scenario()!=='claim',10n**18n,zero,900000])}));
  return {status:'success',transactionHash:hash,blockHash,blockNumber:1234n,logs};
 },
 async getTransaction(){return{hash,to:scenario()==='multi-foreign-engine'?registry:engine,input:scenario()==='claim'?encodeFunctionData({abi:boosterPacksAbi,functionName:'claim',args:[7n,3,10n**18n,9999999999n]}):multi()?encodeFunctionData({abi:boosterPurchaseAbi,functionName:'openPacks',args:[2n,scenario()==='multi-wrong-count'?4:3,10n**18n,9999999999n]}):encodeFunctionData({abi:boosterPacksAbi,functionName:'openPack',args:[2n,10n**18n,9999999999n]})};},
 async getStorageAt(){return '0x'+'0'.repeat(24)+'92e2351a83b6c445c94d0b887259d2b940c82a5a';},
 async getBlock(){return{timestamp:1792740601n};}
};`;
const entry = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {BoosterPackOpening} from '/src/pages/boosters/BoosterPackOpening';
import {BoosterTransactions} from '/src/pages/boosters/BoosterTransactions';
import {BoosterPackSection} from '/src/pages/boosters/BoosterPackSection';
import {BoosterOriginalControls} from '/src/pages/boosters/BoosterOriginalControls';
import {fixtureArtwork,boosterAddresses,fetchBoosterOriginal} from '${ids.boosters}';
import '/src/globals.css';
const query=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
window.__refreshBoosters=()=>query.invalidateQueries();
function OriginalDetailFixture(){
 const [original,setOriginal]=useState(null);
 React.useEffect(()=>{fetchBoosterOriginal(boosterAddresses().monsters,'21').then(response=>setOriginal(response.item));},[]);
 return original?<BoosterOriginalControls original={original}/>:null;
}
function Harness(){
 const mode=new URLSearchParams(location.search).get('mode')||(new URLSearchParams(location.search).has('opening')?'transactions':'opening');
 const [open,setOpen]=useState(false),[closed,setClosed]=useState(0);
 const [submitted,setSubmitted]=useState(mode==='submitted'?'0x'+'a'.repeat(64):null);
 return <MemoryRouter initialEntries={[location.pathname+location.search]}><QueryClientProvider client={query}><main>
  {mode==='opening'||mode==='batch'?<><button onClick={()=>setOpen(true)}>Start local opening</button><output aria-label="Close count">{closed}</output>{open&&(mode==='batch'?<BoosterPackOpening collection={boosterAddresses().monsters} tokenId="7" additionalCards={[{collection:boosterAddresses().monsters,tokenId:'21'},{collection:boosterAddresses().monsters,tokenId:'99'}]} onClose={()=>{setOpen(false);setClosed(n=>n+1);}}/>:<BoosterPackOpening mode="demo" artwork={fixtureArtwork} onClose={()=>{setOpen(false);setClosed(n=>n+1);}}/>)}</>:mode==='pack'?<BoosterPackSection/>:mode==='detail'?<Routes><Route path="/boosters" element={<BoosterPackSection/>}/><Route path="*" element={<OriginalDetailFixture/>}/></Routes>:<BoosterTransactions autoOpenHash={submitted} onOpeningClosed={()=>setSubmitted(null)}/>}
 </main></QueryClientProvider></MemoryRouter>;
}
createRoot(document.getElementById('root')).render(<Harness/>);`;
const modules = {
  [ids.entry]: entry,
  [ids.boosters]: fixture,
  [ids.wagmi]: `import {owner,client,scenario} from '${ids.boosters}';export const useAccount=()=>({address:scenario().startsWith('multi-replay')||scenario()==='multi-foreign-engine'?undefined:scenario()==='offer-public'?'0x9999999999999999999999999999999999999999':owner,isConnected:!scenario().startsWith('multi-replay'),chainId:8453});export const usePublicClient=()=>client;`,
  [ids.action]: `import React from 'react';export function BoosterActionButton({children,disabled,action}){return <button type="button" disabled={disabled} data-fixture-action={JSON.stringify(action)} onClick={()=>{if(action?.kind==='recover'){window.__completeMulti=true;sessionStorage.setItem('fixture-multi-fulfilled','yes');window.__refreshBoosters?.();}}}>{children}</button>}`
};
const cacheDir = await mkdtemp(join(tmpdir(), "yunipals-opening-vite-"));
const server = await createServer({
  cacheDir,
  root,
  configFile: false,
  server: {
    host: "127.0.0.1",
    port: Number(values.port),
    strictPort: true,
    hmr: false
  },
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
          if (req.url?.split("?")[0] === "/__fixture-card.svg") {
            res.setHeader("Content-Type", "image/svg+xml");
            return res.end(
              '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" rx="25" fill="#c4b5fd"/><text x="25" y="300" font-size="30">Fixture Yunidragon</text></svg>'
            );
          }
          if (
            !["/__booster-opening-check", "/boosters"].includes(
              req.url?.split("?")[0]
            )
          )
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
    waitUntil: "load",
    timeout: 45000
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
  if (values["layout-only"] && !name.startsWith("Responsive")) return;
  if (
    values["claims-only"] &&
    !/daily pack|daily claim|original's daily pack|Linked original/i.test(name)
  )
    return;
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
async function protectedLayout(target = page) {
  if (
    (await target
      .locator("[data-stage]")
      .first()
      .getAttribute("data-stage")) === "results"
  ) {
    await target.waitForFunction(
      () =>
        document.activeElement?.getAttribute("data-stage-action") === "results"
    );
  }
  const geometry = await target.evaluate(() => {
    const header = document.querySelector(".yunipals-opening-header");
    const instructions = document.querySelector(
      ".yunipals-opening-instructions"
    );
    const scene = document.querySelector(".yunipals-opening-viewport");
    const card = document.querySelector(
      ".yunipals-opening-extract-card .tilt-card, .yunipals-opening-result .tilt-card"
    );
    const rect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return {
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        left: value.left,
        width: value.width,
        height: value.height
      };
    };
    const h = rect(header),
      i = rect(instructions),
      c = rect(card);
    const title = rect(header.querySelector("h1"));
    const close = rect(document.querySelector(".yunipals-opening-close"));
    const atInstruction = document.elementFromPoint(
      (i.left + i.right) / 2,
      (i.top + i.bottom) / 2
    );
    return {
      header: h,
      focusedAction: document.activeElement?.getAttribute("data-stage-action"),
      focusedActionBounds: rect(document.activeElement),
      viewportHeight: innerHeight,
      title,
      close,
      titleIntersectsClose:
        title.top < close.bottom &&
        title.bottom > close.top &&
        title.left < close.right &&
        title.right > close.left,
      instructions: i,
      scene: rect(scene),
      card: c,
      instructionsOnTop:
        instructions === atInstruction || instructions.contains(atInstruction),
      cardIntersectsHeader: Boolean(
        c &&
          c.top < h.bottom &&
          c.bottom > h.top &&
          c.left < h.right &&
          c.right > h.left
      ),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      misleadingReveal:
        document
          .querySelector("dialog")
          ?.textContent.includes("Swipe the card aside to reveal it.") || false,
      redundantRevealButtons: [
        ...document.querySelectorAll("dialog button")
      ].filter(
        (button) =>
          button.textContent.trim() === "Reveal Yunipal" ||
          button.getAttribute("aria-label") === "Reveal card"
      ).length
    };
  });
  assert(
    geometry.header.top >= 0,
    "Opening heading stays within the top of the viewport"
  );
  assert(
    geometry.header.bottom <= (await target.evaluate(() => innerHeight)),
    "Opening instructions fit the viewport"
  );
  assert(
    geometry.instructionsOnTop,
    "The browser paints the instructions above their own background"
  );
  assert.equal(
    geometry.cardIntersectsHeader,
    false,
    "Moving card never covers the protected header/instructions"
  );
  if (geometry.focusedAction) {
    assert(
      geometry.focusedActionBounds.top >= 0 &&
        geometry.focusedActionBounds.bottom <= geometry.viewportHeight,
      "The automatically focused stage action is inside the viewport"
    );
  }
  assert.equal(
    geometry.titleIntersectsClose,
    false,
    "Close control never covers the heading"
  );
  assert.equal(geometry.horizontalOverflow, false);
  assert.equal(geometry.misleadingReveal, false);
  assert.equal(geometry.redundantRevealButtons, 0);
  return geometry;
}
try {
  await run(
    "Responsive demo and actual wrapper fill the opening scene without a heading gap",
    async () => {
      report.responsiveWrapper = [];
      for (const viewport of [
        { width: 1888, height: 1333 },
        { width: 1024, height: 768 },
        { width: 390, height: 844 }
      ]) {
        await page.setViewportSize(viewport);
        for (const mode of ["opening", "batch"]) {
          await visit(`mode=${mode}`);
          await page
            .getByRole("button", { name: "Start local opening" })
            .click();
          await page
            .locator(".yunipals-opening-body")
            .evaluate((image) => image.decode());
          const protectedGeometry = await protectedLayout();
          const geometry = await page.evaluate(() => {
            const bounds = (selector) => {
              const r = document
                .querySelector(selector)
                .getBoundingClientRect();
              return {
                top: r.top,
                bottom: r.bottom,
                left: r.left,
                right: r.right,
                width: r.width,
                height: r.height
              };
            };
            return {
              pack: bounds(".yunipals-opening-shell"),
              header: bounds(".yunipals-opening-header"),
              action: bounds(".yunipals-opening-content > button:last-child"),
              dialogScrollHeight: document.querySelector("dialog").scrollHeight
            };
          });
          assert(
            geometry.pack.top - geometry.header.bottom >= 0 &&
              geometry.pack.top - geometry.header.bottom <= 48,
            "The sealed wrapper sits directly below the protected heading"
          );
          assert(
            Math.abs(
              (geometry.pack.left + geometry.pack.right) / 2 -
                viewport.width / 2
            ) <= 1,
            "The wrapper stays horizontally centered"
          );
          assert(
            geometry.pack.top >= 0 && geometry.pack.bottom <= viewport.height,
            "The complete sealed wrapper fits the viewport"
          );
          assert(
            geometry.action.top >= 0 &&
              geometry.action.bottom <= viewport.height,
            "The explicit opening action remains in view"
          );
          assert(
            geometry.dialogScrollHeight <= viewport.height + 1,
            "The sealed scene does not require vertical scrolling"
          );
          if (viewport.width >= 1800)
            assert(
              geometry.pack.width >= 350,
              "Large desktop openings use a prominent wrapper"
            );
          const screenshot =
            values.output.replace(/\.json$/, "") +
            `-${viewport.width}x${viewport.height}-${mode}-sealed.png`;
          await page.screenshot({ path: screenshot });
          report.responsiveWrapper.push({
            viewport,
            mode,
            ...geometry,
            protectedGeometry,
            screenshot
          });
          await page.keyboard.press("Escape");
        }
      }
      await page.setViewportSize({ width: 1100, height: 1000 });
    }
  );
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
    "Public offer hides the smoke type for owner and other wallets without internal pack IDs",
    async () => {
      for (const scenario of ["empty", "offer-public"]) {
        await visit(`mode=pack&scenario=${scenario}`);
        const offers = page.locator("#booster-packs article");
        await offers.first().waitFor();
        assert.equal(await offers.count(), 1);
        const text = await offers.innerText();
        assert(text.includes("Yunipals TCG"));
        assert(!/Pack #(?:1|2)|Smoke|Test pack/i.test(text));
      }
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
    "Identical daily packs share one entry; selecting an original claims only its saved pulls",
    async () => {
      await visit("mode=pack&scenario=daily-grouped");
      const packs = page.locator("#daily-packs");
      await packs.getByText("11 pulls saved across 3 originals").waitFor();
      assert.equal(await packs.locator("article").count(), 1);
      const selector = packs.getByRole("combobox", { name: "Choose original" });
      await selector
        .locator('img[src="/__fixture-card.svg?original=7"]')
        .waitFor();
      await selector.locator("img").evaluate((img) => img.decode());
      assert.equal(
        await selector.locator("img").getAttribute("src"),
        "/__fixture-card.svg?original=7"
      );
      await selector.click();
      const option = page.getByRole("option", {
        name: "Original #21 · 5 saved pulls"
      });
      await option.locator("img").evaluate((img) => img.decode());
      assert.equal(
        await option.locator("img").getAttribute("src"),
        "/__fixture-card.svg?original=21"
      );
      await option.click();
      await selector
        .getByText("Original #21 · 5 saved pulls", { exact: true })
        .waitFor();
      await selector
        .locator('img[src="/__fixture-card.svg?original=21"]')
        .waitFor();
      assert.equal(
        await selector.locator("img").getAttribute("src"),
        "/__fixture-card.svg?original=21"
      );
      const claim = packs.getByRole("button", {
        name: "Open daily pack · 5 pulls",
        exact: true
      });
      await claim.waitFor();
      assert.deepEqual(
        JSON.parse(await claim.getAttribute("data-fixture-action")),
        { kind: "claim", packTypeId: "2", originalId: "21", quantity: 5 }
      );
      assert.equal(await packs.locator("article").count(), 1);
      await page.setViewportSize({ width: 390, height: 844 });
      await selector.click();
      const menu = page.getByRole("listbox");
      const bounds = await menu.boundingBox();
      assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391);
      const last = page.getByRole("option", {
        name: "Original #99 · 3 saved pulls"
      });
      await last
        .locator('img[src="/__fixture-card.svg?original=99"]')
        .waitFor();
      await last.locator("img").evaluate((img) => img.decode());
      await page.screenshot({
        path: values.output.replace(/\.json$/, "-original-menu-mobile.png")
      });
      await page.waitForFunction(
        () => document.activeElement?.getAttribute("role") === "option"
      );
      await page.keyboard.press("End");
      await page.waitForFunction(() =>
        document.activeElement
          ?.getAttribute("data-select-value")
          ?.endsWith(":99")
      );
      await page.keyboard.press("Enter");
      await selector
        .getByText("Original #99 · 3 saved pulls", { exact: true })
        .waitFor();
      await selector
        .locator('img[src="/__fixture-card.svg?original=99"]')
        .waitFor();
      assert.equal(
        await selector.locator("img").getAttribute("src"),
        "/__fixture-card.svg?original=99"
      );
      await page.setViewportSize({ width: 1100, height: 1000 });
    }
  );
  await run(
    "Original detail link opens that original's daily pack with its picture selected",
    async () => {
      await visit("mode=detail&scenario=daily-grouped");
      const link = page.getByRole("link", {
        name: "Open daily pack",
        exact: true
      });
      await link.waitFor();
      assert.equal(
        await link.getAttribute("href"),
        "/boosters?original=21#daily-packs"
      );
      await link.click();
      const selector = page.getByRole("combobox", { name: "Choose original" });
      await selector
        .getByText("Original #21 · 5 saved pulls", { exact: true })
        .waitFor();
      await selector.locator("img").evaluate((img) => img.decode());
      assert.equal(
        await selector.locator("img").getAttribute("src"),
        "/__fixture-card.svg?original=21"
      );
      const claim = page.getByRole("button", {
        name: "Open daily pack · 5 pulls",
        exact: true
      });
      assert.equal(
        JSON.parse(await claim.getAttribute("data-fixture-action")).originalId,
        "21"
      );
    }
  );
  await run(
    "Linked original beyond the owner page is selected; foreign originals cannot be claimed",
    async () => {
      await visit("mode=pack&scenario=daily-grouped&original=800");
      const claim = page.getByRole("button", {
        name: "Open daily pack · 5 pulls",
        exact: true
      });
      await claim.waitFor();
      assert.equal(
        JSON.parse(await claim.getAttribute("data-fixture-action")).originalId,
        "800"
      );
      await visit("mode=pack&scenario=daily-grouped&original=999");
      await page
        .getByRole("alert")
        .filter({ hasText: "Original #999 is not in this wallet’s collection" })
        .waitFor();
      assert.equal(
        await page.getByRole("option", { name: /Original #999/ }).count(),
        0
      );
      assert.equal(
        JSON.parse(
          await page
            .locator('#daily-packs button[data-fixture-action*="claim"]')
            .getAttribute("data-fixture-action")
        ).originalId,
        "7"
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
      await protectedLayout();
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
      await page.mouse.move(x, y - 105, { steps: 14 });
      assert(await grab.evaluate((element) => element.hasPointerCapture(1)));
      const partial = await extractionGeometry();
      await protectedLayout();
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
        waitUntil: "load"
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
      await pull(90);
      assert(await grab.evaluate((element) => element.hasPointerCapture(2)));
      const partial = await extractionGeometry(mobile);
      await protectedLayout(mobile);
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
      await protectedLayout(mobile);
      assert.equal(completed.visibleFraction, 1);
      assert(completed.cardBottom <= completed.mouth);
      await waitStage("results", mobile);
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
    "Protected instructions and automatic reveal fit 1024x768 and 390x844 throughout pull settling",
    async () => {
      const measurements = [];
      for (const viewport of [
        { width: 1024, height: 768 },
        { width: 390, height: 844 }
      ]) {
        await page.setViewportSize(viewport);
        await visit("mode=batch");
        await page.getByRole("button", { name: "Start local opening" }).click();
        const sealed = await protectedLayout();
        await page
          .getByRole("button", { name: "Rip open", exact: true })
          .click();
        await waitStage("extracting");
        await page.waitForTimeout(950);
        const peek = await protectedLayout();
        const grab = page.getByRole("button", { name: "Pull card upward" });
        const box = await grab.boundingBox();
        const x = box.x + box.width / 2,
          y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x, y - 85, { steps: 12 });
        const partial = await protectedLayout();
        await page.mouse.move(x, y - 300, { steps: 16 });
        await page.mouse.up();
        await page.waitForTimeout(120);
        const settling = await protectedLayout();
        assert.equal(await stage().getAttribute("data-stage"), "extracting");
        assert.equal(await stage().getAttribute("data-settling"), "true");
        await waitStage("results");
        const revealed = await protectedLayout();
        await page.getByRole("button", { name: "Pull next card" }).focus();
        await page.keyboard.press("Enter");
        await waitStage("extracting");
        const nextPeek = await protectedLayout();
        assert.equal(
          await page.getByRole("button", { name: "Rip pack seal" }).count(),
          0
        );
        await page
          .getByRole("button", { name: "Pull out card", exact: true })
          .click();
        await waitStage("results");
        await protectedLayout();
        await page.screenshot({
          path: `/tmp/yunipals-opening-protected-${viewport.width}x${viewport.height}-20261023.png`
        });
        measurements.push({
          viewport,
          sealed,
          peek,
          partial,
          settling,
          revealed,
          nextPeek
        });
        await page.keyboard.press("Escape");
      }
      report.protectedLayout = measurements;
      await page.setViewportSize({ width: 1100, height: 1000 });
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
        ["non-opening", "Request details unavailable"]
      ]) {
        await visit(`mode=transactions&scenario=${scenario}`);
        await page.getByText(status, { exact: true }).waitFor();
        assert.equal(
          await page
            .getByRole("button", { name: "View card", exact: true })
            .count(),
          0,
          scenario
        );
        assert.equal(await dialog().count(), 0, scenario);
      }
    }
  );
  await run(
    "Queued artwork is explained honestly and polling replaces it with the published card",
    async () => {
      await visit("mode=batch&scenario=artwork-queued");
      await page.getByRole("button", { name: "Start local opening" }).click();
      await page.getByRole("button", { name: "Rip open", exact: true }).click();
      await waitStage("extracting");
      await page
        .getByRole("button", { name: "Pull out card", exact: true })
        .click();
      await waitStage("results");
      await page
        .getByText("Your NFT is minted. Its artwork is awaiting generation.", {
          exact: true
        })
        .waitFor();
      assert.equal(
        await page.locator(".yunipals-opening-result .tilt-card").count(),
        0
      );
      await page.evaluate(() => {
        window.__artworkReady = true;
      });
      await page
        .locator(".yunipals-opening-result .tilt-card")
        .waitFor({ timeout: 10000 });
      await page.keyboard.press("Escape");
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
      await waitStage("results");
      await page
        .getByRole("heading", { name: "Fixture Yunipal #17", exact: true })
        .waitFor();
      await page.keyboard.press("Escape");
    }
  );
  await run(
    "One confirmed purchase transaction reveals all three exact originals through one wrapper and survives reload",
    async () => {
      await visit("mode=transactions&scenario=multi");
      await page
        .getByRole("button", { name: "View 3 cards", exact: true })
        .click();
      await waitStage("sealed");
      await page.getByText("Card 1 of 3", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "Rip pack seal", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      for (const [index, token] of ["7", "21", "99"].entries()) {
        await waitStage("extracting");
        assert.equal(
          await page
            .getByRole("button", { name: "Rip pack seal", exact: true })
            .count(),
          0
        );
        await page
          .getByRole("button", { name: "Pull card upward", exact: true })
          .focus();
        await page.keyboard.press("Enter");
        await waitStage("results");
        await page
          .getByRole("heading", {
            name: `Fixture Yunipal #${token}`,
            exact: true
          })
          .waitFor();
        if (index < 2)
          await page
            .getByRole("button", { name: "Pull next card", exact: true })
            .click();
      }
      assert.deepEqual(
        await page.evaluate(() => [
          ...new Set(window.__openingRequestCardFetches)
        ]),
        ["9", "250", "31"]
      );
      await page.getByRole("button", { name: "Done", exact: true }).click();
      await page.reload();
      await page
        .getByRole("button", { name: "View 3 cards", exact: true })
        .waitFor();
      const saved = await page.evaluate(() =>
        JSON.parse(
          localStorage.getItem(
            [...Object.keys(localStorage)].find((key) =>
              key.startsWith("yunipals/boosters/v1/8453/")
            )
          )
        )
      );
      assert.equal(saved[0].expectedRequestCount, 3);
      assert.equal(saved[0].quantity, 1);
      await page
        .getByRole("button", { name: "View 3 cards", exact: true })
        .click();
      await waitStage("sealed");
      await page.getByText("Card 1 of 3", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
    }
  );
  await run(
    "Asynchronous partial fulfillment waits for every request across close/reload before one combined wrapper",
    async () => {
      await visit("mode=transactions&scenario=multi-pending");
      await page.getByText("1 of 3 packs revealed", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "View pack progress", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Your 3 packs", exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Rip pack seal", exact: true })
          .count(),
        0
      );
      await page.keyboard.press("Escape");
      await page.reload();
      await page.getByText("1 of 3 packs revealed", { exact: true }).waitFor();
      await page.evaluate(() => {
        window.__completeMulti = true;
        sessionStorage.setItem("fixture-multi-fulfilled", "yes");
        window.__refreshBoosters();
      });
      await page
        .getByRole("button", { name: "View 3 cards", exact: true })
        .click();
      await waitStage("sealed");
      await page.getByText("Card 1 of 3", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
    }
  );
  await run(
    "Recovery remains request-specific while the completed originals stay in the same wrapper",
    async () => {
      await visit("mode=transactions&scenario=multi-recovery");
      await page
        .getByRole("button", { name: "View pack progress", exact: true })
        .click();
      const finish = page
        .getByRole("dialog", { name: "Your 3 packs", exact: true })
        .getByRole("button", {
          name: "Finish reveal · pack 2",
          exact: true
        });
      await finish.waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Rip pack seal", exact: true })
          .count(),
        0
      );
      await finish.click();
      await waitStage("sealed");
      await page.getByText("Card 1 of 3", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
    }
  );
  await run(
    "Forfeited requests are explicit and never invent a card or lose the two completed originals",
    async () => {
      await visit("mode=transactions&scenario=multi-forfeit");
      await page
        .getByRole("button", { name: "View 2 cards", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "Your 3 packs", exact: true })
        .getByRole("button", { name: "Open 2 revealed cards", exact: true })
        .click();
      await waitStage("sealed");
      await page.getByText("Card 1 of 2", { exact: true }).waitFor();
      assert.deepEqual(
        await page.evaluate(() => [
          ...new Set(window.__openingRequestCardFetches)
        ]),
        ["9", "250"]
      );
      await page.keyboard.press("Escape");
    }
  );
  await run(
    "Missing logs, duplicate requests and a wrong actual purchase count cannot open any wrapper",
    async () => {
      for (const scenario of [
        "multi-missing",
        "multi-duplicate",
        "multi-wrong-count"
      ]) {
        await visit(`mode=transactions&scenario=${scenario}`);
        await page
          .getByText("Request details unavailable", { exact: true })
          .waitFor();
        assert.equal(
          await page
            .getByRole("button", {
              name: /Reveal .*Yunipals|View pack progress/
            })
            .count(),
          0
        );
        assert.equal(await dialog().count(), 0);
      }
    }
  );
  await run(
    "Indexer delay preserves the whole group and legacy stored hashes recover their actual purchase count",
    async () => {
      await visit("mode=transactions&scenario=multi-incomplete");
      await page
        .getByRole("button", { name: "View 3 cards", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Your 3 packs", exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Rip pack seal", exact: true })
          .count(),
        0
      );
      await page.evaluate(() => {
        window.__completeMulti = true;
        sessionStorage.setItem("fixture-multi-fulfilled", "yes");
        window.__refreshBoosters();
      });
      await waitStage("sealed");
      await page.getByText("Card 1 of 3", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await visit("mode=transactions&scenario=multi-legacy");
      await page
        .getByRole("button", { name: "View 3 cards", exact: true })
        .waitFor();
      await page.reload();
      await page
        .getByRole("button", { name: "View 3 cards", exact: true })
        .waitFor();
    }
  );
  await run(
    "Only confirmed onchain opening+Revealed can explicitly launch the genuine NFT opening",
    async () => {
      await visit("mode=transactions&scenario=revealed");
      const reveal = page.getByRole("button", {
        name: "View card",
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
      await waitStage("results");
      await page
        .getByRole("link", { name: /View.*Yunipal|View.*collection/i })
        .first()
        .waitFor();
      await page.keyboard.press("Escape");
    }
  );
  await run(
    "Submitted hash opens progress before any receipt/API request; confirmation, syncing and VRF are distinct and closing never resubmits",
    async () => {
      await visit("mode=submitted&scenario=submission");
      await page.locator("dialog .yunipals-loader-mark").waitFor();
      await page
        .getByRole("dialog", { name: "Your 3 packs", exact: true })
        .waitFor();
      await page
        .getByText("Waiting for transaction confirmation…", { exact: true })
        .waitFor();
      assert.equal(await dialog().count(), 0);
      await page.evaluate(() => {
        window.__deferRequestStates = true;
        window.__receiptConfirmed = true;
        window.__refreshBoosters();
      });
      await page
        .getByText("Transaction confirmed. Syncing your pack requests…", {
          exact: true
        })
        .waitFor();
      await page.evaluate(() => {
        window.__deferRequestStates = false;
        for (const resolve of window.__releaseRequestStates ?? []) resolve();
      });
      await page.getByText(/Waiting for Chainlink randomness/).waitFor();
      assert.equal(await dialog().count(), 0);
      await page
        .getByRole("button", { name: "Close pack", exact: true })
        .click();
      await page.evaluate(() => {
        window.__completeMulti = true;
        window.__refreshBoosters();
      });
      await page
        .getByRole("button", { name: "View 3 cards", exact: true })
        .waitFor();
      assert.equal(
        await page.getByRole("dialog").count(),
        0,
        "Confirmation must not reopen a closed submitted dialog"
      );
    }
  );
  await run(
    "Public replay link restores all three cards from actual receipt+input without wallet/local ownership and can replay again",
    async () => {
      await visit(
        "mode=transactions&scenario=multi-replay&opening=0x" + "a".repeat(64)
      );
      await dialog().waitFor();
      for (const [index, id] of ["7", "21", "99"].entries()) {
        if (index === 0) {
          await page
            .getByRole("button", { name: "Rip pack seal", exact: true })
            .focus();
          await page.keyboard.press("Enter");
        } else {
          await page
            .getByRole("button", { name: "Pull next card", exact: true })
            .click();
        }
        await waitStage("extracting");
        await page
          .getByRole("button", { name: "Pull card upward", exact: true })
          .focus();
        await page.keyboard.press("Enter");
        await waitStage("results");
        await page
          .getByRole("heading", { name: "Fixture Yunipal #" + id, exact: true })
          .waitFor();
      }
      const replay = page
        .getByRole("link", { name: "Replay opening", exact: true })
        .last();
      assert.equal(
        await replay.getAttribute("href"),
        "/boosters?opening=0x" + "a".repeat(64)
      );
      await Promise.all([
        page.waitForURL(/\/boosters\?opening=/),
        replay.click()
      ]);
      await waitStage("sealed");
      await page
        .getByRole("button", { name: "Rip pack seal", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await waitStage("extracting");
      await page.getByText("Card 1 of 3", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await dialog().waitFor({ state: "detached" });
      await visit(
        "mode=transactions&scenario=multi-replay&opening=0x" + "a".repeat(64)
      );
      await waitStage("sealed");
      await page.keyboard.press("Escape");
      await dialog().waitFor({ state: "detached" });
      assert.equal(await dialog().count(), 0);
      await visit(
        "mode=transactions&scenario=multi-replay&opening=0x" + "a".repeat(64)
      );
      await waitStage("sealed");
      await page.keyboard.press("Escape");
    }
  );
  await run(
    "Public replay refuses foreign-engine calldata, incomplete batches and malformed links without revealing any card",
    async () => {
      for (const scenario of [
        "multi-foreign-engine",
        "multi-missing",
        "multi-wrong-count"
      ]) {
        await visit(
          "mode=transactions&scenario=" +
            scenario +
            "&opening=0x" +
            "a".repeat(64)
        );
        await page
          .getByText(/No cards can be shown until this transaction is verified/)
          .waitFor();
        assert.equal(await dialog().count(), 0);
        await page
          .getByRole("button", { name: "Close pack", exact: true })
          .click();
      }
      await visit("mode=transactions&scenario=multi-replay&opening=not-a-hash");
      assert.equal(await page.getByRole("dialog").count(), 0);
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
  await page.screenshot({
    path: values.output.replace(/\.json$/, "-failure.png")
  });
} finally {
  report.completedAt = new Date().toISOString();
  await writeFile(values.output, JSON.stringify(report, null, 2) + "\n");
  await browser.close();
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
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
