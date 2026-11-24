import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer, transformWithEsbuild } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = process.argv[2] ?? "/tmp/yunipals-anime-application-ui";
await mkdir(output, { recursive: true });
const owner = `0x${"1".repeat(40)}`;
const modules = {
  "virtual:entry.tsx": `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {BrowserRouter,Routes,Route} from 'react-router-dom';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {ArenaDeploymentProvider} from '/src/lib/arenaDeployment';
    import {ArenaQueuePage} from '/src/pages/arena/live/ArenaQueuePage';
    import {LiveArenaPage} from '/src/pages/arena/live/LiveArenaPage';
    import {AnimeStudioPage} from '/src/pages/arena/anime/AnimeStudioPage';
    const kind=location.pathname.includes('/video')?'video':'anime';
    createRoot(document.getElementById('root')).render(
      <BrowserRouter><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
        <ArenaDeploymentProvider kind={kind}><Routes>
          <Route path="/arena/:kind" element={<ArenaQueuePage/>}/>
          <Route path="/arena/anime/studio" element={<AnimeStudioPage/>}/>
          <Route path="/arena/:kind/:id" element={<LiveArenaPage/>}/>
          <Route path="*" element={<p>Application destination</p>}/>
        </Routes></ArenaDeploymentProvider>
      </QueryClientProvider></BrowserRouter>);
  `,
  "virtual:wagmi.ts": `
    export const useAccount=()=>({address:new URLSearchParams(location.search).has('disconnected')?undefined:'${owner}'});
    export const usePublicClient=()=>undefined;
  `,
  "virtual:wallet.ts": `export const useArenaWallet=()=>({
    entryProgress:new URLSearchParams(location.search).has('confirming')?{key:new URLSearchParams(location.search).has('other-battle')?'2/entry':'1/entry',label:'Confirm in wallet…'}:null
  });`,
  "virtual:environment.ts": `export const environment={sharedArenaApiUrl:'/__arena',yunipalsIndexerUrl:'/__indexer'};`
};
const server = await createServer({
  root,
  configFile: false,
  cacheDir: output + "/vite-cache",
  server: { host: "127.0.0.1", port: 0 },
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
      name: "anime-application-fixture",
      enforce: "pre",
      resolveId(id) {
        if (id === "wagmi") return "\0virtual:wagmi.ts";
        if (/useArenaWallet(?:\.ts)?$/.test(id)) return "\0virtual:wallet.ts";
        if (/\/src\/environment(?:\.ts)?$/.test(id))
          return "\0virtual:environment.ts";
        if (modules[id]) return "\0" + id;
      },
      load(id) {
        if (id.startsWith("\0")) return modules[id.slice(1)];
      },
      transform(code, id) {
        if (id.startsWith("\0virtual:"))
          return transformWithEsbuild(code, id.slice(1), {
            loader: id.endsWith("tsx") ? "tsx" : "ts",
            jsx: "automatic"
          });
      },
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith("/arena/")) return next();
          res.setHeader("Content-Type", "text/html");
          res.end(
            '<!doctype html><html><head><link rel="stylesheet" href="/src/globals.css"></head><body><div id="root"></div><script type="module" src="/@id/__x00__virtual:entry.tsx"></script></body></html>'
          );
        });
      }
    }
  ]
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const require = createRequire(
  new URL("../../yunipals-anime-engine/package.json", import.meta.url)
);
const { chromium } = require("playwright-core");
const browser = await chromium.launch({
  executablePath: process.env.ANIME_CHROME,
  args: ["--no-sandbox"]
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let approved = false;
  let phase = "open";
  let entered = false;
  let submitted = false;
  let full = false;
  const seat = {
    seat: 0,
    player: owner,
    nftChainId: 8453,
    collection: "0x98433df878e8c898cb907345c3a7756e5f72240f",
    tokenId: "1234"
  };
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const path = url.pathname;
    let data;
    if (path.endsWith("/config"))
      data = {
        contract: owner,
        chainId: 8453,
        entryMode: "public",
        entriesEnabled: true
      };
    else if (path.endsWith("/context"))
      data = {
        ready: false,
        island: null,
        tiePriority: [],
        roster: entered
          ? [
              {
                id: "1234",
                name: "Test Yunichick",
                image: "/images/arena/anime-chick.webp",
                identity: "A test fighter",
                locomotion: "ground",
                animeDefaultLoadout: ["a", "b"],
                animeKits: [
                  { id: "a", name: "Dust Kick", description: "A dust attack" },
                  {
                    id: "b",
                    name: "Hoof Sweep",
                    description: "A sweeping attack"
                  },
                  {
                    id: "c",
                    name: "Stubborn Rush",
                    description: "A rushing attack"
                  }
                ]
              }
            ]
          : []
      };
    else if (/\/tournaments\/1$/.test(path))
      data = {
        id: "1",
        phase,
        seats: full
          ? Array.from({ length: 4 }, (_, i) => ({
              ...seat,
              seat: i,
              tokenId: String(100 + i),
              player: `0x${"2".repeat(40)}`
            }))
          : entered
            ? [seat]
            : [],
        serverTime: Math.floor(Date.now() / 1000),
        deadline: Math.floor(Date.now() / 1000) + 86400,
        submittedSeats: submitted ? [0] : [],
        requestId: null
      };
    else if (path.endsWith("/tournaments"))
      data = { items: [], nextCursor: null };
    else if (path.endsWith("/fighters"))
      data = {
        items: [],
        nextCursor: null,
        counts: { Approved: 9, Applied: 0, Rejected: 0, Revoked: 0 }
      };
    else if (path.includes("/fighters/"))
      data = { fighter: { status: approved ? "Approved" : "Applied" } };
    else if (path.startsWith("/__indexer/"))
      data = {
        version: 1,
        query: "chain=base&sort=rarity-capped-desc",
        chain: "base",
        chains: ["base"],
        owner,
        resolvedAddresses: { base: owner },
        visibility: "visible",
        previousCursor: null,
        nextCursor: null,
        items: [
          {
            chain: "base",
            chainId: 8453,
            contractAddress: "0x98433df878e8c898cb907345c3a7756e5f72240f",
            tokenId: "1234",
            owner,
            hidden: false,
            burned: false,
            lifecycle: 0,
            mintBlock: "1",
            lastTransferBlock: "1",
            name: "Test Yunichick",
            image: "/images/arena/anime-chick.webp",
            attributes: [],
            tokenUri: null,
            metadataAvailable: true,
            rarityPoints: "1",
            rarityPointsCapped: "1"
          }
        ]
      };
    if (data) return route.fulfill({ json: data });
    return route.continue();
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/arena/anime", "/arena/anime/1"]) {
      await page.goto(origin + path);
      const hint = page.getByRole("complementary", {
        name: "How to apply for Anime Arena"
      });
      await hint.waitFor();
      assert.equal(
        await hint
          .getByRole("link", { name: "My Base Yunipals" })
          .getAttribute("href"),
        `/collector/${owner}?edition=airdrop`
      );
      assert.equal(
        await hint
          .getByRole("link", { name: "View application queue" })
          .getAttribute("href"),
        "/arena/anime/studio"
      );
      if (path.endsWith("/1")) {
        await page
          .getByText("No approved anime fighters were found", { exact: false })
          .waitFor();
        assert.equal(
          await page
            .getByRole("button", { name: "Enter · 1 USDC", exact: true })
            .count(),
          0
        );
      }
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        true
      );
      await hint.screenshot({
        path: `${output}/${width}-${path.endsWith("/1") ? "picker" : "queues"}.png`
      });
    }
  }
  await page.goto(origin + "/arena/anime/1?disconnected");
  const hint = page.getByRole("complementary", {
    name: "How to apply for Anime Arena"
  });
  await hint.getByText("Connect the owning wallet", { exact: false }).waitFor();
  assert.equal(
    await hint
      .getByRole("link", { name: "Browse Base Yunipals" })
      .getAttribute("href"),
    "/collection?edition=airdrop"
  );
  approved = true;
  await page.goto(origin + "/arena/anime/1");
  await page
    .getByRole("button", { name: "Enter · 1 USDC", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByText("No approved anime fighters were found", { exact: false })
      .count(),
    0
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin + "/arena/anime/1");
    await page
      .getByRole("button", { name: "Enter · 1 USDC", exact: true })
      .waitFor();
    const journey = page.getByRole("region", { name: "Battle steps" });
    assert.equal(
      (await journey.locator('[aria-current="step"]').innerText()).replace(
        /\s+/g,
        " "
      ),
      "1. Choose fighter"
    );
    assert.equal(
      await page.evaluate(() => {
        const picker = document.querySelector("#join");
        const roster = [...document.querySelectorAll("h2")].find(
          (el) => el.textContent === "Battle roster"
        );
        return !!(
          picker.compareDocumentPosition(roster) &
          Node.DOCUMENT_POSITION_FOLLOWING
        );
      }),
      true
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      ),
      true
    );
    await page.screenshot({
      path: `${output}/${width}-guided-entry.png`,
      fullPage: true
    });

    await page.goto(origin + "/arena/anime/1?confirming");
    await page
      .getByRole("heading", { name: "Complete your entry in your wallet" })
      .waitFor();
    assert.equal(
      (await journey.locator('[aria-current="step"]').innerText()).replace(
        /\s+/g,
        " "
      ),
      "2. Confirm entry"
    );

    await page.goto(origin + "/arena/anime/1?confirming&other-battle");
    await journey
      .getByRole("heading", { name: "One fighter is all you need" })
      .waitFor();
    full = true;
    await page.goto(origin + "/arena/anime/1");
    await journey
      .getByRole("heading", { name: "This battle is full" })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Enter · 1 USDC", exact: true })
        .isDisabled(),
      true
    );
    full = false;
    entered = true;
    await page.goto(origin + "/arena/anime/1");
    await page
      .getByRole("heading", {
        name: "You’re entered — here’s what happens next"
      })
      .waitFor();
    assert.equal(
      (await journey.locator('[aria-current="step"]').innerText()).replace(
        /\s+/g,
        " "
      ),
      "3. Wait for opponents"
    );
    const additional = page.locator("#join > details");
    assert.equal(await additional.getAttribute("open"), null);
    const summary = page.getByText("Enter another fighter (optional)", {
      exact: true
    });
    await summary.focus();
    await page.keyboard.press("Enter");
    assert.notEqual(await additional.getAttribute("open"), null);
    await page.getByRole("button", { name: "Entered", exact: true }).waitFor();
    await page.keyboard.press("Enter");
    await page.screenshot({
      path: `${output}/${width}-entered.png`,
      fullPage: true
    });

    phase = "strategies";
    await page.goto(origin + "/arena/anime/1");
    await page
      .getByRole("heading", { name: "Next: submit your strategy" })
      .waitFor();
    assert.equal(
      (await journey.locator('[aria-current="step"]').innerText()).replace(
        /\s+/g,
        " "
      ),
      "4. Submit strategy"
    );
    await page
      .getByText("Choose two of your fighter’s three available attacks", {
        exact: false
      })
      .waitFor();
    await page.getByText("2 of 2 selected.", { exact: false }).waitFor();
    await page.screenshot({
      path: `${output}/${width}-strategy.png`,
      fullPage: true
    });
    submitted = true;
    await page.goto(origin + "/arena/anime/1");
    await page
      .getByRole("heading", { name: "Your strategy is locked" })
      .waitFor();
    phase = "resolving";
    await page.goto(origin + "/arena/anime/1");
    await journey
      .getByRole("heading", { name: "The referee is deciding the battle" })
      .waitFor();
    assert.equal(
      (await journey.locator('[aria-current="step"]').innerText()).replace(
        /\s+/g,
        " "
      ),
      "5. Watch battle"
    );
    phase = "expired";
    await page.goto(origin + "/arena/anime/1");
    await page
      .getByText("Entry refunds are managed in", { exact: false })
      .waitFor();
    assert.equal(await journey.count(), 0);
    phase = "open";
    entered = false;
    submitted = false;

    await page.goto(origin + "/arena/anime/studio");
    await page.getByRole("button", { name: "Approved · 9" }).waitFor();
    await page.getByText("Across all players", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("link", { name: "Join a battle", exact: true })
        .getAttribute("href"),
      "/arena/anime"
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      ),
      true
    );
    await page.screenshot({
      path: `${output}/${width}-gallery.png`,
      fullPage: true
    });
    await page
      .getByRole("link", { name: "Join a battle", exact: true })
      .click();
    await page.getByRole("heading", { name: "Join a battle" }).waitFor();
  }
  await page.goto(origin + "/arena/anime/1");
  await page.getByRole("link", { name: "My Base Yunipals" }).click();
  assert.equal(new URL(page.url()).pathname, `/collector/${owner}`);
  assert.equal(new URL(page.url()).search, "?edition=airdrop");
  await page.goto(origin + "/arena/video");
  await page.getByRole("heading", { name: "Join a battle" }).waitFor();
  assert.equal(
    await page
      .getByRole("complementary", { name: "How to apply for Anime Arena" })
      .count(),
    0
  );
  assert.deepEqual(errors, []);
  console.log(
    "Anime application UI passed: desktop/mobile queues and picker, pending/approved fighters, disconnected wallet, collection navigation, picker order, wallet confirmation, entered/strategy/resolving/expired guidance, optional entry keyboard disclosure, gallery next action and video isolation."
  );
} finally {
  await browser.close();
  await server.close();
}
