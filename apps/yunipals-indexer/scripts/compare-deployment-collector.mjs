import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

import pg from "pg";

const previousUrl = process.env.INDEXER_PARITY_PREVIOUS_URL;
const candidateUrl = process.env.INDEXER_PARITY_CANDIDATE_URL;
const reportPath = process.env.INDEXER_PARITY_REPORT;
const databaseUrl = process.env.DATABASE_URL;
if (!previousUrl || !candidateUrl || !reportPath || !databaseUrl) {
  throw new Error("Previous URL, candidate URL, report path, and DATABASE_URL are required");
}
for (const url of [previousUrl, candidateUrl]) {
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1") throw new Error("Collector parity URLs must use loopback");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)])
    );
  }
  return value;
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalize(entry)])
    );
  }
  if (typeof value === "string") {
    try {
      const cursor = JSON.parse(Buffer.from(value, "base64url").toString());
      if (cursor && typeof cursor === "object" && typeof cursor.expires === "number") {
        return { ...cursor, expires: "dynamic" };
      }
    } catch {
      // Ordinary strings are unchanged.
    }
  }
  return value;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(canonical(normalize(value)))).digest("hex");
}

async function responseOf(baseUrl, path) {
  const response = await fetch(new URL(path, baseUrl), { signal: AbortSignal.timeout(15000) });
  return { status: response.status, body: await response.json() };
}

const database = new pg.Client({ connectionString: databaseUrl });
try {
  await database.connect();
  const connected = await database.query("SELECT current_database() AS name, inet_server_addr() AS tcp_address");
  if (connected.rows[0]?.name !== "yunipals_rehearsal" || connected.rows[0]?.tcp_address !== null) {
    throw new Error("Collector comparison requires the isolated rehearsal database over its Unix socket");
  }

  const paths = ["/ready", "/v1/collector-capabilities"];
  for (const chain of ["ethereum", "base", "polygon", "bnb"]) {
    const sample = await database.query(
      `SELECT owner,token_id FROM yunipals_read_v4.token WHERE collection=$1 AND NOT burned LIMIT 1`,
      [chain]
    );
    if (!sample.rows[0]) throw new Error(`No active ${chain} owner in restored data`);
    const { owner, token_id: tokenId } = sample.rows[0];
    const base = `/v2/owners/${owner}/tokens?chain=${chain}&limit=5`;
    paths.push(base, `${base}&sort=rarity-desc`, `${base}&rarityMin=0&rarityMax=1000000`);
    paths.push(`${base}&q=${encodeURIComponent(tokenId)}`);
  }
  const comparisons = [];
  for (const path of paths) {
    const previous = await responseOf(previousUrl, path);
    const candidate = await responseOf(candidateUrl, path);
    comparisons.push({
      path,
      match: digest(previous) === digest(candidate) && previous.status < 500 && candidate.status < 500,
      previous: digest(previous),
      candidate: digest(candidate),
      previousStatus: previous.status,
      candidateStatus: candidate.status
    });
  }
  const report = {
    format: "yunipals-indexer-collector-parity-v1",
    checkedAt: new Date().toISOString(),
    previousUrl,
    candidateUrl,
    database: "yunipals_rehearsal",
    compared: comparisons.length,
    mismatches: comparisons.filter((entry) => !entry.match),
    comparisons
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ compared: report.compared, mismatches: report.mismatches.length, report: reportPath }));
  if (report.mismatches.length) process.exitCode = 1;
} catch (error) {
  console.error("Collector parity check failed", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await database.end().catch(() => undefined);
}
