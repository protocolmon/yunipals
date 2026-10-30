// Real deployment component and verifier with local synthetic wallet/RPC clients.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer, transformWithEsbuild } from "vite";
import ts from "typescript";
const root = fileURLToPath(new URL("..", import.meta.url));
const output = process.argv[2] ?? "/tmp/yunipals-anime-pilot-ui";
await mkdir(output, { recursive: true });
const fixture = `import {decodeFunctionData} from 'viem';import {animePilot} from '/src/lib/animePilot';import {animeRegistryAbi} from '@protopals/yunipals-market-core/animeRegistryAbi';import {animeArenaAbi} from '@protopals/yunipals-market-core/animeArenaAbi';
const listeners=new Set();const mode=new URLSearchParams(location.search).get('wallet')||'admin';let identity={address:mode==='admin'?animePilot.admin:mode==='pilot'?animePilot.wallet:'0x1111111111111111111111111111111111111111',chainId:8453};let open=sessionStorage.getItem('pilot-open')==='true';const applied=new Set(JSON.parse(sessionStorage.getItem('pilot-applied')||'[]'));window.__sends=[];let wallet;let paused=new URLSearchParams(location.search).get('paused')!=='false';const quoteMode=new URLSearchParams(location.search).get('quote');let quote=quoteMode==='high'?20000000000000n:4900000000000n;window.__setQuote=value=>{quote=BigInt(value)};const approved=new URLSearchParams(location.search).get('stage')==='approved';let balance=BigInt(sessionStorage.getItem('pilot-reserve')||'0');
function refresh(){wallet={account:{address:identity.address},async sendTransaction(input){if(input.chain.id!==8453)throw Error('wrong network');if(input.to===animePilot.arena&&input.data==='0x'){if(input.value!==animePilot.reserveWei-balance||input.value>10000000000000n)throw Error('wrong reserve payment');balance+=input.value;sessionStorage.setItem('pilot-reserve',String(balance));window.__sends.push('fund');return '0x'+'ab'.repeat(32);}const decoded=decodeFunctionData({abi:input.to===animePilot.arena?animeArenaAbi:animeRegistryAbi,data:input.data});if(decoded.functionName==='setEntriesPaused'){paused=decoded.args[0];}else if(decoded.functionName==='setApplicationsOpen'){open=decoded.args[0];sessionStorage.setItem('pilot-open',String(open));}else if(decoded.functionName==='applyForArena'){applied.add(String(decoded.args[0]));sessionStorage.setItem('pilot-applied',JSON.stringify([...applied]));}else throw Error('unexpected send');window.__sends.push(decoded.functionName);return '0x'+'ab'.repeat(32);}};}refresh();
export const subscribe=f=>{listeners.add(f);return()=>listeners.delete(f)};export const snapshot=()=>identity;export const signing=()=>wallet;export const setIdentity=window.__identity=(chainId,address=identity.address)=>{identity={address,chainId};refresh();for(const f of listeners)f();};
export const client={getBlockNumber:async()=>100n,getGasPrice:async()=>6000000n,getBalance:async()=>balance,call:async()=>({data:'0x'}),waitForTransactionReceipt:async()=>({status:'success'}),async readContract(input){switch(input.functionName){case'owner':case'curator':return animePilot.admin;case'applicationsOpen':return open;case'entriesPaused':return paused;case'rulesHash':return animePilot.rulesHash;case'eligibility':return animePilot.registry;case'maxVrfCost':return animePilot.reserveWei;case'estimateRequestPriceNative':if(input.args[2]!==12000000n)throw Error('draw quote omitted gas buffer');if(quoteMode==='unavailable')throw Error('price unavailable');return quote;case'ownerOf':return animePilot.wallet;case'fighters':return [approved?2:applied.has(String(input.args[0]))?1:0,0,0,'0x'+'00'.repeat(32)];default:throw Error('unexpected read');}}};`;
const modules = {
  "virtual:anime-environment.ts": `export const environment={animeArenaApiUrl:"http://127.0.0.1:5209/__pilot-api",arenaApiUrl:null};`,
  "virtual:anime-fixture.ts": fixture,
  "virtual:anime-wagmi.ts": `import {useSyncExternalStore} from 'react';import {subscribe,snapshot,signing,client,setIdentity} from 'virtual:anime-fixture.ts';export const useAccount=()=>useSyncExternalStore(subscribe,snapshot);export function useWalletClient(){useSyncExternalStore(subscribe,snapshot);return{data:signing()};}export const usePublicClient=()=>client;export const useSwitchChain=()=>({switchChainAsync:async({chainId})=>setIdentity(chainId)});`,
  "virtual:anime-rainbow.ts": `export const useConnectModal=()=>({openConnectModal:()=>{}});`,
  "virtual:anime-entry.tsx": `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {MemoryRouter} from 'react-router-dom';import {AnimePilotPage} from '/src/pages/arena/anime/AnimePilotPage';createRoot(document.getElementById('root')).render(<MemoryRouter><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><AnimePilotPage/></QueryClientProvider></MemoryRouter>);`
};
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
      name: "anime-setup-fixture",
      enforce: "pre",
      resolveId(id) {
        if (id === "@/environment" || /\/src\/environment(?:\.ts)?$/.test(id))
          return "\0virtual:anime-environment.ts";
        if (modules[id]) return "\0" + id;
        if (id === "wagmi") return "\0virtual:anime-wagmi.ts";
        if (id === "@rainbow-me/rainbowkit")
          return "\0virtual:anime-rainbow.ts";
        if (id === "viem/op-stack") return "\0virtual:anime-fees.ts";
      },
      load(id) {
        if (id.startsWith("\0") && modules[id.slice(1)])
          return modules[id.slice(1)];
      },
      async transform(code, id) {
        if (id.startsWith("\0virtual:"))
          return transformWithEsbuild(code, id.slice(1), {
            loader: id.endsWith("tsx") ? "tsx" : "ts",
            jsx: "automatic"
          });
      },
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (req.url === "/__pilot-api/config") {
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                chainId: 8453,
                entryMode: "pilot",
                entriesEnabled: true,
                contract: "0x576790deff75af86fa638d9a1427e1eee7007094",
                eligibilityRegistry:
                  "0xdbcab53a8e32d43997de252fd49c43ab8df290bf"
              })
            );
          } else if (req.url?.startsWith("/__anime-setup")) {
            res.setHeader("Content-Type", "text/html");
            res.end(
              '<!doctype html><html><head><link rel="stylesheet" href="/src/globals.css"></head><body><div id="root"></div><script type="module" src="/@id/__x00__virtual:anime-entry.tsx"></script></body></html>'
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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort()
  );
  await page.goto("http://127.0.0.1:5209/__anime-setup?wallet=admin");
  await page
    .getByRole("button", { name: "Open applications", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Enable controlled paid pilot" })
      .isDisabled(),
    true
  );
  await page
    .getByRole("button", { name: "Open applications", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Close applications", exact: true })
    .waitFor();
  assert.deepEqual(await page.evaluate(() => window.__sends), [
    "setApplicationsOpen"
  ]);
  await page.getByRole("button", { name: /Fund draw reserve/ }).click();
  await page.waitForFunction(() => window.__sends.length === 2);
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some(
      (b) => b.textContent.includes("Fund draw reserve") && b.disabled
    )
  );
  assert.deepEqual(await page.evaluate(() => window.__sends), [
    "setApplicationsOpen",
    "fund"
  ]);
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem("pilot-reserve")),
    "10000000000000"
  );
  await page.goto("http://127.0.0.1:5209/__anime-setup?wallet=pilot");
  await page
    .getByRole("button", { name: "Apply for this fighter" })
    .first()
    .waitFor();
  assert.equal(
    await page
      .getByRole("heading", { name: "Deployment wallet controls" })
      .count(),
    0
  );
  for (let i = 0; i < 4; i++) {
    await page
      .getByRole("button", { name: "Apply for this fighter" })
      .first()
      .click();
    await page.waitForFunction(
      (n) =>
        [...document.querySelectorAll("button")].filter(
          (b) => b.textContent === "Apply for this fighter"
        ).length ===
        4 - n,
      i + 1
    );
  }
  assert.deepEqual(
    await page.evaluate(() => window.__sends),
    Array(4).fill("applyForArena")
  );
  await page.screenshot({ path: output + "/pilot-mobile.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    ),
    true
  );
  await page.goto(
    "http://127.0.0.1:5209/__anime-setup?wallet=admin&stage=approved"
  );
  await page
    .getByRole("button", { name: "Enable controlled paid pilot" })
    .click();
  await page.getByRole("button", { name: "Pause paid entry" }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__sends), [
    "setEntriesPaused"
  ]);
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem("pilot-open")),
    "true"
  );
  await page.goto(
    "http://127.0.0.1:5209/__anime-setup?wallet=admin&stage=approved&quote=high"
  );
  await page.getByText(/Base gas is currently too high/).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Enable controlled paid pilot" })
      .isDisabled(),
    true
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Close applications", exact: true })
      .isEnabled(),
    true
  );
  for (const name of [
    "Yellow Yunidonkey",
    "Red Yuniturtle",
    "Yellow Yunichick",
    "Green Yunichick"
  ])
    await page.getByRole("heading", { name, exact: true }).waitFor();
  await page.getByText(/Fixed draw cap: 0.00001 ETH/).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__sends), []);
  await page.screenshot({
    path: output + "/high-gas-mobile.png",
    fullPage: true
  });
  await page
    .getByRole("button", { name: "Close applications", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open applications", exact: true })
    .waitFor();
  assert.deepEqual(await page.evaluate(() => window.__sends), [
    "setApplicationsOpen"
  ]);

  for (const quote of ["high", "unavailable"]) {
    await page.goto(
      `http://127.0.0.1:5209/__anime-setup?wallet=admin&stage=approved&paused=false&quote=${quote}`
    );
    await page
      .getByRole("button", { name: "Pause paid entry", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Enable controlled paid pilot" })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Enable controlled paid pilot" })
        .isDisabled(),
      true
    );
    assert.deepEqual(await page.evaluate(() => window.__sends), [
      "setEntriesPaused"
    ]);
    await page
      .getByRole("heading", { name: "Red Yuniturtle", exact: true })
      .waitFor();
  }

  await page.goto(
    "http://127.0.0.1:5209/__anime-setup?wallet=admin&stage=approved"
  );
  await page
    .getByRole("button", { name: "Enable controlled paid pilot" })
    .waitFor();
  await page.evaluate(() => window.__setQuote("20000000000000"));
  await page
    .getByRole("button", { name: "Enable controlled paid pilot" })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Base gas is currently too high" })
    .waitFor();
  assert.deepEqual(await page.evaluate(() => window.__sends), []);
  await page.goto("http://127.0.0.1:5209/__anime-setup?wallet=other");
  await page
    .getByText("Connect the deployment wallet for owner controls")
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Apply for this fighter" }).count(),
    0
  );
  assert.equal(
    await page
      .getByRole("heading", { name: "Deployment wallet controls" })
      .count(),
    0
  );
  assert.deepEqual(errors, []);
  await writeFile(
    output + "/report.json",
    JSON.stringify(
      {
        passed: true,
        checks: [
          "owner opens applications",
          "entry remains gated",
          "high gas keeps fighter cards and owner controls visible",
          "high gas blocks enabling even with a funded reserve",
          "applications can be changed while the draw exceeds its cap",
          "pause remains available during high gas and quote outages",
          "fresh quote revalidation prevents signing above the cap",
          "approved pilot enables while applications stay open",
          "draw quote includes buffered gas",
          "reserve payment matches the reviewed cap",
          "pilot applies for all four",
          "other wallets have no controls",
          "mobile has no overflow",
          "no page errors"
        ]
      },
      null,
      2
    )
  );
  console.log("Anime pilot browser checks passed.");
} finally {
  await browser.close();
  await server.close();
}
