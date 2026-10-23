// Actual panel, hook and receipt validator; synthetic clients only.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createServer, transformWithEsbuild } from "vite";

const { values } = parseArgs({
  options: {
    filter: { type: "string", default: "all" },
    output: {
      type: "string",
      default: "/tmp/yunipals-ypal-wrap-browser-20261023.json"
    },
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
assert(["all", "receipt"].includes(values.filter), "Unknown wrap test filter");
const root = fileURLToPath(new URL("..", import.meta.url));
process.chdir(root);
const pkg = JSON.parse(
  await readFile(root + "/public/boosters/ypal-fresh-launch-v1.json", "utf8")
);
const buttonSource = await readFile(
  root + "/src/pages/boosters/BoosterActionButton.tsx",
  "utf8"
);
const buttonClass = JSON.parse(
  buttonSource.match(/export const boosterButtonClass\s*=\s*("[^"\n]+");/)[1]
);
const ids = {
  fixture: "virtual:ypal-wrap-fixture.ts",
  entry: "virtual:ypal-wrap-entry.tsx",
  wagmi: "virtual:ypal-wrap-wagmi.ts",
  rainbow: "virtual:ypal-wrap-rainbow.ts",
  action: "virtual:ypal-wrap-action.ts",
  fees: "virtual:ypal-wrap-fees.ts"
};
const fixture = `
import {encodeAbiParameters,encodeEventTopics,decodeFunctionData,erc20Abi,hashDomain,parseAbiParameters} from 'viem';
import {validateYpalLaunchPackage,ypalRuntime} from '/src/lib/boosterYpalDeployment';
import {ypalWrapAbi,ypalWrapManifestSha256,ypalWrapPmon,ypalWrapToken} from '/src/lib/ypalWrap';
const bundle=validateYpalLaunchPackage(${JSON.stringify(pkg)});
export const deployment={confirmed:true,manifestSha256:ypalWrapManifestSha256,chainId:8453,ypal:ypalWrapToken,pmon:ypalWrapPmon};
export const scenario=new URLSearchParams(location.search).get('scenario')||'normal';
const owner='0x1111111111111111111111111111111111111111',zero='0x0000000000000000000000000000000000000000';
const blockHash='0x'+'cd'.repeat(32),runtime=ypalRuntime(bundle.artifacts.ypal,ypalWrapToken,ypalWrapPmon);
const types={EIP712Domain:[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}]};
const saved=JSON.parse(sessionStorage.getItem('wrap-fixture')||'null');
const state=saved||{allowance:scenario==='allowance'||scenario.startsWith('defer')?'100000000000000000000':'0',pmon:'100000000000000000000',ypal:'0',records:[],sequence:0,settled:false};
const save=()=>sessionStorage.setItem('wrap-fixture',JSON.stringify(state));
let identity={address:owner,chainId:8453},wallet;const listeners=new Set();let deferred=null;
window.__wrapSends=[];window.__wrapReads=0;window.__wrapHooks=0;window.__wrapContextReads=0;
function persistRecord(record){const i=state.records.findIndex(x=>x.hash===record.hash);if(i<0)state.records.push(record);else state.records[i]=record;save();}
function apply(record){if(record.applied||record.cancel||record.revert)return;record.applied=true;
 if(record.kind==='approve')state.allowance=record.amount;
 else{state.pmon=String(BigInt(state.pmon)-BigInt(record.amount));state.ypal=String(BigInt(state.ypal)+BigInt(record.amount));state.allowance=String(BigInt(state.allowance)-BigInt(record.amount));}persistRecord(record);}
async function barrier(kind){if(window.__wrapDefer===kind){window.__wrapReached=true;await new Promise(resolve=>deferred=resolve);}}
function refreshWallet(){wallet={account:{address:identity.address},chain:{id:identity.chainId},getChainId:async()=>identity.chainId,getAddresses:async()=>{await barrier('provider');return[identity.address];},
 async sendTransaction(input){window.__wrapSends.push({to:input.to,data:input.data,value:String(input.value)});
  if(input.value!==0n||input.nonce!==undefined||input.account!==owner)throw Error('Invalid synthetic wallet entry');
  const approval=input.to.toLowerCase()===ypalWrapPmon.toLowerCase(),decoded=decodeFunctionData({abi:approval?erc20Abi:ypalWrapAbi,data:input.data});
  if(decoded.functionName!==(approval?'approve':'wrap'))throw Error('Unexpected function');
  if(approval&&decoded.args[0].toLowerCase()!==ypalWrapToken.toLowerCase())throw Error('Wrong spender');
  const amount=decoded.args[approval?1:0];const hash='0x'+(++state.sequence).toString(16).padStart(64,'0');
  const record={hash,kind:approval?'approve':'wrap',amount:String(amount),input:input.data,to:input.to,cancel:scenario==='cancel',revert:scenario==='revert'};
  persistRecord(record);if(scenario!=='pending')apply(record);return hash;
 }};}
refreshWallet();
export const subscribe=listener=>{listeners.add(listener);return()=>listeners.delete(listener);};
export const snapshot=()=>identity;export const signing=()=>wallet;
export function setIdentity(chainId,address=owner){identity={chainId,address};refreshWallet();for(const fn of listeners)fn();}
window.__wrapIdentity=setIdentity;
window.__wrapRelease=()=>{const resolve=deferred;deferred=null;window.__wrapDefer=false;resolve?.();};
window.__wrapSettle=()=>{state.settled=true;for(const record of state.records)apply(record);save();};
function record(hash){const value=state.records.find(x=>x.hash===hash);if(!value)throw Error('Unknown synthetic transaction');return value;}
function transaction(value){return{hash:value.hash,blockHash,blockNumber:100n,chainId:8453,from:owner,to:value.cancel?owner:value.to,input:value.cancel?'0x':value.input,value:0n,nonce:5};}
function receipt(value){const amount=BigInt(value.amount);let n=0;const log=(address,topics)=>({address,topics,data:encodeAbiParameters(parseAbiParameters('uint256'),[amount]),blockHash,blockNumber:100n,transactionHash:value.hash,transactionIndex:0,logIndex:n++,removed:false});
 const logs=value.cancel||value.revert?[]:value.kind==='approve'?[log(ypalWrapPmon,encodeEventTopics({abi:erc20Abi,eventName:'Approval',args:{owner,spender:ypalWrapToken}}))]:[
  log(ypalWrapToken,encodeEventTopics({abi:ypalWrapAbi,eventName:'Wrap',args:{user:owner}})),log(ypalWrapToken,encodeEventTopics({abi:erc20Abi,eventName:'Transfer',args:{from:zero,to:owner}})),log(ypalWrapPmon,encodeEventTopics({abi:erc20Abi,eventName:'Transfer',args:{from:owner,to:ypalWrapToken}}))];
 return{transactionHash:value.hash,blockHash,blockNumber:100n,status:value.revert?'reverted':'success',logs};}
export const client={
 getChainId:async()=>8453,getBlockNumber:async()=>200n,getBlock:async()=>({hash:blockHash}),
 getCode:async()=>{window.__wrapReads++;return scenario==='bad-code'?'0x6000':runtime;},
 readContract:async input=>{window.__wrapReads++;switch(input.functionName){case'pmon':return ypalWrapPmon;case'name':return'Yunipals';case'symbol':return'YPAL';case'decimals':return 18;case'DOMAIN_SEPARATOR':return hashDomain({domain:{name:'Yunipals',version:'1',chainId:8453n,verifyingContract:ypalWrapToken},types});case'balanceOf':return BigInt(input.address.toLowerCase()===ypalWrapPmon.toLowerCase()?state.pmon:state.ypal);case'allowance':return BigInt(state.allowance);default:throw Error('Unexpected read');}},
 estimateFeesPerGas:async()=>({maxFeePerGas:1000000000n,maxPriorityFeePerGas:100000000n}),estimateGas:async()=>100000n,getBalance:async()=>10n**20n,
 call:async()=>{await barrier('call');return{data:'0x'};},
 getTransaction:async({hash})=>{
  const value=transaction(record(hash));
  if(scenario==='receipt-stale'||scenario==='receipt-transient'){
   window.__wrapContextReads++;
   if(!state.settled&&(scenario==='receipt-stale'||window.__wrapContextReads<=2))return{...value,blockHash:null,blockNumber:null};
  }
  return value;
 },
 getTransactionReceipt:async({hash})=>{if(scenario==='pending'&&!state.settled){const e=Error('Pending');e.name='TransactionReceiptNotFoundError';throw e;}return receipt(record(hash));},
 waitForTransactionReceipt:async({hash,onReplaced})=>{
  if(scenario==='pending'&&!state.settled)throw Error('Synthetic timeout; hash retained');
  if(scenario==='repriced'||scenario==='cancel'){const prior=record(hash),next={...prior,hash:'0x'+(++state.sequence).toString(16).padStart(64,'0')};persistRecord(next);
   onReplaced?.({reason:scenario==='cancel'?'cancelled':'repriced',replacedTransaction:{...transaction(prior),to:prior.to,input:prior.input},transaction:transaction(next),transactionReceipt:receipt(next)});return receipt(next);}
  return receipt(record(hash));}
};
`;
const modules = {
  [ids.fixture]: fixture,
  [ids.wagmi]: `import {useSyncExternalStore} from 'react';import {subscribe,snapshot,signing,client,setIdentity} from '${ids.fixture}';export function useAccount(){window.__wrapHooks++;return{...useSyncExternalStore(subscribe,snapshot),isConnected:true};}export function useWalletClient(){useSyncExternalStore(subscribe,snapshot);return{data:signing()};}export const usePublicClient=()=>client;export const useSwitchChain=()=>({switchChain:({chainId})=>setIdentity(chainId)});`,
  [ids.rainbow]: `export const useConnectModal=()=>({openConnectModal:()=>{}});`,
  [ids.action]: `export const boosterButtonClass=${JSON.stringify(buttonClass)};`,
  [ids.fees]: `export const estimateL1Fee=async()=>1000n;`,
  [ids.entry]: `import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{BoosterYpalWrap}from'/src/pages/boosters/BoosterYpalWrap';import{deployment,scenario}from'${ids.fixture}';import '/src/globals.css';const root=createRoot(document.getElementById('root'));window.__wrapUnmount=()=>root.unmount();function MountedPanel(){React.useEffect(()=>{window.__wrapReady=true;},[]);return <BoosterYpalWrap deployment={scenario==='inactive'?null:deployment}/>;}root.render(<React.StrictMode><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MountedPanel/></QueryClientProvider></React.StrictMode>);`
};
const cacheDir = await mkdtemp(join(tmpdir(), "yunipals-wrap-vite-"));
const server = await createServer({
  root,
  cacheDir,
  configFile: false,
  optimizeDeps: {
    noDiscovery: true,
    entries: [],
    include: [
      "react",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react-dom/client",
      "@tanstack/react-query",
      "viem",
      "viem/chains",
      "zod"
    ]
  },
  server: { host: "127.0.0.1", port: 5207, strictPort: true, watch: null },
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": root + "/src",
      "@protopals/yunipals-market-core": fileURLToPath(
        new URL("../../../packages/yunipals-market-core/src", import.meta.url)
      )
    }
  },
  plugins: [
    {
      name: "isolated-wrap-check",
      enforce: "pre",
      resolveId(id, importer) {
        if (Object.hasOwn(modules, id)) return "\0" + id;
        if (id === "wagmi") return "\0" + ids.wagmi;
        if (id === "@rainbow-me/rainbowkit") return "\0" + ids.rainbow;
        if (id === "viem/op-stack") return "\0" + ids.fees;
        if (
          id.endsWith("/BoosterActionButton") &&
          importer?.includes("/pages/boosters/")
        )
          return "\0" + ids.action;
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
          if (req.url?.split("?")[0] !== "/__wrap-check") return next();
          res.setHeader("Content-Type", "text/html");
          res.end(
            await vite.transformIndexHtml(
              req.url,
              `<html><body><div id="root"></div><script type="module" src="/@id/__x00__${ids.entry}"></script></body></html>`
            )
          );
        });
      }
    }
  ]
});
const report = {
  format: "yunipals-ypal-wrap-ui-acceptance-v1",
  observedAt: new Date().toISOString(),
  fixturesOnly: true,
  testFilter: values.filter,
  providerCalls: 0,
  realTransactions: 0,
  realSignatures: 0,
  checks: [],
  externalRequests: [],
  browserErrors: [],
  moduleFailures: [],
  consoleDiagnostics: [],
  screenshots: [],
  sourceSha256: {}
};
for (const path of [
  "src/lib/ypalWrap.ts",
  "src/lib/ypalWrap.test.ts",
  "src/hooks/useYpalWrap.ts",
  "src/pages/boosters/BoosterYpalWrap.tsx",
  "scripts/test-ypal-wrap-ui.mjs"
])
  report.sourceSha256[path] = createHash("sha256")
    .update(await readFile(root + "/" + path))
    .digest("hex");
let browser;
try {
  await server.listen();
  const origin = "http://127.0.0.1:" + server.httpServer.address().port;
  const { chromium } = await import(pathToFileURL(values.playwright).href);
  browser = await chromium.launch({
    executablePath: values.chromium,
    args: ["--no-sandbox"]
  });
  async function visit(scenario = "normal") {
    const context = await browser.newContext({
      viewport: { width: 900, height: 900 }
    });
    await context.route("**/*", (route) => {
      if (
        route
          .request()
          .url()
          .startsWith(origin + "/") &&
        route.request().method() === "GET"
      )
        return route.continue();
      report.externalRequests.push(
        route.request().method() + ":" + route.request().resourceType()
      );
      return route.abort("blockedbyclient");
    });
    await context.routeWebSocket("**/*", (socket) => {
      if (new URL(socket.url()).origin === origin.replace(/^http/, "ws"))
        socket.connectToServer();
      else socket.close();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => report.browserErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && report.consoleDiagnostics.length < 8) {
        const text = message.text().slice(0, 500);
        report.consoleDiagnostics.push(text);
        console.log(JSON.stringify({ fixtureConsoleError: text }));
      }
    });
    page.on("response", async (response) => {
      if (response.status() >= 400 && report.moduleFailures.length < 8) {
        const raw = await response.body().catch(() => Buffer.alloc(0));
        const item = {
          path: new URL(response.url()).pathname,
          status: response.status(),
          bodySha256: createHash("sha256").update(raw).digest("hex"),
          outdatedOptimizer: raw.includes(Buffer.from("Outdated Optimize Dep"))
        };
        report.moduleFailures.push(item);
        console.log(JSON.stringify({ fixtureModuleFailure: item }));
      }
    });
    await page.goto(origin + "/__wrap-check?scenario=" + scenario, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
    try {
      await page.waitForFunction(() => window.__wrapReady === true, undefined, {
        timeout: 45000
      });
    } catch (error) {
      report.loadDiagnostic = await page.evaluate(() => ({
        ready: window.__wrapReady ?? null,
        hooks: window.__wrapHooks ?? null,
        reads: window.__wrapReads ?? null,
        body: document.body.innerText.slice(0, 300),
        rootChildren: document.getElementById("root")?.childElementCount
      }));
      throw error;
    }
    return { page, context };
  }
  async function check(name, action) {
    if (
      values.filter === "receipt" &&
      !/^(Pending hash|Mined receipt|Transient receipt)/.test(name)
    )
      return;
    await action();
    assert.deepEqual(report.browserErrors, []);
    assert.deepEqual(report.externalRequests, []);
    report.checks.push({ name, passed: true });
  }
  const review = (page, kind) =>
    page.getByRole("button", {
      name: kind === "approve" ? "Review PMON approval" : "Review wrap",
      exact: true
    });
  const confirm = (page, kind) =>
    page.getByRole("button", {
      name: kind === "approve" ? "Confirm exact approval" : "Confirm wrap",
      exact: true
    });
  await check(
    "Inactive deployment renders no panel and performs no wallet or RPC reads",
    async () => {
      const { page, context } = await visit("inactive");
      assert.equal(
        await page.getByRole("heading", { name: "Get YPAL" }).count(),
        0
      );
      assert.deepEqual(
        await page.evaluate(() => [
          window.__wrapHooks,
          window.__wrapReads,
          window.__wrapSends.length
        ]),
        [0, 0, 0]
      );
      await context.close();
    }
  );
  await check(
    "Exact PMON approval and 1:1 wrapping are two separately reviewed sends",
    async () => {
      const { page, context } = await visit();
      await page
        .getByLabel("PMON amount", { exact: true })
        .fill("1.234567890123456789");
      const desktop = "/tmp/yunipals-ypal-wrap-desktop-20261023.png";
      await page.screenshot({ path: desktop, fullPage: true });
      report.screenshots.push(desktop);
      await review(page, "approve").click({ noWaitAfter: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("dialog").waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth
        ),
        false
      );
      const mobile = "/tmp/yunipals-ypal-wrap-mobile-review-20261023.png";
      await page.screenshot({ path: mobile, fullPage: true });
      report.screenshots.push(mobile);
      await confirm(page, "approve").click({ noWaitAfter: true });
      await page
        .getByText(
          "PMON approval confirmed. Review the wrap action separately.",
          { exact: true }
        )
        .waitFor();
      assert.equal(await page.evaluate(() => window.__wrapSends.length), 1);
      await review(page, "wrap").click({ noWaitAfter: true });
      await confirm(page, "wrap").click({ noWaitAfter: true });
      await page
        .getByText(
          "Wrapped 1.234567890123456789 PMON into 1.234567890123456789 YPAL.",
          { exact: true }
        )
        .waitFor();
      assert.equal(await page.evaluate(() => window.__wrapSends.length), 2);
      assert.equal(
        await page
          .getByText("YPAL balance", { exact: true })
          .locator("..")
          .getByRole("definition")
          .getAttribute("title"),
        "1.234567890123456789"
      );
      await context.close();
    }
  );
  await check(
    "Existing sufficient allowance wraps directly with one send",
    async () => {
      const { page, context } = await visit("allowance");
      await review(page, "wrap").click({ noWaitAfter: true });
      await confirm(page, "wrap").click({ noWaitAfter: true });
      await page
        .getByText("Wrapped 1 PMON into 1 YPAL.", { exact: true })
        .waitFor();
      assert.equal(await page.evaluate(() => window.__wrapSends.length), 1);
      await context.close();
    }
  );
  await check(
    "Zero, too many decimals and insufficient PMON cannot prepare",
    async () => {
      const { page, context } = await visit();
      for (const amount of ["0", "1.0000000000000000001", "101"]) {
        await page.getByLabel("PMON amount", { exact: true }).fill(amount);
        assert.equal(
          await page
            .getByRole("button", { name: /^Review (?:PMON approval|wrap)$/ })
            .isDisabled(),
          true
        );
      }
      assert.equal(await page.evaluate(() => window.__wrapSends.length), 0);
      await context.close();
    }
  );
  await check("Wrong deployed runtime fails closed", async () => {
    const { page, context } = await visit("bad-code");
    await page.getByRole("alert").waitFor();
    assert.equal(await review(page, "wrap").isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__wrapSends.length), 0);
    await context.close();
  });
  await check(
    "Pending hash survives reload, blocks sends and resolves only its canonical receipt",
    async () => {
      const { page, context } = await visit("pending");
      await review(page, "approve").click({ noWaitAfter: true });
      await confirm(page, "approve").click({ noWaitAfter: true });
      await page
        .getByText("Saved PMON approval transaction", { exact: true })
        .waitFor();
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.__wrapReady === true, undefined, {
        timeout: 45000
      });
      assert.equal(await review(page, "approve").isDisabled(), true);
      await page
        .getByRole("button", { name: "Check pending transaction" })
        .click({ noWaitAfter: true });
      await page
        .getByText("Confirming on Base. Your transaction hash is saved.", {
          exact: true
        })
        .waitFor();
      assert.equal(await page.evaluate(() => window.__wrapSends.length), 0);
      await page.evaluate(() => window.__wrapSettle());
      await page
        .getByRole("button", { name: "Check pending transaction" })
        .click({ noWaitAfter: true });
      await page
        .getByText(
          "PMON approval confirmed. Review the wrap action separately.",
          { exact: true }
        )
        .waitFor();
      assert.equal(await page.evaluate(() => window.__wrapSends.length), 0);
      await context.close();
    }
  );
  await check(
    "Mined receipt with stale transaction context survives reload and manually recovers without resending",
    async () => {
      const { page, context } = await visit("receipt-stale");
      await review(page, "approve").click({ noWaitAfter: true });
      await confirm(page, "approve").click({ noWaitAfter: true });
      await page
        .getByText("Confirming on Base. Your transaction hash is saved.", {
          exact: true
        })
        .waitFor();
      assert.equal(await page.evaluate(() => window.__wrapSends.length), 1);
      assert.equal(await page.evaluate(() => window.__wrapContextReads), 3);
      assert.equal(
        await page
          .getByRole("button", { name: /^Review (?:PMON approval|wrap)$/ })
          .isDisabled(),
        true
      );
      const saved = await page.evaluate(() =>
        Object.entries(localStorage).find(([key]) =>
          key.startsWith("yunipals/ypal-wrap/v1/")
        )
      );
      assert(saved && JSON.parse(saved[1]).hash);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.__wrapReady === true, undefined, {
        timeout: 45000
      });
      await page
        .getByRole("button", { name: "Check pending transaction", exact: true })
        .click({ noWaitAfter: true });
      await page
        .getByText("Confirming on Base. Your transaction hash is saved.", {
          exact: true
        })
        .waitFor();
      assert.equal(await page.evaluate(() => window.__wrapSends.length), 0);
      assert.equal(await page.evaluate(() => window.__wrapContextReads), 3);
      const retained = await page.evaluate(() =>
        Object.entries(localStorage).find(([key]) =>
          key.startsWith("yunipals/ypal-wrap/v1/")
        )
      );
      assert.deepEqual(retained, saved);
      await page.evaluate(() => window.__wrapSettle());
      await page
        .getByRole("button", { name: "Check pending transaction", exact: true })
        .click({ noWaitAfter: true });
      await page
        .getByText(
          "PMON approval confirmed. Review the wrap action separately.",
          { exact: true }
        )
        .waitFor();
      assert.equal(await page.evaluate(() => window.__wrapSends.length), 0);
      assert.equal(
        await page
          .getByRole("button", {
            name: "Check pending transaction",
            exact: true
          })
          .count(),
        0
      );
      await context.close();
    }
  );
  await check(
    "Transient receipt context recovers on the third read without another wallet entry",
    async () => {
      const { page, context } = await visit("receipt-transient");
      await review(page, "approve").click({ noWaitAfter: true });
      await confirm(page, "approve").click({ noWaitAfter: true });
      await page
        .getByText(
          "PMON approval confirmed. Review the wrap action separately.",
          { exact: true }
        )
        .waitFor();
      assert.equal(await page.evaluate(() => window.__wrapContextReads), 3);
      assert.equal(await page.evaluate(() => window.__wrapSends.length), 1);
      assert.equal(
        await page
          .getByRole("button", {
            name: "Check pending transaction",
            exact: true
          })
          .count(),
        0
      );
      await context.close();
    }
  );
  for (const scenario of ["repriced", "cancel", "revert"])
    await check(
      "Canonical " +
        scenario +
        " receipt resolves without another automatic send",
      async () => {
        const { page, context } = await visit(scenario);
        await review(page, "approve").click({ noWaitAfter: true });
        await confirm(page, "approve").click({ noWaitAfter: true });
        await page
          .getByText(
            scenario === "repriced"
              ? "PMON approval confirmed. Review the wrap action separately."
              : "The transaction is confirmed cancelled or reverted. Review a fresh action when ready.",
            { exact: true }
          )
          .waitFor();
        assert.equal(await page.evaluate(() => window.__wrapSends.length), 1);
        await context.close();
      }
    );
  for (const mode of [
    "network",
    "account",
    "dismiss",
    "unmount",
    "provider-network"
  ])
    await check(
      "Deferred final " +
        mode +
        " invalidation makes zero wallet-entry attempts",
      async () => {
        const { page, context } = await visit("defer-" + mode);
        await review(page, "wrap").click({ noWaitAfter: true });
        await page.getByRole("dialog").waitFor();
        await page.evaluate(
          (mode) =>
            (window.__wrapDefer =
              mode === "provider-network" ? "provider" : "call"),
          mode
        );
        await confirm(page, "wrap").click({ noWaitAfter: true });
        await page.waitForFunction(() => window.__wrapReached);
        if (mode === "network" || mode === "provider-network") {
          await page.evaluate(() => window.__wrapIdentity(1));
          await page.waitForTimeout(50);
          await page.evaluate(() => window.__wrapIdentity(8453));
        }
        if (mode === "account") {
          await page.evaluate(() =>
            window.__wrapIdentity(
              8453,
              "0x2222222222222222222222222222222222222222"
            )
          );
          await page.waitForTimeout(50);
          await page.evaluate(() => window.__wrapIdentity(8453));
        }
        if (mode === "dismiss")
          await page
            .getByRole("button", { name: "Cancel review" })
            .click({ noWaitAfter: true });
        if (mode === "unmount")
          await page.evaluate(() => window.__wrapUnmount());
        await page.evaluate(() => window.__wrapRelease());
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => window.__wrapSends.length), 0);
        await context.close();
      }
    );
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.message;
  throw error;
} finally {
  await writeFile(values.output, JSON.stringify(report, null, 2) + "\n");
  await browser?.close();
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
console.log(
  JSON.stringify({
    passed: report.passed,
    checks: report.checks.length,
    output: values.output
  })
);
