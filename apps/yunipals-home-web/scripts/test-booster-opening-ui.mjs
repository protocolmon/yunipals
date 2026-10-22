// Real React components with local request/receipt fixtures; no chain or wallet.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
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
      default: "/tmp/yunipals-booster-opening-ui.json"
    },
    "components-only": { type: "boolean", default: false }
  }
});
const root = fileURLToPath(new URL("..", import.meta.url));
process.chdir(root);
const report = {
  format: "yunipals-booster-opening-component-ui-v1",
  observedAt: new Date().toISOString(),
  fixturesOnly: true,
  packVisualIncluded: !values["components-only"],
  providerCalls: 0,
  transactions: 0,
  signatures: 0,
  externalRequests: [],
  browserErrors: [],
  checks: []
};
const sourcePaths = [
  "src/pages/boosters/BoosterPackOpening.tsx",
  "src/pages/boosters/booster-pack-opening.css",
  "src/pages/boosters/BoosterTransactions.tsx",
  "src/pages/boosters/BoosterPackSection.tsx",
  "src/pages/collection/page.tsx",
  "src/components/Nav.tsx"
];
const sourceSha256 = Object.fromEntries(
  await Promise.all(
    sourcePaths.map(async (path) => [
      path,
      createHash("sha256")
        .update(await readFile(`${root}/${path}`))
        .digest("hex")
    ])
  )
);
report.sourceSha256 = sourceSha256;
const collectionPath = `${root}/src/pages/collection/page.tsx`;
const collectionText = await readFile(collectionPath, "utf8");
const collectionTree = ts.createSourceFile(
  collectionPath,
  collectionText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const rendered = new Set();
function inspect(node) {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
    rendered.add(node.tagName.getText(collectionTree));
  ts.forEachChild(node, inspect);
}
inspect(collectionTree);
assert(
  !rendered.has("BoosterPackSection"),
  "Home must not mount the purchase component, including hidden JSX"
);
assert(!/import\s.*BoosterPackSection/.test(collectionText));
assert(
  rendered.has("BoosterCollection"),
  "Owned booster collection stays on the collection page"
);
const navText = await readFile(`${root}/src/components/Nav.tsx`, "utf8");
assert(/<ScanSearch\b/.test(navText), "Grading uses the inspection icon");
assert(navText.includes("Grading is coming soon"));
assert(!navText.includes("Battles are coming soon"));
report.checks.push({
  name: "Homepage truly omits purchase component and retains owned collection; Grading uses ScanSearch",
  passed: true
});

const ids = {
  entry: "virtual:booster-opening-ui.tsx",
  boosters: "virtual:booster-opening-fixture.ts",
  wagmi: "virtual:booster-opening-wagmi.ts",
  action: "virtual:booster-opening-action.tsx"
};
const fixture = `
import {encodeEventTopics,encodeAbiParameters,parseAbiParameters} from 'viem';
import {boosterPacksAbi} from '@protopals/yunipals-market-core/boosterAbi';
export const owner='0xB3883Cd96d72B08b8226452305A28D65974a3727';
const registry='0x1111111111111111111111111111111111111111';
const engine='0x2222222222222222222222222222222222222222';
const monsters='0x3333333333333333333333333333333333333333';
const hash='0x'+'a'.repeat(64),zero='0x'+'0'.repeat(64);
export const scenario=()=>new URLSearchParams(location.search).get('scenario')||'revealed';
export const fixtureArtwork={name:'Fixture Yunidragon',image:'/__fixture-card.svg',attributes:{type:'Yunidragon',color:'Blue',horn:'Spiral',glitter:'No'},status:'ready',holo:null};
export const boosterQueryKey=['booster-opening-local-fixture'];
export const boosterAddresses=()=>({registry,engine,monsters});
export const visibleBoosterTypes=(rows)=>rows;
export const readBoosterTransactions=()=>scenario()==='empty'?[]:[{hash,kind:scenario()==='claim'?'claim':'open',cancelled:scenario()==='cancelled',submittedAt:1}];
export const readBoosterTransactionReceipt=(read)=>read();
export const fetchBoosterMonster=async()=>({item:{tokenId:'7',metadataUri:'fixture:7',collection:monsters,isOriginal:true,owner}});
export const fetchMonsterArtwork=async()=>fixtureArtwork;
export const fetchBoosterTypes=async()=>({requestsPaused:false,items:[{id:'fixture-pack-2',packTypeId:'2',registry,engine,manifestUri:'ipfs://fixture-standard',totalVariants:264,mintsPerInterval:1,intervalSeconds:'86400',paymentToken:'0xe5a54a517cde8ed48a336b173044b1138aa2c1a3',price:'1000000000000000000',salesPaused:false}]});
export const client={
 async readContract({functionName}){
  if(functionName==='refundCredits')return 0n;
  if(functionName==='getRequest')return {originalId:7n,status:scenario()==='pending'?1:scenario()==='recovery'?2:3,opening:scenario()!=='non-opening'&&scenario()!=='claim'};
  throw Error('Unexpected local fixture read: '+functionName);
 },
 async getTransactionReceipt(){
  if(scenario()==='unconfirmed')return null;
  if(scenario()==='reverted')return {status:'reverted',logs:[]};
  const topics=encodeEventTopics({abi:boosterPacksAbi,eventName:'RequestCreated',args:{requestId:9n,originalId:7n,packTypeId:2n}});
  const data=encodeAbiParameters(parseAbiParameters('address,uint32,bool,uint256,bytes32,uint32'),[owner,1,scenario()!=='claim',10n**18n,zero,900000]);
  return {status:'success',logs:[{address:engine,topics,data}]};
 }
};`;
const entry = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {BoosterPackOpening} from '/src/pages/boosters/BoosterPackOpening';
import {BoosterTransactions} from '/src/pages/boosters/BoosterTransactions';
import {BoosterPackSection} from '/src/pages/boosters/BoosterPackSection';
import {fixtureArtwork} from '${ids.boosters}';
import '/src/globals.css';
const query=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
function Harness(){
 const mode=new URLSearchParams(location.search).get('mode')||'opening';
 const [open,setOpen]=useState(false),[closed,setClosed]=useState(0);
 return <MemoryRouter><QueryClientProvider client={query}><main>
  {mode==='opening'?<><button onClick={()=>setOpen(true)}>Start local opening</button><output aria-label="Close count">{closed}</output>{open&&<BoosterPackOpening mode="demo" artwork={fixtureArtwork} onClose={()=>{setOpen(false);setClosed(n=>n+1);}}/>}</>:mode==='pack'?<BoosterPackSection/>:<BoosterTransactions/>}
 </main></QueryClientProvider></MemoryRouter>;
}
createRoot(document.getElementById('root')).render(<Harness/>);`;
const modules = {
  [ids.entry]: entry,
  [ids.boosters]: fixture,
  [ids.wagmi]: `import {owner,client} from '${ids.boosters}';export const useAccount=()=>({address:owner,isConnected:true,chainId:8453});export const usePublicClient=()=>client;`,
  [ids.action]: `import React from 'react';export function BoosterActionButton({children,disabled}){return <button type="button" disabled={disabled}>{children}</button>}`
};
const server = await createServer({
  root,
  configFile: false,
  server: { host: "127.0.0.1", port: 5198, strictPort: true },
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
      name: "booster-opening-component-check",
      enforce: "pre",
      resolveId(id, importer) {
        if (Object.hasOwn(modules, id)) return "\0" + id;
        if (id === "wagmi") return "\0" + ids.wagmi;
        if (id === "@/lib/boosters" || id === `${root}/src/lib/boosters`)
          return "\0" + ids.boosters;
        if (
          id.endsWith("/BoosterActionButton") &&
          importer?.includes("/pages/boosters/")
        )
          return "\0" + ids.action;
      },
      load(id) {
        if (!id.startsWith("\0") || !Object.hasOwn(modules, id.slice(1)))
          return;
        return transformWithEsbuild(modules[id.slice(1)], id.slice(1), {
          loader: "tsx",
          jsx: "automatic"
        });
      },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (req.url === "/__fixture-card.svg") {
            res.setHeader("Content-Type", "image/svg+xml");
            return res.end(
              '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" rx="25" fill="#c4b5fd"/><text x="25" y="300" font-size="30">Fixture Yunidragon</text></svg>'
            );
          }
          if (req.url?.split("?")[0] !== "/__booster-opening-check")
            return next();
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
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const { chromium } = await import(pathToFileURL(values.playwright).href);
const browser = await chromium.launch({
  executablePath: values.chromium,
  args: ["--no-sandbox"]
});
const context = await browser.newContext({
  viewport: { width: 1100, height: 1000 }
});
await context.route("**/*", (route) => {
  const request = route.request();
  if (request.url().startsWith(origin + "/") && request.method() === "GET")
    return route.continue();
  report.externalRequests.push({
    method: request.method(),
    type: request.resourceType()
  });
  return route.abort("blockedbyclient");
});
await context.routeWebSocket("**/*", (socket) => socket.close());
const page = await context.newPage();
page.setDefaultTimeout(12000);
page.on("pageerror", (error) => report.browserErrors.push(error.message));
const visit = (query) =>
  page.goto(`${origin}/__booster-opening-check?${query}`, {
    waitUntil: "networkidle"
  });
const dialog = () =>
  page.getByRole("dialog", { name: "Yunipals pack opening", exact: true });
const stage = () => page.locator("[data-stage]").first();
async function waitStage(value) {
  await page.waitForFunction(
    (value) =>
      document.querySelector("[data-stage]")?.getAttribute("data-stage") ===
      value,
    value
  );
}
async function drag(locator, dx, dy, cancel = false) {
  const box = await locator.boundingBox();
  assert(box);
  const x = box.x + box.width * 0.12,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  if (cancel)
    await locator.dispatchEvent("pointercancel", {
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true
    });
  await page.mouse.up();
}
async function run(name, fn) {
  await fn();
  assert.deepEqual(report.browserErrors, []);
  report.checks.push({ name, passed: true });
}
try {
  if (!values["components-only"])
    await run(
      "Real pack offer uses decoded portrait artwork, correct price/rules and demo entry",
      async () => {
        await visit("mode=pack&scenario=empty");
        const offer = page.locator("#booster-packs article").first();
        await offer.waitFor();
        const art = offer.locator(
          'img[src="/images/boosters/yunipals-pack-v1.png"]'
        );
        await art.evaluate((image) => image.decode());
        assert(
          await art.evaluate(
            (image) =>
              image.naturalHeight > image.naturalWidth &&
              image.naturalWidth >= 400
          )
        );
        assert((await offer.innerText()).includes("264"));
        assert((await offer.innerText()).includes("1 PROTO"));
        await page
          .getByRole("heading", { name: "Unwrap a little magic.", exact: true })
          .waitFor();
        await offer
          .getByRole("heading", { name: "Yunipals booster pack", exact: true })
          .waitFor();
        await offer
          .getByRole("button", { name: "Open pack", exact: true })
          .waitFor();
        await page.setViewportSize({ width: 390, height: 844 });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1
          ),
          "Portrait offer fits mobile width"
        );
        report.packScreenshot =
          "/tmp/yunipals-booster-pack-offer-mobile-20261022.png";
        await page.screenshot({ path: report.packScreenshot, fullPage: true });
        await page
          .getByRole("button", { name: "Try the opening", exact: true })
          .first()
          .click();
        await dialog().waitFor();
        await page
          .getByText("Demo preview — no NFT is minted.", { exact: true })
          .waitFor();
        await page.keyboard.press("Escape");
        assert.equal(await dialog().count(), 0);
        await page.setViewportSize({ width: 1100, height: 1000 });
      }
    );
  await run(
    "Ready demo uses actual strip drag; short/cancelled gestures never reveal",
    async () => {
      await visit("mode=opening");
      await page
        .getByRole("button", { name: "Start local opening", exact: true })
        .click();
      await dialog().waitFor();
      const rip = page.getByRole("button", {
        name: "Rip pack seal",
        exact: true
      });
      const box = await rip.boundingBox();
      await drag(rip, box.width * 0.12, 0);
      assert.equal(await stage().getAttribute("data-stage"), "sealed");
      await drag(rip, box.width * 0.25, 0, true);
      assert.equal(await stage().getAttribute("data-stage"), "sealed");
      await drag(rip, box.width * 0.9, 0);
      await waitStage("extracting");
      assert.equal(
        await page
          .getByRole("button", { name: "Replay opening", exact: true })
          .count(),
        0
      );
      await drag(
        page.getByRole("button", { name: "Pull card upward", exact: true }),
        0,
        -320
      );
      await waitStage("revealing");
      await drag(
        page.getByRole("button", { name: "Reveal card", exact: true }),
        300,
        0
      );
      await waitStage("results");
      await page
        .getByRole("button", { name: "Replay opening", exact: true })
        .click();
      await waitStage("sealed");
      await page.keyboard.press("Escape");
      assert.equal(await dialog().count(), 0);
    }
  );
  await run(
    "Keyboard and reduced motion complete the same steps without looping animations",
    async () => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await visit("mode=opening");
      await page
        .getByRole("button", { name: "Start local opening", exact: true })
        .click();
      const rip = page.getByRole("button", {
        name: "Rip pack seal",
        exact: true
      });
      await rip.focus();
      await page.keyboard.press("Enter");
      await waitStage("extracting");
      await page
        .getByRole("button", { name: "Pull pack downward", exact: true })
        .focus();
      await page.keyboard.press("Space");
      await waitStage("revealing");
      await page
        .getByRole("button", { name: "Reveal card", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await waitStage("results");
      assert.equal(
        await dialog().evaluate(
          (element) =>
            element
              .getAnimations({ subtree: true })
              .filter(
                (animation) =>
                  animation.effect?.getTiming().iterations === Infinity
              ).length
        ),
        0
      );
      await page
        .getByRole("button", { name: "Close pack opening", exact: true })
        .click();
      assert.equal(await page.getByLabel("Close count").innerText(), "1");
      await page.emulateMedia({ reducedMotion: "no-preference" });
    }
  );
  await run(
    "Real transaction component never offers a reveal for cancelled, failed, VRF-pending, recovery or claim requests",
    async () => {
      for (const [scenario, status] of [
        ["cancelled", "Cancelled"],
        ["unconfirmed", "Waiting for confirmation"],
        ["reverted", "Transaction reverted"],
        ["pending", "Awaiting randomness"],
        ["recovery", "Ready for recovery"],
        ["claim", "Revealed"],
        ["non-opening", "Revealed"]
      ]) {
        await visit(`mode=transactions&scenario=${scenario}`);
        await page.getByText(status, { exact: true }).waitFor();
        assert.equal(
          await page
            .getByRole("button", { name: "Reveal Yunipal", exact: true })
            .count(),
          0,
          scenario
        );
        assert.equal(await dialog().count(), 0, scenario);
      }
    }
  );
  await run(
    "Only confirmed onchain opening+Revealed can explicitly launch the genuine NFT opening",
    async () => {
      await visit("mode=transactions&scenario=revealed");
      const reveal = page.getByRole("button", {
        name: "Reveal Yunipal",
        exact: true
      });
      await reveal.waitFor();
      assert.equal(
        await dialog().count(),
        0,
        "Do not auto-play an opening on a poll"
      );
      await reveal.click();
      await dialog().waitFor();
      await waitStage("sealed");
      assert.equal(
        await page
          .getByText("Demo preview — no NFT is minted.", { exact: true })
          .count(),
        0
      );
      await page
        .getByRole("button", { name: "Rip pack seal", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await waitStage("extracting");
      await page
        .getByRole("button", { name: "Pull card upward", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await waitStage("revealing");
      await page
        .getByRole("button", { name: "Reveal card", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await waitStage("results");
      await page
        .getByRole("link", { name: /View.*Yunipal|View.*collection/i })
        .first()
        .waitFor();
      await page.keyboard.press("Escape");
    }
  );
  assert.deepEqual(
    report.externalRequests,
    [],
    "Component harness never calls a remote API/provider"
  );
  for (const path of sourcePaths)
    assert.equal(
      createHash("sha256")
        .update(await readFile(`${root}/${path}`))
        .digest("hex"),
      sourceSha256[path],
      `Source changed during browser check: ${path}`
    );
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = String(error.stack ?? error);
} finally {
  report.completedAt = new Date().toISOString();
  await writeFile(values.output, JSON.stringify(report, null, 2) + "\n");
  await browser.close();
  await server.close();
}
console.log(
  JSON.stringify({
    output: values.output,
    passed: report.passed,
    checks: report.checks,
    failure: report.failure
  })
);
if (!report.passed) process.exitCode = 1;
