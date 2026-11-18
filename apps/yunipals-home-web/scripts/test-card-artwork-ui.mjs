// Actual artwork hook, loader and thumbnails; only network responses are fixtures.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createServer, transformWithEsbuild } from "vite";

const { values } = parseArgs({
  options: {
    playwright: { type: "string", default: process.env.PLAYWRIGHT_MODULE },
    chromium: { type: "string", default: process.env.CHROMIUM_EXECUTABLE }
  }
});
const root = fileURLToPath(new URL("..", import.meta.url));
const cacheDir = await mkdtemp(join(tmpdir(), "card-artwork-test-"));
const modules = {
  "virtual:artwork-portals.ts": `
export const portalApiUrl=()=>location.origin;
export async function fetchPortalStatus(signal){
 const res=await fetch('/status',{signal});if(!res.ok)throw Error('Temporarily unavailable');return res.json();
}`,
  "virtual:artwork-entry.tsx": `
import React from 'react';import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {environment} from '/src/environment';
import {BoosterArtwork} from '/src/pages/boosters/BoosterCollection';
import '/src/globals.css';
environment.portalsEnabled=true;environment.portalGrading='0x1111111111111111111111111111111111111111';
const q=new QueryClient({defaultOptions:{queries:{retryDelay:10}}});
window.refresh=()=>q.invalidateQueries();
createRoot(document.getElementById('root')).render(<MemoryRouter><QueryClientProvider client={q}>
<div className="mx-auto grid max-w-3xl grid-cols-2 gap-6 p-6">{['1','2'].map(tokenId=><article key={tokenId} className="rounded-card border border-line bg-lavender/20 p-4"><BoosterArtwork uri={location.origin+'/original.json'} label={'Yunipal #'+tokenId} card={{collection:'0x2222222222222222222222222222222222222222',tokenId}} display="thumbnail" eager/><p className="mt-3 font-bold">Yunipal #{tokenId}</p></article>)}</div>
</QueryClientProvider></MemoryRouter>);
`
};
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
      name: "artwork-fixtures",
      enforce: "pre",
      resolveId(id) {
        if (Object.hasOwn(modules, id)) return "\0" + id;
        if (id === "@/lib/portals" || id === `${root}/src/lib/portals`)
          return "\0virtual:artwork-portals.ts";
      },
      load(id) {
        if (id.startsWith("\0") && Object.hasOwn(modules, id.slice(1)))
          return transformWithEsbuild(modules[id.slice(1)], id.slice(1), {
            loader: "tsx",
            jsx: "automatic"
          });
      },
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          if (req.url !== "/") return next();
          res.setHeader("Content-Type", "text/html");
          res.end(
            '<div id="root"></div><script type="module" src="/@id/__x00__virtual:artwork-entry.tsx"></script>'
          );
        });
      }
    }
  ]
});
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const { chromium } = await import(
    values.playwright
      ? pathToFileURL(values.playwright).href
      : "playwright-core"
  );
  browser = await chromium.launch({
    executablePath: values.chromium,
    args: ["--no-sandbox"]
  });
  const page = await browser.newPage({
    viewport: { width: 1000, height: 800 }
  });
  const errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error(e.message);
  });
  let originalFail = false,
    statusFail = true,
    gradedFail = false,
    gradedVersion = "2";
  let releaseOriginal;
  const originalGate = new Promise((resolve) => {
    releaseOriginal = resolve;
  });
  let releaseImage;
  const imageGate = new Promise((resolve) => {
    releaseImage = resolve;
  });
  const metadata = (name, image, version) => ({
    name,
    image,
    attributes: [],
    yunipals: { status: "ready", ...(version ? { version } : {}) }
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(origin).origin) return route.abort();
    if (url.pathname === "/status")
      return route.fulfill({
        status: statusFail ? 503 : 200,
        json: statusFail
          ? {}
          : {
              enabled: true,
              deployment: {
                chainId: 8453,
                grading: "0x1111111111111111111111111111111111111111",
                cards: "0x2222222222222222222222222222222222222222"
              }
            }
      });
    if (url.pathname === "/original.json") {
      await originalGate;
      return route.fulfill({
        status: originalFail ? 503 : 200,
        json: metadata("Original", origin + "original.svg")
      });
    }
    if (url.pathname.startsWith("/v1/portals/cards/"))
      return route.fulfill({
        status: gradedFail ? 503 : 200,
        json: metadata("Graded", origin + "graded.svg", gradedVersion)
      });
    if (
      url.pathname.endsWith(".svg") &&
      ["/original.svg", "/graded.svg"].includes(url.pathname)
    ) {
      await imageGate;
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="plum"/></svg>'
      });
    }
    return route.continue();
  });
  await page.goto(origin);
  const loaders = page.locator(".card-artwork-loader");
  await loaders.first().waitFor();
  assert.notEqual(
    await page
      .locator(".card-artwork-loader-face")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
    "none"
  );
  await page.screenshot({
    path: join(tmpdir(), "yunipals-card-loader-desktop.png")
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(tmpdir(), "yunipals-card-loader-mobile.png")
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth
    ),
    false
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator(".card-artwork-loader-face")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
    "none"
  );
  console.log("PASS animated loader, mobile layout and reduced motion");
  releaseOriginal();
  await page.getByText("Original artwork", { exact: true }).first().waitFor();
  assert.equal(await loaders.count(), 2); // Still loading actual image bytes.
  releaseImage();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('img[alt^="Yunipal"]')].every(
        (img) => img.complete && img.naturalWidth > 0
      ) && document.querySelectorAll('img[alt^="Yunipal"]').length === 2
  );
  await page.waitForFunction(
    () => document.querySelectorAll(".card-artwork-loader").length === 0
  );
  console.log(
    "PASS original artwork remains available during grading outage; loader covers image download"
  );
  statusFail = false;
  await page.evaluate(() => window.refresh());
  await page.waitForFunction(() =>
    document.querySelector('img[alt="Yunipal #1"]')?.src.endsWith("/graded.svg")
  );
  assert.equal(
    await page.getByText("Original artwork", { exact: true }).count(),
    0
  );
  console.log(
    "PASS recovery replaces labelled original with current graded artwork"
  );
  statusFail = true;
  gradedFail = true;
  originalFail = true;
  await page.evaluate(() => window.refresh());
  await page.waitForTimeout(300);
  assert(
    (
      await page.getByAltText("Yunipal #1", { exact: true }).getAttribute("src")
    ).endsWith("/graded.svg")
  );
  assert.equal(
    await page
      .getByText("Artwork could not be loaded.", { exact: true })
      .count(),
    0
  );
  console.log(
    "PASS cached graded artwork survives background refresh failures"
  );
  statusFail = false;
  gradedFail = false;
  originalFail = false;
  gradedVersion = "0";
  await page.evaluate(() => window.refresh());
  await page.waitForFunction(() =>
    document
      .querySelector('img[alt="Yunipal #1"]')
      ?.src.endsWith("/original.svg")
  );
  assert.equal(
    await page.getByText("Original artwork", { exact: true }).count(),
    0
  );
  console.log(
    "PASS ungraded cards retain their original artwork without a fallback notice"
  );
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
