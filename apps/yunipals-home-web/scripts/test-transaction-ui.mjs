import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createServer, transformWithEsbuild } from "vite";

const { values } = parseArgs({
  options: { playwright: { type: "string" }, chromium: { type: "string" } }
});
const { chromium } = await import(
  values.playwright ? pathToFileURL(values.playwright).href : "playwright"
);
const root = fileURLToPath(new URL("..", import.meta.url));
process.chdir(root);
const entry = "virtual:transaction-check.tsx";
const mock = "virtual:transaction-mocks";
const fixture = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import {PortalTransactionStatus} from '/src/pages/portals/PortalTransactionStatus';
import {ArenaTransactionFeedback} from '/src/pages/arena/live/ArenaFeedback';
import {PendingMarketTransactions} from '/src/components/marketplace/PendingMarketTransactions';
import {TransactionHistory, TransactionRow, TransactionLink, transactionActionVariants} from '/src/components/ui/transaction';
import '/src/globals.css';
window.fixture={portals:[],records:[],query:{data:null,isError:false},revision:0};
window.checks=[];
window.update=(patch)=>{window.fixture={...window.fixture,...patch,revision:window.fixture.revision+1};window.dispatchEvent(new Event('fixture'));window.dispatchEvent(new Event('market-records'));};
function Demo(){
 const [open,setOpen]=useState(false);
 return <BrowserRouter><main className="mx-auto max-w-4xl space-y-5 p-4">
  <PortalTransactionStatus/>
  <TransactionHistory title="Your openings" count={1} open={open} onOpenChange={setOpen}>
   <ul><TransactionRow as="li" title="Booster opening" status="3 cards · Ready" tone="success" href="https://basescan.org/tx/0x123" actions={<button className={transactionActionVariants()} onClick={()=>window.checks.push('replay')}>Replay</button>}/></ul>
  </TransactionHistory>
  <ArenaTransactionFeedback operation={{hash:'0x123',action:{kind:'approval'},state:'indexed'}} busy={false} onCheck={()=>window.checks.push('arena')}/>
  <TransactionLink href="https://basescan.org/tx/0x123">Transaction {'0x'+'a'.repeat(64)}</TransactionLink>
  <PendingMarketTransactions/>
 </main></BrowserRouter>
}
createRoot(document.getElementById('root')).render(<Demo/>);`;
const mocks = `
import {useSyncExternalStore} from 'react';
const subscribe=fn=>{window.addEventListener('fixture',fn);return()=>window.removeEventListener('fixture',fn)};
const noop=()=>{};
const tracker={key:'test-wallet',getSnapshot:()=>[],check:async(id)=>window.checks.push(id)};
const client={invalidateQueries:noop};
export function usePortalTransactions(){const state=useSyncExternalStore(subscribe,()=>window.fixture);return {tracker,transactions:state.portals};}
export const useArenaDeployment=()=>({entry:5});
export const useConfig=()=>({});
export const useQueryClient=()=>client;
export function useQuery(options){const state=useSyncExternalStore(subscribe,()=>window.fixture);return options.queryKey[0]==='marketplace-receipt'?{...state.query,refetch:()=>window.checks.push('market-retry')}:{data:null};}
export const marketClient=null;
export const analyticsOperations={confirmed:noop};
export const onchainAnalytics={confirmed:noop};
export const confirmSettlement=noop;
export const forgetSettlement=noop;
export const pendingMarketEvent='market-records';
export const readPendingTransactions=()=>window.fixture.records;
export const dismissPendingTransaction=hash=>window.update({records:window.fixture.records.filter(r=>r.hash!==hash)});
`;
const server = await createServer({
  root,
  server: { host: "127.0.0.1", port: 0 },
  plugins: [
    {
      name: "transaction-check",
      enforce: "pre",
      resolveId(id) {
        if ([entry, mock].includes(id)) return "\0" + id;
      },
      load(id) {
        if (id === "\0" + entry)
          return transformWithEsbuild(fixture, entry, {
            loader: "tsx",
            jsx: "automatic"
          });
        if (id === "\0" + mock) return mocks;
      },
      transform(code, id) {
        if (id.endsWith("/PortalTransactionStatus.tsx"))
          return code
            .replace('"@/hooks/usePortalTransactions"', JSON.stringify(mock))
            .replace(
              'import { environment } from "@/environment";',
              "const environment={portalChainId:8453};"
            );
        if (id.endsWith("/ArenaFeedback.tsx"))
          return code.replace('"@/lib/arenaDeployment"', JSON.stringify(mock));
        if (id.endsWith("/PendingMarketTransactions.tsx"))
          return code.replace(
            /"(@tanstack\/react-query|wagmi|@\/lib\/analytics\/(operations|onchain)|@\/hooks\/marketplace\/useMarketplace|@\/lib\/marketplace\/(settlementReconciliation|confirmedSettlements|pendingTransactions))"/g,
            JSON.stringify(mock)
          );
      },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (req.url !== "/__transaction-check") return next();
          res.setHeader("Content-Type", "text/html");
          res.end(
            await vite.transformIndexHtml(
              req.url,
              `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"/></head><body><div id="root"></div><script type="module" src="/@id/__x00__${entry}"></script></body></html>`
            )
          );
        });
      }
    }
  ]
});
await server.listen();
const browser = await chromium.launch({
  executablePath: values.chromium,
  args: ["--no-sandbox"]
});
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 }
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/__transaction-check`
  );
  await page.waitForFunction(() => window.update);
  const confirmed = {
    id: "0x" + "1".repeat(64),
    hash: "0x" + "1".repeat(64),
    actionKey: "request",
    label: "Request next portal",
    state: "indexed",
    message: "Confirmed and indexed.",
    createdAt: Date.now()
  };
  await page.evaluate((row) => window.update({ portals: [row] }), confirmed);
  const portal = page.getByRole("region", {
    name: "Saved portal transactions"
  });
  assert.equal(await portal.locator("details").getAttribute("open"), null);
  await portal.locator("summary").focus();
  await page.keyboard.press("Enter");
  await portal
    .getByText("Confirmed and indexed.")
    .waitFor({ state: "visible" });
  assert.equal(
    await portal.getByRole("link").getAttribute("href"),
    "https://basescan.org/tx/" + confirmed.hash
  );
  await portal.getByRole("button", { name: "Dismiss" }).click();
  await portal.waitFor({ state: "hidden" });
  assert.equal(
    await page.evaluate(() => window.fixture.portals.length),
    1,
    "Dismissal must not delete tracked receipts"
  );
  await page.reload();
  await page.waitForFunction(() => window.update);
  await page.evaluate((row) => window.update({ portals: [row] }), confirmed);
  await portal.waitFor({ state: "hidden" });
  // If a dismissed receipt needs confirmation again, it must resurface.
  await page.evaluate((row) => window.update({ portals: [row] }), {
    ...confirmed,
    state: "confirming",
    message: "Checking confirmation again."
  });
  await portal
    .getByRole("button", { name: "Check status" })
    .waitFor({ state: "visible" });
  assert.equal(
    await portal.getByRole("button", { name: "Dismiss" }).count(),
    0
  );
  await portal.locator("summary").click();
  const pending = {
    ...confirmed,
    id: "0x" + "2".repeat(64),
    hash: "0x" + "2".repeat(64),
    actionKey: "grade:42",
    label: "Transform your pal",
    state: "indexing",
    message: "Confirmed onchain. Waiting for indexing."
  };
  await page.evaluate(
    (rows) => window.update({ portals: rows }),
    [confirmed, pending]
  );
  await portal.getByRole("button", { name: "Check status" }).click();
  assert.deepEqual(await page.evaluate(() => window.checks), [pending.id]);
  assert.equal(
    await portal
      .getByRole("link", { name: "Card history" })
      .getAttribute("href"),
    "/grading/cards/42"
  );
  await portal.locator("summary").click();
  await page.evaluate((row) => window.update({ portals: [row] }), {
    ...pending,
    state: "failed",
    message: "Transaction reverted."
  });
  await portal.getByText("Transaction reverted.").waitFor({ state: "visible" });
  await portal.getByRole("button", { name: "Dismiss" }).click();
  await portal.waitFor({ state: "hidden" });
  await page.evaluate((row) => window.update({ portals: [row] }), {
    ...confirmed,
    createdAt: Date.now() - 3600001
  });
  await portal.waitFor({ state: "hidden" });
  const openings = page.locator("details").filter({ hasText: "Your openings" });
  await openings.locator("summary").focus();
  await page.keyboard.press("Space");
  await openings.getByRole("button", { name: "Replay" }).click();
  assert((await page.evaluate(() => window.checks)).includes("replay"));
  await page
    .getByText(/Choose your fighter below/)
    .waitFor({ state: "visible" });
  const record = {
    hash: "0x" + "3".repeat(64),
    expectation: { chainId: 56, kind: "buy" }
  };
  await page.evaluate((record) => window.update({ records: [record] }), record);
  const market = page.getByRole("complementary", { name: "Your transactions" });
  await market.getByText("Awaiting confirmation").waitFor({ state: "visible" });
  assert.equal(
    await market.getByRole("button", { name: "Dismiss" }).count(),
    0
  );
  await page.evaluate(() =>
    window.update({ query: { data: null, isError: true } })
  );
  await market.getByRole("button", { name: "Check again" }).click();
  assert((await page.evaluate(() => window.checks)).includes("market-retry"));
  await page.evaluate(() =>
    window.update({ query: { data: { status: "reverted" }, isError: false } })
  );
  await market
    .getByText("Reverted", { exact: true })
    .waitFor({ state: "visible" });
  await market.getByRole("button", { name: "Dismiss" }).click();
  await market.waitFor({ state: "hidden" });
  await page.evaluate(
    (record) =>
      window.update({
        records: [record],
        query: {
          data: {
            status: "confirmed",
            receipt: { transactionHash: record.hash }
          },
          isError: false
        }
      }),
    record
  );
  await market
    .getByText("Confirmed", { exact: true })
    .waitFor({ state: "visible" });
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(150);
    if (!((await market.locator("details").getAttribute("open")) !== null))
      await market.locator("summary").click();
    await market
      .getByText("Confirmed", { exact: true })
      .waitFor({ state: "visible" });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      ),
      `Overflow at ${width}px`
    );
    for (const link of await page.locator('a[target="_blank"]').all())
      assert((await link.getAttribute("rel")).includes("noreferrer"));
    await page.screenshot({ path: `/tmp/yunipals-transactions-${width}.png` });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate((row) => window.update({ portals: [row] }), pending);
  const spinner = portal.locator(
    "svg.animate-spin, svg.motion-safe\\:animate-spin"
  );
  assert.equal(
    await spinner.evaluate((el) => getComputedStyle(el).animationName),
    "none"
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: portal dismissal persists on reload without deleting receipts, reorgs resurface, portal history and recovery, keyboard toggles, pack replay action, Arena approval guidance, marketplace pending/error/retry/dismiss states, safe links, 320/390/1280px layouts and reduced motion."
  );
} finally {
  await browser.close();
  await server.close();
}
