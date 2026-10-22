import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { parseArgs, promisify } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    playwright: { type: "string" },
    chromium: { type: "string" },
    output: { type: "string", default: "/tmp/yunipals-arena-production-ui" },
    "vercel-cli": { type: "string" },
    "vercel-project-dir": { type: "string" },
    "entry-mode": { type: "string", default: "pilot" }
  }
});
if (!values.url || !values.playwright) {
  throw new Error("Pass --url and an installed --playwright module.");
}
const { chromium } = await import(
  pathToFileURL(resolve(values.playwright)).href
);
const url = values.url;
const expectedEntryMode = values["entry-mode"];
assert.ok(["pilot", "public"].includes(expectedEntryMode));
assert.ok(
  /^https:\/\/(www\.yunipals\.com|yunipals-[a-z0-9]+-devving\.vercel\.app)$/.test(
    url
  )
);
const protectedDeployment = url.endsWith(".vercel.app");
if (
  protectedDeployment &&
  (!values["vercel-cli"] || !values["vercel-project-dir"])
) {
  throw new Error(
    "Pass the existing authenticated --vercel-cli and linked --vercel-project-dir for a protected deployment."
  );
}
if (protectedDeployment) {
  const linked = JSON.parse(
    await readFile(
      resolve(values["vercel-project-dir"], ".vercel/project.json"),
      "utf8"
    )
  );
  assert.equal(linked.projectId, "prj_j8Mg0nIBXeXVLylHgSu6OWxa6QgE");
  assert.equal(linked.orgId, "team_EHhGsy15b4Z8zOUwpm2usI5y");
}
const output = resolve(values.output);
const temporary = await mkdtemp("/tmp/arena-css-review-");
const run = promisify(execFile);
const node = process.execPath;
const cli = values["vercel-cli"];
let active = 0;
const waiting = [];
let count = 0;
const cache = new Map();
async function fetchProtected(path) {
  if (cache.has(path)) return cache.get(path);
  const task = (async () => {
    if (active < 3) active++;
    else await new Promise((resolve) => waiting.push(resolve));
    const file = `${temporary}/${++count}.body`;
    try {
      const { stdout } = await run(
        node,
        [
          cli,
          "curl",
          path,
          "--deployment",
          url,
          "--scope",
          "devving",
          "--",
          "--silent",
          "--show-error",
          "--output",
          file,
          "--write-out",
          "%{http_code}|%{content_type}"
        ],
        {
          cwd: resolve(values["vercel-project-dir"]),
          timeout: 45000,
          maxBuffer: 1024 * 1024
        }
      );
      const match = stdout.trim().match(/(\d{3})\|([^\n]+)$/);
      assert.ok(match, "Missing deployment HTTP status");
      return {
        status: Number(match[1]),
        contentType: match[2],
        body: await readFile(file)
      };
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  })();
  cache.set(path, task);
  return task;
}
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: values.chromium,
  args: ["--no-sandbox"]
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 }
});
if (protectedDeployment) {
  // Authentication stays in the supported Vercel CLI. No token is extracted,
  // exposed to browser state or forwarded to an external service.
  await context.route(url + "/**", async (route) => {
    assert.ok(["GET", "HEAD"].includes(route.request().method()));
    const target = new URL(route.request().url());
    const response = await fetchProtected(target.pathname + target.search);
    await route
      .fulfill(
        route.request().method() === "HEAD"
          ? { ...response, body: "" }
          : response
      )
      .catch(() => {});
  });
}
const page = await context.newPage();
page.setDefaultTimeout(45000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const metrics = [];
async function checkLayout(mobile) {
  await page
    .locator('a[aria-label="Yunipals home"] img')
    .evaluate((img) => img.decode());
  const actual = await page.evaluate(() => {
    const main = document.querySelector("main");
    const heading = main.querySelector("h1");
    const logo = document.querySelector('a[aria-label="Yunipals home"] img');
    const navigation = document.querySelector(
      'nav[aria-label="Primary navigation"]'
    );
    const arenaNavigation = document.querySelector(
      'nav[aria-label="Arena navigation"]'
    );
    const payouts = document.querySelector(
      'section[aria-label="Entry and payouts"]'
    );
    const rect = main.getBoundingClientRect();
    const style = getComputedStyle(main);
    const gridStyle = payouts && getComputedStyle(payouts);
    return {
      pathname: location.pathname,
      viewport: innerWidth,
      main: {
        width: rect.width,
        x: rect.x,
        paddingTop: style.paddingTop,
        paddingLeft: style.paddingLeft,
        maxWidth: style.maxWidth
      },
      headingFontSize: getComputedStyle(heading).fontSize,
      logo: {
        width: logo.getBoundingClientRect().width,
        height: logo.getBoundingClientRect().height,
        loaded: logo.complete && logo.naturalWidth > 0
      },
      navigation: getComputedStyle(navigation).display,
      arenaNavigation: getComputedStyle(arenaNavigation).display,
      payouts: payouts
        ? {
            display: gridStyle.display,
            columns: gridStyle.gridTemplateColumns.split(" ").length,
            background: gridStyle.backgroundImage,
            radius: gridStyle.borderRadius
          }
        : null,
      overflow: document.documentElement.scrollWidth > innerWidth + 1
    };
  });
  assert.equal(actual.main.paddingTop, "48px", "Main padding utility missing");
  assert.equal(
    actual.main.paddingLeft,
    "20px",
    "Main horizontal padding missing"
  );
  assert.equal(
    actual.headingFontSize,
    mobile ? "36px" : "48px",
    "Responsive heading utility missing"
  );
  assert.equal(actual.logo.width, 40, "Logo width utility missing");
  assert.equal(actual.logo.height, 40, "Logo height utility missing");
  assert.equal(actual.logo.loaded, true, "Logo asset missing");
  assert.equal(
    actual.navigation,
    mobile ? "none" : "flex",
    "Responsive primary navigation missing"
  );
  assert.equal(
    actual.arenaNavigation,
    "flex",
    "Arena navigation layout missing"
  );
  assert.equal(actual.overflow, false, "Page overflows viewport");
  if (!mobile) {
    assert.ok(
      actual.main.width >= 896 && actual.main.width <= 1152,
      "Main container width utility missing"
    );
    assert.ok(
      Math.abs(actual.main.x - (1440 - actual.main.width) / 2) <= 1,
      "Container is not centered"
    );
  }
  if (actual.payouts) {
    assert.equal(actual.payouts.display, "grid", "Payout grid missing");
    assert.equal(
      actual.payouts.columns,
      mobile ? 2 : 4,
      "Responsive payout columns missing"
    );
    assert.match(
      actual.payouts.background,
      /linear-gradient/,
      "Payout theme missing"
    );
    assert.equal(actual.payouts.radius, "22px", "Theme configuration missing");
  }
  assert.equal(
    await page
      .locator("main")
      .getByRole("button", { name: /Connect wallet/i })
      .count(),
    0,
    "Arena must use the shared header wallet control"
  );
  assert.equal(
    await page.getByRole("button", { name: /sign in to arena/i }).count(),
    0,
    "Arena must not show a separate sign-in gate"
  );
  metrics.push(actual);
}
try {
  await page.goto(url + "/arena", {
    waitUntil: "domcontentloaded",
    timeout: 90000
  });
  await page
    .getByRole("heading", { name: "Four fighters. One champion.", exact: true })
    .waitFor();
  if (expectedEntryMode === "pilot") {
    await page
      .getByText(
        "Controlled launch pilot · only the selected test wallets can enter while the full mainnet flow is verified.",
        { exact: true }
      )
      .waitFor();
  }
  await page
    .locator('a[aria-label="Yunipals home"] img')
    .evaluate((img) => img.decode());
  const decline = page.getByRole("button", { name: "Decline", exact: true });
  if (await decline.isVisible()) await decline.click();
  await checkLayout(false);
  const api = await page.evaluate(async () => {
    const get = async (path) => {
      const r = await fetch("/api/arena/" + path);
      return { status: r.status, data: await r.json() };
    };
    const config = await get("config"),
      health = await get("health"),
      rules = await get("rules"),
      tournaments = await get("tournaments"),
      privateMe = await get("me"),
      walletSummary = await get(
        "wallets/0x08820403d7Edb694A2E91eBa5bCc73DBCD24aB23/summary"
      ),
      walletRewards = await get(
        "wallets/0x08820403d7Edb694A2E91eBa5bCc73DBCD24aB23/rewards?limit=12"
      );
    return {
      config,
      health,
      rulesHash: rules.data.rulesHash,
      rulesStatus: rules.status,
      tournaments,
      walletSummary,
      walletRewards,
      privateMeStatus: privateMe.status
    };
  });
  assert.equal(api.config.status, 200);
  assert.equal(
    api.config.data.contract.toLowerCase(),
    "0xebd141b6ae36f74fe70b9139b262ee9771b72aca"
  );
  assert.equal(api.config.data.entriesEnabled, true);
  assert.equal(api.config.data.entryMode, expectedEntryMode);
  assert.equal(api.config.data.entryFee, "2000000");
  assert.equal(api.health.status, 200);
  assert.equal(api.health.data.ok, true);
  assert.equal(api.rulesStatus, 200);
  assert.equal(
    api.rulesHash,
    "0x46a4dc89a248047d27c6b02d208c5d2866e843280ef2803294384850edb06c80"
  );
  assert.equal(api.tournaments.status, 200);
  assert.equal(api.privateMeStatus, 401);
  assert.equal(api.walletSummary.status, 200);
  assert.equal(
    api.walletSummary.data.wallet,
    "0x08820403d7edb694a2e91eba5bcc73dbcd24ab23"
  );
  assert.match(api.walletSummary.data.available, /^[0-9]+$/);
  assert.equal(api.walletRewards.status, 200);
  assert.ok(Array.isArray(api.walletRewards.data.items));
  await page.screenshot({
    path: output + "/arena-desktop.png",
    fullPage: true
  });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, heading] of [
    ["/arena", "Four fighters. One champion."],
    ["/arena/me", "Your Arena"],
    ["/arena/hosting", "Your islands. Their battles."],
    ["/arena/rules", "How the Arena works"]
  ]) {
    await page.goto(url + path, {
      waitUntil: "domcontentloaded",
      timeout: 90000
    });
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    if (path === "/arena") {
      await page
        .getByRole("region", { name: "How Arena works", exact: true })
        .waitFor();
      assert.equal(await page.locator("textarea").count(), 0);
      assert.equal(
        await page
          .getByText("Timeline & verification", { exact: true })
          .count(),
        0
      );
    }
    await checkLayout(true);
    await page.screenshot({
      path: output + "/" + path.slice(1).replaceAll("/", "-") + "-mobile.png",
      fullPage: true
    });
  }
  await page.goto(url + "/?collection=islands", {
    waitUntil: "domcontentloaded",
    timeout: 90000
  });
  await page
    .getByRole("combobox", { name: "Island origin" })
    .getByText("Airdropped · Base", { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("combobox", { name: "Island origin" })
      .evaluate((el) => getComputedStyle(el).borderRadius),
    "9999px"
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  );
  await page.screenshot({
    path: output + "/islands-mobile.png",
    fullPage: true
  });
  assert.deepEqual(errors, []);
  const report = {
    version: "arena-production-layout-v2",
    checkedAt: new Date().toISOString(),
    url,
    status: "passed",
    access: protectedDeployment
      ? "Supported Vercel CLI; deployment protection retained"
      : "Public domain",
    checks: [
      "Generated Tailwind utilities and custom theme are applied",
      "Desktop centered container, 40px logo, flex navigation and four payout columns",
      "Mobile layout, two payout columns, responsive headings and no overflow on four Arena routes",
      "Same-origin API reads live deployed contract and indexed tournament state",
      `${expectedEntryMode} entry state; 2 USDC economics and published rules match`,
      "Private account still denies unauthenticated access",
      "Existing Base islands filter and styled dropdown preserved",
      "Arena uses only the shared header wallet control",
      "No separate Arena sign-in gate",
      "Indexed wallet balance and rewards are readable without authentication",
      "No browser exceptions"
    ],
    metrics,
    api,
    limitation:
      "Read-only layout/API verification only; real payments, provider outcomes and claims have separate acceptance evidence."
  };
  await writeFile(
    output + "/report.json",
    JSON.stringify(report, null, 2) + "\n"
  );
  console.log(
    JSON.stringify({
      url,
      status: report.status,
      output,
      layoutChecks: metrics.length,
      indexedTournaments: api.tournaments.data.items.length
    })
  );
} catch (error) {
  await page
    .screenshot({ path: output + "/failure.png", fullPage: true })
    .catch(() => {});
  console.log(JSON.stringify({ url: page.url(), errors, metrics }));
  throw error;
} finally {
  await browser.close();
  // CLI reads may still be completing after the browser cancels prefetches.
  // Drain those tasks before removing their output directory.
  await Promise.allSettled([...cache.values()]);
  await rm(temporary, { recursive: true, force: true });
}
