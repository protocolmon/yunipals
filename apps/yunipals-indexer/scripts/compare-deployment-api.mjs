import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import pg from "pg";

const previousRoot = process.env.INDEXER_PARITY_PREVIOUS_ROOT;
const candidateRoot = process.env.INDEXER_PARITY_CANDIDATE_ROOT;
const reportPath = process.env.INDEXER_PARITY_REPORT;
const databaseUrl = process.env.DATABASE_URL;
if (!previousRoot || !candidateRoot || !reportPath || !databaseUrl) {
  throw new Error("Previous root, candidate root, report path, and DATABASE_URL are required");
}
const database = new pg.Client({ connectionString: databaseUrl });
const readSchema = process.env.READ_DATABASE_SCHEMA ?? "yunipals_read_v4";
if (!/^[a-z_][a-z0-9_]*$/i.test(readSchema)) throw new Error("Invalid read schema");

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

function digest(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

async function responseOf(app, path) {
  const response = await app.request(`http://localhost${path}`);
  let body = await response.text();
  try {
    body = JSON.parse(body);
  } catch {
    // Keep non-JSON responses as strings.
  }
  if (path === "/ready" && body && typeof body === "object") {
    const { databasePool: _runtimePool, ...stableBody } = body;
    body = stableBody;
  }
  return {
    status: response.status,
    etag: response.headers.get("etag"),
    metadataRelease: response.headers.get("x-metadata-release"),
    metadataOwnership: response.headers.get("x-metadata-ownership"),
    body
  };
}

const paths = new Set([
  "/ready",
  "/v1/indexing-status",
  "/v1/status",
  "/v1/collections",
  "/v1/collection",
  "/v1/tokens?limit=10",
  "/v1/leaderboards/monster-count?limit=3",
  "/legacy-meta/meta?id=1"
]);

try {
  await database.connect();
  const connected = await database.query("SELECT current_database() AS name, inet_server_addr() AS tcp_address");
  if (connected.rows[0]?.name !== "yunipals_rehearsal" || connected.rows[0]?.tcp_address !== null) {
    throw new Error("Parity comparison requires the isolated rehearsal database over its Unix socket");
  }

  for (const chain of ["ethereum", "base", "polygon", "bnb"]) {
    paths.add(`/v1/collection?chain=${chain}`);
    paths.add(`/v1/tokens?chain=${chain}&limit=5`);
    paths.add(`/v1/tokens?chain=${chain}&sort=rarity-desc&limit=5`);
    paths.add(`/v1/traits?chain=${chain}`);
    paths.add(`/v1/leaderboards/monster-count?chain=${chain}&limit=3`);
    const sample = await database.query(
      `SELECT token_id, owner FROM "${readSchema}".token WHERE collection=$1 AND NOT burned LIMIT 2`,
      [chain]
    );
    for (const token of sample.rows) {
      paths.add(`/v1/tokens/${chain}/${encodeURIComponent(token.token_id)}`);
      paths.add(`/v1/owners/${token.owner}/tokens?chain=${chain}&limit=10`);
    }
  }

  const previous = await import(pathToFileURL(resolve(previousRoot, "lib/api/server.ts")).href);
  const candidate = await import(pathToFileURL(resolve(candidateRoot, "lib/api/server.ts")).href);
  if (!previous.app || !candidate.app) throw new Error("Both API modules must export app");
  const comparisons = [];
  for (const path of paths) {
    const before = await responseOf(previous.app, path);
    const after = await responseOf(candidate.app, path);
    comparisons.push({
      path,
      match: digest(before) === digest(after) && before.status < 500 && after.status < 500,
      previous: digest(before),
      candidate: digest(after),
      previousStatus: before.status,
      candidateStatus: after.status
    });
    if (comparisons.length % 10 === 0) {
      console.log(`Compared ${comparisons.length}/${paths.size} main API routes`);
    }
  }
  const report = {
    format: "yunipals-indexer-api-parity-v1",
    checkedAt: new Date().toISOString(),
    previousRoot,
    candidateRoot,
    database: "yunipals_rehearsal",
    statementTimeoutMs: process.env.API_DB_STATEMENT_TIMEOUT_MS ?? null,
    acceptedRoutingDifference: "The candidate main API adds collector capabilities; the public proxy serves this route from the separate collector API.",
    compared: comparisons.length,
    mismatches: comparisons.filter((entry) => !entry.match),
    comparisons
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ compared: report.compared, mismatches: report.mismatches.length, report: reportPath }));
  if (report.mismatches.length) process.exitCode = 1;
} catch (error) {
  console.error("API parity check failed", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await database.end().catch(() => undefined);
  process.exit(process.exitCode ?? 0);
}
