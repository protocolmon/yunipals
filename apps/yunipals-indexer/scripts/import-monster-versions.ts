import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import pg from "pg";
import {
  parseVersionManifest,
  versionEvidenceHash
} from "../lib/versions/manifest.js";
import { storeVersionManifest } from "../lib/versions/import.js";

const [manifestPath, allocationPath, action] = process.argv.slice(2);
if (
  !manifestPath ||
  !allocationPath ||
  !["--check", "--activate"].includes(action ?? "")
)
  throw new Error(
    "Usage: import-monster-versions.ts manifest.json evidence.jsonl --check|--activate"
  );
const raw = await readFile(manifestPath);
const allocation = await readFile(allocationPath);
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const revision = hash(raw),
  sourceSha = hash(allocation);
const manifest = parseVersionManifest(JSON.parse(raw.toString()));
if (manifest.groups.some((g) => versionEvidenceHash(g.evidence) !== sourceSha))
  throw new Error("Allocation file hash mismatch.");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(
    action === "--activate"
      ? "BEGIN"
      : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
  );
  await client.query("SET LOCAL statement_timeout='10s'");
  if (action === "--activate")
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('monster-version-publication'))"
    );
  await storeVersionManifest(
    client,
    manifest,
    revision,
    sourceSha,
    action === "--activate"
  );
  if (action === "--activate") {
    await client.query("COMMIT");
  } else await client.query("ROLLBACK");
  console.log(
    JSON.stringify({
      revision,
      groups: manifest.groups.length,
      members: manifest.groups.reduce((n, g) => n + g.members.length, 0),
      activated: action === "--activate"
    })
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
