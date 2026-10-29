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
let state = "Applied";
const fighter = () => ({
  tokenId: "1",
  status: state,
  recipeVersion: 1,
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
      manifest: { version: anime ? "anime-rules-v1" : "arena-mainnet-input-v1" }
    };
  else if (path === "/tournaments") body = { items: [], nextCursor: null };
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
              sprites: { idle: { file: "idle.12345678.webp" } }
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
    if (status === "Approved")
      await page
        .getByRole("link", { name: "Enter the anime arena", exact: true })
        .waitFor();
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
          "rules and transfer policy"
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
