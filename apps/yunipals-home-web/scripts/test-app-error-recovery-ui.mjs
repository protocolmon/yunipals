import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, transformWithEsbuild } from "vite";
import { chromium } from "/tmp/yunipals-foundry/node_modules/playwright-core/index.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const files = [
  "src/main.tsx",
  "src/lib/lazyLoadRecovery.ts",
  "src/components/AppErrorBoundary.tsx"
];
const sha = async (path) =>
  createHash("sha256")
    .update(await readFile(`${root}/${path}`))
    .digest("hex");
const sourceSha256 = Object.fromEntries(
  await Promise.all(files.map(async (path) => [path, await sha(path)]))
);
const cacheDir = await mkdtemp(join(tmpdir(), "yunipals-error-boundary-"));
const entry = `import React,{lazy,Suspense}from'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import{AppErrorBoundary}from'/src/components/AppErrorBoundary';import{registerLazyLoadRecovery}from'/src/lib/lazyLoadRecovery';import'/src/globals.css';registerLazyLoadRecovery();const kind=new URLSearchParams(location.search).get('kind');const missingUrl='/__missing-lazy-module.js';const Missing=lazy(()=>import(/* @vite-ignore */ missingUrl));function Render(){throw new Error('Synthetic genuine render exception');}createRoot(document.getElementById('root')).render(<MemoryRouter><AppErrorBoundary><Suspense fallback={<p>Loading…</p>}>{kind==='render'?<Render/>:kind==='lazy'?<Missing/>:<h1>Healthy Arena fixture</h1>}</Suspense></AppErrorBoundary></MemoryRouter>);`;
const server = await createServer({
  root,
  cacheDir,
  configFile: false,
  server: { host: "127.0.0.1", port: 5210, strictPort: true, hmr: false },
  resolve: { alias: { "@": `${root}/src` } },
  esbuild: { jsx: "automatic" },
  plugins: [
    {
      name: "app-error-recovery-fixture",
      resolveId(id) {
        if (id === "virtual:error-entry") return "\0error-entry.tsx";
      },
      load(id) {
        if (id === "\0error-entry.tsx")
          return transformWithEsbuild(entry, "error-entry.tsx", {
            loader: "tsx",
            jsx: "automatic"
          });
      },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (req.url === "/__missing-lazy-module.js") {
            res.statusCode = 404;
            return res.end("Missing fixture chunk");
          }
          if (req.url?.split("?")[0] !== "/__app-error-check") return next();
          res.setHeader("Content-Type", "text/html");
          res.end(
            await vite.transformIndexHtml(
              req.url,
              '<html><body><div id="root"></div><script type="module" src="/@id/__x00__error-entry.tsx"></script></body></html>'
            )
          );
        });
      }
    }
  ]
});
await server.listen();
const browser = await chromium.launch({
  executablePath:
    "/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
  args: ["--no-sandbox"]
});
const context = await browser.newContext();
const page = await context.newPage();
let navigations = 0;
page.on("framenavigated", (frame) => {
  if (frame === page.mainFrame()) navigations++;
});
const origin = "http://127.0.0.1:5210";
await context.route("**/*", (r) =>
  r
    .request()
    .url()
    .startsWith(origin + "/") && r.request().method() === "GET"
    ? r.continue()
    : r.abort()
);
await context.routeWebSocket("**/*", (s) => s.close());
const report = {
  format: "yunipals-app-error-recovery-ui-v1",
  fixturesOnly: true,
  realWalletActions: 0,
  externalRequestsDispatched: 0,
  sourceSha256,
  checks: []
};
try {
  await page.goto(origin + "/__app-error-check?kind=healthy", {
    waitUntil: "load"
  });
  await page.getByRole("heading", { name: "Healthy Arena fixture" }).waitFor();
  report.checks.push("Healthy routes render normally");
  await page.goto(
    origin + "/__app-error-check?kind=render&retained=query#fragment",
    { waitUntil: "load" }
  );
  await page
    .getByRole("heading", { name: "This page couldn’t load." })
    .waitFor();
  const renderNavigations = navigations;
  await page.waitForTimeout(150);
  assert.equal(navigations, renderNavigations);
  assert(page.url().endsWith("?kind=render&retained=query#fragment"));
  await page
    .getByRole("button", { name: "Reload page", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("link", { name: "Back to collection" })
      .getAttribute("href"),
    "/"
  );
  report.checks.push(
    "A genuine React render exception shows visible recovery controls without automatic reload or changed URL"
  );
  await page.goto(origin + "/__app-error-check?kind=lazy", {
    waitUntil: "load"
  });
  await page
    .getByRole("heading", { name: "This page couldn’t load." })
    .waitFor();
  await page
    .getByText(
      "Submitted transactions remain onchain. Reloading does not submit another transaction.",
      { exact: true }
    )
    .waitFor();
  report.checks.push(
    "An actual rejected dynamic import renders the same helpful fallback instead of an empty root"
  );
  for (const path of files) assert.equal(await sha(path), sourceSha256[path]);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error.stack;
  process.exitCode = 1;
} finally {
  await writeFile(
    "/tmp/yunipals-app-error-recovery-ui-20261023.json",
    JSON.stringify(report, null, 2) + "\n"
  );
  await browser.close();
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
console.log(JSON.stringify(report));
