// Real crew builder, wallet picker and response validation; wallet/RPC/API are fixtures.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createServer, transformWithEsbuild } from "vite";

const { values } = parseArgs({
  options: { playwright: { type: "string" }, chromium: { type: "string" } }
});
const root = fileURLToPath(new URL("..", import.meta.url));
const owner = "0x1111111111111111111111111111111111111111";
const hash = "0x" + "a".repeat(64);
const day = 20000;
let rules = {
  enabled: true,
  day,
  timestamp: day * 86400 + 100,
  requestId: "10",
  ready: true,
  color: 1,
  monsterType: 1
};
const card = (id, color, horn, monsterType, bornToday = false) => ({
  tokenId: String(id),
  owner,
  level: 0,
  sources: [
    {
      tokenId: String(id),
      originalTokenId: "1",
      sequence: id,
      mintedAt: (day - (bornToday ? 0 : 1)) * 86400 + 1,
      isOriginal: false,
      packTypeId: "1",
      variantId: id,
      monsterType,
      color,
      horn,
      glitter: 0
    }
  ],
  effectiveSequence: id,
  artVersion: "0",
  historyHash: hash,
  localDoses: 0,
  presence: 0,
  finish: 0,
  history: {
    tokenId: String(id),
    level: 0,
    presence: 0,
    finish: 0,
    doses: [],
    parents: []
  },
  nextAdventureAt: 0,
  unused: null,
  pendingAdventure: null,
  pendingEvolution: null,
  pendingGrade: null,
  graded: false,
  reservedBy: null,
  transferLocked: false,
  artwork: { uri: "/fixture.png", hash },
  metadataURI: "/fixture.json"
});
const cards = [
  card(1, 1, 1, 2),
  card(2, 2, 2, 2),
  card(3, 2, 1, 1, true),
  card(4, 2, 1, 1)
];
const modules = {
  "virtual:crew-wallet.ts": `export const useAccount=()=>({address:'${owner}',chainId:8453});export const usePublicClient=()=>null;export const useWalletClient=()=>({data:null});`,
  "virtual:crew-art.tsx": `export const BoosterArtwork=({label})=><img width="240" height="320" src="/images/evolution/finishes/normal.webp" alt={label}/>;`,
  "virtual:crew-entry.tsx": `import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{DailyCrewBuilder}from'/src/pages/adventures/DailyCrewBuilder';import{environment}from'/src/environment';import'/src/globals.css';environment.portalApiUrl='/fixture';environment.portalChainId=8453;const query=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});window.__refresh=()=>query.invalidateQueries({queryKey:['evolution','daily-crew']});createRoot(document.getElementById('root')).render(<MemoryRouter><QueryClientProvider client={query}><DailyCrewBuilder busy={false} onReview={(survivor,crew)=>window.__review={survivor,crew}}/></QueryClientProvider></MemoryRouter>);`
};
const cacheDir = await mkdtemp(join(tmpdir(), "crew-ui-"));
const server = await createServer({
  root,
  cacheDir,
  configFile: false,
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": `${root}/src`,
      "@protopals/yunipals-market-core": fileURLToPath(
        new URL("../../../packages/yunipals-market-core/src", import.meta.url)
      )
    }
  },
  server: { host: "127.0.0.1", port: 0, hmr: false },
  plugins: [
    {
      name: "crew-fixtures",
      enforce: "pre",
      resolveId(id) {
        if (Object.hasOwn(modules, id)) return "\0" + id;
        if (id === "wagmi") return "\0virtual:crew-wallet.ts";
        if (id.endsWith("/BoosterCollection")) return "\0virtual:crew-art.tsx";
      },
      load(id) {
        if (id.startsWith("\0") && modules[id.slice(1)])
          return transformWithEsbuild(modules[id.slice(1)], id.slice(1), {
            loader: "tsx",
            jsx: "automatic"
          });
      },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (req.url !== "/__crew") return next();
          res.setHeader("Content-Type", "text/html");
          res.end(
            await vite.transformIndexHtml(
              req.url,
              '<html><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div><script type="module" src="/@id/__x00__virtual:crew-entry.tsx"></script></body></html>'
            )
          );
        });
      }
    }
  ]
});
let browser;
try {
  await server.listen();
  const { chromium } = await import(
    values.playwright ? pathToFileURL(values.playwright).href : "playwright"
  );
  browser = await chromium.launch({
    headless: true,
    executablePath: values.chromium,
    args: ["--no-sandbox"]
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 }
  });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/fixture/v1/evolution/**", (route) =>
    route.fulfill({
      json: route.request().url().includes("/crew")
        ? rules
        : { cards, nextAfter: null }
    })
  );
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/__crew`
  );
  await page
    .getByRole("button", { name: /Review crew and sacrifices/ })
    .waitFor();
  const choose = async (id) =>
    page
      .getByRole("button", { name: new RegExp(`Yunipal #${id}(?:\\s|$)`) })
      .click();
  // Wrong role must be rejected, and each role requires a separate card.
  await choose(2);
  assert.match(await page.getByRole("alert").innerText(), /slot needs/);
  await choose(1);
  await page
    .getByRole("button", { name: "Diamond-horn monster", exact: true })
    .click();
  await choose(2);
  await page
    .locator("#daily-crew > div.grid > div")
    .nth(2)
    .getByRole("button")
    .click();
  await choose(4);
  assert.equal(
    await page
      .getByRole("button", { name: /Review crew and sacrifices/ })
      .isDisabled(),
    true
  );
  await choose(3);
  await page.getByRole("radio").nth(1).check();
  await page
    .getByRole("button", { name: /Review crew and sacrifices/ })
    .click();
  assert.deepEqual(await page.evaluate(() => window.__review), {
    survivor: "2",
    crew: { tokenIds: ["1", "2", "3"], day }
  });
  assert.match(
    await page.locator("#daily-crew").innerText(),
    /guaranteed serum/
  );
  assert.match(
    await page.locator("#daily-crew").innerText(),
    /permanently sacrificed/
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    ),
    true
  );
  await page.screenshot({
    path: "/tmp/yunipals-daily-crew-desktop.png",
    fullPage: true
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    ),
    true
  );
  await page.screenshot({
    path: "/tmp/yunipals-daily-crew-mobile.png",
    fullPage: true
  });
  // A UTC rollover clears the accepted selection and prevents stale departure.
  rules = { ...rules, day: day + 1, timestamp: (day + 1) * 86400 + 1 };
  await page.evaluate(() => window.__refresh());
  await page
    .getByText("Select this slot, then choose a companion below.")
    .first()
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: /Review crew and sacrifices/ })
      .isDisabled(),
    true
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS real crew selection: wrong traits, newborn requirement, selected survivor, midnight rollover, desktop/mobile, no page errors"
  );
} finally {
  await browser?.close();
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
