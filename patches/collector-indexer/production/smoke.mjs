import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const publicBase = "https://api.yunipals.com/yunipals-indexer";
const base = process.env.COLLECTOR_SMOKE_URL ?? "http://127.0.0.1:9012";
// Select the same public leaderboard sample visitors can browse. Do not emit
// owner identities, token data, holdings counts, or request URLs in reports.
async function json(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  assert.equal(r.status, 200);
  return r.json();
}
const leaders = await json(
  publicBase + "/v1/leaderboards/monster-count?limit=1"
);
const owner = leaders.items[0].owner;
assert.match(owner, /^0x[0-9a-fA-F]{40}$/);
const results = [];
async function read(label, params = {}, status = 200) {
  await new Promise((r) => setTimeout(r, 1000));
  const started = performance.now();
  const response = await fetch(
    `${base}/v2/owners/${owner}/tokens?${new URLSearchParams({ limit: "24", ...params })}`,
    { signal: AbortSignal.timeout(3000) }
  );
  const body = await response.json();
  results.push({
    label,
    status: response.status,
    totalMs: Math.round(performance.now() - started),
    timing: response.headers.get("server-timing")
  });
  if (response.status !== status) {
    console.log(JSON.stringify(results));
    throw new Error(label + " unexpected status " + response.status);
  }
  if (status === 200) {
    assert.equal(body.version, 1);
    assert.ok(body.items.length <= 24);
    assert.ok(
      body.items.every((x) => x.owner.toLowerCase() === owner.toLowerCase())
    );
  }
  return body;
}
function ids(page) {
  return page.items.map((t) => t.chain + ":" + t.tokenId);
}
const caps = await json(base + "/v1/collector-capabilities");
assert.equal(caps.version, 1);
const first = await read("first-cold");
assert.ok(first.items.length > 0);
await read("first-warm");
if (first.nextCursor) {
  const second = await read("next", { cursor: first.nextCursor });
  assert.ok(ids(second).every((id) => !ids(first).includes(id)));
  const prev = await read("previous", { cursor: second.previousCursor });
  assert.deepEqual(ids(prev), ids(first));
  await read(
    "cursor-binding",
    { cursor: first.nextCursor, sort: "rarity-capped-asc" },
    409
  );
}
const asc = await read("ascending", { sort: "rarity-capped-asc" });
for (const [p, sign] of [
  [first, -1],
  [asc, 1]
]) {
  let last = null;
  let unknown = false;
  for (const x of p.items) {
    const s = x.rarityPointsCapped ?? x.rarityPoints;
    if (s == null) {
      unknown = true;
      continue;
    }
    assert.ok(!unknown);
    if (last !== null) assert.ok((Number(s) - last) * sign >= 0);
    last = Number(s);
  }
}
const token = first.items[0];
const combined = {};
for (const type of ["Type", "Color"]) {
  const value = token.attributes.find((x) => x.trait_type === type)?.value;
  if (typeof value === "string") combined["t." + type] = value;
}
const filtered = await read("combined-traits", combined);
assert.ok(
  filtered.items.every((x) =>
    Object.entries(combined).every(([key, value]) =>
      x.attributes.some(
        (a) => a.trait_type === key.slice(2) && a.value === value
      )
    )
  )
);
const exact = await read("exact-id", { q: token.tokenId });
assert.ok(exact.items.every((x) => x.tokenId === token.tokenId));
if (caps.rarityRange) {
  const score = token.rarityPointsCapped ?? token.rarityPoints;
  if (score !== null) {
    const bounded = await read("rarity-exact", {
      rarityMin: score,
      rarityMax: score
    });
    assert.ok(
      bounded.items.every(
        (x) => (x.rarityPointsCapped ?? x.rarityPoints) === score
      )
    );
  }
}
assert.equal(
  (await read("no-match", { "t.Type": "collector-smoke-no-match" })).items
    .length,
  0
);
await read("hidden", { visibility: "hidden" });
if (caps.namePrefixSearch && token.name?.length >= 2) {
  const prefix = token.name.slice(0, 2).toLowerCase();
  const names = await read("name-prefix", { q: prefix });
  assert.ok(names.items.every((x) => x.name.toLowerCase().startsWith(prefix)));
}
for (const chain of ["ethereum", "base", "polygon", "bnb"]) {
  const page = await read("chain-" + chain, { chain });
  assert.ok(page.items.every((x) => x.chain === chain));
}
const report = {
  checkedAt: new Date().toISOString(),
  sampleSource:
    "Public monster-count leaderboard; one wallet; sequential one-second pauses",
  limitations: "Bounded smoke test, not a production concurrency benchmark",
  passed: true,
  results
};
await writeFile(
  "/tmp/yunipals-collector-production-smoke.json",
  JSON.stringify(report, null, 2) + "\n"
);
console.log(JSON.stringify(report, null, 2));
