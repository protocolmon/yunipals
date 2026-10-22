// Verify the original main app and additive packs using live, public read APIs.
// No injected wallet, signatures, provider RPC, or non-GET browser requests.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "https://www.yunipals.com" },
    output: {
      type: "string",
      default: "/tmp/yunipals-restored-main-readonly.json"
    },
    "protected-vercel": { type: "boolean", default: false },
    "arena-prepared": { type: "boolean", default: false },
    playwright: {
      type: "string",
      default: "/tmp/yunipals-foundry/node_modules/playwright-core/index.mjs"
    },
    chromium: {
      type: "string",
      default: "/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome"
    }
  }
});
const origin = new URL(values.url).origin;
assert(
  origin === "https://www.yunipals.com" ||
    /^https:\/\/yunipals-[a-z0-9]+-devving\.vercel\.app$/.test(origin),
  "Use the canonical site or its reviewed Vercel preview"
);
const apiOrigin = "https://api.yunipals.com";
let bypass;
if (values["protected-vercel"]) {
  assert(origin.endsWith(".vercel.app"));
  // Match the existing canonical verifier; reuse existing automation access.
  // This value stays in memory and is attached only to the exact app origin.
  const { token } = JSON.parse(
    await readFile("/root/.local/share/com.vercel.cli/auth.json", "utf8")
  );
  const response = await fetch(
    "https://api.vercel.com/v9/projects/prj_j8Mg0nIBXeXVLylHgSu6OWxa6QgE?teamId=team_EHhGsy15b4Z8zOUwpm2usI5y",
    { headers: { Authorization: `Bearer ${token}` } }
  );
  assert.equal(response.status, 200, "Existing Vercel access required");
  const project = await response.json();
  assert.equal(project.id, "prj_j8Mg0nIBXeXVLylHgSu6OWxa6QgE");
  bypass = Object.entries(project.protectionBypass ?? {}).find(
    ([, value]) => value.scope === "automation-bypass"
  )?.[0];
  assert(bypass, "Existing preview automation access required");
}

const report = {
  format: "yunipals-restored-main-readonly-v1",
  origin,
  observedAt: new Date().toISOString(),
  originalMainReference: "2d5cfd4a75d659fe65c442fcb54b759675aff638",
  mockedApiResponses: 0,
  walletConnections: 0,
  signatures: 0,
  transactions: 0,
  providerCalls: 0,
  expectedArenaConfigured: !values["arena-prepared"],
  blockedRequests: {},
  api: [],
  checks: [],
  pageErrors: []
};
const { chromium } = await import(pathToFileURL(values.playwright).href);
const browser = await chromium.launch({
  executablePath: values.chromium,
  args: ["--no-sandbox"]
});
const context = await browser.newContext({
  viewport: { width: 1360, height: 1000 },
  serviceWorkers: "block"
});
await context.route("**/*", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const kind = request.resourceType();
  const isData = ["fetch", "xhr"].includes(kind);
  const provider =
    /(?:alchemy|infura|ankr|quicknode|drpc|publicnode|walletconnect|rpc\.ankr|mainnet\.base|binance|bnbchain|polygon-rpc|rpc\.ethereum)/i.test(
      url.hostname
    ) || /(?:^|\/)rpc(?:\/|$)/i.test(url.pathname);
  let reason;
  if (request.method() !== "GET") reason = "nonGet";
  else if (provider) reason = "provider";
  else if (isData && ![origin, apiOrigin].includes(url.origin))
    reason = "thirdPartyData";
  if (reason) {
    report.blockedRequests[reason] = (report.blockedRequests[reason] ?? 0) + 1;
    return route.abort("blockedbyclient");
  }
  return route.continue({
    headers:
      bypass && url.origin === origin
        ? { ...request.headers(), "x-vercel-protection-bypass": bypass }
        : request.headers()
  });
});
await context.routeWebSocket("**/*", (socket) => socket.close());
const page = await context.newPage();
page.setDefaultTimeout(25000);
page.on("pageerror", (error) => {
  // Public failure text only; never request headers, tokens, or raw responses.
  report.pageErrors.push(error.message.slice(0, 500));
});

function matches(path, query) {
  return (response) => {
    const url = new URL(response.url());
    return (
      (url.origin === apiOrigin ||
        (url.origin === origin && url.pathname.startsWith("/api/arena/"))) &&
      path.test(url.pathname) &&
      (!query || query(url.searchParams))
    );
  };
}
async function json(response) {
  assert.equal(response.status(), 200, new URL(response.url()).pathname);
  const body = await response.body();
  assert(body.length < 2000000, "Bounded public API response required");
  const value = JSON.parse(body.toString());
  report.api.push({
    path: new URL(response.url()).pathname,
    status: response.status(),
    ...(Array.isArray(value.items) ? { count: value.items.length } : {})
  });
  return value;
}
async function dismissCookies() {
  const decline = page.getByRole("button", { name: "Decline", exact: true });
  if (await decline.isVisible()) await decline.click();
}
function waitForResponse(predicate) {
  const waiting = page.waitForResponse(predicate);
  // An action can fail before its paired response arrives. Preserve the error
  // for the later await without letting an abandoned waiter crash the report.
  waiting.catch(() => {});
  return waiting;
}
async function visit(path, predicate) {
  const api = predicate ? waitForResponse(predicate) : undefined;
  const response = await page.goto(origin + path, {
    waitUntil: "domcontentloaded"
  });
  assert.equal(response.status(), 200, "Deployed app HTML must load");
  assert.equal(new URL(page.url()).origin, origin, "Stay in the same app");
  const entry = (await response.text()).match(
    /src="(\/assets\/index-[^"]+\.js)"/
  )?.[1];
  assert(entry, "Built app entry asset must be present");
  if (report.entryAsset) assert.equal(entry, report.entryAsset);
  report.entryAsset = entry;
  await dismissCookies();
  return api ? json(await api) : response;
}
async function afterAction(predicate, action) {
  const waiting = waitForResponse(predicate);
  await action();
  return json(await waiting);
}
async function image(locator) {
  const element = locator.locator("img").first();
  await element.scrollIntoViewIfNeeded();
  await element.evaluate((img) => img.decode());
  assert(await element.evaluate((img) => img.naturalWidth > 0));
}
async function textIncludes(value) {
  await page.waitForFunction(
    (value) => document.querySelector("main")?.textContent?.includes(value),
    String(value)
  );
}
async function check(name, run) {
  const before = report.pageErrors.length;
  try {
    const evidence = await run();
    assert.equal(
      report.pageErrors.length,
      before,
      "No browser runtime exception"
    );
    report.checks.push({ name, passed: true, ...evidence });
  } catch (error) {
    report.checks.push({
      name,
      passed: false,
      error: String(error.message).slice(0, 700),
      route: new URL(page.url()).pathname
    });
  }
  await writeFile(values.output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report.checks.at(-1)));
}
const tokenRows = (chain) =>
  matches(/\/v1\/tokens$/, (q) => q.getAll("chain").includes(chain));
const tokenDetail = (chain, id) =>
  matches(new RegExp(`/v1/tokens/${chain}/${id}$`));

try {
  await check(
    "Original desktop navigation and real OG collection/detail",
    async () => {
      const rows = await visit("/?chain=ethereum", tokenRows("ethereum"));
      assert(rows.items?.length > 0, "Real Ethereum OG data required");
      const nav = page.getByRole("navigation", {
        name: "Primary navigation",
        exact: true
      });
      for (const [name, href] of [
        ["Collection", "/"],
        ["Leaderboard", "/leaderboard"],
        ["Arena", "/arena"],
        ["Packs", "/boosters"]
      ]) {
        assert.equal(
          await nav
            .getByRole("link", { name, exact: true })
            .getAttribute("href"),
          href
        );
      }
      assert(await nav.getByTitle("Battles are coming soon").isVisible());
      const tabs = page.getByRole("navigation", {
        name: "Collections",
        exact: true
      });
      await tabs.getByRole("link", { name: "Yunipals", exact: true }).waitFor();
      await tabs.getByRole("link", { name: "Islands", exact: true }).waitFor();
      const token = rows.items[0];
      const href = `/collection/ethereum/${token.tokenId}`;
      const card = page.locator(`a[href="${href}"]`).first();
      await image(card);
      const detail = await afterAction(
        tokenDetail("ethereum", token.tokenId),
        () => card.click()
      );
      assert.equal(
        String(detail.token?.token_id ?? detail.token?.tokenId),
        String(token.tokenId)
      );
      await textIncludes(token.tokenId);
      if (token.name) await textIncludes(token.name);
      return {
        route: href,
        renderedTokenId: token.tokenId,
        rows: rows.items.length
      };
    }
  );

  await check(
    "Real leaderboard, metric switch and collector holdings",
    async () => {
      const board = await visit(
        "/leaderboard",
        matches(/\/v1\/leaderboards\/collector-score$/)
      );
      assert(board.items?.length > 0, "Real ranking rows required");
      const entry = board.items[0];
      const row = page.locator(`a[href="/collector/${entry.owner}"]`).first();
      await row.waitFor();
      assert(await row.locator(`[aria-label="Rank ${entry.rank}"]`).count());
      const metrics = page.getByRole("group", {
        name: "Leaderboard metric",
        exact: true
      });
      const next = metrics.getByRole("button", { pressed: false }).first();
      const nextLabel = await next.textContent();
      const changed = await afterAction(
        (response) =>
          matches(/\/v1\/leaderboards\/[^/]+$/)(response) &&
          !new URL(response.url()).pathname.endsWith("/collector-score"),
        () => next.click()
      );
      assert(changed.items?.length > 0);
      await page
        .locator(`a[href="/collector/${changed.items[0].owner}"]`)
        .first()
        .waitFor();
      const owner = changed.items[0].owner;
      const holdings = await afterAction(
        matches(new RegExp(`/v[12]/owners/${owner}/tokens$`, "i")),
        () => page.locator(`a[href="/collector/${owner}"]`).first().click()
      );
      assert(holdings.items?.length > 0, "Collector OG holdings must load");
      await page.locator('a[href^="/collection/"]').first().waitFor();
      return {
        owner,
        rows: board.items.length,
        secondMetric: nextLabel?.trim(),
        holdings: holdings.items.length
      };
    }
  );

  await check(
    "Both Islands origins, real details and transfer history",
    async () => {
      const seen = [];
      for (const [islandOrigin, collection] of [
        ["airdrop", "base-islands-v2"],
        ["original", "ethereum-islands"]
      ]) {
        const rows = await visit(
          `/?collection=islands&origin=${islandOrigin}`,
          matches(
            /\/v2\/islands\/tokens$/,
            (q) => q.get("origin") === islandOrigin
          )
        );
        assert(rows.items?.length > 0, "Real island cards required");
        const token = rows.items[0];
        const href = `/collection/${collection}/${token.tokenId}`;
        const card = page.locator(`a[href="${href}"]`).first();
        await image(card);
        const transferResponse = waitForResponse(
          matches(
            new RegExp(
              `/v2/collections/${collection}/tokens/${token.tokenId}/transfers$`
            )
          )
        );
        const detail = await afterAction(
          matches(
            new RegExp(`/v2/collections/${collection}/tokens/${token.tokenId}$`)
          ),
          () => card.click()
        );
        assert.equal(String(detail.token?.tokenId), String(token.tokenId));
        await textIncludes(token.tokenId);
        await page
          .getByRole("link", { name: "Back to islands", exact: true })
          .waitFor();
        await json(await transferResponse);
        seen.push({
          origin: islandOrigin,
          collection,
          tokenId: token.tokenId,
          rows: rows.items.length
        });
      }
      return { origins: seen };
    }
  );

  await check(
    "Original Islands staking read path and disconnected unstake entry",
    async () => {
      const rows = await visit(
        "/?collection=islands&origin=original&holding=staked",
        matches(/\/v2\/islands\/tokens$/, (q) => q.get("holding") === "staked")
      );
      assert(
        Array.isArray(rows.items),
        "Successful staking filter data required"
      );
      await page
        .getByRole("combobox", { name: "Island holdings", exact: true })
        .waitFor();
      if (rows.items.length === 0) {
        await page
          .getByText(
            rows.complete === false
              ? "Waiting for staking verification"
              : "No islands found",
            { exact: true }
          )
          .waitFor();
        return {
          publishedStakedRows: 0,
          verificationComplete: rows.complete ?? null,
          stakingReadPath: "live_api_and_matching_empty_state",
          unstakeEntryCheck: "not_exercised_no_published_staked_rows",
          withdrawalExecuted: false
        };
      }
      const token = rows.items.find(
        (item) => item.staking?.status === "staked"
      );
      assert(
        token,
        "API must identify the stake, not just return island cards"
      );
      const detail = await afterAction(
        matches(
          new RegExp(
            `/v2/collections/ethereum-islands/tokens/${token.tokenId}$`
          )
        ),
        () =>
          page
            .locator(`a[href="/collection/ethereum-islands/${token.tokenId}"]`)
            .first()
            .click()
      );
      assert.equal(detail.token?.staking?.status, "staked");
      const staker = detail.token.staking.staker;
      assert(staker, "Staker identity required");
      await page.locator(`a[href*="owner=${staker}"]`).first().waitFor();
      await page
        .getByRole("button", {
          name: "Connect staking wallet to unstake",
          exact: true
        })
        .waitFor();
      return { tokenId: token.tokenId, staker, withdrawalExecuted: false };
    }
  );

  await check(
    "Real Exomon collection, detail and legacy redirect",
    async () => {
      const rows = await visit("/?chain=solana", tokenRows("solana"));
      assert(rows.items?.length > 0, "Real Exomon data required");
      const token = rows.items[0];
      const href = `/collection/solana/${token.tokenId}`;
      const card = page.locator(`a[href="${href}"]`).first();
      await image(card);
      const detail = await afterAction(
        tokenDetail("solana", token.tokenId),
        () => card.click()
      );
      assert.equal(detail.token?.tokenId, token.tokenId);
      await textIncludes(token.tokenId);
      await page
        .getByRole("link", { name: "View mint on Solscan", exact: true })
        .waitFor();
      await visit("/exomon");
      await page.waitForURL(
        (url) =>
          url.pathname === "/" && url.searchParams.get("chain") === "solana"
      );
      return {
        tokenId: token.tokenId,
        rows: rows.items.length,
        legacyRedirect: true
      };
    }
  );

  await check("Real Exomon leaderboard and Solana collector", async () => {
    const rows = await visit(
      "/leaderboard?chain=solana",
      matches(
        /\/v1\/leaderboards\/collector-score$/,
        (q) => q.get("chain") === "solana"
      )
    );
    assert(rows.items?.length > 0);
    const owner = rows.items[0].owner;
    const holdings = await afterAction(
      matches(
        new RegExp(`/v1/owners/${owner}/tokens$`),
        (q) => q.get("chain") === "solana"
      ),
      () => page.locator(`a[href="/collector/solana/${owner}"]`).first().click()
    );
    assert(holdings.items?.length > 0);
    await page.locator('a[href^="/collection/solana/"]').first().waitFor();
    return {
      owner,
      rankings: rows.items.length,
      holdings: holdings.items.length
    };
  });

  await check("Arena configured mode, public page and rules", async () => {
    if (values["arena-prepared"]) {
      await visit("/arena");
      await page
        .getByRole("heading", {
          name: "Four fighters. One champion.",
          exact: true
        })
        .waitFor();
      await page
        .getByText(
          "Mainnet tournaments are being prepared. Paid entry is not open yet.",
          { exact: true }
        )
        .waitFor();
      await visit("/arena/rules");
      await page
        .getByRole("heading", { name: "How the Arena works", exact: true })
        .waitFor();
      return {
        configured: false,
        publicPageAndRules: "restored_original_prepared_mode",
        gameApiCheck: "not_configured",
        tournamentFlowVerified: false
      };
    }
    const configuration = waitForResponse(matches(/\/config$/));
    const rows = await visit("/arena", matches(/\/tournaments$/));
    const config = await json(await configuration);
    assert.equal(config.chainId, 8453);
    assert.match(config.contract, /^0x[a-fA-F0-9]{40}$/);
    await page
      .getByRole("heading", {
        name: "Four fighters. One champion.",
        exact: true
      })
      .waitFor();
    assert(Array.isArray(rows.items));
    let tournamentId = null;
    if (rows.items.length) {
      tournamentId = String(rows.items[0].id);
      const details = waitForResponse(
        matches(new RegExp(`/tournaments/${tournamentId}$`))
      );
      const contextResponse = waitForResponse(
        matches(new RegExp(`/tournaments/${tournamentId}/context$`))
      );
      await page.locator(`a[href="/arena/${tournamentId}"]`).first().click();
      const detail = await json(await details);
      assert.equal(String(detail.id), tournamentId);
      assert(Array.isArray(detail.seats));
      const material = await json(await contextResponse);
      assert(Array.isArray(material.roster));
      await textIncludes(`Tournament #${tournamentId}`);
    } else {
      await page
        .getByText("The next lobby is being prepared.", { exact: true })
        .waitFor();
    }
    await visit("/arena/rules");
    await page
      .getByRole("heading", { name: "How the Arena works", exact: true })
      .waitFor();
    return {
      tournaments: rows.items.length,
      tournamentId,
      entryMode: config.entryMode ?? null
    };
  });

  await check("Mobile original menu and same-app pack entry", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await visit("/");
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    const nav = page.getByRole("navigation", {
      name: "Mobile navigation",
      exact: true
    });
    for (const name of ["Collection", "Leaderboard", "Arena", "Packs"])
      await nav.getByRole("link", { name, exact: true }).waitFor();
    await nav.getByText("Battles · Coming soon", { exact: true }).waitFor();
    await nav.getByRole("link", { name: "Leaderboard", exact: true }).click();
    await page.waitForURL(origin + "/leaderboard");
    assert.equal(
      await page
        .getByRole("navigation", { name: "Mobile navigation", exact: true })
        .count(),
      0
    );
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Mobile navigation", exact: true })
      .getByRole("link", { name: "Packs", exact: true })
      .click();
    await page.waitForURL(origin + "/boosters");
    await page.locator("#booster-packs article").first().waitFor();
    await page.getByRole("heading", { name: "Pack #2", exact: true }).waitFor();
    assert(
      await page.getByText("1 PROTO", { exact: false }).first().isVisible()
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1
      ),
      "No mobile horizontal overflow"
    );
    return { viewport: "390x844", packId: 2, walletConnected: false };
  });
} finally {
  report.completedAt = new Date().toISOString();
  report.passed =
    report.checks.length === 8 &&
    report.checks.every((check) => check.passed) &&
    report.pageErrors.length === 0;
  await writeFile(values.output, JSON.stringify(report, null, 2) + "\n");
  await browser.close();
}
console.log(
  JSON.stringify({
    output: values.output,
    passed: report.passed,
    checks: report.checks.map(({ name, passed }) => ({ name, passed })),
    reportSha256: createHash("sha256")
      .update(await readFile(values.output))
      .digest("hex")
  })
);
if (!report.passed) process.exitCode = 1;
