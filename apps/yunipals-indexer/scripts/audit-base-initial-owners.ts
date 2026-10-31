import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { parseArgs } from "node:util";
import pg from "pg";
import { monsterVersionLimit } from "@protopals/yunipals-market-core/monsterVersions";
import { assertOwnershipAvailable } from "../lib/ownership/readiness.js";
import {
  initialOwnerScanQuery,
  attachInitialOwnerSources,
  classifyInitialOwner,
  type InitialOwnerRow
} from "../lib/versions/initial-owners.js";

const { values } = parseArgs({
  options: {
    progress: { type: "boolean", default: false },
    output: { type: "string" },
    manifest: { type: "string" },
    limit: { type: "string" },
    "batch-size": { type: "string", default: "250" }
  }
});
if (!values.output)
  throw new Error(
    "Usage: audit-base-initial-owners.ts --output audit.jsonl [--manifest manifest.json] [--limit N] [--batch-size 250]"
  );
const batchSize = Number(values["batch-size"]),
  maximum = values.limit === undefined ? Infinity : Number(values.limit);
if (
  !Number.isSafeInteger(batchSize) ||
  batchSize < 1 ||
  batchSize > 500 ||
  (maximum !== Infinity && (!Number.isSafeInteger(maximum) || maximum < 1))
)
  throw new Error("Invalid audit limit.");
if (values.output === values.manifest)
  throw new Error("Choose separate audit and manifest files.");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const audit = await open(values.output, "wx");
const digest = createHash("sha256");
const counts: Record<string, number> = {};
const originalIdentityCounts = {
  archiveFound: 0,
  archiveMissing: 0,
  archiveRetainsBaseTokenId: 0,
  archiveUsesDifferentId: 0,
  pairedWithSameTokenId: 0,
  pairedWithDifferentTokenId: 0,
  unmatchedArchiveMinted: {} as Record<string, number>
};
type Audit = ReturnType<typeof classifyInitialOwner>;
const groups = new Map<
  string,
  {
    members: NonNullable<Audit["base"] | Audit["original"]>[];
    initialOwners: {
      tokenId: string;
      recipient: string;
      transactionHash: string;
      logIndex: number;
    }[];
  }
>();
let scanned = 0;
try {
  await db.connect();
  let metadataReleaseId: string | null = null;
  let after = "";
  let finished = false;
  while (!finished && scanned < maximum) {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await db.query("SET LOCAL statement_timeout='5s'");
    await db.query("SET LOCAL jit=off");
    await assertOwnershipAvailable(db, ["ethereum", "base", "polygon", "bnb"]);
    const releases = (
      await db.query<{ release_id: string }>(
        "SELECT release_id FROM metadata_source.archive_release WHERE state='active'"
      )
    ).rows;
    if (releases.length !== 1)
      throw new Error("A single active metadata release is required.");
    const currentRelease = releases[0]!.release_id;
    if (metadataReleaseId !== null && metadataReleaseId !== currentRelease)
      throw new Error(
        "Metadata release changed during the audit. Start a new audit."
      );
    metadataReleaseId = currentRelease;
    const chunkSize = Math.min(5000, maximum - scanned);
    const scan = initialOwnerScanQuery(metadataReleaseId, after, chunkSize);
    await db.query(
      "DECLARE base_initial_owner_scan NO SCROLL CURSOR FOR " + scan.text,
      scan.values
    );
    let inChunk = 0;
    while (inChunk < chunkSize) {
      const size = Math.min(batchSize, chunkSize - inChunk);
      const rawRows = (
        await db.query<InitialOwnerRow>(
          `FETCH FORWARD ${size} FROM base_initial_owner_scan`
        )
      ).rows;
      const rows = await attachInitialOwnerSources(
        db,
        metadataReleaseId,
        rawRows
      );
      if (!rows.length) {
        finished = true;
        break;
      }
      for (const row of rows) {
        const result = classifyInitialOwner(row);
        const line = JSON.stringify(result) + "\n";
        await audit.write(line);
        digest.update(line);
        counts[result.status] = (counts[result.status] ?? 0) + 1;
        if (result.archivedOriginals.length) {
          originalIdentityCounts.archiveFound++;
          if (
            result.archivedOriginals.some((o) => o.tokenId === result.tokenId)
          )
            originalIdentityCounts.archiveRetainsBaseTokenId++;
          else originalIdentityCounts.archiveUsesDifferentId++;
        } else originalIdentityCounts.archiveMissing++;
        if (result.original) {
          if (result.original.tokenId === result.tokenId)
            originalIdentityCounts.pairedWithSameTokenId++;
          else originalIdentityCounts.pairedWithDifferentTokenId++;
        } else {
          const states = new Set(
            result.archivedOriginals.map((o) => String(o.minted ?? "unknown"))
          );
          const state = states.size === 1 ? [...states][0]! : "unknown";
          const totals = originalIdentityCounts.unmatchedArchiveMinted;
          totals[state] = (totals[state] ?? 0) + 1;
        }
        scanned++;
        if (
          values.manifest &&
          result.original &&
          result.base &&
          result.initialMint
        ) {
          const key = JSON.stringify(result.original);
          const group = groups.get(key) ?? {
            members: [result.original],
            initialOwners: []
          };
          group.members.push(result.base);
          group.initialOwners.push({
            tokenId: result.tokenId,
            recipient: result.initialMint.recipient,
            transactionHash: result.initialMint.transactionHash,
            logIndex: result.initialMint.logIndex
          });
          groups.set(key, group);
        }
      }

      const next = rows.at(-1)!.tokenId;
      if (next <= after)
        throw new Error("Initial-owner cursor did not advance.");
      after = next;
      inChunk += rows.length;
    }
    await db.query("CLOSE base_initial_owner_scan");
    await db.query("ROLLBACK");
    if (values.progress) console.error(JSON.stringify({ scanned, counts }));
  }
  await audit.sync();
  const auditSha256 = digest.digest("hex");
  let eligibleGroups = 0,
    oversizedGroups = 0;
  if (values.manifest) {
    const file = await open(values.manifest, "wx");
    try {
      await file.write(
        `{"version":1,"metadataReleaseId":${JSON.stringify(metadataReleaseId)},"groups":[`
      );
      for (const group of groups.values()) {
        if (group.members.length > monsterVersionLimit) {
          oversizedGroups++;
          continue;
        }
        const output = {
          members: group.members,
          evidence: {
            kind: "base-mint-and-source-identity",
            source:
              "canonical Base zero-address Transfer and shared archived monster identity across configured original NFT contracts",
            auditSha256,
            initialOwners: group.initialOwners
          }
        };
        await file.write((eligibleGroups ? "," : "") + JSON.stringify(output));
        eligibleGroups++;
      }
      await file.write("]}\n");
      await file.sync();
    } finally {
      await file.close();
    }
  }
  console.log(
    JSON.stringify({
      scanned,
      counts,
      originalIdentityCounts,
      auditSha256,
      metadataReleaseId,
      manifestGroups: eligibleGroups,
      oversizedGroups,
      limited: scanned === maximum
    })
  );
} catch (error) {
  await db.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await audit.close();
  await db.end();
}
