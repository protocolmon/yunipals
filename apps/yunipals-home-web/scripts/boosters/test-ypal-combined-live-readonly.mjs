// Combined-release successor: actual standalone wrap route and disconnected three-card replay.
// Frozen6f/9b QA proofs remain unchanged; all responses come from the real reviewed deployment.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../package.json", import.meta.url));
const {
  parseAbi,
  decodeFunctionData,
  decodeFunctionResult,
  toFunctionSelector
} = require("viem");

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    release: { type: "string" },
    "manifest-sha": { type: "string" },
    output: {
      type: "string",
      default: "/tmp/yunipals-ypal-combined-release-readonly-20261023.json"
    },
    "protected-vercel": { type: "boolean", default: false },
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
assert(
  values.url && values.release && /^[0-9a-f]{64}$/.test(values["manifest-sha"]),
  "Pass the exact reviewed URL/release/manifest SHA"
);
const origin = new URL(values.url).origin;
assert(
  origin === "https://www.yunipals.com" ||
    /^https:\/\/yunipals-[a-z0-9]+-devving\.vercel\.app$/.test(origin)
);
const manifestRaw = await readFile(values.release + "/RELEASE-MANIFEST.json");
const manifest = JSON.parse(manifestRaw);
const digest = (raw) => createHash("sha256").update(raw).digest("hex");
assert.equal(digest(manifestRaw), values["manifest-sha"]);
assert.equal(
  manifest.ypalConfirmedDeploymentSha256,
  "3249c24a567f611cf7276776668825bf28ced27902c9d3804dc0b5c33acf394c"
);
const entry = (await readFile(values.release + "/index.html", "utf8")).match(
  /src="(\/assets\/index-[^"]+\.js)"/
)[1];
const expected = {
  registry: "0x39a766a2a5ab6421929bcdc317b7b31f97d8e7e3",
  engine: "0xdf4aaa47fe0e8208b5a33c74898f834b2952189e",
  monsters: "0x7d62628806e7eef76a354c7c48787879e3440b16",
  ypal: "0xcd3709e84fc817b46196fa2d5b7202710ab51346"
};
const openingHash =
  "0x62e4c5d0792f1dc955b28601debabaa9240d9aeb596479a9e1f297adcb03e8a7";
const openingOwner = "0xb3883cd96d72b08b8226452305a28d65974a3727";
const requestIds = [
  "30582751643770632920893678658617792337567496805906007006450413228818305173241",
  "23217472439048618091950218259590224155344674435619542086250038280081490374453",
  "53752971648959452984656149113571701599987596496047729772470578807920582379163"
];
const tokenVariants = {
  1: "171",
  3: "178",
  2: "244"
};
const requestCalls = new Set(
  requestIds.map(
    (id) =>
      toFunctionSelector("getRequest(uint256)") +
      BigInt(id).toString(16).padStart(64, "0")
  )
);
const api = "https://api.yunipals.com/yunipals-indexer";
const implementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const capSelector = "0x3cda41a1";
const multicall = "0xca11bde05977b3631167028862be2a173976ca11";
const multicallAbi = parseAbi([
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] results)"
]);
function capabilityCall(r) {
  const p = r.params;
  if (r.jsonrpc !== "2.0" || !Array.isArray(p)) return null;
  if (
    ["eth_getTransactionByHash", "eth_getTransactionReceipt"].includes(r.method)
  )
    return p.length === 1 && p[0]?.toLowerCase() === openingHash
      ? r.method
      : null;
  if (
    r.method === "eth_getStorageAt" &&
    p.length === 3 &&
    p[0]?.toLowerCase() === expected.engine &&
    p[1] === implementationSlot &&
    p[2] === "latest"
  )
    return "implementation";
  if (
    r.method !== "eth_call" ||
    p.length !== 2 ||
    p[1] !== "latest" ||
    (p[0]?.value && BigInt(p[0].value) !== 0n)
  )
    return null;
  const direct = (call) =>
    call.target?.toLowerCase() === expected.engine &&
    (call.callData === capSelector || requestCalls.has(call.callData));
  if (direct({ target: p[0]?.to, callData: p[0]?.data }))
    return p[0].data === capSelector ? "capability" : "exact-opening-request";
  if (p[0]?.to?.toLowerCase() !== multicall) return null;
  try {
    const decoded = decodeFunctionData({ abi: multicallAbi, data: p[0].data });
    return decoded.functionName === "aggregate3" &&
      decoded.args[0].length >= 1 &&
      decoded.args[0].length <= 4 &&
      decoded.args[0].every(direct)
      ? "exact-opening-multicall"
      : null;
  } catch {
    return null;
  }
}
const allowedRpc = new Set([
  "https://base-rpc.publicnode.com",
  "https://base.drpc.org"
]);
const report = {
  format: "yunipals-ypal-combined-release-live-readonly-v1",
  runScope: "standalone-wrap-and-actual-three-card-replay",
  origin,
  observedAt: new Date().toISOString(),
  releaseManifestSha256: digest(manifestRaw),
  confirmedDeploymentSha256: manifest.ypalConfirmedDeploymentSha256,
  scriptSha256: digest(await readFile(new URL(import.meta.url))),
  readerFinalizationReceiptVerified: false,
  actualOpeningTransaction: openingHash,
  actualRequestIds: requestIds,
  mockedResponses: 0,
  walletConnections: 0,
  signatures: 0,
  transactions: 0,
  providerMaximumCalls: 20,
  providerCalls: [],
  api: [],
  blockedRequests: {},
  checks: [],
  pageErrors: []
};
let authHeader;
if (values["protected-vercel"]) {
  assert(origin.endsWith(".vercel.app"));
  if (process.env.VERCEL_OIDC_TOKEN) {
    authHeader = {
      "x-vercel-trusted-oidc-idp-token": process.env.VERCEL_OIDC_TOKEN
    };
    report.previewAccess = "existing_short_lived_oidc_origin_scoped";
  } else {
    // Same established access as the existing canonical verifier. Existing
    // automation access only; no token creation, storage, printing or broad headers.
    const { token } = JSON.parse(
      await readFile("/root/.local/share/com.vercel.cli/auth.json", "utf8")
    );
    const response = await fetch(
      "https://api.vercel.com/v9/projects/prj_j8Mg0nIBXeXVLylHgSu6OWxa6QgE?teamId=team_EHhGsy15b4Z8zOUwpm2usI5y",
      {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(15000)
      }
    );
    assert.equal(
      response.status,
      200,
      "Existing Vercel authentication required"
    );
    const project = await response.json();
    assert.equal(project.id, "prj_j8Mg0nIBXeXVLylHgSu6OWxa6QgE");
    const bypass = Object.entries(project.protectionBypass ?? {}).find(
      ([, v]) => v.scope === "automation-bypass"
    )?.[0];
    assert(bypass, "Existing automation access required");
    authHeader = { "x-vercel-protection-bypass": bypass };
    report.previewAccess = "existing_automation_access_origin_scoped";
  }
}
const { chromium } = await import(pathToFileURL(values.playwright).href);
const browser = await chromium.launch({
  executablePath: values.chromium,
  args: ["--no-sandbox"]
});
const context = await browser.newContext({
  viewport: { width: 1360, height: 1000 },
  serviceWorkers: "block"
});
let providerCalls = 0;
const rpcInFlight = new Map();
await context.route("**/*", async (route) => {
  const request = route.request(),
    url = new URL(request.url());
  let reason;
  if (request.method() === "OPTIONS" && allowedRpc.has(url.origin))
    return route.continue();
  if (
    request.method() === "POST" &&
    allowedRpc.has(url.origin) &&
    url.pathname === "/"
  ) {
    let messages;
    try {
      const value = JSON.parse(request.postData() ?? "");
      messages = Array.isArray(value) ? value : [value];
    } catch {
      messages = [];
    }
    const shapes = messages.map(capabilityCall);
    const valid = messages.length > 0 && shapes.every(Boolean);
    if (valid && providerCalls + messages.length <= 20) {
      providerCalls += messages.length;
      rpcInFlight.set(request, { messages, shapes });
      for (const [i, r] of messages.entries())
        report.providerCalls.push({
          method: r.method,
          shape: shapes[i],
          engine: expected.engine,
          endpoint: url.origin,
          status: "requested"
        });
      return route.continue();
    }
    report.refusedRpcShapes ??= [];
    if (report.refusedRpcShapes.length < 6)
      report.refusedRpcShapes.push(
        ...messages.map((r) => ({
          method: r.method,
          to: typeof r.params?.[0]?.to === "string" ? r.params[0].to : null,
          selector:
            typeof r.params?.[0]?.data === "string"
              ? r.params[0].data.slice(0, 10)
              : null
        }))
      );
    reason = "provider_method_or_cap_refused";
  } else if (request.method() !== "GET") reason = "non_get_refused";
  else if (
    allowedRpc.has(url.origin) ||
    /(?:alchemy|infura|ankr|quicknode|drpc|publicnode|walletconnect|mainnet\.base|bnbchain|polygon-rpc|rpc\.ethereum)/i.test(
      url.hostname
    )
  )
    reason = "other_provider_refused";
  else if (
    ["xhr", "fetch"].includes(request.resourceType()) &&
    ![origin, "https://api.yunipals.com"].includes(url.origin)
  )
    reason = "third_party_data_refused";
  if (reason) {
    report.blockedRequests[reason] = (report.blockedRequests[reason] ?? 0) + 1;
    return route.abort("blockedbyclient");
  }
  return route.continue({
    headers:
      authHeader && url.origin === origin
        ? { ...request.headers(), ...authHeader }
        : request.headers()
  });
});
await context.routeWebSocket("**/*", (socket) => socket.close());
const page = await context.newPage();
page.setDefaultTimeout(25000);
page.on("pageerror", (error) =>
  report.pageErrors.push(error.message.slice(0, 400))
);
const rpcReadResults = [];
page.on("response", async (response) => {
  const request = rpcInFlight.get(response.request());
  if (!request) return;
  const { messages, shapes } = request;
  try {
    const body = await response.json();
    for (const row of Array.isArray(body) ? body : [body]) {
      const input = messages.find((r) => r.id === row.id);
      if (input && !row.error) {
        const shape = shapes[messages.indexOf(input)];
        rpcReadResults.push({
          method: input.method,
          shape,
          resultSha256: digest(Buffer.from(JSON.stringify(row.result))),
          status: response.status()
        });
      }
    }
  } catch {
    /* Report a missing real capability result at the assertion. */
  }
});
async function get(path) {
  assert(path.startsWith("/v1/boosters/"));
  const response = await context.request.get(api + path, {
    headers: {
      Origin: "https://www.yunipals.com",
      Referer: "https://www.yunipals.com/",
      "User-Agent": "Mozilla/5.0"
    },
    maxRedirects: 0,
    timeout: 20000
  });
  assert.equal(response.status(), 200, "Actual fresh API required: " + path);
  const raw = await response.body();
  assert(raw.length <= 2000000);
  report.api.push({ path, status: response.status(), sha256: digest(raw) });
  return JSON.parse(raw);
}
function frame(body) {
  assert.equal(body.engine?.toLowerCase(), expected.engine);
  assert.equal(body.collection?.toLowerCase(), expected.monsters);
  assert.equal(body.enabled, true);
  assert(Array.isArray(body.items));
}
async function navigate(path) {
  const response = await page.goto(origin + path, {
    waitUntil: "domcontentloaded"
  });
  assert.equal(response.status(), 200);
  assert(
    (await response.text()).includes(entry),
    "Exact reviewed frontend entry asset"
  );
  await page.locator("main").waitFor();
  const decline = page.getByRole("button", { name: "Decline", exact: true });
  if (await decline.isVisible()) await decline.click();
  assert.equal(new URL(page.url()).origin, origin);
}
async function checkpoint(name, run) {
  const result = await run();
  assert.equal(report.pageErrors.length, 0);
  report.checks.push({ name, passed: true, ...result });
  await writeFile(values.output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report.checks.at(-1)));
}
async function waitStage(stage) {
  await page.waitForFunction(
    (stage) =>
      document
        .querySelector('dialog[aria-label="Yunipals pack opening"]')
        ?.getAttribute("data-stage") === stage,
    stage
  );
}

async function keyAction(locator) {
  await locator.focus();
  await page.keyboard.press("Enter");
}
async function visibleGeometry(locator) {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(innerWidth - 1, r.x + r.width / 2));
    const y = Math.max(0, Math.min(innerHeight - 1, r.y + r.height / 2));
    return {
      visible:
        r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight,
      hit: el.contains(document.elementFromPoint(x, y))
    };
  });
}
try {
  await checkpoint(
    "Actual fresh request membership and all three approved artworks",
    async () => {
      const cards = [];
      for (const id of requestIds) {
        const request = await get(
          `/v1/boosters/requests/${expected.engine}/${id}`
        );
        assert.equal(request.item.transactionHash.toLowerCase(), openingHash);
        assert.equal(request.item.payer.toLowerCase(), openingOwner);
        assert.equal(request.item.status, "completed");
        assert.equal(request.item.opening, true);
        assert.equal(request.item.quantity, 1);
        const response = await get(
          `/v1/boosters/requests/${expected.engine}/${id}/monsters`
        );
        frame(response);
        assert.equal(response.items.length, 1);
        const card = response.items[0];
        assert.equal(card.requestKey, `8453:${expected.engine}:${id}`);
        assert.equal(card.collection.toLowerCase(), expected.monsters);
        assert.equal(card.variantId, tokenVariants[card.tokenId]);
        assert.equal(card.mintedTo.toLowerCase(), openingOwner);
        const art = await get(
          `/v1/boosters/art/base-mainnet-standard-v1/${card.variantId}.json`
        );
        assert.equal(art.yunipals?.status, "ready");
        assert.equal(typeof art.image, "string");
        const image = new URL(art.image);
        assert.equal(image.origin, "https://api.yunipals.com");
        assert(
          image.pathname ===
            `/yunipals-indexer/v1/boosters/art-assets/${art.yunipals.artworkSha256}.png`
        );
        cards.push({
          tokenId: card.tokenId,
          variantId: card.variantId,
          requestId: id,
          image: art.image
        });
      }
      assert.deepEqual(cards.map((c) => c.tokenId).sort(), ["1", "2", "3"]);
      report.actualCards = cards;
      return {
        actualOpening: openingHash,
        cards: cards.map(({ tokenId, variantId }) => ({ tokenId, variantId })),
        mocked: false
      };
    }
  );
  await checkpoint(
    "Responsive fresh pack offer links to standalone GetYPAL with no inline form",
    async () => {
      await navigate("/boosters");
      const offer = page.locator("#booster-packs");
      await offer
        .getByRole("heading", { name: "Yunipals booster pack", exact: true })
        .waitFor();
      assert.equal(await offer.locator("article").count(), 1);
      assert(!/Pack #\d|1 PROTO|Test pack/i.test(await offer.innerText()));
      assert.equal(
        await offer
          .getByRole("link", { name: "Get YPAL", exact: true })
          .first()
          .getAttribute("href"),
        "/wrap"
      );
      assert.equal(await page.locator("#ypal-wrap-title").count(), 0);
      const pack = offer.locator("article img").first();
      await pack.evaluate((img) => img.decode());
      assert.deepEqual(
        await pack.evaluate((img) => [img.naturalWidth, img.naturalHeight]),
        [1024, 1536]
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await pack.evaluate((image) =>
        image.scrollIntoView({ block: "center", behavior: "instant" })
      );
      const box = await pack.boundingBox();
      assert(box && box.width > 100 && box.width <= 390);
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      );
      await page.screenshot({
        path: values.output.replace(/\.json$/, "-packs-mobile.png"),
        fullPage: false
      });
      const faq = page.getByRole("region", {
        name: "Booster pack FAQ",
        exact: true
      });
      const question = faq
        .locator("summary")
        .filter({ hasText: "Why is my card image still loading?" });
      await keyAction(question);
      assert.equal(
        await question.evaluate((el) => el.parentElement.open),
        true
      );
      await offer
        .getByRole("link", { name: "Get YPAL", exact: true })
        .first()
        .click();
      await page.waitForURL(origin + "/wrap");
      await page.locator("#ypal-wrap-title").waitFor();
      await page
        .getByRole("button", {
          name: "Connect wallet to get YPAL",
          exact: true
        })
        .waitFor();
      assert.equal(await page.locator("#ypal-wrap-amount").count(), 0);
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      );
      await page.screenshot({
        path: values.output.replace(/\.json$/, "-wrap-mobile.png"),
        fullPage: true
      });
      return {
        getYpal: "/wrap",
        inlineForm: false,
        disconnectedForm: true,
        viewport: "390x844",
        faqKeyboard: true
      };
    }
  );
  await checkpoint(
    "Real disconnected three-card opening, progressive physical extraction and same-hash replay",
    async () => {
      await page.setViewportSize({ width: 1360, height: 1000 });
      await navigate(`/boosters?opening=${openingHash}`);
      const modal = page.getByRole("dialog", {
        name: "Yunipals pack opening",
        exact: true
      });
      await modal.waitFor({ timeout: 45000 });
      await waitStage("sealed");
      assert.equal(
        await modal
          .getByText("Demo preview — no NFT is minted.", { exact: true })
          .count(),
        0
      );
      assert.equal(
        await modal.getByText("Card 1 of 3", { exact: true }).count(),
        1
      );
      assert.equal(await page.evaluate(() => Boolean(window.ethereum)), false);
      const rip = modal.getByRole("button", {
        name: "Rip pack seal",
        exact: true
      });
      const seal = await rip.boundingBox();
      assert(seal);
      await page.mouse.move(
        seal.x + seal.width * 0.05,
        seal.y + seal.height * 0.5
      );
      await page.mouse.down();
      await page.mouse.move(
        seal.x + seal.width * 0.96,
        seal.y + seal.height * 0.5,
        { steps: 20 }
      );
      await page.mouse.up();
      await waitStage("extracting");
      const instructions = modal.locator(".yunipals-opening-instructions");
      assert((await visibleGeometry(instructions)).visible);
      const firstPeek = await modal
        .locator(".yunipals-opening-extract-window")
        .evaluate((el) => {
          const r = el.getBoundingClientRect();
          return {
            width: r.width,
            height: r.height,
            clip: getComputedStyle(el).clipPath
          };
        });
      assert(
        firstPeek.width > 0 && firstPeek.height > 0 && firstPeek.clip !== "none"
      );
      const pull = modal.getByRole("button", {
        name: "Pull card upward",
        exact: true
      });
      const rect = await pull.boundingBox();
      assert(rect);
      await page.mouse.move(
        rect.x + rect.width / 2,
        rect.y + rect.height * 0.4
      );
      await page.mouse.down();
      await page.mouse.move(
        rect.x + rect.width / 2,
        rect.y + rect.height * 0.4 - 24,
        { steps: 12 }
      );
      await page.waitForTimeout(200);
      await page.mouse.up();
      await page.waitForTimeout(350);
      assert.equal(await modal.getAttribute("data-stage"), "extracting");
      await keyAction(
        modal.getByRole("button", { name: "Pull out card", exact: true })
      );
      const ids = [];
      for (let index = 1; index <= 3; index++) {
        await waitStage("results");
        await modal.getByText(`Card ${index} of 3`, { exact: true }).waitFor();
        assert.equal(
          await modal
            .getByRole("button", { name: "Reveal Yunipal", exact: true })
            .count(),
          0
        );
        const link = modal.getByRole("link", { name: /^View Yunipal #\d+$/ });
        await link.waitFor();
        const href = await link.getAttribute("href");
        assert(href.startsWith(`/monsters/${expected.monsters}/`));
        const id = href.split("/").at(-1);
        assert(tokenVariants[id]);
        ids.push(id);
        const image = modal.locator(".tilt-card > img").first();
        await image.evaluate((img) => img.decode());
        assert(await image.evaluate((img) => img.naturalWidth > 0));
        assert.equal(
          await image.getAttribute("src"),
          report.actualCards.find((c) => c.tokenId === id).image
        );
        const next = modal.getByRole("button", {
          name: index < 3 ? "Pull next card" : "Replay opening",
          exact: true
        });
        assert.deepEqual(await visibleGeometry(next), {
          visible: true,
          hit: true
        });
        if (index < 3) {
          await keyAction(next);
          await waitStage("extracting");
          await keyAction(
            modal.getByRole("button", { name: "Pull out card", exact: true })
          );
        }
      }
      assert.deepEqual(ids.slice().sort(), ["1", "2", "3"]);
      await page.screenshot({
        path: values.output.replace(/\.json$/, "-real-results.png"),
        fullPage: false
      });
      const replay = modal.getByRole("link", {
        name: "Replay opening",
        exact: true
      });
      assert.equal(
        await replay.getAttribute("href"),
        `/boosters?opening=${openingHash}`
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }),
        replay.click()
      ]);
      await modal.waitFor({ timeout: 45000 });
      await waitStage("sealed");
      await modal.getByText("Card 1 of 3", { exact: true }).waitFor();
      assert.equal(
        new URL(page.url()).searchParams.get("opening"),
        openingHash
      );
      assert(
        (await visibleGeometry(modal.locator(".yunipals-opening-instructions")))
          .visible
      );
      await keyAction(
        modal.getByRole("button", { name: "Rip open", exact: true })
      );
      await waitStage("extracting");
      await keyAction(
        modal.getByRole("button", { name: "Pull out card", exact: true })
      );
      await waitStage("results");
      assert.deepEqual(
        await visibleGeometry(
          modal.getByRole("button", { name: "Pull next card", exact: true })
        ),
        { visible: true, hit: true }
      );
      await page.screenshot({
        path: values.output.replace(/\.json$/, "-replay-mobile.png"),
        fullPage: false
      });
      await modal
        .getByRole("button", { name: "Close pack opening", exact: true })
        .click();
      await modal.waitFor({ state: "detached" });
      return {
        disconnected: true,
        realTokenIds: ids,
        variants: [171, 178, 244],
        fullRip: true,
        shortPullRetracts: true,
        sameHashReplayReset: true,
        mobileResultActionVisible: true
      };
    }
  );
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = {
    message: String(error.message).slice(0, 700),
    route: new URL(page.url()).pathname
  };
  console.log(JSON.stringify({ passed: false, ...report.failure }));
} finally {
  report.completedAt = new Date().toISOString();
  report.providerIndividualRequests = providerCalls;
  report.walletAvailable = await page
    .evaluate(() => Boolean(window.ethereum))
    .catch(() => false);
  report.capabilityResults = rpcReadResults;
  await writeFile(values.output, JSON.stringify(report, null, 2) + "\n");
  await browser.close();
}
console.log(
  JSON.stringify({
    output: values.output,
    passed: report.passed,
    checks: report.checks.length,
    providerIndividualRequests: providerCalls,
    reportSha256: digest(await readFile(values.output))
  })
);
if (!report.passed) process.exitCode = 1;
