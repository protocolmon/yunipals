import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import pg from "pg";
import { assertOwnershipAvailable } from "../lib/ownership/readiness.js";
import { parseVersionManifest } from "../lib/versions/manifest.js";
import { versionSolanaSnapshot } from "../lib/versions/read.js";
import {
  addSolanaVersionGroups,
  solanaVersionCandidates,
  type BaseIdentityAudit
} from "../lib/versions/solana.js";

const { values } = parseArgs({
  options: {
    manifest: { type: "string" },
    audit: { type: "string" },
    output: { type: "string" }
  }
});
if (
  !values.manifest ||
  !values.audit ||
  !values.output ||
  [values.manifest, values.audit].includes(values.output)
)
  throw new Error(
    "Usage: extend-monster-versions-solana.ts --manifest existing.json --audit complete-audit.jsonl --output extended.json"
  );
const manifest = parseVersionManifest(
  JSON.parse(await readFile(values.manifest, "utf8"))
);
const auditDigest = createHash("sha256");
const originals: BaseIdentityAudit[] = [];
const input = createReadStream(values.audit);
input.on("data", (chunk) => auditDigest.update(chunk));
for await (const line of createInterface({ input, crlfDelay: Infinity })) {
  if (!line) continue;
  const row = JSON.parse(line) as BaseIdentityAudit;
  if (
    row.archivedOriginals.some(
      (o) => o.chainId === "mainnet-beta" && o.originType === "GEN1_EXOMON_DROP"
    )
  )
    originals.push(row);
}
const auditSha256 = auditDigest.digest("hex");
if (
  manifest.groups.some(
    (g) =>
      g.evidence.kind !== "base-mint-and-source-identity" ||
      g.evidence.auditSha256 !== auditSha256
  )
)
  throw new Error("The manifest and complete initial mint audit do not match.");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const candidates: Awaited<ReturnType<typeof solanaVersionCandidates>> = [];
await db.connect();
try {
  for (let i = 0; i < originals.length; i += 250) {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
      await db.query("SET LOCAL statement_timeout='5s'");
      await db.query("SET LOCAL jit=off");
      await assertOwnershipAvailable(db, ["base"]);
      await versionSolanaSnapshot(db, true);
      const active = (
        await db.query<{ release_id: string }>(
          "SELECT release_id FROM metadata_source.archive_release WHERE state='active'"
        )
      ).rows;
      if (
        active.length !== 1 ||
        active[0]!.release_id !== manifest.metadataReleaseId
      )
        throw new Error("Metadata release changed.");
      candidates.push(
        ...(await solanaVersionCandidates(
          db,
          manifest.metadataReleaseId,
          originals.slice(i, i + 250)
        ))
      );
    } finally {
      await db.query("ROLLBACK");
    }
  }
} finally {
  await db.end();
}
const extended = addSolanaVersionGroups(manifest, candidates, auditSha256);
const output = JSON.stringify({ version: 1, ...extended }) + "\n";
const file = await open(values.output, "wx", 0o600);
try {
  await file.write(output);
  await file.sync();
} finally {
  await file.close();
}
console.log(
  JSON.stringify({
    groups: extended.groups.length,
    solanaOriginals: candidates.length,
    threeVersionGroups: extended.groups.filter((g) => g.members.length === 3)
      .length,
    metadataReleaseId: extended.metadataReleaseId,
    auditSha256,
    manifestSha256: createHash("sha256").update(output).digest("hex"),
    activated: false
  })
);
