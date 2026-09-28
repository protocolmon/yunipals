import { parseArgs } from "node:util";
import { writeFile } from "node:fs/promises";

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    owner: { type: "string" },
    seconds: { type: "string", default: "60" },
    sessions: { type: "string", default: "1" },
    load: { type: "boolean", default: false },
    output: { type: "string", default: "/tmp/collector-api-benchmark.json" },
  },
});
if (!values.url || !values.owner || !/^0x[0-9a-fA-F]{40}$/.test(values.owner))
  throw new Error(
    "Pass --url for the indexer and --owner for a large test wallet.",
  );
const base = new URL(values.url);
if (
  !["http:", "https:"].includes(base.protocol) ||
  base.username ||
  base.password ||
  base.search ||
  base.hash
)
  throw new Error(
    "Use an HTTP(S) base URL without credentials or query parameters.",
  );
const seconds = Number(values.seconds);
const sessions = Number(values.sessions);
if (
  !Number.isInteger(seconds) ||
  seconds < 1 ||
  seconds > 600 ||
  !Number.isInteger(sessions) ||
  sessions < 1 ||
  sessions > 20
)
  throw new Error("Use 1–600 seconds and 1–20 sessions.");
if ((sessions > 1 || seconds > 60) && !values.load)
  throw new Error("Concurrent or extended workloads require explicit --load; do not use this on production by default.");
const origin = values.url.replace(/\/$/, "");
const read = async (path) => {
  const response = await fetch(`${origin}${path}`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};
const capabilities = await read("/v1/collector-capabilities");
if (capabilities.version !== 1)
  throw new Error("Enable the collector endpoint first.");
const path = `/v2/owners/${values.owner}/tokens`;
const first = await read(`${path}?limit=24`);
const sample = first.items[0];
if (!sample) throw new Error("Choose a wallet with holdings.");
const traits = Object.fromEntries(
  (sample.attributes ?? []).map((item) => [item.trait_type, item.value]),
);
const combined = new URLSearchParams({ limit: "24" });
for (const key of ["Type", "Color"])
  if (typeof traits[key] === "string") combined.set(`t.${key}`, traits[key]);
const cases = [
  "limit=24",
  "limit=24&sort=rarity-capped-asc",
  combined.toString(),
  new URLSearchParams({ limit: "24", q: sample.tokenId }).toString(),
];
const effectiveRarity = sample.rarityPointsCapped ?? sample.rarityPoints;
if (capabilities.rarityRange && effectiveRarity !== null) {
  cases.push(
    new URLSearchParams({ limit: "24", rarityMin: "0" }).toString(),
    new URLSearchParams({
      limit: "24",
      rarityMin: effectiveRarity,
      rarityMax: effectiveRarity,
    }).toString(),
  );
}
if (capabilities.namePrefixSearch && sample.name?.trim().length >= 2)
  cases.push(
    new URLSearchParams({
      limit: "24",
      q: sample.name.trim().slice(0, 2),
    }).toString(),
  );
const timings = [];
const errors = [];
const deadline = performance.now() + seconds * 1000;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await Promise.all(
  Array.from({ length: sessions }, async (_, session) => {
    let tick = session;
    let cursor = null;
    while (performance.now() < deadline) {
      const started = performance.now();
      try {
        const params = new URLSearchParams(cases[tick % cases.length]);
        if (cursor) params.set("cursor", cursor);
        const page = await read(`${path}?${params}`);
        if (page.version !== 1 || page.items.length > 24)
          throw new Error("Invalid bounded page");
        timings.push(performance.now() - started);
        // Visit a continuation before changing filters, with cursors kept per session.
        if (!cursor && page.nextCursor) cursor = page.nextCursor;
        else {
          cursor = null;
          tick++;
        }
      } catch (error) {
        errors.push(error.message);
        cursor = null;
        tick++;
      }
      await pause(
        Math.max(
          0,
          Math.min(
            5000 - (performance.now() - started),
            deadline - performance.now(),
          ),
        ),
      );
    }
  }),
);
timings.sort((a, b) => a - b);
const percentile = (p) =>
  timings[Math.max(0, Math.ceil(timings.length * p) - 1)] ?? null;
const report = {
  sessions,
  seconds,
  requests: timings.length + errors.length,
  errors,
  p95Ms: percentile(0.95),
  p99Ms: percentile(0.99),
  workload:
    "One request per session every five seconds, alternating first/next pages and representative filters",
  releaseWorkload: sessions === 20 && seconds >= 300,
};
report.passed =
  !errors.length &&
  report.p95Ms !== null &&
  report.p95Ms < 300 &&
  report.p99Ms < 1000;
await writeFile(values.output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (!report.passed) process.exitCode = 1;
