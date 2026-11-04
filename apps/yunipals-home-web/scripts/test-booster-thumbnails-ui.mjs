import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { createServer } from "vite";
import {
  registerBoosterArtworkRoutes,
  BoosterArtworkStore
} from "../../yunipals-indexer/lib/boosters/artwork.ts";

const { values } = parseArgs({
  options: {
    playwright: { type: "string", default: "playwright-core" },
    chromium: {
      type: "string",
      default: "/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome"
    }
  }
});
const appRoot = fileURLToPath(new URL("../", import.meta.url));
const repository = fileURLToPath(new URL("../../../", import.meta.url));
const requireIndexer = createRequire(
  new URL("../../yunipals-indexer/package.json", import.meta.url)
);
const { Hono } = requireIndexer("hono");
const directory = await mkdtemp(join(tmpdir(), "tcg-thumbnails-"));
const harness = await mkdtemp(join(appRoot, ".thumbnail-check-"));
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAYCAYAAADzoH0MAAAAL0lEQVR4nGNgGGjACGM0MDT8J0VjA0MDIwMDAwMTpS4YNWDUgFEDRg0YPAYMPAAA8jYDKAKC4WAAAAAASUVORK5CYII=",
  "base64"
);
const sources = Array.from({ length: 5 }, (_, index) => {
  const data = Buffer.concat([png, Buffer.from(String(index))]);
  return { data, sha: createHash("sha256").update(data).digest("hex") };
});
let server;
let browser;
try {
  await mkdir(join(directory, "assets"));
  await mkdir(join(directory, "catalogs/demo/variants"), { recursive: true });
  for (const [index, source] of sources.entries()) {
    await writeFile(
      join(directory, "assets", `${source.sha}.png`),
      source.data
    );
    await writeFile(
      join(directory, "catalogs/demo/variants", `${index}.json`),
      JSON.stringify({
        image: `https://example.test/v1/boosters/art-assets/${source.sha}.png`,
        yunipals: { status: "ready", artworkSha256: source.sha }
      })
    );
  }
  const generation = spawnSync(
    "python3",
    [
      join(repository, "scripts/boosters/art_previews.py"),
      "--directory",
      directory
    ],
    { encoding: "utf8" }
  );
  assert.equal(generation.status, 0, generation.stderr);
  for (const index of [1, 2]) {
    await unlink(join(directory, "previews/v1", `${sources[index].sha}.webp`));
    await unlink(join(directory, "previews/v1", `${sources[index].sha}.json`));
  }
  await unlink(join(directory, "assets", `${sources[2].sha}.png`));
  const api = new Hono();
  registerBoosterArtworkRoutes(api, new BoosterArtworkStore(directory));
  let complete = false;
  const counts = new Map();
  api.get("/complete", (c) => {
    complete = true;
    return c.json({ ready: true });
  });
  api.get("/mask.svg", (c) =>
    c.body(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 24"><rect width="16" height="24" fill="white"/></svg>',
      200,
      { "Content-Type": "image/svg+xml" }
    )
  );
  api.get("/art/:id", (c) => {
    const index = Number(c.req.param("id"));
    if (index === 3 && !complete)
      return c.json({ yunipals: { status: "queued" } }, 202);
    const origin = new URL(c.req.url).origin;
    return c.json({
      name: "Preview test",
      image: `${origin}/v1/boosters/art-assets/${sources[index].sha}.png`,
      attributes: [{ trait_type: "Glitter", value: "Yes" }],
      yunipals: {
        status: "ready",
        holo: {
          foreground: `${origin}/mask.svg`,
          background: `${origin}/mask.svg`,
          stars: `${origin}/mask.svg`
        }
      }
    });
  });
  await writeFile(
    join(harness, "index.html"),
    '<div id="root"></div><script type="module" src="./main.tsx"></script>'
  );
  await writeFile(
    join(harness, "main.tsx"),
    `
    import React, { useState } from "react";
    import { createRoot } from "react-dom/client";
    import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
    import { MemoryRouter } from "react-router-dom";
    import { WagmiProvider, createConfig, http } from "wagmi";
    import { base } from "wagmi/chains";
    import { BoosterArtwork } from "/src/pages/boosters/BoosterCollection";
    import { CollectionPackCard } from "/src/components/CollectionPackCard";
    import "/src/globals.css";
    import "/src/booster-cards.css";
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const config = createConfig({ chains: [base], transports: { [base.id]: http(location.origin) } });
    const monster = { collection: "0x1111111111111111111111111111111111111111", tokenId: "1", monsterType: "8", color: "1", horn: "2", glitter: "1", metadataUri: location.origin + "/art/0" };
    function Check() {
      const [full, setFull] = useState(false);
      return <main className="p-4"><div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <section data-check="grid"><CollectionPackCard monster={monster} eager /></section>
        <section data-check="duplicate"><BoosterArtwork uri={location.origin + "/art/0"} label="Duplicate card" display="thumbnail" eager /></section>
        <section data-check="fallback"><BoosterArtwork uri={location.origin + "/art/1"} label="Fallback card" display="thumbnail" eager /></section>
        <section data-check="broken"><BoosterArtwork uri={location.origin + "/art/2"} label="Broken card" display="thumbnail" eager /></section>
        <section data-check="queued"><BoosterArtwork uri={location.origin + "/art/3"} label="Queued card" display="thumbnail" eager /></section>
      </div><button onClick={() => setFull(true)}>Expand card</button>
      <button onClick={async () => { await fetch("/complete"); await client.invalidateQueries(); }}>Complete artwork</button>
      {full && <section data-check="full"><BoosterArtwork uri={location.origin + "/art/0"} label="Full card" interactive /></section>}
      <div style={{ height: 10000 }} /><section data-check="lazy" className="w-60"><BoosterArtwork uri={location.origin + "/art/4"} label="Lazy card" display="thumbnail" /></section></main>;
    }
    createRoot(document.getElementById("root")!).render(<WagmiProvider config={config}><QueryClientProvider client={client}><MemoryRouter><Check /></MemoryRouter></QueryClientProvider></WagmiProvider>);
  `
  );
  server = await createServer({
    root: appRoot,
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "thumbnail-test-api",
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            if (
              !/^\/(v1\/boosters\/|art\/|complete|mask.svg)/.test(req.url ?? "")
            )
              return next();
            const pathname = new URL(req.url, `http://${req.headers.host}`)
              .pathname;
            counts.set(pathname, (counts.get(pathname) ?? 0) + 1);
            const response = await api.request(
              `http://${req.headers.host}${req.url}`,
              { method: req.method }
            );
            res.statusCode = response.status;
            for (const [key, value] of response.headers)
              res.setHeader(key, value);
            res.end(Buffer.from(await response.arrayBuffer()));
          });
        }
      }
    ]
  });
  await server.listen();
  const address = server.httpServer.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const importPath = values.playwright.startsWith("/")
    ? pathToFileURL(values.playwright).href
    : values.playwright;
  const { chromium } = await import(importPath);
  browser = await chromium.launch({
    executablePath: values.chromium,
    args: ["--no-sandbox"]
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  const previewPath = (index) =>
    `/v1/boosters/art-previews/v1/${sources[index].sha}.webp`;
  const originalPath = (index) =>
    `/v1/boosters/art-assets/${sources[index].sha}.png`;
  await page.goto(`${origin}/${harness.split("/").at(-1)}/index.html`);
  await page.waitForFunction(
    () => document.querySelector('[data-check="grid"] img')?.naturalWidth > 0
  );
  assert.ok(
    (
      await page.locator('[data-check="grid"] img').getAttribute("src")
    ).endsWith(previewPath(0))
  );
  await page.waitForFunction(
    () =>
      document.querySelector('[data-check="fallback"] img')?.naturalWidth > 0
  );
  assert.ok(
    (
      await page.locator('[data-check="fallback"] img').getAttribute("src")
    ).endsWith(originalPath(1))
  );
  await page.locator('[data-check="broken"] [role="img"]').waitFor();
  assert.equal(counts.get(previewPath(2)), 1);
  assert.equal(counts.get(originalPath(2)), 1);
  assert.equal(counts.get("/art/0"), 1);
  assert.equal(counts.get(originalPath(0)) ?? 0, 0);
  assert.equal(counts.get("/mask.svg") ?? 0, 0);
  assert.equal(counts.get(previewPath(4)) ?? 0, 0);
  assert.match(
    await page.locator('[data-check="queued"]').innerText(),
    /being prepared/
  );
  await page.getByRole("button", { name: "Complete artwork" }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-check="queued"] img')?.naturalWidth > 0
  );
  await page.getByRole("button", { name: "Expand card", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-check="full"] img')?.naturalWidth > 0
  );
  assert.ok(
    (
      await page.locator('[data-check="full"] img').first().getAttribute("src")
    ).endsWith(originalPath(0))
  );
  await page.getByRole("button", { name: /View Preview test larger/ }).click();
  await page.getByRole("dialog").waitFor();
  assert.ok(
    (
      await page.getByRole("dialog").locator("img").first().getAttribute("src")
    ).endsWith(originalPath(0))
  );
  await page.keyboard.press("Escape");
  await page.locator('[data-check="lazy"]').scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () => document.querySelector('[data-check="lazy"] img')?.naturalWidth > 0
  );
  assert.equal(counts.get(previewPath(4)), 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth
    ),
    false
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        passed: [
          "grid uses WebP",
          "shared metadata deduplicates",
          "missing preview falls back once",
          "broken original stops retrying",
          "queued artwork becomes ready",
          "distant images load on scroll",
          "detail and lightbox use full artwork",
          "mobile layout fits"
        ],
        generation: JSON.parse(generation.stdout)
      },
      null,
      2
    )
  );
} finally {
  await browser?.close();
  await server?.close();
  await rm(harness, { recursive: true, force: true });
  await rm(directory, { recursive: true, force: true });
}
