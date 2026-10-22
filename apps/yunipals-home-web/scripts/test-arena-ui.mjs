import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:53902" },
    playwright: { type: "string" },
    chromium: { type: "string" },
    output: { type: "string", default: "/tmp/yunipals-arena-ui" }
  }
});
const app = new URL(values.url);
if (
  app.protocol !== "http:" ||
  !["localhost", "127.0.0.1"].includes(app.hostname)
)
  throw new Error("Use a local Arena Lab.");
if (!values.playwright) throw new Error("Pass an installed Playwright module.");
const root = fileURLToPath(new URL("../../..", import.meta.url));
const pilot = resolve(root, "docs/islands/arena-freeform-tournament-v7");
const published = resolve(
  root,
  "docs/islands/arena-artwork-production-v2/https-releases/4d50ebe8ec0d1ae8c0b9b9f94ad3daef21a7235b06d07df2412fb33c139fc1f9/public/images"
);
const roster = JSON.parse(
  await readFile(resolve(pilot, "roster.json"), "utf8")
);
const { chromium } = await import(pathToFileURL(values.playwright).href);
const browser = await chromium.launch({
  executablePath: values.chromium,
  args: ["--no-sandbox"]
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  acceptDownloads: true
});
const page = await context.newPage();
const report = {
  tests: [],
  errors: [],
  apiRequests: 0,
  screenshots: [],
  paidGeneration: false,
  vrf: "local-test-only",
  imageSource:
    "Existing original NFT references and published island artwork, served locally in this test"
};
page.on("pageerror", (error) => report.errors.push(error.message));
page.on("request", (request) => {
  if (new URL(request.url()).pathname.startsWith("/api/arena/"))
    report.apiRequests++;
});
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.origin === app.origin) return route.continue();
  if (url.pathname.startsWith("/__fixtures/")) {
    const response = await route.fetch({
      url: `${app.origin}${url.pathname}${url.search}`
    });
    return route.fulfill({
      response,
      headers: {
        ...response.headers(),
        "access-control-allow-origin": app.origin
      }
    });
  }
  const fighter = roster.find((entry) => entry.image === url.href);
  if (fighter)
    return route.fulfill({
      contentType: "image/png",
      body: await readFile(resolve(pilot, fighter.localImage))
    });
  const image =
    url.hostname === "assets.yunipals.com" &&
    /^\/islands\/v2\/images\/(\d+)\.png$/.exec(url.pathname);
  if (image)
    return route.fulfill({
      contentType: "image/png",
      body: await readFile(resolve(published, `${image[1]}.png`))
    });
  if (url.hostname === "fonts.googleapis.com")
    return route.fulfill({ contentType: "text/css", body: "" });
  return route.abort();
});
await mkdir(values.output, { recursive: true });
const get = async (path) => {
  const response = await page.request.get(`${app.origin}/api/arena/${path}`);
  assert.equal(response.status(), 200);
  return response.json();
};
try {
  await page.goto(`${app.origin}/arena-lab`);
  const create = page.getByRole("button", {
    name: "Open test tournament",
    exact: true
  });
  await create.waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some(
      (button) =>
        button.textContent === "Open test tournament" && !button.disabled
    )
  );
  await create.click();
  await page.getByRole("heading", { name: "1. Fill the four seats" }).waitFor();
  const tournamentId = new URL(page.url()).searchParams.get("tournament");
  assert.ok(tournamentId);
  await page
    .getByRole("button", { name: "Join as Bastion", exact: true })
    .click();
  await page.getByRole("button", { name: "Seat 1", exact: true }).waitFor();
  const first = await get(`tournaments/${tournamentId}`);
  assert.ok(first.draw?.requestId);
  assert.equal(first.submissionCount, 0);
  assert.equal(await page.getByRole("textbox").count(), 0);
  for (const name of ["Cedar", "Zephyr", "Elrond"]) {
    await page
      .getByRole("button", { name: `Join as ${name}`, exact: true })
      .click();
    await page
      .getByRole("button", {
        name: `Seat ${["Bastion", "Cedar", "Zephyr", "Elrond"].indexOf(name) + 1}`,
        exact: true
      })
      .waitFor();
  }
  await page.getByRole("button", { name: "Lock & submit privately" }).waitFor();
  const joined = await get(`tournaments/${tournamentId}`);
  assert.equal(joined.draw.requestId, first.draw.requestId);
  assert.equal(joined.pool.genesisWeight, 3);
  assert.equal(joined.pool.totalWeight, 1948);
  await page.waitForFunction(() =>
    [...document.querySelectorAll("main img")].every(
      (img) => img.complete && img.naturalWidth > 0
    )
  );
  await page.screenshot({
    path: resolve(values.output, "roster-and-island.png"),
    fullPage: true
  });
  report.screenshots.push("roster-and-island.png");
  report.tests.push(
    "First entrant triggered one persistent draw; four entries unlocked custom strategy inputs"
  );
  const strategies = roster.map(
    (fighter) =>
      `PRIVATE_UI_${fighter.id}: On ${joined.island.name}, watch the opponent's windup. ${fighter.locomotion === "flight" ? "Bank sideways in flight" : "Sidestep on the ground"} at release, then counter the exposed flank during recovery. Against the finalist, adapt the angle to its actual body and defenses.`
  );
  for (let index = 0; index < 4; index++) {
    const fighter = roster[index];
    await page
      .getByRole("group", { name: "Lab player controls" })
      .getByRole("button", { name: fighter.name, exact: true })
      .click();
    await page
      .getByRole("textbox", { name: `${fighter.name}’s strategy` })
      .fill(strategies[index]);
    await page.getByRole("button", { name: "Lock & submit privately" }).click();
    if (index < 3) {
      await page
        .getByRole("status")
        .filter({ hasText: `${fighter.name}’s strategy is locked` })
        .waitFor();
      const publicState = await get(`tournaments/${tournamentId}`);
      assert.equal(publicState.submissionCount, index + 1);
      assert.equal(publicState.strategies, null);
      assert.ok(!JSON.stringify(publicState).includes("PRIVATE_UI_"));
      assert.equal(
        (
          await page.request.get(
            `${app.origin}/api/arena/tournaments/${tournamentId}/input`
          )
        ).status(),
        409
      );
      if (index === 1) {
        await page.reload();
        await page
          .getByRole("group", { name: "Lab player controls" })
          .waitFor();
        assert.ok(
          !(await page
            .getByRole("main")
            .textContent()
            .then((text) => text.includes("PRIVATE_UI_")))
        );
      }
    }
  }
  await page
    .getByRole("heading", { name: "All four strategies revealed" })
    .waitFor();
  const final = await get(`tournaments/${tournamentId}`);
  assert.deepEqual(
    final.strategies.map((entry) => entry.text),
    strategies
  );
  assert.equal(final.resolution, "ready-for-referee");
  const downloadReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export frozen input" }).click();
  const download = await downloadReady;
  const input = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(input.inputSha256, final.inputSha256);
  assert.equal(input.input.strategies.length, 4);
  assert.ok(!JSON.stringify(input).includes("credential"));
  await writeFile(
    resolve(values.output, "frozen-test-input.json"),
    JSON.stringify(input, null, 2)
  );
  report.tests.push(
    "First three prompts remained private across API reads and browser reload; fourth atomically revealed all four"
  );
  report.tests.push(
    "Export contains frozen inputs and draw proof data, without seat credentials"
  );
  await page.screenshot({
    path: resolve(values.output, "revealed-desktop.png"),
    fullPage: true
  });
  report.screenshots.push("revealed-desktop.png");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  );
  await page.screenshot({
    path: resolve(values.output, "revealed-mobile.png"),
    fullPage: true
  });
  report.screenshots.push("revealed-mobile.png");
  report.tests.push("390px mobile viewport has no horizontal overflow");
  report.tournamentId = tournamentId;
  report.island = {
    tokenId: final.island.tokenId,
    name: final.island.name,
    edition: final.island.edition
  };
  assert.deepEqual(report.errors, []);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failure = String(error);
  throw error;
} finally {
  await writeFile(
    resolve(values.output, "report.json"),
    JSON.stringify(report, null, 2)
  );
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
