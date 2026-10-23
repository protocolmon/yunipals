// Real deployed YPAL acceptance. No wallet connections, signatures or sends.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../package.json", import.meta.url));
const { parseAbi, decodeFunctionData, decodeFunctionResult } = require("viem");

const { values } = parseArgs({ options: {
  url: { type: "string", default: "https://yunipals-fpxxed02z-devving.vercel.app" },
  release: { type: "string", default: "/tmp/yunipals-collection-booster-live-www-1792783059763" },
  output: { type: "string", default: "/tmp/yunipals-ypal-stage-live-readonly-20261023.json" },
  "protected-vercel": { type: "boolean", default: false },
  playwright: { type: "string", default: "/tmp/yunipals-foundry/node_modules/playwright-core/index.mjs" },
  chromium: { type: "string", default: "/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome" }
}});
const origin = new URL(values.url).origin;
assert(["https://yunipals-fpxxed02z-devving.vercel.app", "https://www.yunipals.com"].includes(origin));
const manifestRaw = await readFile(values.release + "/RELEASE-MANIFEST.json");
const manifest = JSON.parse(manifestRaw);
const digest = (raw) => createHash("sha256").update(raw).digest("hex");
assert.equal(digest(manifestRaw), "6f1206cee59299b8257ea6b82a03cc767359229d7e850c488ee2c21d9b989aab");
assert.equal(manifest.ypalConfirmedDeploymentSha256, "3249c24a567f611cf7276776668825bf28ced27902c9d3804dc0b5c33acf394c");
const entry = (await readFile(values.release + "/index.html", "utf8")).match(/src="(\/assets\/index-[^"]+\.js)"/)[1];
const expected = {
  registry: "0x39a766a2a5ab6421929bcdc317b7b31f97d8e7e3",
  engine: "0xdf4aaa47fe0e8208b5a33c74898f834b2952189e",
  monsters: "0x7d62628806e7eef76a354c7c48787879e3440b16",
  ypal: "0xcd3709e84fc817b46196fa2d5b7202710ab51346"
};
const api = "https://api.yunipals.com/yunipals-indexer";
const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const capSelector = "0x3cda41a1";
const multicall = "0xca11bde05977b3631167028862be2a173976ca11";
const multicallAbi = parseAbi(["function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] results)"]);
function capabilityCall(r) {
  const p = r.params;
  if (r.jsonrpc !== "2.0" || !Array.isArray(p)) return null;
  if (r.method === "eth_getStorageAt" && p.length === 3 && p[0]?.toLowerCase() === expected.engine && p[1] === implementationSlot && p[2] === "latest") return "implementation";
  if (r.method !== "eth_call" || p.length !== 2 || p[1] !== "latest" || (p[0]?.value && BigInt(p[0].value) !== 0n)) return null;
  if (p[0]?.to?.toLowerCase() === expected.engine && p[0]?.data === capSelector) return "direct";
  if (p[0]?.to?.toLowerCase() !== multicall) return null;
  try {
    const decoded = decodeFunctionData({ abi: multicallAbi, data: p[0].data });
    return decoded.functionName === "aggregate3" && decoded.args[0].length === 1 && decoded.args[0].every((c) => c.target.toLowerCase() === expected.engine && c.callData === capSelector) ? "multicall3-exact-getter" : null;
  } catch { return null; }
}
const allowedRpc = new Set(["https://base-rpc.publicnode.com", "https://base.drpc.org"]);
const report = {
  format: "yunipals-ypal-live-readonly-v1", origin, observedAt: new Date().toISOString(),
  releaseManifestSha256: digest(manifestRaw), confirmedDeploymentSha256: manifest.ypalConfirmedDeploymentSha256,
  scriptSha256: digest(await readFile(new URL(import.meta.url))), readerFinalizationReceiptVerified: false,
  mockedResponses: 0, walletConnections: 0, signatures: 0, transactions: 0,
  providerMaximumCalls: 6, providerCalls: [], api: [], blockedRequests: {}, checks: [], pageErrors: []
};
let authHeader;
if (values["protected-vercel"]) {
  assert.equal(origin, "https://yunipals-fpxxed02z-devving.vercel.app");
  if (process.env.VERCEL_OIDC_TOKEN) {
    authHeader = { "x-vercel-trusted-oidc-idp-token": process.env.VERCEL_OIDC_TOKEN };
    report.previewAccess = "existing_short_lived_oidc_origin_scoped";
  } else {
    // Same established access as the existing canonical verifier. Existing
    // automation access only; no token creation, storage, printing or broad headers.
    const { token } = JSON.parse(await readFile("/root/.local/share/com.vercel.cli/auth.json", "utf8"));
    const response = await fetch("https://api.vercel.com/v9/projects/prj_j8Mg0nIBXeXVLylHgSu6OWxa6QgE?teamId=team_EHhGsy15b4Z8zOUwpm2usI5y", { headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200, "Existing Vercel authentication required");
    const project = await response.json();
    assert.equal(project.id, "prj_j8Mg0nIBXeXVLylHgSu6OWxa6QgE");
    const bypass = Object.entries(project.protectionBypass ?? {}).find(([, v]) => v.scope === "automation-bypass")?.[0];
    assert(bypass, "Existing automation access required");
    authHeader = { "x-vercel-protection-bypass": bypass };
    report.previewAccess = "existing_automation_access_origin_scoped";
  }
}
const { chromium } = await import(pathToFileURL(values.playwright).href);
const browser = await chromium.launch({ executablePath: values.chromium, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, serviceWorkers: "block" });
let providerCalls = 0;
const rpcInFlight = new Map();
await context.route("**/*", async (route) => {
  const request = route.request(), url = new URL(request.url());
  let reason;
  if (request.method() === "OPTIONS" && allowedRpc.has(url.origin)) return route.continue();
  if (request.method() === "POST" && allowedRpc.has(url.origin) && url.pathname === "/") {
    let messages;
    try { const value = JSON.parse(request.postData() ?? ""); messages = Array.isArray(value) ? value : [value]; } catch { messages = []; }
    const shapes = messages.map(capabilityCall);
    const valid = messages.length > 0 && shapes.every(Boolean);
    if (valid && providerCalls + messages.length <= 6) {
      providerCalls += messages.length;
      rpcInFlight.set(request, { messages, shapes });
      for (const [i, r] of messages.entries()) report.providerCalls.push({ method: r.method, shape: shapes[i], engine: expected.engine, endpoint: url.origin, status: "requested" });
      return route.continue();
    }
    report.refusedRpcShapes ??= [];
    if (report.refusedRpcShapes.length < 6) report.refusedRpcShapes.push(...messages.map((r) => ({method:r.method,to:typeof r.params?.[0]?.to === "string" ? r.params[0].to : null,selector:typeof r.params?.[0]?.data === "string" ? r.params[0].data.slice(0,10) : null})));
    reason = "provider_method_or_cap_refused";
  } else if (request.method() !== "GET") reason = "non_get_refused";
  else if (allowedRpc.has(url.origin) || /(?:alchemy|infura|ankr|quicknode|drpc|publicnode|walletconnect|mainnet\.base|bnbchain|polygon-rpc|rpc\.ethereum)/i.test(url.hostname)) reason = "other_provider_refused";
  else if (["xhr", "fetch"].includes(request.resourceType()) && ![origin, "https://api.yunipals.com"].includes(url.origin)) reason = "third_party_data_refused";
  if (reason) {
    report.blockedRequests[reason] = (report.blockedRequests[reason] ?? 0) + 1;
    return route.abort("blockedbyclient");
  }
  return route.continue({ headers: authHeader && url.origin === origin ? { ...request.headers(), ...authHeader } : request.headers() });
});
await context.routeWebSocket("**/*", (socket) => socket.close());
const page = await context.newPage(); page.setDefaultTimeout(25000);
page.on("pageerror", (error) => report.pageErrors.push(error.message.slice(0, 400)));
const rpcReadResults = [];
page.on("response", async (response) => {
  const request = rpcInFlight.get(response.request());
  if (!request) return;
  const {messages, shapes} = request;
  try {
    const body = await response.json();
    for (const row of Array.isArray(body) ? body : [body]) {
      const input = messages.find((r) => r.id === row.id);
      if (input && !row.error) {
        const shape=shapes[messages.indexOf(input)];
        const decoded=shape === "multicall3-exact-getter" ? decodeFunctionResult({abi:multicallAbi,functionName:"aggregate3",data:row.result}) : null;
        if(decoded) assert(decoded[0].success);
        rpcReadResults.push({ method:input.method, shape, result:decoded ? decoded[0].returnData : row.result, status:response.status() });
      }
    }
  } catch { /* Report a missing real capability result at the assertion. */ }
});
async function get(path) {
  assert(path.startsWith("/v1/boosters/") || path === "/readyz");
  const response = await context.request.get(api + path, { headers: { Origin: "https://www.yunipals.com", Referer: "https://www.yunipals.com/", "User-Agent": "Mozilla/5.0" }, maxRedirects: 0, timeout: 20000 });
  assert.equal(response.status(), 200, "Actual fresh API required: " + path);
  const raw = await response.body(); assert(raw.length <= 2000000);
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
  const response = await page.goto(origin + path, { waitUntil: "domcontentloaded" });
  assert.equal(response.status(), 200);
  assert((await response.text()).includes(entry), "Exact reviewed frontend entry asset");
  await page.locator("main").waitFor();
  const decline = page.getByRole("button", { name: "Decline", exact: true });
  if (await decline.isVisible()) await decline.click();
  assert.equal(new URL(page.url()).origin, origin);
}
async function checkpoint(name, run) {
  const result = await run(); assert.equal(report.pageErrors.length, 0);
  report.checks.push({ name, passed: true, ...result });
  await writeFile(values.output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report.checks.at(-1)));
}
async function waitStage(stage) {
  await page.waitForFunction((stage) => document.querySelector('dialog[aria-label="Yunipals pack opening"]')?.getAttribute("data-stage") === stage, stage);
}
try {
  // Run only after root acknowledges the real reader switch. No API fixtures.
  await checkpoint("Actual fresh YPAL API/source frame and history isolation", async () => {
    // nginx exposes public feature reads, not the API's private /readyz. A
    // successful types response is readiness-gated by the actual server.
    const types = await get("/v1/boosters/types"); frame(types); assert.equal(types.items.length, 1);
    assert.equal(types.chainId, 8453);
    assert(/^[0-9]+$/.test(types.indexedBlock)); assert(BigInt(types.indexedBlock) >= 52995174n);
    assert(/^[0-9]+$/.test(types.indexedTimestamp));
    assert(Date.now() / 1000 - Number(types.indexedTimestamp) >= 0 && Date.now() / 1000 - Number(types.indexedTimestamp) <= 180);
    const pack = types.items[0];
    assert.equal(pack.registry.toLowerCase(), expected.registry); assert.equal(pack.packTypeId, "1");
    assert.equal(pack.engine.toLowerCase(), expected.engine); assert.equal(pack.paymentToken.toLowerCase(), expected.ypal);
    assert.equal(pack.price, "1000000000000000000"); assert.equal(String(pack.totalVariants), "264");
    assert.equal(pack.catalogHash, "0x63813f1a231eca352a31d873ebb987ab2dc6a0625ece3fcf8cfc706fd6aa8733");
    const global = await get("/v1/boosters/monsters?limit=24"); frame(global); assert(global.items.length <= 24);
    for (const row of global.items) assert.equal(row.collection.toLowerCase(), expected.monsters);
    const recent = await get("/v1/boosters/recent-openings?limit=12"); frame(recent); assert(recent.items.length <= 12);
    for (const row of recent.items) {
      assert.equal(row.monster.collection.toLowerCase(), expected.monsters);
      assert(row.requestKey.startsWith("8453:" + expected.engine + ":"));
      assert(row.monster.originalKey.startsWith("8453:" + expected.monsters + ":"));
    }
    return { publicReadiness: "actual gated types200/fresh complete checkpoint; private readyz checked by reader owner", indexedBlock: types.indexedBlock, realTypes: types.items.length, globalRows: global.items.length, recentRows: recent.items.length, engine: expected.engine, collection: expected.monsters, paymentToken: expected.ypal };
  });
  await checkpoint("Approved standard artwork metadata and real offer, FAQ and Get YPAL", async () => {
    const art = await get("/v1/boosters/art/base-mainnet-standard-v1/81.json");
    assert.equal(art.yunipals?.status, "ready"); assert.equal(typeof art.image, "string");
    assert(Array.isArray(art.attributes) && art.attributes.length >= 4);
    await navigate("/boosters");
    await page.getByRole("heading", { name: "Yunipals booster pack", exact: true }).waitFor();
    assert.equal(await page.locator("#booster-packs article").count(), 1);
    await page.getByRole("heading", { name: "Get YPAL", exact: true }).waitFor();
    await page.getByRole("button", { name: "Connect wallet to get YPAL", exact: true }).waitFor();
    const offer = page.locator("#booster-packs");
    assert(!/Pack #\d|1 PROTO|Test pack/i.test(await offer.innerText()));
    const img = offer.locator("article img").first(); await img.evaluate((img) => img.decode());
    assert.deepEqual(await img.evaluate((img) => [img.naturalWidth, img.naturalHeight]), [1024,1536]);
    const faq = page.getByRole("region", { name: "Booster pack FAQ", exact: true });
    const question = faq.locator("summary").filter({ hasText: "What is YPAL?" });
    await question.focus(); await page.keyboard.press("Enter");
    assert.equal(await question.evaluate((el) => el.parentElement.open), true);
    assert((await faq.innerText()).includes("one-for-one on Base"));
    const positions = await page.evaluate(() => [document.querySelector("#booster-packs").getBoundingClientRect().bottom, document.querySelector("#booster-faq-heading").getBoundingClientRect().top]);
    assert(positions[1] >= positions[0]);
    return { approvedVariant:81, offerCount:1, faqKeyboard:true, getYpalDisconnected:true };
  });
  await checkpoint("Actual engine quantity10 and one-wrapper three-card preview", async () => {
    const quantity = page.getByRole("spinbutton", { name: "Packs to open", exact:true });
    await page.waitForFunction(() => document.querySelector('#booster-packs input[type="number"]')?.max === "10");
    assert(rpcReadResults.some((r) => r.method === "eth_getStorageAt" && r.status === 200 && /^0x[0-9a-f]{64}$/i.test(r.result)));
    assert(rpcReadResults.some((r) => r.method === "eth_call" && r.status === 200 && BigInt(r.result) === 10n));
    await quantity.fill("10"); await page.getByRole("button", { name: "Choose 10 packs", exact:true }).click();
    await page.getByText(/^10 YPAL/).first().waitFor();
    assert.equal(await page.getByRole("button", { name:"One more pack",exact:true }).isDisabled(),true);
    await page.getByRole("button",{name:"Choose 3 packs",exact:true}).click();
    await page.getByRole("button",{name:"Try the opening",exact:true}).click();
    const modal=page.getByRole("dialog",{name:"Yunipals pack opening",exact:true});
    await modal.getByText("Demo preview — no NFT is minted.",{exact:true}).waitFor();
    await modal.getByRole("button",{name:"Rip open",exact:true}).click(); await waitStage("extracting");
    await modal.getByRole("button",{name:"Pull out card",exact:true}).click(); await waitStage("results");
    assert.equal(await modal.getByRole("button",{name:"Reveal Yunipal",exact:true}).count(),0);
    await modal.getByRole("button",{name:"Pull next card",exact:true}).waitFor();
    await page.screenshot({path:values.output.replace(/\.json$/,"-desktop-preview.png"),fullPage:false});
    await modal.getByRole("button",{name:"Close pack opening",exact:true}).click();
    return { actualMaxOpenPacks:10, capabilityResults:rpcReadResults, previewCards:3, transactions:0 };
  });
  await checkpoint("Actual OG collection and original main navigation", async () => {
    const waiting=page.waitForResponse((r)=>new URL(r.url()).pathname==="/yunipals-indexer/v1/tokens"&&new URL(r.url()).searchParams.getAll("chain").includes("ethereum"));
    waiting.catch(() => {});
    await navigate("/?edition=og&chain=ethereum#collection");
    const response=await waiting; assert.equal(response.status(),200);const body=await response.json();assert(body.items.length>0);
    const nav=page.getByRole("navigation",{name:"Primary navigation",exact:true});
    for (const [name,href]of[["Collection","/"],["Packs","/boosters"],["Leaderboard","/leaderboard"],["Arena","/arena"]]) assert.equal(await nav.getByRole("link",{name,exact:true}).getAttribute("href"),href);
    assert(await nav.getByTitle("Grading is coming soon").isVisible());
    const first=body.items[0], card=page.locator(`a[href="/collection/ethereum/${first.tokenId}"]`).first();await card.waitFor();
    await card.locator("img").first().evaluate((img)=>img.decode());
    assert(await card.locator("img").first().evaluate((img)=>img.naturalWidth>0));
    assert.equal(await page.locator("#booster-packs").count(),0);
    return { realOgRows:body.items.length, firstOgToken:first.tokenId, originalLinks:true, purchaseOnHome:false };
  });
  await checkpoint("Mobile menu, YPAL offer and accessible FAQ",async()=>{
    await page.setViewportSize({width:390,height:844});
    await page.getByRole("button",{name:"Open menu",exact:true}).click();
    const nav=page.getByRole("navigation",{name:"Mobile navigation",exact:true});
    for(const name of["Collection","Packs","Leaderboard","Arena"])await nav.getByRole("link",{name,exact:true}).waitFor();
    await nav.getByRole("link",{name:"Packs",exact:true}).click();await page.waitForURL(origin+"/boosters");
    await page.getByRole("heading",{name:"Get YPAL",exact:true}).waitFor();
    assert.equal(await page.getByRole("navigation",{name:"Mobile navigation",exact:true}).count(),0);
    await page.getByRole("spinbutton",{name:"Packs to open",exact:true}).waitFor();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    const faq=page.getByRole("region",{name:"Booster pack FAQ",exact:true});
    await faq.locator("summary").filter({hasText:"Why is my card image still loading?"}).click();
    assert((await faq.innerText()).includes("updates automatically"));
    await page.screenshot({path:values.output.replace(/\.json$/,"-mobile.png"),fullPage:true});
    return{viewport:"390x844",sameAppPacks:true,faq:true,horizontalOverflow:false};
  });
  report.passed=true;
} catch(error) {
  report.passed=false;report.failure={message:String(error.message).slice(0,700),route:new URL(page.url()).pathname};
  console.log(JSON.stringify({passed:false,...report.failure}));
} finally {
  report.completedAt=new Date().toISOString();report.providerIndividualRequests=providerCalls;
  report.walletAvailable=await page.evaluate(()=>Boolean(window.ethereum)).catch(()=>false);
  report.capabilityResults=rpcReadResults;
  await writeFile(values.output,JSON.stringify(report,null,2)+"\n");await browser.close();
}
console.log(JSON.stringify({output:values.output,passed:report.passed,checks:report.checks.length,providerIndividualRequests:providerCalls,reportSha256:digest(await readFile(values.output))}));
if(!report.passed)process.exitCode=1;
