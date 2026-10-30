// Real deployment UI/verifier; all wallet/RPC effects are local synthetic data.
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer, transformWithEsbuild } from "vite";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = process.argv[2] ?? "/tmp/yunipals-shared-arena-setup-ui";
await mkdir(output, { recursive: true });
const source = await readFile(
  root + "/src/lib/sharedArenaDeployment.test.ts",
  "utf8"
);
const tree = ts.createSourceFile(
  "fixture.ts",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
);
const declarations = tree.statements
  .filter(
    (n) =>
      (ts.isFunctionDeclaration(n) && n.name?.text === "fixture") ||
      (ts.isVariableStatement(n) &&
        n.declarationList.declarations.some((d) =>
          ["hash", "blockHash", "owner", "address"].includes(
            d.name.getText(tree)
          )
        ))
  )
  .map((n) => n.getText(tree))
  .join("\n");
const raw = await readFile(
  root + "/public/arena/shared-arena-deployment-v2.json",
  "utf8"
);
const fixture = `import {getContractAddress} from 'viem';import {sharedArenaCreation,sharedArenaDeploymentSha256} from '/src/lib/sharedArenaDeployment';
const assert={equal(a,b){if(a!==b)throw Error('fixture assertion')}};const bundle=${raw};${declarations}
const f=fixture(),scenario=new URLSearchParams(location.search).get('scenario')||'normal';
const key='yunipals/shared-arena/'+sharedArenaDeploymentSha256+'/'+owner.toLowerCase();
if(sessionStorage.getItem('shared-current-scenario')!==scenario){sessionStorage.setItem('shared-current-scenario',scenario);localStorage.removeItem(key);}
let sent=!!localStorage.getItem(key);window.__sends=[];let identity={address:owner,chainId:8453};const listeners=new Set();
export const subscribe=f=>{listeners.add(f);return()=>listeners.delete(f)};export const snapshot=()=>identity;
window.__identity=(chainId,address=owner)=>{identity={address,chainId};for(const f of listeners)f();};export const setIdentity=window.__identity;
export const signing=()=>({account:{address:identity.address},async sendTransaction(input){
 if(input.value!==0n||input.chain.id!==8453||input.data!==sharedArenaCreation(bundle)||input.account!==owner)throw Error('Wrong wallet request');
 window.__sends.push(input.data);sent=true;return hash;}});
f.reader.getTransactionReceipt=async()=>{if(!sent||scenario==='pending')throw Error('Transaction pending');return{...f.state.receipt,status:scenario==='reverted'?'reverted':'success'}};
f.reader.estimateGas=async()=>1000000n;f.reader.estimateFeesPerGas=async()=>({maxFeePerGas:10000000n,maxPriorityFeePerGas:100000n});f.reader.call=async()=>({data:'0x'});
f.reader.waitForTransactionReceipt=async()=>{if(scenario==='pending')throw Error('Receipt timeout; transaction retained');return f.reader.getTransactionReceipt()};
const originalRead=f.reader.readContract;window.__modes={video:true,anime:true};window.__ownerCalls=[];
f.reader.readContract=async(input)=>input.blockNumber!==undefined?originalRead(input):input.functionName==='owner'?owner:window.__modes[Number(input.args?.[0])===0?'video':'anime'];
export async function ownerWrite(input){if(input.account!==owner||input.functionName!=='setEntriesPaused')throw Error('Wrong owner request');window.__ownerCalls.push(input.args);window.__modes[input.args[0]===0?'video':'anime']=input.args[1];return hash;}
export const client=f.reader;`;
const modules = {
  "virtual:shared-fixture.ts": fixture,
  "virtual:shared-wagmi.ts": `import {useSyncExternalStore} from 'react';import {subscribe,snapshot,signing,client,setIdentity,ownerWrite} from 'virtual:shared-fixture.ts';export const useAccount=()=>useSyncExternalStore(subscribe,snapshot);export function useWalletClient(){useSyncExternalStore(subscribe,snapshot);return{data:signing()};}export const useWriteContract=()=>({writeContractAsync:ownerWrite});export const usePublicClient=()=>client;export const useSwitchChain=()=>({switchChainAsync:async({chainId})=>setIdentity(chainId)});`,
  "virtual:shared-rainbow.ts": `export const useConnectModal=()=>({openConnectModal:()=>{}});`,
  "virtual:shared-entry.tsx": `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {MemoryRouter} from 'react-router-dom';import {SharedArenaSetupPage} from '/src/pages/arena/SharedArenaSetupPage';createRoot(document.getElementById('root')).render(<React.StrictMode><MemoryRouter><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><SharedArenaSetupPage/></QueryClientProvider></MemoryRouter></React.StrictMode>);`
};
const { getContractAddress } = await import("viem");
const fixtureBundle = JSON.parse(raw);
const fixtureAddress = getContractAddress({
  from: fixtureBundle.admin,
  nonce: 7n
});
const server = await createServer({
  root,
  configFile: false,
  cacheDir: output + "/vite-cache",
  server: { host: "127.0.0.1", port: 5209, strictPort: true },
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
      name: "shared-arena-setup-fixture",
      enforce: "pre",
      resolveId(id) {
        if (modules[id]) return "\0" + id;
        if (id === "wagmi") return "\0virtual:shared-wagmi.ts";
        if (id === "@rainbow-me/rainbowkit")
          return "\0virtual:shared-rainbow.ts";
      },
      load(id) {
        if (id.startsWith("\0") && modules[id.slice(1)])
          return modules[id.slice(1)];
      },
      async transform(code, id) {
        if (id.endsWith("/src/lib/sharedArenaLiveDeployment.ts"))
          return "export const sharedArenaConfirmedHash=null;";
        if (id.endsWith("/src/environment.ts"))
          return `export const environment={sharedArenaApiUrl:'http://127.0.0.1:5209/__mock/shared'};`;
        if (id.startsWith("\0virtual:"))
          return transformWithEsbuild(code, id.slice(1), {
            loader: id.endsWith("tsx") ? "tsx" : "ts",
            jsx: "automatic"
          });
      },
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (req.url?.startsWith("/__mock/shared/")) {
            const kind = req.url.split("/")[3],
              name = req.url.split("/")[4],
              bundle = JSON.parse(raw);
            const value =
              name === "config"
                ? {
                    chainId: 8453,
                    contract: undefined,
                    contractVersion: 2,
                    randomnessFunding: "first-entrant",
                    mediaKind: kind,
                    entriesEnabled: true,
                    entryMode: "pilot"
                  }
                : name === "health"
                  ? {
                      ok: true,
                      indexerMode: "unified",
                      sourceKind: "unified",
                      sourceEpoch: "test-only"
                    }
                  : { rulesHash: bundle.rulesHashes[kind] };
            // Same deterministic creation address as the verifier fixture.
            if (name === "config") value.contract = fixtureAddress;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(value));
          } else if (req.url?.startsWith("/__shared-setup")) {
            res.setHeader("Content-Type", "text/html");
            res.end(
              '<!doctype html><html><head><link rel="stylesheet" href="/src/globals.css"></head><body><div id="root"></div><script type="module" src="/@id/__x00__virtual:shared-entry.tsx"></script></body></html>'
            );
          } else next();
        });
      }
    }
  ]
});
await server.listen();
const require = createRequire(
  new URL("../../yunipals-anime-engine/package.json", import.meta.url)
);
const { chromium } = require("playwright-core");
const browser = await chromium.launch({
  executablePath: process.env.ANIME_CHROME,
  args: ["--no-sandbox"]
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (r) =>
    new URL(r.request().url()).hostname === "127.0.0.1"
      ? r.continue()
      : r.abort()
  );
  const go = (scenario) =>
    page.goto("http://127.0.0.1:5209/__shared-setup?scenario=" + scenario);
  const review = () =>
    page
      .getByRole("button", { name: "Review deployment fee", exact: true })
      .click();
  const deploy = () =>
    page
      .getByRole("button", { name: "Deploy shared Arena", exact: true })
      .click();
  await go("normal");
  await review();
  await page
    .getByRole("button", { name: "Deploy shared Arena", exact: true })
    .waitFor();
  await page.evaluate(() => window.__identity(1));
  await page
    .getByRole("button", { name: "Deploy shared Arena", exact: true })
    .waitFor({ state: "detached" });
  await review();
  await page.getByRole("alert").filter({ hasText: "Base selected" }).waitFor();
  await review();
  await deploy();
  await page.getByText("Verified shared Arena:", { exact: false }).waitFor();
  assert.equal((await page.evaluate(() => window.__sends)).length, 1);
  await page.getByText("Deployment record", { exact: true }).click();
  const record = JSON.parse(await page.locator("pre").textContent());
  assert.equal(record.version, "arena-modes-browser/confirmed-v2");
  assert.equal(record.registry, JSON.parse(raw).registry);
  await page.route("**/__mock/shared/anime/config", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        chainId: 8453,
        contract: "0x" + "9".repeat(40),
        contractVersion: 2,
        randomnessFunding: "first-entrant",
        mediaKind: "anime",
        entriesEnabled: true,
        entryMode: "pilot"
      })
    })
  );
  await page
    .getByRole("button", { name: "Enable anime pilot", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "not ready for its controlled pilot" })
    .waitFor();
  assert.deepEqual(await page.evaluate(() => window.__ownerCalls), []);
  await page.unroute("**/__mock/shared/anime/config");
  await page
    .getByRole("button", { name: "Enable anime pilot", exact: true })
    .click();
  await page.getByText("anime: entries open", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__ownerCalls), [
    [1, false]
  ]);
  await page.route("**/__mock/shared/anime/health", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "test-only outage" })
    })
  );
  await page
    .getByRole("button", { name: "Pause anime entries", exact: true })
    .click();
  await page.getByText("anime: entries paused", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__ownerCalls), [
    [1, false],
    [1, true]
  ]);
  await page.unroute("**/__mock/shared/anime/health");
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  );
  await page.screenshot({
    path: output + "/complete-mobile.png",
    fullPage: true
  });
  await page.reload();
  await page.getByText("Verified shared Arena:", { exact: false }).waitFor();
  assert.equal((await page.evaluate(() => window.__sends)).length, 0);
  await go("pending");
  await review();
  await deploy();
  await page
    .getByRole("alert")
    .filter({ hasText: "Receipt timeout" })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Deploy shared Arena", exact: true })
      .count(),
    0
  );
  await page.reload();
  await page
    .getByRole("link", { name: "View deployment transaction" })
    .waitFor();
  await page
    .getByRole("button", { name: "Clear a confirmed reverted transaction" })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "Deploy shared Arena", exact: true })
      .count(),
    0
  );
  await go("reverted");
  await review();
  await deploy();
  await page
    .getByRole("button", { name: "Clear a confirmed reverted transaction" })
    .waitFor();
  await page
    .getByRole("button", { name: "Clear a confirmed reverted transaction" })
    .click();
  await page
    .getByRole("button", { name: "Review deployment fee", exact: true })
    .waitFor();
  await go("wrong-wallet");
  await page.evaluate(() => window.__identity(8453, "0x" + "9".repeat(40)));
  await page
    .getByRole("alert")
    .filter({ hasText: "Connect the reviewed deployment wallet" })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Review deployment fee", exact: true })
      .count(),
    0
  );
  assert.deepEqual(errors, []);
  console.log(
    "Shared browser deployment and controls passed: exact creation, chain/wallet changes, wrong-service rejection, independent mode enable/pause, pause during outage, reload recovery, pending retention, reverted retry and mobile layout."
  );
} finally {
  await browser.close();
  await server.close();
}
