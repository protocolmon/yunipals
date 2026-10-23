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
import {decodeFunctionData,encodeAbiParameters,parseAbiParameters,erc20Abi,hashDomain,recoverTypedDataAddress,serializeSignature} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {base} from 'viem/chains';
import {boosterPacksAbi} from '@protopals/yunipals-market-core/boosterAbi';
import {boosterPurchaseAbi} from '/src/lib/boosterPurchase';
import {boosterPermitAbi,boosterPermitTypedData} from '/src/lib/boosterPermit';
export const scenario=new URLSearchParams(location.search).get('scenario')||'batch';
const signer=privateKeyToAccount('0x'+'11'.repeat(32)),other=privateKeyToAccount('0x'+'22'.repeat(32));
export const account=scenario.startsWith('permit')?signer.address:'0xb3883cd96d72b08b8226452305a28d65974a3727';
export const engine='0x455fabad0ac8ff1ea4df70ca07aa56a272cb2609';
const token='0xe5a54a517cde8ed48a336b173044b1138aa2c1a3';
window.__purchase={calls:[],sends:[],sendAttempts:0,saved:[],submitted:[],confirmed:[],signatures:[]};
window.__walletAccount=account;window.__walletChain=8453;window.__walletTime=1792760000n;window.__permitNonce=4n;
window.__feePrice=2n;window.__ethBalance=10n**18n;window.__tokenBalance=10n**30n;
let allowance=scenario.startsWith('approval')||(scenario.startsWith('permit')&&scenario!=='permit-allowance')?0n:10n**30n;
window.__setAllowance=(value)=>{allowance=BigInt(value);};
const domain={name:'Proto',version:'1',chainId:8453,verifyingContract:token};
const domainTypes={EIP712Domain:[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}]};
const price=scenario==='approval-large'?500n*10n**18n:10n**18n;
export const pack={id:'pack-2',packTypeId:'2',engine,registry:'0xeaee2da120a398f21729d50672ac5d1dd71d7274',paymentToken:token,price:String(price),openings:'1',intervalSeconds:'86400',mintsPerInterval:1,totalVariants:'264',maxBatch:7};
const decoded=(data)=>{for(const abi of [boosterPacksAbi,boosterPurchaseAbi,boosterPermitAbi,erc20Abi]){try{return decodeFunctionData({abi,data});}catch{}}return null;};
const log=(row)=>JSON.parse(JSON.stringify(row,(_,v)=>typeof v==='bigint'?String(v):v));
const safeDecoded=(d)=>d?.functionName==='openPacksWithPermit'?{...d,args:d.args.slice(0,4)}:d;
const simulatePermit=async(tx)=>{const d=decoded(tx.data);if(d?.functionName!=='openPacksWithPermit')return;
 const [type,count,budget,deadline,v,r,s]=d.args;const value=price*BigInt(count);
 if(tx.to.toLowerCase()!==engine||tx.account.toLowerCase()!==account.toLowerCase()||type!==2n||count<1||count>10||deadline<=window.__walletTime||budget!==tx.value)throw Error('Invalid permit purchase simulation');
 if(scenario==='permit-simulation-failed')throw Error('Signed permit simulation reverted');
 if(allowance<value){const typed=boosterPermitTypedData({owner:account,spender:engine,token,value,nonce:window.__permitNonce,deadline,domain});
  const recovered=await recoverTypedDataAddress({...typed,signature:serializeSignature({v:BigInt(v),r,s})});
  if(recovered.toLowerCase()!==account.toLowerCase())throw Error('Permit nonce/signature cannot authorize payment');}
};
export const client={chain:base,
 async getStorageAt(){return scenario==='legacy'?'0x00000000000000000000000092e2351a83b6c445c94d0b887259d2b940c82a5a':scenario==='permit-old-engine'?'0x000000000000000000000000eba9d4deb6914ab67a820ea27c2fc3f43812e471':'0x'+'ab'.repeat(32);},
 async readContract({functionName,args}){window.__purchase.calls.push(log({functionName,args}));switch(functionName){
 case 'MAX_OPEN_PACKS':return 10;
 case 'PERMIT_OPEN_VERSION':return scenario.startsWith('permit')&&scenario!=='permit-unsupported'?1n:0n;
 case 'name':return 'Proto';
 case 'DOMAIN_SEPARATOR':return hashDomain({domain:{...domain,version:scenario==='permit-wrong-domain'?'2':'1',chainId:8453n},types:domainTypes});
 case 'nonces':return window.__permitNonce;
 case 'getPack':return{active:true,salesPaused:false,openings:1n,rules:{engine,paymentToken:token,price,supplyCap:scenario==='soldout'?2n:0n}};
 case 'quote':return[1000n,700000];
 case 'quoteOpenPacks':return[BigInt(args[1])*1000n*(args[2]/2n),700000];
 case 'balanceOf':return scenario==='insufficient'?2n*10n**18n:window.__tokenBalance;
 case 'allowance':return allowance;
 case 'decimals':return 18;
 case 'symbol':return 'PROTO';
 default:throw Error('Unexpected fixture read '+functionName);
 }},
 async estimateFeesPerGas(){return{maxFeePerGas:window.__feePrice,maxPriorityFeePerGas:1n};},
 async getBlock(){return{timestamp:window.__walletTime};},
 async getBalance(){return window.__ethBalance;},
 async estimateGas(tx){await simulatePermit(tx);return 1000000n;},
 async call(tx){if(tx.to.toLowerCase()!== '0x420000000000000000000000000000000000000f'){await simulatePermit(tx);window.__purchase.calls.push(log({simulation:safeDecoded(decoded(tx.data)),value:tx.value}));}return{data:encodeAbiParameters(parseAbiParameters('uint256'),[200n])};},
 async waitForTransactionReceipt({hash}){if(scenario==='permit-pending'||scenario==='approval-pending')return new Promise(()=>{});return{transactionHash:hash,status:scenario==='permit-reverted'?'reverted':'success'};}
};
export const wallet={
 async getChainId(){return window.__walletChain;},async getAddresses(){
  if(window.__expireOnFinalWalletCheck&&++window.__permitSecondChecks===2){const expired=Date.now()+601000;Date.now=()=>expired;}
  if(window.__deferFinalWalletCheck&&++window.__permitUnmountChecks===2){window.__finalWalletCheckReached=true;await new Promise(resolve=>{window.__releaseWalletCheck=resolve;});}
  return[window.__walletAccount];},
 async signTypedData(typed){window.__purchase.signatures.push(log({domain:typed.domain,message:typed.message}));
  if(scenario==='permit-rejected')throw Error('User rejected signature');
  const signature=await(scenario==='permit-wrong-wallet'?other:signer).signTypedData(typed);
  if(scenario==='permit-account-switch')window.__walletAccount=other.address;
  if(scenario==='permit-chain-switch')window.__walletChain=1;
  if(scenario==='permit-expired')window.__walletTime+=601n;
  if(scenario==='permit-replayed')window.__permitNonce++;
  if(scenario==='permit-vrf-rise')window.__feePrice=20n;
  if(scenario==='permit-no-eth')window.__ethBalance=0n;
  if(scenario==='permit-no-proto')window.__tokenBalance=0n;
  if(scenario==='permit-front-run'){window.__permitNonce++;allowance=typed.message.value;}
  return signature;
 },
 async sendTransaction(tx){window.__purchase.sendAttempts++;const d=decoded(tx.data);await simulatePermit(tx);window.__purchase.sends.push(log({...safeDecoded(d),value:tx.value,to:tx.to}));if(d?.functionName==='approve')allowance=d.args[1];return '0x'+String(window.__purchase.sends.length).repeat(64);}
};
export const save=(wallet,engine,row)=>window.__purchase.saved.push(row);
`;
const modules = {
  [ids.fixture]: fixture,
  [ids.wagmi]: `import {account,client,wallet} from '${ids.fixture}';export const useAccount=()=>({address:account,isConnected:true,chainId:8453});export const usePublicClient=()=>client;export const useWalletClient=()=>({data:wallet});export const useSwitchChain=()=>({isPending:false});`,
  [ids.boosters]: `import {pack,engine,save} from '${ids.fixture}';export const boosterQueryKey=['local-purchase-fixture'];export const boosterAddresses=()=>({registry:pack.registry,engine,monsters:'0x105319be2182018c31fb10b1be198c3cf238a146'});export const saveBoosterTransaction=save;`,
  [ids.rainbow]: `export const useConnectModal=()=>({});`,
  [ids.entry]: `import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{BoosterPurchaseOptions}from'/src/pages/boosters/BoosterPurchaseOptions';import{useBoosterActions}from'/src/hooks/useBoosterActions';import{pack}from'${ids.fixture}';import'/src/globals.css';function HookProbe(){window.__purchaseHook=useBoosterActions();return null;}const query=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});const app=createRoot(document.getElementById('root'));window.__unmountPurchase=()=>app.unmount();app.render(<QueryClientProvider client={query}><HookProbe/><main className="mx-auto max-w-xl p-6"><BoosterPurchaseOptions pack={pack} paused={false} onConfirmed={hash=>window.__purchase.confirmed.push(hash)} onSubmitted={new URLSearchParams(location.search).get("handoff")?hash=>window.__purchase.submitted.push(hash):undefined} onPreview={quantity=>window.__preview=quantity}/></main></QueryClientProvider>);`
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
    assert.equal(review.permitApproval, false);
    assert.equal(review.permitSigned, false);
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
  await page.setViewportSize({ width: 1100, height: 1000 });
  async function startPermitReview(scenario, quantity = 3) {
    await visit(scenario);
    if (quantity !== 1)
      await page
        .getByRole("button", { name: `Choose ${quantity} packs`, exact: true })
        .click();
    await page
      .getByRole("button", {
        name: quantity === 1 ? "Open pack" : `Open ${quantity} packs`,
        exact: true
      })
      .last()
      .click();
    await dialog
      .getByRole("button", { name: "Sign approval", exact: true })
      .waitFor();
  }
  async function signPermitReview() {
    await dialog
      .getByRole("button", { name: "Sign approval", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Open packs", exact: true })
      .waitFor();
  }
  for (const quantity of [1, 3]) {
    await startPermitReview("permit", quantity);
    assert.equal(
      await reviewValue("Approval amount").innerText(),
      `${quantity} PROTO`
    );
    await dialog
      .getByText("After approval signature", { exact: true })
      .waitFor();
    let permit = await page.evaluate(() => window.__purchase);
    assert.equal(permit.sends.length, 0);
    assert.equal(permit.signatures.length, 0);
    assert.equal(
      permit.calls.filter((row) => row.simulation).length,
      0,
      "The unapproved open is never independently simulated"
    );
    await signPermitReview();
    permit = await page.evaluate(() => window.__purchase);
    assert.equal(permit.signatures.length, 1);
    assert.equal(permit.signatures[0].domain.chainId, 8453);
    assert.equal(
      permit.signatures[0].domain.verifyingContract.toLowerCase(),
      "0xe5a54a517cde8ed48a336b173044b1138aa2c1a3"
    );
    assert.equal(
      permit.signatures[0].message.value,
      String(BigInt(quantity) * 10n ** 18n)
    );
    assert.equal(permit.signatures[0].message.nonce, "4");
    assert.equal(permit.signatures[0].message.deadline, "1792760600");
    assert.equal(permit.sends.length, 0, "Signing alone never broadcasts");
    assert.equal(permit.sendAttempts, 0);
    assert(
      permit.calls.some(
        (row) => row.simulation?.functionName === "openPacksWithPermit"
      )
    );
    assert.equal(
      permit.calls.filter((row) =>
        ["openPack", "openPacks"].includes(row.simulation?.functionName)
      ).length,
      0
    );
    await reviewValue("Network gas estimate")
      .getAttribute("title")
      .then((value) => assert.match(value, / ETH$/));
    await dialog
      .getByRole("button", { name: "Open packs", exact: true })
      .click();
    await page.waitForFunction(() => window.__purchase.confirmed.length === 1);
    permit = await page.evaluate(() => window.__purchase);
    assert.equal(permit.sends.length, 1);
    assert.equal(permit.sendAttempts, 1);
    assert.equal(permit.signatures.length, 1);
    assert.equal(permit.sends[0].functionName, "openPacksWithPermit");
    assert.deepEqual(permit.sends[0].args, [
      "2",
      quantity,
      String(BigInt(quantity) * 1100n + 1n),
      "1792760600"
    ]);
    assert.equal(permit.saved[0].kind, "open");
    assert.equal(permit.saved[0].expectedRequestCount, quantity);
    assert.equal(permit.saved[0].quantity, 1);
    assert.deepEqual(
      Object.keys(permit.saved[0]).sort(),
      ["expectedRequestCount", "hash", "kind", "packTypeId", "quantity"].sort()
    );
  }
  report.checks.push(
    "Exact-price permits for one and three packs require signature then explicit gas review; one engine transaction, immutable deadline and ordinary saved request grouping"
  );

  await startPermitReview("permit");
  assert.equal(
    await dialog
      .getByRole("button", { name: "Use separate approval", exact: true })
      .count(),
    0
  );
  assert.equal(
    await page.evaluate(() => window.__purchase.signatures.length),
    0
  );
  assert.equal(await page.evaluate(() => window.__purchase.sends.length), 0);
  report.checks.push(
    "Combined approval has no optional separate-approval button; signing and sending still require explicit confirmation"
  );

  for (const scenario of [
    "permit-old-engine",
    "permit-unsupported",
    "permit-wrong-domain"
  ]) {
    await visit(scenario);
    await page.getByRole("button", { name: "Open pack", exact: true }).click();
    await dialog
      .getByRole("button", { name: "Approve payment", exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(() => window.__purchase.signatures.length),
      0
    );
    assert.equal(await page.evaluate(() => window.__purchase.sends.length), 0);
  }
  await visit("permit-allowance");
  await page.getByRole("button", { name: "Open pack", exact: true }).click();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).waitFor();
  assert.equal(
    await dialog
      .getByRole("button", { name: "Sign approval", exact: true })
      .count(),
    0
  );
  report.checks.push(
    "Known old engines, unsupported capability or token domain use separate approval; an existing sufficient allowance keeps the direct purchase"
  );

  for (const scenario of [
    "permit-rejected",
    "permit-wrong-wallet",
    "permit-account-switch",
    "permit-chain-switch",
    "permit-expired",
    "permit-replayed",
    "permit-vrf-rise",
    "permit-no-eth",
    "permit-no-proto",
    "permit-simulation-failed"
  ]) {
    await startPermitReview(scenario);
    await dialog
      .getByRole("button", { name: "Sign approval", exact: true })
      .click();
    await dialog.getByRole("alert").waitFor();
    assert.equal(
      await page.evaluate(() => window.__purchase.sends.length),
      0,
      scenario
    );
    assert.equal(
      await page.evaluate(() => window.__purchase.sendAttempts),
      0,
      scenario
    );
    assert.equal(
      await page.evaluate(() => window.__purchase.signatures.length),
      1,
      scenario
    );
    assert.equal(
      await dialog
        .getByRole("button", { name: "Open packs", exact: true })
        .count(),
      0,
      scenario
    );
  }
  report.checks.push(
    "Rejected or wrong-wallet signatures, wallet/chain switches, expired/replayed permissions and failed full-call simulation never send or trigger automatic approval"
  );

  for (const mutation of ["nonce", "expiry"]) {
    await startPermitReview("permit");
    await signPermitReview();
    await page.evaluate((mutation) => {
      if (mutation === "nonce") window.__permitNonce++;
      else window.__walletTime += 601n;
    }, mutation);
    await dialog
      .getByRole("button", { name: "Open packs", exact: true })
      .click();
    await dialog.getByRole("alert").waitFor();
    assert.equal(await page.evaluate(() => window.__purchase.sends.length), 0);
    assert.equal(await page.evaluate(() => window.__purchase.sendAttempts), 0);
  }
  report.checks.push(
    "Nonce drift without sufficient allowance and expiry after the final review invalidate the signed review before any transaction"
  );

  await startPermitReview("permit-late-expiry");
  await signPermitReview();
  await page.evaluate(() => {
    window.__expireOnFinalWalletCheck = true;
    window.__permitSecondChecks = 0;
  });
  await dialog.getByRole("button", { name: "Open packs", exact: true }).click();
  await dialog.getByRole("alert").waitFor();
  assert.equal(await page.evaluate(() => window.__permitSecondChecks), 2);
  assert.equal(await page.evaluate(() => window.__purchase.sendAttempts), 0);
  assert.equal(await page.evaluate(() => window.__purchase.sends.length), 0);
  report.checks.push(
    "Expiry during the final awaited wallet preflight is rechecked synchronously before wallet entry; zero send attempts"
  );

  await startPermitReview("permit-unmount");
  await signPermitReview();
  await page.evaluate(() => {
    window.__deferFinalWalletCheck = true;
    window.__permitUnmountChecks = 0;
  });
  await dialog.getByRole("button", { name: "Open packs", exact: true }).click();
  await page.waitForFunction(() => window.__finalWalletCheckReached === true);
  await page.evaluate(() => window.__unmountPurchase());
  assert.equal(await page.locator("#root > *").count(), 0);
  await page.evaluate(() => window.__releaseWalletCheck());
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.__permitUnmountChecks), 2);
  assert.equal(await page.evaluate(() => window.__purchase.sendAttempts), 0);
  assert.equal(await page.evaluate(() => window.__purchase.sends.length), 0);
  report.checks.push(
    "Unmounting the actual React root during the final awaited wallet check invalidates the review before wallet entry; zero send attempts"
  );

  await startPermitReview("permit-front-run");
  await signPermitReview();
  await dialog.getByRole("button", { name: "Open packs", exact: true }).click();
  await page.waitForFunction(() => window.__purchase.confirmed.length === 1);
  assert.equal(await page.evaluate(() => window.__purchase.sends.length), 1);
  assert.equal(await page.evaluate(() => window.__purchase.sendAttempts), 1);
  report.checks.push(
    "A safely consumed permit remains usable when the exact-price allowance already exists; no re-sign or extra approval transaction"
  );

  await startPermitReview("permit-pending");
  await dialog
    .getByRole("button", { name: "Sign approval", exact: true })
    .evaluate((button) => {
      button.click();
      button.click();
    });
  await dialog
    .getByRole("button", { name: "Open packs", exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(() => window.__purchase.signatures.length),
    1
  );
  await dialog
    .getByRole("button", { name: "Open packs", exact: true })
    .evaluate((button) => {
      button.click();
      button.click();
    });
  await page.waitForFunction(() => window.__purchase.sends.length === 1);
  await page.waitForTimeout(80);
  assert.equal(await page.evaluate(() => window.__purchase.sends.length), 1);
  assert.equal(
    await page.evaluate(() => window.__purchase.confirmed.length),
    0
  );
  assert.equal(
    await page.evaluate(() => window.__purchase.saved[0].expectedRequestCount),
    3
  );
  report.checks.push(
    "Synchronous double clicks produce one signature and one transaction; a pending chain receipt stays unconfirmed without duplicate sends"
  );

  await startPermitReview("permit-reverted");
  await signPermitReview();
  await dialog.getByRole("button", { name: "Open packs", exact: true }).click();
  await dialog.getByRole("alert").waitFor();
  assert.equal(await page.evaluate(() => window.__purchase.sends.length), 1);
  assert.equal(
    await page.evaluate(() => window.__purchase.confirmed.length),
    0
  );
  report.checks.push(
    "Only a successful actual chain receipt confirms; a reverted permit purchase preserves its tracked hash without claiming an opening"
  );
  await visit("approval-pending&handoff=1");
  await page
    .getByRole("button", { name: "Open pack", exact: true })
    .last()
    .click();
  await dialog
    .getByRole("button", { name: "Approve payment", exact: true })
    .click();
  await page.waitForFunction(() => window.__purchase.saved.length === 1);
  assert.equal(
    await page.evaluate(() => window.__purchase.submitted.length),
    0
  );
  assert.equal(
    await page.evaluate(() => window.__purchase.confirmed.length),
    0
  );
  await dialog
    .getByText("Waiting for transaction confirmation…", { exact: true })
    .waitFor();
  assert.equal(await dialog.isVisible(), true);
  report.checks.push(
    "Automatic unsupported-permit fallback keeps its approval confirmation dialog visible and never pretends approval is an opening submission"
  );
  await visit("permit-pending&handoff=1");
  await page
    .getByRole("button", { name: "Choose 3 packs", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open 3 packs", exact: true })
    .last()
    .click();
  await signPermitReview();
  await dialog.getByRole("button", { name: "Open packs", exact: true }).click();
  await page.waitForFunction(() => window.__purchase.submitted.length === 1);
  assert.equal(
    await page.evaluate(() => window.__purchase.confirmed.length),
    0
  );
  assert.equal(
    await page.evaluate(() => window.__purchase.saved[0].expectedRequestCount),
    3
  );
  assert.equal(await dialog.isVisible(), false);
  assert.equal(await page.evaluate(() => window.__purchase.sendAttempts), 1);
  assert.equal(
    await page
      .getByRole("button", { name: "Open 3 packs", exact: true })
      .last()
      .isDisabled(),
    true
  );
  report.checks.push(
    "Opening hash is saved and handed to progress immediately while receipt remains pending; the approval dialog closes and duplicate submission stays disabled"
  );
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error.stack;
  process.exitCode = 1;
} finally {
  await writeFile(
    "/tmp/yunipals-booster-permit-purchase-ui-20261023.json",
    JSON.stringify(report, null, 2) + "\n"
  );
  await browser.close();
  await server.close();
}
console.log(JSON.stringify(report));
