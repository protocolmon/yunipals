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
      type: "string"
    },
    chromium: {
      type: "string"
    }
  }
});
const root = fileURLToPath(new URL("..", import.meta.url));
const modules = {
  "virtual:daily-fixture.ts": `
import {decodeFunctionData,encodeEventTopics,encodeAbiParameters,encodeFunctionData,parseAbiParameters} from 'viem';
import {boosterPacksAbi} from '@protopals/yunipals-market-core/boosterAbi';
import {dailyClaimManyAbi} from '/src/lib/boosterDailyClaims';
export const owner='0x1111111111111111111111111111111111111111';
const engine='0x2222222222222222222222222222222222222222';
const monsters='0x3333333333333333333333333333333333333333';
const registry='0x4444444444444444444444444444444444444444';
export const hash='0x'+'a'.repeat(64);
const blockHash='0x'+'b'.repeat(64),zero='0x'+'0'.repeat(64);
export const boosterQueryKey=['daily-reveal-fixture'];
export const boosterAssetUrl=uri=>new URL(uri,window.location.origin).href;
export const boosterAddresses=()=>({engine,monsters,registry});
export const readBoosterTransactions=()=>[];
export const saveBoosterTransaction=()=>{};
export const readBoosterTransactionReceipt=read=>read();
export const original=()=>({id:'8453:'+monsters+':7',tokenId:'7',collection:monsters,engine,owner,
 revealedAt:String(1792740601-2*86400),dailyCommitted:window.__spent?'2':'0',minted:'1',remaining:'263',
 pendingRequest:window.__pending?'8453:'+engine+':9':null,burned:false,
 pack:{packTypeId:'2',intervalSeconds:'86400',mintsPerInterval:1,totalVariants:264,maxBatch:7}});
export const fetchBoosterOwner=async(_,__,cursor)=>({items:cursor?Array.from({length:window.__many?20:1},(_,i)=>({...original(),id:'second'+i,tokenId:String(8+i)})):[original()],nextCursor:cursor?null:'page2'});
const receipt=(txHash, ids)=>({status:'success',transactionHash:txHash,blockHash,blockNumber:1n,logs:ids.map((id,index)=>({
 address:engine,transactionHash:txHash,blockHash,blockNumber:1n,logIndex:index,removed:false,
 topics:encodeEventTopics({abi:boosterPacksAbi,eventName:'RequestCreated',args:{requestId:BigInt(id)+2n,originalId:BigInt(id),packTypeId:2n}}),
 data:encodeAbiParameters(parseAbiParameters('address,uint32,bool,uint256,bytes32,uint32'),[owner,2,false,0n,zero,900000])
}))});
const idFrom=data=>decodeFunctionData({abi:boosterPacksAbi,data}).args[0].toString();
export const wallet={
 async getChainId(){return 8453;},async getAddresses(){return [owner];},
 async getCapabilities(){return {atomic:{status:window.__capability||'supported'}};},
 async sendCalls({calls,forceAtomic}){window.__batchCalls=calls;window.__atomic=forceAtomic;if(window.__rejectBatch)throw Error('User rejected');return {id:'daily-batch'};},
 async waitForCallsStatus(){if(window.__timeout)throw Error('Timed out');return {status:'success',receipts:[{transactionHash:hash}]};},
 async sendTransaction({data}){window.__sends=(window.__sends||0)+1;if(window.__sends===window.__rejectAt)throw Error('User rejected');const decoded=decodeFunctionData({abi:[...boosterPacksAbi,...dailyClaimManyAbi],data});window.__receiptIds=decoded.functionName==='claimMany'?decoded.args[0].map(String):[String(decoded.args[0])];window.__sentGroups=[...(window.__sentGroups||[]),window.__receiptIds];window.__lastData=data;return hash;}
};
export const fetchBoosterOriginal=async()=>({item:original()});
export const fetchBoosterMonster=async(_,id)=>({item:{metadataUri:'fixture:'+id}});
export const fetchMonsterArtwork=async uri=>({name:'Yunipal #'+uri.split(':')[1],image:'/card.svg',attributes:{type:'Yunidragon',glitter:'No'},status:'ready',holo:null});
export const fetchBoosterRequestMonsters=async()=>({items:window.__indexed?['17','41'].map(tokenId=>({
 id:'8453:'+monsters+':'+tokenId,tokenId,collection:monsters,originalKey:'8453:'+monsters+':7',
 mintedTo:owner,owner,mintBlock:"1",burned:false,requestKey:'8453:'+engine+':9',typeKey:'8453:'+registry+':2',isOriginal:false,metadataUri:'fixture:'+tokenId
})):[]});
export const client={
 async estimateFeesPerGas(){return {maxFeePerGas:1n,maxPriorityFeePerGas:1n};},
 async estimateGas(){return 21000n;},async getBalance(){return 10n**18n;},async call(){return {};},
 async waitForTransactionReceipt(){return receipt(hash,window.__receiptIds||['7']);},
 async getBlock(){return {timestamp:1792740601n};},
 async readContract({functionName}){
  if(functionName==='MAX_CLAIM_ORIGINALS'){if(window.__native)return 20;throw Error('Unsupported');}
  if(functionName==='getPack')return {active:true,rules:{engine,maxBatch:7}};
  if(functionName==='claimable')return 2;
  if(functionName==='quote')return [100n];
  if(functionName==='getRequest')return {originalId:7n,quantity:2,opening:false,payer:owner,paid:0n,ruleHash:zero,status:window.__revealed?3:1};
  throw Error('Unexpected RPC '+functionName);
 },
 async getTransaction(){return {hash,to:window.__native?engine:owner,input:window.__lastData||encodeFunctionData({abi:boosterPacksAbi,functionName:'claim',args:[7n,2,0n,9999999999n]})};},
 async getTransactionReceipt({hash:txHash}){return receipt(txHash,window.__receiptIds||['7','8']);}

};`,
  "virtual:daily-wagmi.ts": `
import {useSyncExternalStore} from 'react';
import {owner,client,wallet} from 'virtual:daily-fixture.ts';
let address=owner;const listeners=new Set();
window.__wallet=value=>{address=value;listeners.forEach(fn=>fn());};
export function useAccount(){return {address:useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>address),chainId:8453,isConnected:!!address};}
export const usePublicClient=()=>client;
export const useWalletClient=()=>({data:wallet});
export const useSwitchChain=()=>({switchChain:()=>{}});`,
  "virtual:daily-action.tsx": `
import {hash} from 'virtual:daily-fixture.ts';
export const boosterButtonClass="fixture-button";
export function BoosterActionButton({children,ariaLabel,onSubmitted}){
 return <button aria-label={ariaLabel} onClick={()=>{window.__submitted=onSubmitted;onSubmitted(hash);}}>{children}</button>;
}`,
  "virtual:daily-fee.ts": `export const estimateL1Fee=async()=>1n;`,
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
        if (id === "viem/op-stack") return "\0virtual:daily-fee.ts";
        if (id === "wagmi") return "\0virtual:daily-wagmi.ts";
        if (id === "@rainbow-me/rainbowkit") return "\0virtual:daily-wallet.ts";
        if (id === "@/lib/boosters" || id === `${root}/src/lib/boosters`)
          return "\0virtual:daily-fixture.ts";
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
  const { chromium } = await import(
    values.playwright ? pathToFileURL(values.playwright).href : "playwright-core"
  );
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
  const visit = async (config = {}) => {
    await page.goto(origin + "/__daily-reveal");
    await page.evaluate((config) => {
      localStorage.clear();
      Object.assign(window, config);
    }, config);
    await page.reload();
    await page.evaluate((config) => Object.assign(window, config), config);
    await page
      .getByRole("button", { name: "2 daily cards ready. Open daily cards." })
      .click();
    await page.getByRole("button", { name: "Open all", exact: true }).click();
  };
  await visit();
  await page.getByText("4 saved cards", { exact: true }).waitFor();
  await page.getByText("One bundled transaction", { exact: true }).waitFor();
  await page.screenshot({ path: join(tmpdir(), "yunipals-daily-open-all-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth
    ),
    false
  );
  await page.screenshot({ path: join(tmpdir(), "yunipals-daily-open-all-mobile.png") });
  await page.setViewportSize({ width: 1100, height: 900 });
  await page
    .getByRole("button", { name: "Open 4 cards in one bundle" })
    .click();
  await page.getByRole("button", { name: "View daily opening 1" }).waitFor();
  assert.equal(await page.evaluate(() => window.__batchCalls.length), 2);
  assert.equal(await page.evaluate(() => window.__atomic), true);
  assert.equal(await page.evaluate(() => window.__sends || 0), 0);
  await page.getByRole("button", { name: "View daily opening 1" }).click();
  await page.getByRole("dialog", { name: "Your pack", exact: true }).waitFor();
  console.log(
    "PASS: paginated originals combine in one atomic wallet call and resume their reveal"
  );

  await visit({ __capability: "ready" });
  await page.getByText(/may first ask you to enable/).waitFor();
  console.log("PASS: account setup is explained before submission");

  await visit({ __capability: "unsupported", __rejectAt: 2 });
  await page.getByText("2 wallet confirmations", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Open 4 cards", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Cancelled in your wallet" })
    .waitFor();
  assert.equal(await page.evaluate(() => window.__sends), 2);
  assert.equal(await page.evaluate(() => window.__batchCalls?.length || 0), 0);
  await page.getByRole("button", { name: "View daily opening 1" }).waitFor();
  console.log(
    "PASS: unsupported wallet uses explicit sequential confirmations and preserves partial success"
  );

  await visit({ __rejectBatch: true });
  await page
    .getByRole("button", { name: "Open 4 cards in one bundle" })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Cancelled in your wallet" })
    .waitFor();
  assert.equal(await page.evaluate(() => window.__sends || 0), 0);
  console.log("PASS: rejected bundle never falls back to more wallet popups");

  await visit({ __timeout: true });
  await page
    .getByRole("button", { name: "Open 4 cards in one bundle" })
    .click();
  await page
    .getByRole("button", { name: "Check opening status", exact: true })
    .last()
    .waitFor();
  const saved = await page.evaluate(() =>
    Object.values(localStorage).some((value) =>
      value.includes('"id":"daily-batch"')
    )
  );
  assert.equal(saved, true);
  await page.reload();
  await page
    .getByRole("button", { name: "2 daily cards ready. Open daily cards." })
    .click();
  await page
    .getByRole("button", { name: "Check opening status", exact: true })
    .click();
  await page.getByRole("button", { name: "View daily opening 1" }).waitFor();
  assert.equal(await page.evaluate(() => window.__batchCalls?.length || 0), 0);
  console.log(
    "PASS: reload after timeout resumes the saved batch without resubmission"
  );
  await visit();
  await page
    .getByRole("button", { name: "Open 4 cards in one bundle" })
    .waitFor();
  await page.evaluate(() =>
    window.__wallet("0x5555555555555555555555555555555555555555")
  );
  await page.locator("dialog[open]").waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => window.__batchCalls?.length || 0), 0);
  console.log(
    "PASS: switching wallets dismisses the old review without submission"
  );

  await visit({ __native: true, __capability: "unsupported" });
  await page.getByText(/No smart-account setup needed/).waitFor();
  await page
    .getByRole("button", { name: "Open 4 cards in one bundle" })
    .click();
  await page.getByRole("button", { name: "View daily opening 1" }).waitFor();
  assert.equal(await page.evaluate(() => window.__sends), 1);
  assert.deepEqual(await page.evaluate(() => window.__sentGroups), [
    ["7", "8"]
  ]);
  assert.equal(await page.evaluate(() => window.__batchCalls?.length || 0), 0);
  await page.getByRole("button", { name: "View daily opening 1" }).click();
  await page.getByRole("dialog", { name: "Your pack", exact: true }).waitFor();
  console.log(
    "PASS: native batching needs one ordinary transaction and replays its exact claims"
  );

  await visit({ __native: true, __many: true, __capability: "unsupported" });
  await page.getByText("42 saved cards", { exact: true }).waitFor();
  await page.getByText("2 wallet confirmations", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Open 42 cards", exact: true })
    .click();
  await page
    .getByText("Your daily cards are on their way. Open a reveal below.")
    .waitFor();
  assert.deepEqual(
    await page.evaluate(() => window.__sentGroups.map((group) => group.length)),
    [20, 1]
  );
  console.log(
    "PASS: collections larger than twenty originals split into the minimum number of native transactions"
  );
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
