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
  "virtual:wallet-provider.ts": `export const useAccount=()=>({address:'${wallet}',chainId:8453});
  const client={readContract:async({functionName})=>functionName==='allowance'?0n:functionName==='balanceOf'?100000000n:functionName==='quoteJoin'?[true,100n]:0n,getBalance:async()=>1000000000000000000n,estimateFeesPerGas:async()=>({maxFeePerGas:10n,maxPriorityFeePerGas:1n}),estimateContractGas:async()=>100000n,waitForTransactionReceipt:async({hash})=>({status:'success',transactionHash:hash})};
  export const usePublicClient=()=>client;export const useSwitchChain=()=>({switchChainAsync:async()=>{}});export const useSignMessage=()=>({signMessageAsync:async()=>'0x1234'});export const useSignTypedData=()=>({signTypedDataAsync:async()=>'0x1234'});
  export const useWriteContract=()=>({writeContractAsync:async input=>{const writes=JSON.parse(localStorage.getItem('writes')||'[]');writes.push(input.functionName);localStorage.setItem('writes',JSON.stringify(writes));return input.functionName==='approve'?'${approvalHash}':'${entryHash}'}});`,
  "virtual:wallet-entry.tsx": `import React from 'react';import{createRoot}from'react-dom/client';import{ArenaDeploymentProvider}from'/src/lib/arenaDeployment';import{useArenaWallet}from'/src/pages/arena/live/useArenaWallet';
  const mode=new URLSearchParams(location.search).get('mode'),kind=mode==='anime'?'anime':'video',shared=mode!=='legacy';
  const config={chainId:8453,contract:'0x'+ '3'.repeat(40),contractVersion:shared?2:1,randomnessFunding:shared?'first-entrant':'reserve',mediaKind:kind,paymentToken:'0x'+'4'.repeat(40),entryFee:kind==='anime'?'1000000':'2000000',strategyMaxLength:2400,entriesEnabled:true,confirmationPolicy:'latest'};
  function Harness(){const w=useArenaWallet(config,async()=>{window.__refreshes=(window.__refreshes||0)+1});return <><button disabled={!!w.busy||w.pendingTransaction} onClick={()=>void w.join(shared&&kind==='anime'?'2':'1',{chainId:8453,contractAddress:'0x'+'5'.repeat(40),tokenId:'42'},4)}>Enter fighter</button><output id="progress">{w.entryProgress?.label}</output><output id="status">{w.operation?.action.kind}:{w.operation?.state}</output><output id="pending">{String(w.pendingTransaction)}</output><output id="error">{w.error}</output></>};
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
        document.getElementById("progress").textContent === "Updating approval…"
    );
    assert.deepEqual(
      await page.evaluate(() => JSON.parse(localStorage.getItem("writes"))),
      ["approve"]
    );
    approvalState = "indexed";
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
    assert.ok(posts >= 3);
    assert.ok(await page.evaluate(() => window.__refreshes > 0));
    console.log(
      `${mode}: approval continues into entry; visible progress and reload recovery pass without duplicate sends.`
    );
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
