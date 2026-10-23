// Real purchase controls, review hook and calldata; local fixtures only.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer, transformWithEsbuild } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const ids = {
  entry: "virtual:purchase-entry.tsx",
  fixture: "virtual:purchase-fixture.ts",
  wagmi: "virtual:purchase-wagmi.ts",
  boosters: "virtual:purchase-boosters.ts",
  rainbow: "virtual:purchase-rainbow.ts"
};
const fixture = `
import {decodeFunctionData,encodeAbiParameters,parseAbiParameters,erc20Abi} from 'viem';
import {base} from 'viem/chains';
import {boosterPacksAbi} from '@protopals/yunipals-market-core/boosterAbi';
import {boosterPurchaseAbi} from '/src/lib/boosterPurchase';
export const account='0xb3883cd96d72b08b8226452305a28d65974a3727';
export const engine='0x455fabad0ac8ff1ea4df70ca07aa56a272cb2609';
const token='0xe5a54a517cde8ed48a336b173044b1138aa2c1a3';
export const scenario=new URLSearchParams(location.search).get('scenario')||'batch';
window.__purchase={calls:[],sends:[],saved:[],confirmed:[]};
let allowance=scenario.startsWith('approval')?0n:10n**30n;
const price=scenario==='approval-large'?500n*10n**18n:10n**18n;
export const pack={id:'pack-2',packTypeId:'2',engine,registry:'0xeaee2da120a398f21729d50672ac5d1dd71d7274',paymentToken:token,price:String(price),openings:'1',intervalSeconds:'86400',mintsPerInterval:1,totalVariants:'264',maxBatch:7};
const decoded=(data)=>{for(const abi of [boosterPacksAbi,boosterPurchaseAbi,erc20Abi]){try{return decodeFunctionData({abi,data});}catch{}}return null;};
const log=(row)=>JSON.parse(JSON.stringify(row,(_,v)=>typeof v==='bigint'?String(v):v));
export const client={chain:base,
 async getStorageAt(){return scenario==='legacy'?'0x00000000000000000000000092e2351a83b6c445c94d0b887259d2b940c82a5a':'0x'+'ab'.repeat(32);},
 async readContract({functionName,args}){window.__purchase.calls.push(log({functionName,args}));switch(functionName){
 case 'MAX_OPEN_PACKS':return 10;
 case 'getPack':return{active:true,salesPaused:false,openings:1n,rules:{engine,paymentToken:token,price,supplyCap:scenario==='soldout'?2n:0n}};
 case 'quote':return[1000n,700000];
 case 'quoteOpenPacks':return[BigInt(args[1])*1000n,700000];
 case 'balanceOf':return scenario==='insufficient'?2n*10n**18n:10n**30n;
 case 'allowance':return allowance;
 case 'decimals':return 18;
 case 'symbol':return 'PROTO';
 default:throw Error('Unexpected fixture read '+functionName);
 }},
 async estimateFeesPerGas(){return{maxFeePerGas:2n,maxPriorityFeePerGas:1n};},
 async getBlock(){return{timestamp:1792760000n};},
 async getBalance(){return 10n**18n;},
 async estimateGas(){return 1000000n;},
 async call(tx){if(tx.to.toLowerCase()!== '0x420000000000000000000000000000000000000f')window.__purchase.calls.push(log({simulation:decoded(tx.data),value:tx.value}));return{data:encodeAbiParameters(parseAbiParameters('uint256'),[200n])};},
 async waitForTransactionReceipt({hash}){return{transactionHash:hash,status:'success'};}
};
export const wallet={async sendTransaction(tx){const d=decoded(tx.data);window.__purchase.sends.push(log({...d,value:tx.value,to:tx.to}));if(d?.functionName==='approve')allowance=d.args[1];return '0x'+String(window.__purchase.sends.length).repeat(64);}};
export const save=(wallet,engine,row)=>window.__purchase.saved.push(row);
`;
const modules = {
  [ids.fixture]: fixture,
  [ids.wagmi]: `import {account,client,wallet} from '${ids.fixture}';export const useAccount=()=>({address:account,isConnected:true,chainId:8453});export const usePublicClient=()=>client;export const useWalletClient=()=>({data:wallet});export const useSwitchChain=()=>({isPending:false});`,
  [ids.boosters]: `import {pack,engine,save} from '${ids.fixture}';export const boosterQueryKey=['local-purchase-fixture'];export const boosterAddresses=()=>({registry:pack.registry,engine,monsters:'0x105319be2182018c31fb10b1be198c3cf238a146'});export const saveBoosterTransaction=save;`,
  [ids.rainbow]: `export const useConnectModal=()=>({});`,
  [ids.entry]: `import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{BoosterPurchaseOptions}from'/src/pages/boosters/BoosterPurchaseOptions';import{useBoosterActions}from'/src/hooks/useBoosterActions';import{pack}from'${ids.fixture}';import'/src/globals.css';function HookProbe(){window.__purchaseHook=useBoosterActions();return null;}const query=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});createRoot(document.getElementById('root')).render(<QueryClientProvider client={query}><HookProbe/><main className="mx-auto max-w-xl p-6"><BoosterPurchaseOptions pack={pack} paused={false} onConfirmed={hash=>window.__purchase.confirmed.push(hash)} onPreview={quantity=>window.__preview=quantity}/></main></QueryClientProvider>);`
};
const server = await createServer({
  root,
  configFile: false,
  server: { host: "127.0.0.1", port: 5199, strictPort: true },
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
      name: "local-purchase-ui",
      enforce: "pre",
      resolveId(id) {
        if (Object.hasOwn(modules, id)) return "\0" + id;
        if (id === "wagmi") return "\0" + ids.wagmi;
        if (id === "@rainbow-me/rainbowkit") return "\0" + ids.rainbow;
        if (id === "@/lib/boosters" || id === `${root}/src/lib/boosters`)
          return "\0" + ids.boosters;
      },
      async load(id) {
        if (id.startsWith("\0") && modules[id.slice(1)])
          return (
            await transformWithEsbuild(modules[id.slice(1)], id.slice(1), {
              loader: id.endsWith("tsx") ? "tsx" : "ts",
              jsx: "automatic"
            })
          ).code;
      },
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url?.startsWith("/__purchase")) {
            response.setHeader("Content-Type", "text/html");
            response.end(
              `<div id="root"></div><script type="module" src="/@id/__x00__${ids.entry}"></script>`
            );
          } else next();
        });
      }
    }
  ]
});
const report = {
  format: "yunipals-batch-purchase-ui-v1",
  observedAt: new Date().toISOString(),
  fixturesOnly: true,
  realProviderCalls: 0,
  realTransactions: 0,
  checks: [],
  errors: []
};
await server.listen();
const { chromium } = await import(
  pathToFileURL("/tmp/yunipals-foundry/node_modules/playwright-core/index.mjs")
    .href
);
const browser = await chromium.launch({
  executablePath:
    "/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
  args: ["--no-sandbox"]
});
try {
  const page = await browser.newPage({
    viewport: { width: 1100, height: 1000 }
  });
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname === "127.0.0.1")
      return route.continue();
    report.errors.push("Unexpected external request");
    return route.abort();
  });
  const visit = (scenario) =>
    page.goto(`http://127.0.0.1:5199/__purchase?scenario=${scenario}`);
  await visit("batch");
  await page
    .getByRole("button", { name: "Choose 3 packs", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open 3 packs", exact: true })
    .last()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Total pack price", { exact: true }).waitFor();
  assert.match(await dialog.innerText(), /Originals requested\s+3/);
  assert.match(await dialog.innerText(), /3 PROTO/);
  const reviewValue = (label) =>
    dialog.getByText(label, { exact: true }).locator("..").locator("dd");
  assert.equal(
    await reviewValue("Your PROTO balance").innerText(),
    "1,000,000,000,000 PROTO"
  );
  assert.equal(
    await reviewValue("Your PROTO balance").getAttribute("title"),
    "1000000000000 PROTO"
  );
  assert.equal(
    await reviewValue("Network gas estimate").innerText(),
    "≈ 0.0000000000024 ETH"
  );
  assert.equal(
    await reviewValue("Network gas estimate").getAttribute("title"),
    "0.0000000000024002 ETH"
  );
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await page.waitForFunction(() => window.__purchase.confirmed.length === 1);
  let result = await page.evaluate(() => window.__purchase);
  assert.equal(result.sends.length, 1);
  assert.equal(result.sends[0].functionName, "openPacks");
  assert.deepEqual(result.sends[0].args.slice(0, 3), ["2", 3, "3301"]);
  assert.equal(result.sends[0].value, "3301");
  assert.equal(result.saved[0].expectedRequestCount, 3);
  assert.equal(result.saved[0].quantity, 1);
  report.checks.push(
    "Three originals: correct total price, one atomic call, aggregate ETH ceiling and persisted request count"
  );

  await visit("approval");
  await page
    .getByRole("button", { name: "Choose 5 packs", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open 5 packs", exact: true })
    .last()
    .click();
  await reviewValue("Approval amount").waitFor();
  assert.equal(await reviewValue("Approval amount").innerText(), "1,000 PROTO");
  assert.equal(
    await reviewValue("Your PROTO balance").innerText(),
    "1,000,000,000,000 PROTO"
  );
  await dialog.getByRole("button", { name: "Approve payment" }).click();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).waitFor();
  assert.equal(
    await dialog.getByText("Approval amount", { exact: true }).count(),
    0
  );
  await reviewValue("Your PROTO balance").waitFor();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await page.waitForFunction(() => window.__purchase.confirmed.length === 1);
  result = await page.evaluate(() => window.__purchase);
  assert.deepEqual(
    result.sends.map((row) => row.functionName),
    ["approve", "openPacks"]
  );
  assert.equal(result.sends[0].args[1], "1000000000000000000000");
  assert.equal(result.sends[1].args[1], 5);
  assert.equal(
    result.calls.filter((row) => row.functionName === "balanceOf").length,
    2,
    "The opening review reads the current balance again after approval"
  );
  report.checks.push(
    "Default 1000 PROTO approval followed by a fresh balance and batch review; only one opening transaction"
  );

  for (const [scenario, quantity, expectedPrice, expectedApproval] of [
    ["approval", 5, "5000000000000000000", "1000000000000000000000"],
    ["approval-large", 3, "1500000000000000000000", "1500000000000000000000"],
    ["batch", 3, "3000000000000000000", "0"]
  ]) {
    await visit(scenario);
    await page.waitForFunction(() => Boolean(window.__purchaseHook));
    await page.evaluate(
      ({ quantity }) =>
        window.__purchaseHook.prepare({
          kind: "open",
          packTypeId: "2",
          quantity
        }),
      { quantity }
    );
    await page.waitForFunction(() => window.__purchaseHook.review !== null);
    const review = await page.evaluate(() =>
      JSON.parse(
        JSON.stringify(window.__purchaseHook.review, (_, value) =>
          typeof value === "bigint" ? String(value) : value
        )
      )
    );
    assert.equal(review.tokenBalance, String(10n ** 30n));
    assert.equal(review.tokenPrice, expectedPrice);
    assert.equal(review.approvalAmount, expectedApproval);
    assert.equal(review.atomicApproval, false);
    assert.equal(review.approval, expectedApproval !== "0");
    assert(BigInt(review.networkFee) > 0n);
    assert.equal(await page.evaluate(() => window.__purchase.sends.length), 0);
  }
  report.checks.push(
    "Actual review hook exposes current PROTO balance, 1000 default or exact larger approval, existing allowance and finite gas without sending"
  );

  for (const scenario of ["insufficient", "soldout"]) {
    await visit(scenario);
    await page
      .getByRole("button", { name: "Choose 3 packs", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Open 3 packs", exact: true })
      .last()
      .click();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.evaluate(() => window.__purchase.sends.length), 0);
    report.checks.push(`${scenario}: no approval or opening sent`);
  }
  await visit("legacy");
  await page.getByRole("spinbutton", { name: "Packs to open" }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "One more pack" }).isDisabled(),
    true
  );
  await page.getByRole("button", { name: "Open pack", exact: true }).click();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await page.waitForFunction(() => window.__purchase.confirmed.length === 1);
  result = await page.evaluate(() => window.__purchase);
  assert.equal(result.sends[0].functionName, "openPack");
  assert.equal(result.saved[0].expectedRequestCount, 1);
  report.checks.push(
    "Legacy implementation keeps single purchases operational and cannot send unsupported batch calls"
  );
  await visit("batch");
  await page
    .getByRole("button", { name: "Choose 10 packs", exact: true })
    .click();
  assert.equal(
    await page.getByRole("button", { name: "One more pack" }).isDisabled(),
    true
  );
  await page.getByRole("button", { name: "Try the opening" }).click();
  assert.equal(await page.evaluate(() => window.__preview), 10);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    ),
    true
  );
  report.checks.push(
    "Maximum ten, multi-card demo selection, and mobile layout"
  );
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error.stack;
  process.exitCode = 1;
} finally {
  await writeFile(
    "/tmp/yunipals-batch-purchase-ui-20261023.json",
    JSON.stringify(report, null, 2) + "\n"
  );
  await browser.close();
  await server.close();
}
console.log(JSON.stringify(report));
