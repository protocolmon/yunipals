// Actual owner page/helper with synthetic clients; external requests are blocked.
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
      default: "/tmp/yunipals-booster-ypal-owner-browser-20261023.json"
    }
  }
});
const root = fileURLToPath(new URL("..", import.meta.url));
process.chdir(root);
const pkg = JSON.parse(
  await readFile(`${root}/public/boosters/ypal-fresh-launch-v1.json`, "utf8")
);
const art = await readFile(
  `${root}/src/lib/fixtures/ypal-approved-art-manifest.json`,
  "utf8"
);
const source = await readFile(
  `${root}/src/lib/boosterYpalDeployment.test.ts`,
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
    (node) =>
      (ts.isFunctionDeclaration(node) && node.name?.text === "fixture") ||
      (ts.isVariableStatement(node) &&
        node.declarationList.declarations.some((d) =>
          ["bundle", "address", "hash", "domainTypes"].includes(
            d.name.getText(tree)
          )
        ))
  )
  .map((n) => n.getText(tree))
  .join("\n");
assert(declarations.includes("function fixture"));
const ids = {
  entry: "virtual:ypal-owner-entry.tsx",
  fixture: "virtual:ypal-owner-fixture.ts",
  wagmi: "virtual:ypal-owner-wagmi.ts",
  rainbow: "virtual:ypal-owner-rainbow.ts",
  action: "virtual:ypal-owner-action.ts",
  fees: "virtual:ypal-owner-fees.ts"
};
const fixture = `
import {encodeAbiParameters,encodeEventTopics,hashDomain,padHex,parseAbiParameters} from 'viem';
import {packRegistryAbi} from '@protopals/yunipals-market-core/boosterAbi';
import {validateBoosterCatalog} from '@protopals/yunipals-market-core/boosterCatalog';
import {validateYpalLaunchPackage,ypalLaunchSteps,ypalLaunchPackageSha256,ypalRuntime,ypalLaunchAction,ypalPackArguments,ypalImplementationSlot} from '/src/lib/boosterYpalDeployment';
const raw={toString:()=>${JSON.stringify(JSON.stringify(pkg))}};
${declarations}
const query=new URLSearchParams(location.search),scenario=query.get('scenario')||'normal';
const key='yunipals/boosters/ypal-launch/v1/'+ypalLaunchPackageSha256;
const first=sessionStorage.getItem('ypal-scenario')!==scenario;
let through=first?Number(query.get('through')||0):Number(sessionStorage.getItem('ypal-through')||0);
const f=fixture(through);
if(first){sessionStorage.setItem('ypal-scenario',scenario);sessionStorage.setItem('ypal-through',String(through));
 const stored=Number(query.get('stored')??through),receipts={};for(let i=0;i<stored;i++)receipts[ypalLaunchSteps[i]]=hash(i+1);localStorage.setItem(key,JSON.stringify(receipts));}
let identity={address:scenario==='foreign'?'0x9999999999999999999999999999999999999999':f.b.owner,chainId:scenario==='wrong-chain'?1:8453};
let wallet;const listeners=new Set();const sends=[];let deferred=null;window.__ypalSends=sends;
function refreshWallet(){wallet={account:{address:identity.address},chain:{id:identity.chainId},
 getChainId:async()=>identity.chainId,getAddresses:async()=>[identity.address],
 async sendTransaction(input){sends.push({step:ypalLaunchSteps[through],data:input.data,to:input.to||null});
  const step=ypalLaunchSteps[through],expected=ypalLaunchAction(f.b,step,{completed:through,addresses:f.addresses,typeId:through>=9?1n:undefined});
  if(input.data!==expected.data||input.value!==0n||input.nonce!==undefined)throw Error('Synthetic wallet input differs');
  const result=hash(through+1);if(scenario!=='pending'){through++;sessionStorage.setItem('ypal-through',String(through));f.options.count=through>=9?1n:0n;f.options.active=through===10;}
  if(scenario==='reverted')f.receipts.get(result).status='reverted';return result;
 }};}
refreshWallet();
export const subscribe=(listener)=>{listeners.add(listener);return()=>listeners.delete(listener);};
export const snapshot=()=>identity;
export const signing=()=>wallet;
export function setIdentity(address,chainId){identity={address,chainId};refreshWallet();for(const listener of listeners)listener();}
window.__ypalIdentity=(chainId,address=f.b.owner)=>setIdentity(address,chainId);
window.__ypalRelease=()=>{const resolve=deferred;deferred=null;window.__ypalDefer=false;resolve?.();};
const actualReceipt=f.client.getTransactionReceipt.bind(f.client);
f.client.getTransactionReceipt=async({hash:txHash})=>{
 const n=Number(BigInt(txHash));if(n<=10&&n>through){const e=Error('Synthetic pending');e.name='TransactionReceiptNotFoundError';throw e;}
 return actualReceipt({hash:txHash});};
f.client.estimateFeesPerGas=async()=>({maxFeePerGas:1000000000n,maxPriorityFeePerGas:100000000n});
f.client.estimateGas=async()=>1000000n;f.client.getBalance=async()=>10n**20n;
f.client.call=async()=>{if(window.__ypalDefer){window.__ypalSimulationReached=true;await new Promise((resolve)=>deferred=resolve);}return{data:'0x'};};
f.client.waitForTransactionReceipt=async({hash:txHash,onReplaced})=>{
 if(scenario==='pending')throw Error('Synthetic receipt timeout; hash retained');
 if(scenario==='repriced'){const nextHash=hash(10000),original=f.transactions.get(txHash),receipt=f.receipts.get(txHash);
  const next={...original,hash:nextHash};f.transactions.set(nextHash,next);f.receipts.set(nextHash,{...receipt,transactionHash:nextHash});
  onReplaced?.({reason:'repriced',replacedTransaction:original,transaction:next,transactionReceipt:f.receipts.get(nextHash)});txHash=nextHash;}
 return f.client.getTransactionReceipt({hash:txHash});};
if(scenario==='bad-domain')f.options.domain=hash(9999);
export const client=f.client;
window.__ypalHash=(n)=>hash(n);
`;
const modules = {
  [ids.fixture]: fixture,
  [ids.wagmi]: `import {useSyncExternalStore} from 'react';import {subscribe,snapshot,signing,client,setIdentity} from '${ids.fixture}';export function useAccount(){return {...useSyncExternalStore(subscribe,snapshot),isConnected:true};}export function useWalletClient(){useSyncExternalStore(subscribe,snapshot);return{data:signing()};}export const usePublicClient=()=>client;export const useSwitchChain=()=>({switchChain:({chainId})=>setIdentity(snapshot().address,chainId)});`,
  [ids.rainbow]: `export const useConnectModal=()=>({openConnectModal:()=>{}});`,
  [ids.action]: `export const boosterButtonClass='fixture-button';`,
  [ids.fees]: `export const estimateL1Fee=async()=>1000n;`,
  [ids.entry]: `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {MemoryRouter} from 'react-router-dom';import {BoosterYpalSetupPage} from '/src/pages/boosters/BoosterYpalSetupPage';const root=createRoot(document.getElementById('root'));window.__ypalUnmount=()=>root.unmount();root.render(<React.StrictMode><MemoryRouter><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><BoosterYpalSetupPage/></QueryClientProvider></MemoryRouter></React.StrictMode>);`
};
const cacheDir = await mkdtemp(join(tmpdir(), "yunipals-ypal-owner-vite-"));
const server = await createServer({
  root,
  cacheDir,
  configFile: false,
  server: { host: "127.0.0.1", port: 5206, strictPort: true },
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
      name: "ypal-owner-isolated-qualification",
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
          if (req.url?.split("?")[0] !== "/__ypal-owner-check") return next();
          const html = await vite.transformIndexHtml(
            req.url,
            `<html><body><div id="root"></div><script type="module" src="/@id/__x00__${ids.entry}"></script></body></html>`
          );
          res.setHeader("Content-Type", "text/html");
          res.end(html);
        });
      }
    }
  ]
});
const report = {
  format: "yunipals-ypal-owner-ui-acceptance-v1",
  observedAt: new Date().toISOString(),
  fixturesOnly: true,
  providerCalls: 0,
  realTransactions: 0,
  realSignatures: 0,
  checks: [],
  externalRequests: [],
  browserErrors: [],
  sourceSha256: {}
};
for (const path of [
  "src/lib/boosterYpalDeployment.ts",
  "src/lib/boosterYpalDeployment.test.ts",
  "src/pages/boosters/BoosterYpalSetupPage.tsx",
  "src/lib/fixtures/ypal-approved-art-manifest.json",
  "public/boosters/ypal-fresh-launch-v1.json",
  "scripts/test-booster-ypal-setup-ui.mjs"
])
  report.sourceSha256[path] = createHash("sha256")
    .update(await readFile(`${root}/${path}`))
    .digest("hex");
let browser;
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const { chromium } = await import(pathToFileURL(values.playwright).href);
  browser = await chromium.launch({
    executablePath: values.chromium,
    args: ["--no-sandbox"]
  });
  async function visit(query = "") {
    const context = await browser.newContext({
      viewport: { width: 1100, height: 1000 }
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
      if (
        route.request().url() === pkg.pack.manifestURI &&
        route.request().method() === "GET"
      )
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: art
        });
      report.externalRequests.push(
        route.request().method() + ":" + route.request().resourceType()
      );
      return route.abort("blockedbyclient");
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => report.browserErrors.push(error.message));
    await page.goto(origin + "/__ypal-owner-check?" + query, {
      waitUntil: "networkidle"
    });
    return { context, page };
  }
  async function check(name, action) {
    await action();
    assert.deepEqual(report.browserErrors, []);
    assert.deepEqual(report.externalRequests, []);
    report.checks.push({ name, passed: true });
  }
  const review = (page, label) =>
    page.getByRole("button", { name: "Review: " + label, exact: true });
  await check(
    "Ten explicit receipt-derived actions, one public type, no automatic next transaction, correct export",
    async () => {
      const { context, page } = await visit("scenario=normal");
      for (const label of [
        "Deploy YPAL token",
        "Deploy registry implementation",
        "Deploy registry proxy",
        "Deploy NFT implementation",
        "Deploy NFT collection proxy",
        "Deploy engine implementation",
        "Deploy engine proxy",
        "Set NFT birth metadata",
        "Configure public pack",
        "Activate public pack"
      ]) {
        await review(page, label).click();
        await page.getByRole("dialog").waitFor({ state: "visible" });
        const before = await page.evaluate(() => window.__ypalSends.length);
        await page
          .getByRole("button", {
            name: "Confirm this transaction",
            exact: true
          })
          .click();
        await page.waitForFunction(
          (n) => window.__ypalSends.length === n + 1,
          before
        );
        await page.getByRole("dialog").waitFor({ state: "hidden" });
      }
      await page
        .getByRole("button", { name: "Download verified deployment manifest" })
        .waitFor({ state: "visible" });
      assert.equal(await page.evaluate(() => window.__ypalSends.length), 10);
      const downloadEvent = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Download verified deployment manifest" })
        .click();
      const download = await downloadEvent;
      assert.equal(
        download.suggestedFilename(),
        "yunipals-ypal-fresh-deployment-confirmed-v1.json"
      );
      await context.close();
    }
  );
  for (const query of [
    "scenario=foreign",
    "scenario=wrong-chain",
    "scenario=bad-domain&through=1"
  ])
    await check(query + " refuses transaction preparation", async () => {
      const { context, page } = await visit(query);
      const count = await page
        .getByRole("button", { name: /^Review:/ })
        .count();
      if (query.startsWith("scenario=bad-domain")) {
        assert(count <= 1);
        if (count)
          assert.equal(
            await page.getByRole("button", { name: /^Review:/ }).isDisabled(),
            true
          );
      } else assert.equal(count, 0);
      assert.equal(await page.evaluate(() => window.__ypalSends.length), 0);
      await context.close();
    });
  await check(
    "Pending hash survives reload and blocks another deployment",
    async () => {
      const { context, page } = await visit("scenario=pending");
      await review(page, "Deploy YPAL token").click();
      await page
        .getByRole("button", { name: "Confirm this transaction" })
        .click();
      await page.waitForFunction(() => window.__ypalSends.length === 1);
      await page.reload({ waitUntil: "networkidle" });
      await page.getByText("Pending", { exact: true }).waitFor();
      assert.equal(
        await page.getByRole("button", { name: /^Review:/ }).count(),
        0
      );
      await context.close();
    }
  );
  await check(
    "A confirmed reverted deployment can be explicitly cleared and reviewed again",
    async () => {
      const { context, page } = await visit("scenario=reverted");
      await review(page, "Deploy YPAL token").click();
      await page
        .getByRole("button", { name: "Confirm this transaction" })
        .click();
      await page.getByText("Cancelled or reverted", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "Check saved transactions" })
        .click();
      await review(page, "Deploy YPAL token").waitFor();
      await context.close();
    }
  );
  await check(
    "Repriced replacement retains the actual replacement receipt",
    async () => {
      const { context, page } = await visit("scenario=repriced");
      await review(page, "Deploy YPAL token").click();
      await page
        .getByRole("button", { name: "Confirm this transaction" })
        .click();
      await review(page, "Deploy registry implementation").waitFor();
      assert((await page.locator('a[href*="2710"]').count()) > 0);
      await context.close();
    }
  );
  for (const [through, stored, step, n] of [
    [9, 8, "configure", 9],
    [10, 9, "activate", 10]
  ])
    await check(
      "Manual " + step + " recovery after state advances without local receipt",
      async () => {
        const { context, page } = await visit(
          "scenario=recover-" +
            step +
            "&through=" +
            through +
            "&stored=" +
            stored
        );
        await page.selectOption("#ypal-recovery-step", step);
        await page.fill(
          "#ypal-receipt",
          "0x" + n.toString(16).padStart(64, "0")
        );
        await page
          .getByRole("button", { name: "Verify and restore receipt" })
          .click();
        if (step === "configure")
          await review(page, "Activate public pack").waitFor();
        else
          await page
            .getByRole("button", {
              name: "Download verified deployment manifest"
            })
            .waitFor();
        assert.equal(await page.evaluate(() => window.__ypalSends.length), 0);
        await context.close();
      }
    );
  for (const mode of ["network", "account", "dismiss", "unmount"])
    await check(
      "Deferred final simulation " +
        mode +
        " invalidates review with zero wallet entries",
      async () => {
        const { context, page } = await visit("scenario=deferred-" + mode);
        await review(page, "Deploy YPAL token").click();
        await page.getByRole("dialog").waitFor({ state: "visible" });
        await page.evaluate(() => (window.__ypalDefer = true));
        await page
          .getByRole("button", { name: "Confirm this transaction" })
          .click();
        await page.waitForFunction(() => window.__ypalSimulationReached);
        if (mode === "network") {
          await page.evaluate(() => window.__ypalIdentity(1));
          await page.waitForTimeout(30);
          await page.evaluate(() => window.__ypalIdentity(8453));
        }
        if (mode === "account") {
          await page.evaluate(() =>
            window.__ypalIdentity(
              8453,
              "0x9999999999999999999999999999999999999999"
            )
          );
          await page.waitForTimeout(30);
          await page.evaluate(() => window.__ypalIdentity(8453));
        }
        if (mode === "dismiss")
          await page.getByRole("button", { name: "Cancel review" }).click();
        if (mode === "unmount")
          await page.evaluate(() => window.__ypalUnmount());
        await page.evaluate(() => window.__ypalRelease());
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => window.__ypalSends.length), 0);
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
