// Exercise the real wallet hook with synthetic providers and local HTTP only.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer, transformWithEsbuild } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const wallet = `0x${"1".repeat(40)}`;
const approvalHash = `0x${"a".repeat(64)}`;
const entryHash = `0x${"b".repeat(64)}`;
const mocks = {
  "virtual:wallet-provider.ts": `import{createWalletClient,custom,encodeAbiParameters,encodeEventTopics}from'viem';import{base}from'viem/chains';import{arenaV2Abi}from'@protopals/yunipals-market-core/arenaV2Abi';
  const query=new URLSearchParams(location.search),batch=query.get('batch')||'unsupported',outcome=query.get('outcome')||'success';
  const record=(key,value)=>{const all=JSON.parse(localStorage.getItem(key)||'[]');all.push(value);localStorage.setItem(key,JSON.stringify(all))};
  const rpc=async({method,params})=>{
    if(method==='wallet_getCapabilities'){if(batch==='missing')throw Object.assign(new Error('Not supported'),{code:-32601});return batch==='global'?{'0x0':{atomic:{status:'supported'}}}:{'0x2105':{atomic:{status:batch}}}}
    if(method==='wallet_sendCalls'){record('batches',params[0]);if(outcome==='reject')throw Object.assign(new Error('User rejected'),{code:4001});if(outcome==='unknown')throw Object.assign(new Error('Connection lost'),{code:-32000});return{id:params[0].id}}
    if(method==='wallet_getCallsStatus'){
      const state=localStorage.getItem('batchState')||'pending',id=query.get('mode')==='anime'?2n:1n;
      const log={address:'0x'+'3'.repeat(40),topics:encodeEventTopics({abi:arenaV2Abi,eventName:'Entered',args:{id,seat:0,player:'${wallet}'}}),data:encodeAbiParameters([{type:'uint256'},{type:'address'},{type:'uint256'}],[8453n,'0x'+'5'.repeat(40),state==='mismatch'?43n:42n])};
      return{version:'2.0.0',id:params[0],chainId:'0x2105',atomic:state!=='partial',status:state==='pending'?100:state==='failed'?500:state==='partial'?600:200,receipts:state==='pending'||state==='failed'?[]:[{status:'0x1',transactionHash:'${entryHash}',blockHash:'0x'+'c'.repeat(64),blockNumber:'0x64',gasUsed:'0x186a0',logs:[log]}]};
    }
    throw new Error('Unexpected wallet RPC '+method);
  };
  const connected=createWalletClient({chain:base,account:'${wallet}',transport:custom({request:rpc})});
  export const useWalletClient=()=>({data:connected});
  export const useAccount=()=>({address:'${wallet}',chainId:8453});
  const client={readContract:async({functionName})=>functionName==='allowance'?BigInt(localStorage.getItem('allowance')||'0'):functionName==='balanceOf'?100000000n:functionName==='quoteJoin'?[true,100n]:0n,getBalance:async()=>1000000000000000000n,estimateFeesPerGas:async()=>({maxFeePerGas:10n,maxPriorityFeePerGas:1n}),estimateContractGas:async()=>100000n,waitForTransactionReceipt:async({hash})=>{if(hash==='${approvalHash}')localStorage.setItem('allowance',query.get('lowAllowance')?'0':'100000000');return{status:'success',transactionHash:hash}}};
  export const usePublicClient=()=>client;export const useSwitchChain=()=>({switchChainAsync:async()=>{}});export const useSignMessage=()=>({signMessageAsync:async()=>'0x1234'});export const useSignTypedData=()=>({signTypedDataAsync:async()=>'0x1234'});
  export const useWriteContract=()=>({writeContractAsync:async input=>{record('writes',input.functionName);if(input.functionName==='join'&&localStorage.getItem('rejectJoin'))throw new Error('Entry declined');return input.functionName==='approve'?'${approvalHash}':'${entryHash}'}});`,
  "virtual:wallet-entry.tsx": `import React from 'react';import{createRoot}from'react-dom/client';import{ArenaDeploymentProvider}from'/src/lib/arenaDeployment';import{useArenaWallet}from'/src/pages/arena/live/useArenaWallet';
  const mode=new URLSearchParams(location.search).get('mode'),kind=mode==='anime'?'anime':'video',shared=mode!=='legacy';
  const config={chainId:8453,contract:'0x'+ '3'.repeat(40),contractVersion:shared?2:1,randomnessFunding:shared?'first-entrant':'reserve',mediaKind:kind,paymentToken:'0x'+'4'.repeat(40),entryFee:kind==='anime'?'1000000':'2000000',strategyMaxLength:2400,entriesEnabled:true,confirmationPolicy:'latest'};
  function Harness(){const w=useArenaWallet(config,async()=>{window.__refreshes=(window.__refreshes||0)+1});return <><button disabled={!!w.busy||w.pendingTransaction} onClick={()=>void w.join(shared&&kind==='anime'?'2':'1',{chainId:8453,contractAddress:'0x'+'5'.repeat(40),tokenId:'42'},4)}>Enter fighter</button><output id="progress">{w.entryProgress?.label}</output><output id="status">{w.operation?.action.kind}:{w.operation?.state}</output><button onClick={()=>void w.checkStatus()}>Check status</button><output id="batch">{String(w.batchPending)}</output><output id="pending">{String(w.pendingTransaction)}</output><output id="error">{w.error}</output></>};
  createRoot(document.getElementById('root')).render(<React.StrictMode><ArenaDeploymentProvider kind={kind} shared={shared}><Harness/></ArenaDeploymentProvider></React.StrictMode>);`
};
const server = await createServer({
  root,
  configFile: false,
  server: { host: "127.0.0.1", port: 5212, strictPort: true },
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
      name: "local-arena-wallet-fixture",
      enforce: "pre",
      resolveId(id) {
        if (id === "wagmi") return "\0virtual:wallet-provider.ts";
        const module = id.startsWith("/") ? id.slice(1) : id;
        if (mocks[module]) return "\0" + module;
      },
      load(id) {
        if (id.startsWith("\0")) return mocks[id.slice(1)];
        if (id === root + "/src/environment.ts")
          return "export const environment={arenaApiUrl:'/api/legacy',sharedArenaApiUrl:'/api/shared'}";
      },
      transform(code, id) {
        if (id === "\0virtual:wallet-entry.tsx")
          return transformWithEsbuild(code, id, {
            loader: "tsx",
            jsx: "automatic"
          });
      },
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          if (req.url?.startsWith("/?")) {
            res.setHeader("Content-Type", "text/html");
            res.end(
              '<div id="root"></div><script type="module" src="/virtual:wallet-entry.tsx"></script>'
            );
          } else next();
        });
      }
    }
  ]
});
const { chromium } = createRequire(
  new URL("../../yunipals-anime-engine/package.json", import.meta.url)
)("playwright-core");
await server.listen();
const browser = await chromium.launch({
  executablePath: process.env.ARENA_TEST_CHROMIUM,
  args: ["--no-sandbox"]
});
try {
  for (const mode of ["legacy", "video", "anime"]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (error) => console.error(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") console.error(message.text());
    });
    let approvalState = "indexing",
      entryState = "indexing",
      posts = 0;
    const actions = new Map();
    await context.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const body =
        route.request().method() === "POST"
          ? route.request().postDataJSON()
          : null;
      let value;
      if (path.endsWith("/me")) value = { wallet };
      else if (path.endsWith("/admission"))
        value = {
          entry: { player: wallet, ...body },
          expiry: String(Math.floor(Date.now() / 1000) + 480),
          signature: "0x1234"
        };
      else if (path.includes("/transactions")) {
        if (body) {
          posts++;
          actions.set(body.hash, body.action);
        }
        const hash = body?.hash ?? path.split("/").at(-1);
        const approval = hash === approvalHash;
        value = {
          hash,
          action: actions.get(hash),
          state: approval ? approvalState : entryState,
          indexedThroughBlock: "100",
          result: null
        };
      } else throw Error("Unexpected synthetic request: " + path);
      await route.fulfill({ json: value });
    });
    await page.goto(`http://127.0.0.1:5212/?mode=${mode}`);
    await page.getByRole("button", { name: "Enter fighter" }).click();
    await page.waitForFunction(
      () =>
        document.getElementById("progress").textContent === "Updating entry…"
    );
    assert.deepEqual(
      await page.evaluate(() => JSON.parse(localStorage.getItem("writes"))),
      ["approve", "join"]
    );
    await page.reload();
    await page.waitForFunction(
      () =>
        document.getElementById("progress").textContent === "Updating entry…"
    );
    entryState = "indexed";
    await page.waitForFunction(
      () => document.getElementById("status").textContent === "entry:indexed"
    );
    assert.equal(await page.locator("#pending").textContent(), "false");
    assert.equal(await page.locator("#error").textContent(), "");
    assert.deepEqual(
      await page.evaluate(() => JSON.parse(localStorage.getItem("writes"))),
      ["approve", "join"]
    );
    assert.ok(posts >= 2);
    assert.equal(approvalState, "indexing");
    assert.ok(await page.evaluate(() => window.__refreshes > 0));
    console.log(
      `${mode}: approval proceeds without waiting for indexer; entry still waits for canonical result and recovers after reload.`
    );
    await context.close();
  }
  for (const [batch, outcome] of [
    ["supported", "success"],
    ["ready", "success"],
    ["global", "success"],
    ["supported", "unknown"],
    ["supported", "reject"],
    ["supported", "failed"],
    ["supported", "mismatch"],
    ["supported", "partial"]
  ]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    let entryState = "indexing",
      posts = 0,
      action;
    await context.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname,
        body =
          route.request().method() === "POST"
            ? route.request().postDataJSON()
            : null;
      let value;
      if (path.endsWith("/me")) value = { wallet };
      else if (path.endsWith("/admission"))
        value = {
          entry: { player: wallet, ...body },
          expiry: String(Math.floor(Date.now() / 1000) + 480),
          signature: "0x1234"
        };
      else if (path.includes("/transactions")) {
        if (body) {
          posts++;
          action = body.action;
          assert.equal(body.hash, entryHash);
          assert.equal(action.kind, "entry");
        }
        value = {
          hash: entryHash,
          action,
          state: entryState,
          indexedThroughBlock: "100",
          result: null
        };
      } else throw Error("Unexpected request " + path);
      await route.fulfill({ json: value });
    });
    await page.goto(
      "http://127.0.0.1:5212/?mode=anime&batch=" + batch + "&outcome=" + outcome
    );
    await page.getByRole("button", { name: "Enter fighter" }).click();
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem("batches") || "[]").length === 1
    );
    const [sent] = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("batches"))
    );
    assert.equal(sent.atomicRequired, true);
    assert.equal(sent.chainId, "0x2105");
    assert.equal(sent.from, wallet);
    assert.equal(sent.calls.length, 2);
    assert.equal(sent.calls[0].to, "0x" + "4".repeat(40));
    assert.ok(sent.calls[0].data.startsWith("0x095ea7b3"));
    assert.equal(sent.calls[1].to, "0x" + "3".repeat(40));
    assert.equal(sent.calls[1].value, "0x64");
    assert.deepEqual(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem("writes") || "[]")
      ),
      []
    );
    if (outcome === "reject") {
      await page.waitForFunction(
        () => document.getElementById("error").textContent.length > 0
      );
      assert.equal(await page.locator("#batch").textContent(), "false");
      assert.equal(await page.locator("#pending").textContent(), "false");
      assert.equal(posts, 0);
    } else {
      if (outcome === "unknown") {
        await page.waitForFunction(() =>
          document
            .getElementById("error")
            .textContent.includes("may have submitted")
        );
        await page.reload();
      }
      await page.waitForFunction(
        () => document.getElementById("batch").textContent === "true"
      );
      await page.evaluate(
        (state) => localStorage.setItem("batchState", state),
        ["failed", "mismatch", "partial"].includes(outcome)
          ? outcome
          : "success"
      );
      if (["mismatch", "partial"].includes(outcome)) {
        await page.waitForFunction(() =>
          document.getElementById("error").textContent.includes("retained")
        );
        assert.equal(await page.locator("#pending").textContent(), "true");
        assert.equal(posts, 0);
      } else if (outcome === "failed") {
        await page.waitForFunction(() =>
          document.getElementById("error").textContent.includes("No entry fee")
        );
        assert.equal(await page.locator("#pending").textContent(), "false");
        assert.equal(posts, 0);
      } else {
        await page.waitForFunction(
          () =>
            document.getElementById("progress").textContent ===
            "Updating entry…"
        );
        await page.reload();
        entryState = "indexed";
        await page.waitForFunction(
          () =>
            document.getElementById("status").textContent === "entry:indexed"
        );
        assert.equal(await page.locator("#pending").textContent(), "false");
        assert.ok(posts >= 2);
      }
    }
    assert.equal(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("batches")).length
      ),
      1
    );
    assert.deepEqual(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem("writes") || "[]")
      ),
      []
    );
    console.log(
      "atomic " +
        batch +
        "/" +
        outcome +
        ": ordered approve + paid join, retained recovery ID, no duplicate/fallback sends."
    );
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
