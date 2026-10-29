// Real deployment component and verifier with local synthetic wallet/RPC clients.
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer, transformWithEsbuild } from "vite";
import ts from "typescript";
const root = fileURLToPath(new URL("..", import.meta.url));
const output = process.argv[2] ?? "/tmp/yunipals-anime-setup-ui";
await mkdir(output, { recursive: true });
const source = await readFile(
  root + "/src/lib/animeDeployment.test.ts",
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
          ["owner", "hashes", "addresses"].includes(d.name.getText(tree))
        ))
  )
  .map((n) => n.getText(tree))
  .join("\n");
const raw = await readFile(
  root + "/public/arena/anime-deployment-v1.json",
  "utf8"
);
const fixture = `import {getContractAddress} from 'viem';import {animeLaunchAction,animeDeploymentPackageSha256} from '/src/lib/animeDeployment';
const assert={ok(v){if(!v)throw Error('fixture assertion');}};const bundle=${raw};${declarations}
const f=await fixture();const scenario=new URLSearchParams(location.search).get('scenario')||'normal';
if(sessionStorage.getItem('anime-current-scenario')!==scenario){sessionStorage.setItem('anime-current-scenario',scenario);localStorage.removeItem('yunipals/anime-launch/'+animeDeploymentPackageSha256+'/'+owner.toLowerCase());}
const key='anime-setup-'+scenario;let through=Number(sessionStorage.getItem(key)||0);
const listeners=new Set();let identity={address:owner,chainId:8453};let wallet;window.__sends=[];
function refresh(){wallet={account:{address:identity.address},async sendTransaction(input){
 if(input.value!==0n||input.chain.id!==8453)throw Error('Wrong wallet request');
 const step=through===0?'registry':'arena';const expected=await animeLaunchAction(bundle,step,owner,through?addresses[0]:undefined);
 if(input.data!==expected.data)throw Error('Wrong creation data');
 window.__sends.push(step);const hash=hashes[step];if(scenario!=='pending'){through++;sessionStorage.setItem(key,String(through));}return hash;
}};}refresh();
export const subscribe=f=>{listeners.add(f);return()=>listeners.delete(f)};export const snapshot=()=>identity;export const signing=()=>wallet;
window.__identity=(chainId,address=owner)=>{identity={address,chainId};refresh();for(const f of listeners)f();};
export const setIdentity=window.__identity;
const receipts=f.reader.getTransactionReceipt;
f.reader.getTransactionReceipt=async({hash})=>{const n=hash===hashes.registry?1:2;if(n>through)throw Object.assign(Error('pending'),{name:'TransactionReceiptNotFoundError'});return receipts({hash});};
f.reader.estimateFeesPerGas=async()=>({maxFeePerGas:10000000n,maxPriorityFeePerGas:100000n});
f.reader.estimateGas=async()=>1000000n;f.reader.getBalance=async()=>10n**20n;
f.reader.waitForTransactionReceipt=async({hash})=>{if(scenario==='pending')throw Error('Receipt timeout; retained');return f.reader.getTransactionReceipt({hash});};
export const client=f.reader;`;
const modules = {
  "virtual:anime-fixture.ts": fixture,
  "virtual:anime-wagmi.ts": `import {useSyncExternalStore} from 'react';import {subscribe,snapshot,signing,client,setIdentity} from 'virtual:anime-fixture.ts';export const useAccount=()=>useSyncExternalStore(subscribe,snapshot);export function useWalletClient(){useSyncExternalStore(subscribe,snapshot);return{data:signing()};}export const usePublicClient=()=>client;export const useSwitchChain=()=>({switchChain:({chainId})=>setIdentity(chainId)});`,
  "virtual:anime-rainbow.ts": `export const useConnectModal=()=>({openConnectModal:()=>{}});`,
  "virtual:anime-fees.ts": `export const estimateL1Fee=async()=>1000n;`,
  "virtual:anime-entry.tsx": `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {MemoryRouter} from 'react-router-dom';import {AnimeSetupPage} from '/src/pages/arena/anime/AnimeSetupPage';createRoot(document.getElementById('root')).render(<React.StrictMode><MemoryRouter><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><AnimeSetupPage/></QueryClientProvider></MemoryRouter></React.StrictMode>);`
};
const server = await createServer({
  root,
  configFile: false,
  cacheDir: output + "/vite-cache",
  server: { host: "127.0.0.1", port: 5208, strictPort: true },
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
          if (req.url?.startsWith("/__anime-setup")) {
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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (r) =>
    new URL(r.request().url()).hostname === "127.0.0.1"
      ? r.continue()
      : r.abort()
  );
  await page.goto("http://127.0.0.1:5208/__anime-setup");
  await page
    .getByRole("button", { name: "Review: deploy fighter registry" })
    .click();
  await page.getByRole("button", { name: "Confirm in wallet" }).waitFor();
  await page.evaluate(() => window.__identity(1));
  await page.getByRole("button", { name: "Switch to Base" }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Confirm in wallet" }).count(),
    0
  );
  await page.getByRole("button", { name: "Switch to Base" }).click();
  await page
    .getByRole("button", { name: "Review: deploy fighter registry" })
    .click();
  await page.getByRole("button", { name: "Confirm in wallet" }).click();
  await page.getByRole("button", { name: "Review: deploy arena" }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__sends), ["registry"]);
  await page.reload();
  await page.getByRole("button", { name: "Review: deploy arena" }).click();
  await page.getByRole("button", { name: "Confirm in wallet" }).click();
  await page.getByRole("heading", { name: "Deployment complete" }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__sends), ["arena"]);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  );
  await page.screenshot({
    path: output + "/complete-mobile.png",
    fullPage: true
  });
  await page.goto("http://127.0.0.1:5208/__anime-setup?scenario=pending");
  await page
    .getByRole("button", { name: "Review: deploy fighter registry" })
    .click();
  await page.getByRole("button", { name: "Confirm in wallet" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Receipt timeout" })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Waiting for deployment state" })
      .isDisabled(),
    true
  );
  await page.reload();
  await page.getByText("Transaction saved. Checking its receipt.").waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Waiting for deployment state" })
      .isDisabled(),
    true
  );
  assert.deepEqual(errors, []);
  console.log(
    "Browser deployment: chain changes invalidate review; both creations, reload recovery, mobile layout and pending hash retention passed."
  );
} finally {
  await browser.close();
  await server.close();
}
