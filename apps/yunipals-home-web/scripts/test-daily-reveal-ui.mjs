// Real daily-card controls and reveal components; only wallet/RPC/API boundaries
// are fixtures. No signatures, transactions or external requests are made.
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
const modules = {
  "virtual:daily-fixture.ts": `
import {encodeEventTopics,encodeAbiParameters,encodeFunctionData,parseAbiParameters} from 'viem';
import {boosterPacksAbi} from '@protopals/yunipals-market-core/boosterAbi';
export const owner='0x1111111111111111111111111111111111111111';
const engine='0x2222222222222222222222222222222222222222';
const monsters='0x3333333333333333333333333333333333333333';
const registry='0x4444444444444444444444444444444444444444';
export const hash='0x'+'a'.repeat(64);
const blockHash='0x'+'b'.repeat(64),zero='0x'+'0'.repeat(64);
export const boosterQueryKey=['daily-reveal-fixture'];
export const boosterAddresses=()=>({engine,monsters,registry});
export const readBoosterTransactions=()=>[];
export const readBoosterTransactionReceipt=read=>read();
export const original=()=>({id:'8453:'+monsters+':7',tokenId:'7',collection:monsters,engine,owner,
 revealedAt:String(1792740601-2*86400),dailyCommitted:window.__spent?'2':'0',minted:'1',remaining:'263',
 pendingRequest:window.__pending?'8453:'+engine+':9':null,burned:false,
 pack:{packTypeId:'2',intervalSeconds:'86400',mintsPerInterval:1,totalVariants:264,maxBatch:7}});
export const fetchBoosterOwner=async()=>({items:[original()],nextCursor:null});
export const fetchBoosterOriginal=async()=>({item:original()});
export const fetchBoosterMonster=async(_,id)=>({item:{metadataUri:'fixture:'+id}});
export const fetchMonsterArtwork=async uri=>({name:'Yunipal #'+uri.split(':')[1],image:'/card.svg',attributes:{type:'Yunidragon',glitter:'No'},status:'ready',holo:null});
export const fetchBoosterRequestMonsters=async()=>({items:window.__indexed?['17','41'].map(tokenId=>({
 id:'8453:'+monsters+':'+tokenId,tokenId,collection:monsters,originalKey:'8453:'+monsters+':7',
 requestKey:'8453:'+engine+':9',typeKey:'8453:'+registry+':2',isOriginal:false,metadataUri:'fixture:'+tokenId
})):[]});
export const client={
 async getBlock(){return {timestamp:1792740601n};},
 async readContract({functionName}){
  if(functionName==='getRequest')return {originalId:7n,quantity:2,opening:false,payer:owner,paid:0n,ruleHash:zero,status:window.__revealed?3:1};
  throw Error('Unexpected RPC '+functionName);
 },
 async getTransaction(){return {hash,to:engine,input:encodeFunctionData({abi:boosterPacksAbi,functionName:'claim',args:[7n,2,0n,9999999999n]})};},
 async getTransactionReceipt({hash:txHash}){
  if(!window.__confirmed)return null;
  return {status:'success',transactionHash:txHash,blockHash,blockNumber:1n,logs:[{
   address:engine,transactionHash:txHash,blockHash,blockNumber:1n,logIndex:0,removed:false,
   topics:encodeEventTopics({abi:boosterPacksAbi,eventName:'RequestCreated',args:{requestId:9n,originalId:7n,packTypeId:2n}}),
   data:encodeAbiParameters(parseAbiParameters('address,uint32,bool,uint256,bytes32,uint32'),[owner,2,false,0n,zero,900000])
  }]};
 }
};`,
  "virtual:daily-wagmi.ts": `
import {useSyncExternalStore} from 'react';
import {owner,client} from 'virtual:daily-fixture.ts';
let address=owner;const listeners=new Set();
window.__wallet=value=>{address=value;listeners.forEach(fn=>fn());};
export function useAccount(){return {address:useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>address),chainId:8453,isConnected:!!address};}
export const usePublicClient=()=>client;`,
  "virtual:daily-action.tsx": `
import {hash} from 'virtual:daily-fixture.ts';
export function BoosterActionButton({children,ariaLabel,onSubmitted}){
 return <button aria-label={ariaLabel} onClick={()=>{window.__submitted=onSubmitted;onSubmitted(hash);}}>{children}</button>;
}`,
  "virtual:daily-wallet.ts": `export const useConnectModal=()=>({openConnectModal:()=>{}});`,
  "virtual:daily-entry.tsx": `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider,useQuery} from '@tanstack/react-query';
import {BoosterOpeningProvider} from '/src/providers/BoosterOpeningProvider';
import {CollectionDailyPulls} from '/src/components/CollectionDailyPulls';
import {boosterQueryKey} from 'virtual:daily-fixture.ts';
import '/src/globals.css';
const queries=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
window.__refresh=()=>queries.invalidateQueries();
window.__refreshOriginals=()=>queries.invalidateQueries({queryKey:[...boosterQueryKey,'originals']});
function Collection(){
 const cards=useQuery({queryKey:[...boosterQueryKey,'normal-collection','all'],queryFn:async()=>window.__indexed?'17,41':'none',staleTime:Infinity});
 return <output aria-label="Collection cards">{cards.data}</output>;
}
function App(){
 const [shown,setShown]=useState(true);
 window.__hide=()=>setShown(false);
 return <><Collection/>{shown&&<CollectionDailyPulls/>}</>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><MemoryRouter><QueryClientProvider client={queries}><BoosterOpeningProvider><App/></BoosterOpeningProvider></QueryClientProvider></MemoryRouter></React.StrictMode>);
`
};
const cacheDir = await mkdtemp(join(tmpdir(), "daily-reveal-vite-"));
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
      name: "daily-reveal-regression",
      enforce: "pre",
      resolveId(id) {
        if (Object.hasOwn(modules, id)) return "\0" + id;
        if (id === "wagmi") return "\0virtual:daily-wagmi.ts";
        if (id === "@rainbow-me/rainbowkit") return "\0virtual:daily-wallet.ts";
        if (id === "@/lib/boosters" || id === `${root}/src/lib/boosters`)
          return "\0virtual:daily-fixture.ts";
        if (id.endsWith("/BoosterActionButton"))
          return "\0virtual:daily-action.tsx";
      },
      load(id) {
        if (id.startsWith("\0") && Object.hasOwn(modules, id.slice(1)))
          return transformWithEsbuild(modules[id.slice(1)], id.slice(1), {
            loader: "tsx",
            jsx: "automatic"
          });
      },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (req.url === "/card.svg") {
            res.setHeader("Content-Type", "image/svg+xml");
            return res.end(
              '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#c4b5fd"/></svg>'
            );
          }
          if (req.url !== "/__daily-reveal") return next();
          res.setHeader("Content-Type", "text/html");
          res.end(
            await vite.transformIndexHtml(
              req.url,
              '<html><body><div id="root"></div><script type="module" src="/@id/__x00__virtual:daily-entry.tsx"></script></body></html>'
            )
          );
        });
      }
    }
  ]
});
let browser;
let page;
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const { chromium } = await import(pathToFileURL(values.playwright).href);
  browser = await chromium.launch({
    executablePath: values.chromium,
    args: ["--no-sandbox"]
  });
  const context = await browser.newContext({
    viewport: { width: 1100, height: 900 },
    reducedMotion: "reduce"
  });
  const external = [],
    errors = [];
  await context.route("**/*", (route) => {
    if (
      route
        .request()
        .url()
        .startsWith(origin + "/")
    )
      return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  const reveal = () =>
    page.getByRole("dialog", { name: "Yunipals pack opening", exact: true });
  const visit = () => page.goto(origin + "/__daily-reveal");
  const openDaily = async () => {
    const trigger = page.getByRole("button", {
      name: "2 daily cards ready. Open daily cards."
    });
    if ((await trigger.getAttribute("aria-expanded")) !== "true")
      await trigger.click();
    await page
      .getByRole("button", { name: "Open 2 saved cards from original #7" })
      .click();
  };
  // Submission survives source-row removal before confirmation; indexing delay
  // retains the loading dialog; all cards remain available through completion.
  await visit();
  await openDaily();
  await page.getByRole("dialog").waitFor();
  await page.evaluate(async () => {
    window.__spent = true;
    await window.__refreshOriginals();
  });
  await page
    .getByRole("region", { name: "Your daily cards" })
    .waitFor({ state: "hidden" });
  assert.equal(await page.locator("dialog[open]").count(), 1);
  await page.evaluate(async () => {
    window.__confirmed = true;
    await window.__refresh();
  });
  await page.getByRole("dialog", { name: "Your pack", exact: true }).waitFor();
  await page.evaluate(async () => {
    window.__revealed = true;
    await window.__refresh();
  });
  assert.equal(await reveal().count(), 0, "Do not show unindexed cards");
  assert.equal(await page.locator("dialog[open]").count(), 1);
  await page.evaluate(() => {
    window.__indexed = true;
  });
  await reveal().waitFor(); // The real request-card polling retries indexing.
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Collection cards"]').textContent ===
      "17,41"
  );
  await page.getByRole("button", { name: "Rip open", exact: true }).click();
  await page
    .getByRole("button", { name: "Pull out card", exact: true })
    .click();
  await page
    .getByRole("link", { name: "View Yunipal #17", exact: true })
    .waitFor();
  await page.evaluate(async () => {
    await window.__refresh();
  });
  await page
    .getByRole("button", { name: "Pull next card", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Pull out card", exact: true })
    .click();
  await page
    .getByRole("link", { name: "View Yunipal #41", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  assert.equal(await page.locator("dialog[open]").count(), 0);
  assert.equal(await page.evaluate(() => document.body.style.overflow), "");
  console.log(
    "PASS: row removal, delayed confirmation/indexing, collection refresh, both reveals and explicit close"
  );

  // A resumed request survives its pendingRequest field being cleared.
  await visit();
  await page
    .getByRole("button", { name: "2 daily cards ready. Open daily cards." })
    .waitFor();
  await page.evaluate(async () => {
    window.__pending = true;
    await window.__refreshOriginals();
  });
  await page
    .getByRole("button", { name: "2 daily cards ready. Open daily cards." })
    .click();
  await page
    .getByRole("button", { name: "View pending daily cards from original #7" })
    .click();
  await page.getByRole("dialog", { name: "Your pack", exact: true }).waitFor();
  await page.evaluate(async () => {
    window.__pending = false;
    window.__spent = true;
    window.__revealed = true;
    window.__indexed = true;
    await window.__refresh();
  });
  await reveal().waitFor();
  assert.equal(
    await page.getByRole("region", { name: "Your daily cards" }).count(),
    0
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("dialog[open]").count(), 0);
  console.log(
    "PASS: resumed request survives pending-row removal and closes with Escape"
  );

  // Wallet replacement tracks only the currently selected submission. Closing
  // or changing wallets must not let a late callback reopen that submission.
  await visit();
  await openDaily();
  await page.getByRole("dialog").waitFor();
  await page.evaluate(() =>
    window.__submitted("0x" + "c".repeat(64), "0x" + "a".repeat(64))
  );
  await page.waitForFunction(() =>
    document
      .querySelector('dialog[open] a[href*="basescan.org/tx/"]')
      ?.getAttribute("href")
      .endsWith("c".repeat(64))
  );
  await page.getByRole("button", { name: "Close pack", exact: true }).click();
  await page.evaluate(() =>
    window.__submitted("0x" + "d".repeat(64), "0x" + "c".repeat(64))
  );
  assert.equal(await page.locator("dialog[open]").count(), 0);
  await openDaily();
  await page.getByRole("dialog").waitFor();
  await page.evaluate(() => {
    window.__oldSubmitted = window.__submitted;
    window.__wallet("0x5555555555555555555555555555555555555555");
  });
  await page.locator("dialog[open]").waitFor({ state: "hidden" });
  await page.evaluate(() => window.__oldSubmitted("0x" + "e".repeat(64)));
  assert.equal(await page.locator("dialog[open]").count(), 0);
  await page.evaluate(() =>
    window.__wallet("0x1111111111111111111111111111111111111111")
  );
  assert.equal(await page.locator("dialog[open]").count(), 0);
  console.log("PASS: replacement tracking, dismissal and wallet isolation");
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
} catch (error) {
  console.error(await page?.locator("body").innerText());
  throw error;
} finally {
  await browser?.close();
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
