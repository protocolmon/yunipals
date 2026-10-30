import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
const require = createRequire(
  new URL("../../apps/yunipals-anime-engine/package.json", import.meta.url)
);
const { chromium } = require("playwright-core");
const app = new URL(process.argv[2] ?? "http://127.0.0.1:5177");
if (
  app.protocol !== "http:" ||
  !["127.0.0.1", "localhost"].includes(app.hostname)
)
  throw new Error("Use a local fixture website.");
const output = process.argv[3] ?? "/tmp/yunipals-anime-ui";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.ANIME_CHROME,
  args: ["--no-sandbox"]
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [],
  requests = [];
page.on("pageerror", (error) => errors.push(error.message));
let state = "Applied",
  backgroundMode = "shared-preview";
const fighter = () => ({
  tokenId: "1",
  status: state,
  recipeVersion: 2,
  applications: 2,
  manifestHash: `0x${"a".repeat(64)}`,
  applicant: `0x${"1".repeat(40)}`,
  reasonCode: ["Rejected", "Revoked"].includes(state) ? 2 : null,
  note: ["Rejected", "Revoked"].includes(state)
    ? '<img src=x onerror="alert(1)"> Please reapply after the recipe update.'
    : null,
  appliedBlock: "90",
  queuePosition: 3
});
const art = await readFile(
  new URL(
    "../../apps/yunipals-anime-engine/fixtures/assets/cedar-idle.webp",
    import.meta.url
  )
);
await page.route("https://assets-anime.yunipals.com/**", (r) =>
  r.fulfill({ status: 200, contentType: "image/webp", body: art })
);
await page.route("**/api/**", async (route) => {
  const url = new URL(route.request().url());
  const anime = url.pathname.startsWith("/api/anime-arena/");
  const path = url.pathname.replace(/^\/api\/(anime-arena|arena)/, "");
  requests.push(url.pathname);
  let body;
  if (path === "/config")
    body = {
      chainId: 8453,
      contract: `0x${(anime ? "2" : "1").repeat(40)}`,
      paymentToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      entryFee: anime ? "1000000" : "2000000",
      strategyMaxLength: 2400,
      entriesEnabled: false,
      entryMode: "closed",
      confirmationPolicy: "latest",
      mediaKind: anime ? "anime" : "video"
    };
  else if (path === "/rules")
    body = {
      rulesHash: `0x${"b".repeat(64)}`,
      manifest: { version: anime ? "anime-rules-v3" : "arena-mainnet-input-v1" }
    };
  else if (path === "/tournaments") body = { items: [], nextCursor: null };
  else if (path === "/tournaments/93")
    body = {
      id: "93",
      phase: "strategies",
      seats: [],
      submittedSeats: [],
      deadline: Math.floor(Date.now() / 1000) + 86400,
      serverTime: Math.floor(Date.now() / 1000),
      islandId: "1",
      requestId: "3",
      strategies: null,
      winners: null
    };
  else if (path === "/tournaments/93/context")
    body = {
      island: {
        tokenId: "1",
        name: "Selected island #1",
        image: "https://assets-anime.yunipals.com/island-fixture.webp",
        traits: { biome: "Ancient Grounds" },
        profile: { geometry: "A pillared court." },
        animeBackground: { mode: backgroundMode }
      },
      roster: [],
      rules: { combat: { terrainPolicy: "Selected island terrain." } }
    };
  else if (path === "/fighters")
    body = {
      items: [fighter()],
      counts: { None: 0, Applied: 12, Approved: 4, Rejected: 2, Revoked: 1 },
      nextCursor: null
    };
  else if (path === "/fighters/1")
    body = {
      fighter: fighter(),
      registry: `0x${"3".repeat(40)}`,
      applicationsOpen: true,
      assetsOrigin: "https://assets-anime.yunipals.com",
      manifest:
        state === "Approved"
          ? {
              identity: { species: "Unibranch" },
              sprites: { idle: { file: "idle.12345678.webp" } },
              kits: ["Vine Lash", "Thorn Volley", "Root Slam"].map(
                (name, i) => ({
                  id: name.toLowerCase().replaceAll(" ", "-"),
                  name,
                  element: "nature",
                  kind: ["strike", "projectile", "dash"][i],
                  description: `${name} signature effect.`,
                  impact: {
                    sheet:
                      "recipes/anime-fighter-v2/species/elements-nature/impact.12345678.webp",
                    cols: 2,
                    rows: 2,
                    blend: "add"
                  }
                })
              )
            }
          : null
    };
  else throw new Error(`Unexpected fixture request ${url.pathname}`);
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
});
try {
  await page.goto(`${app.origin}/arena/anime`);
  await page
    .getByRole("heading", { name: "Four fighters. One champion." })
    .waitFor();
  await page.getByText("3.20 USDC", { exact: true }).waitFor();
  await page.getByText("0.20 USDC", { exact: true }).waitFor();
  await page.screenshot({
    path: join(output, "anime-desktop.png"),
    fullPage: true
  });
  await page.goto(`${app.origin}/arena`);
  await page.getByText("6 USDC", { exact: true }).waitFor();
  assert.equal(await page.getByText("3.20 USDC", { exact: true }).count(), 0);
  await page.goto(`${app.origin}/arena/anime/rules`);
  await page
    .getByRole("heading", { name: "Anime fighters · Base OG only" })
    .waitFor();
  await page.getByText(/Approval and fighter art follow the NFT/).waitFor();
  await page.getByText(/Choose two before locking your strategy/).waitFor();
  await page
    .getByText(/Anime films currently use one shared arena backdrop/)
    .waitFor();
  await page.goto(`${app.origin}/arena/anime/93`);
  await page.getByRole("heading", { name: "Selected island #1" }).waitFor();
  await page.getByText(/The film uses shared arena artwork/).waitFor();
  assert.equal(await page.getByText("Brookstone Ring #195").count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(output, "shared-island-mobile.png"),
    fullPage: true
  });
  backgroundMode = "island";
  await page.reload();
  await page.getByRole("heading", { name: "Selected island #1" }).waitFor();
  assert.equal(
    await page.getByText(/The film uses shared arena artwork/).count(),
    0
  );
  await page.goto(`${app.origin}/arena/anime/studio`);
  await page.getByRole("link", { name: "Base Yunipal #1" }).waitFor();
  await page
    .getByRole("button", { name: "Applied · 12", exact: true })
    .waitFor();
  state = "Rejected";
  await page.getByRole("button", { name: /^Rejected/ }).click();
  await page.getByText(/Curator note: <img src=x/).waitFor();
  assert.equal(await page.locator('img[src="x"]').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(output, "queue-mobile.png"),
    fullPage: true
  });
  for (const status of ["None", "Applied", "Rejected", "Revoked", "Approved"]) {
    state = status;
    await page.goto(`${app.origin}/collection/base/1`);
    await page
      .getByRole("heading", { name: "Anime Arena", exact: true })
      .waitFor();
    if (status === "Applied")
      await page
        .getByText(
          "Application #2 · Queue position 3. Awaiting curator review."
        )
        .waitFor();
    if (status === "Rejected")
      await page.getByText(/Curator note: <img src=x/).waitFor();
    if (status === "Revoked")
      await page.getByText("Awaiting curator re-approval.").waitFor();
    if (status === "Approved") {
      await page
        .getByRole("link", { name: "Enter the anime arena", exact: true })
        .waitFor();
      for (const name of ["Vine Lash", "Thorn Volley", "Root Slam"])
        await page
          .getByRole("img", { name: `${name} effect preview` })
          .waitFor();
    }
    assert.equal(
      await page.getByRole("button", { name: /^(Apply|Reapply)$/ }).count(),
      0,
      "Non-owner must not see application controls"
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1
      )
    );
  }
  await page.screenshot({
    path: join(output, "approved-token-mobile.png"),
    fullPage: true
  });
  // Exercise the real form in isolation: no wallet signing or provider calls.
  await page.route("**/__anime-kit-form", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><head><link rel="stylesheet" href="/src/globals.css"><script type="module">import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type; window.__vite_plugin_react_preamble_installed__ = true;</script></head><body><div id="kit-form"></div></body></html>'
    })
  );
  await page.goto(`${app.origin}/__anime-kit-form`);
  await page.evaluate(async () => {
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (
      await import("/node_modules/.vite/deps/react-dom_client.js")
    ).default;
    const { StrategyEditor } = await import(
      "/src/pages/arena/live/LiveArenaPage.tsx"
    );
    window.__kitSubmissions = [];
    const kits = ["Vine Lash", "Thorn Volley", "Root Slam"].map((name) => ({
      id: name.toLowerCase().replaceAll(" ", "-"),
      name,
      kind: "strike",
      description: `${name} signature effect.`
    }));
    createRoot(document.getElementById("kit-form")).render(
      React.createElement(StrategyEditor, {
        tournament: {
          id: "93",
          submittedSeats: [],
          deadline: Math.floor(Date.now() / 1000) + 86400,
          serverTime: Math.floor(Date.now() / 1000)
        },
        seat: {
          seat: 0,
          player: `0x${"1".repeat(40)}`,
          nftChainId: 8453,
          tokenId: "1"
        },
        contract: `0x${"2".repeat(40)}`,
        fighter: {
          name: "Yunibranch",
          locomotion: "ground",
          animeKits: kits,
          animeDefaultLoadout: [kits[0].id, kits[1].id]
        },
        busy: false,
        submit: async (...args) => {
          window.__kitSubmissions.push(args);
        },
        readReceipt: async () => undefined
      })
    );
  });
  const vine = page.getByRole("button", { name: /Vine Lash/ }),
    thorn = page.getByRole("button", { name: /Thorn Volley/ }),
    root = page.getByRole("button", { name: /Root Slam/ });
  await vine.waitFor();
  assert.equal(await vine.getAttribute("aria-pressed"), "true");
  assert.equal(await thorn.getAttribute("aria-pressed"), "true");
  assert.equal(await root.isDisabled(), true);
  await vine.focus();
  await page.keyboard.press("Space");
  assert.equal(await vine.getAttribute("aria-pressed"), "false");
  const lock = page.getByRole("button", { name: "Sign & lock strategy" });
  await page.getByRole("textbox").fill("Thorn Volley, then Root Slam.");
  assert.equal(await lock.isDisabled(), true);
  await root.focus();
  await page.keyboard.press("Enter");
  await lock.click();
  assert.deepEqual(await page.evaluate(() => window.__kitSubmissions), [
    ["93", 0, "Thorn Volley, then Root Slam.", ["thorn-volley", "root-slam"]]
  ]);
  await page.screenshot({
    path: join(output, "loadout-picker-mobile.png"),
    fullPage: true
  });
  assert.deepEqual(errors, []);
  assert.ok(requests.some((p) => p === "/api/arena/config"));
  assert.ok(requests.some((p) => p === "/api/anime-arena/config"));
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      {
        checks: [
          "deployment-specific routes, caches and economics",
          "public queue and escaped rejection notes",
          "all five token states for non-owner",
          "approved preview and mobile overflow",
          "rules and transfer policy",
          "shared arena artwork with the selected island's rules and rewards",
          "three signature kit canvas previews and cosmetic loadout rules",
          "keyboard 2-of-3 defaults, selection limit and submitted loadout"
        ],
        errors,
        requests
      },
      null,
      2
    ) + "\n"
  );
  console.log("Anime desktop/mobile fixture flows passed");
} finally {
  await browser.close();
}
