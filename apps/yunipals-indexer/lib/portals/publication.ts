import { z } from "zod";
import type { PortalRuntime } from "./runtime.js";
import type { PortalLedgerCursor } from "./ledger-store.js";
import type { PortalChain } from "./chain.js";

const hash = z.string().regex(/^0x[0-9a-f]{64}$/);
const asset = z.object({ hash, uri: z.string().url() });
export const publishedSlabSchema = asset.extend({
  manifest: asset,
  renderer: z.string(),
  rawArtworkHash: hash,
  version: z.string().regex(/^\d+$/)
});
const publicationSchema = z
  .object({
    slab: publishedSlabSchema,
    result: z
      .object({
        requestBinding: hash,
        artwork: asset,
        reportHash: hash,
        scores: z.array(z.number().int().min(1).max(100)).length(4)
      })
      .passthrough()
  })
  .passthrough();

async function stable(runtime: PortalRuntime, cursor: PortalLedgerCursor) {
  const current = await runtime.ledger.cursor();
  return (
    current?.generation === cursor.generation &&
    BigInt(current.block) >= BigInt(cursor.block) &&
    (await runtime.chain.client.getBlock({ blockNumber: BigInt(cursor.block) }))
      .hash === cursor.hash
  );
}

/** A published file is usable only while its indexed result and current
 * canonical result still agree. This also handles transfers/burns: no owner
 * lookup is needed for the immutable public history. */
export async function canonicalPublication(
  runtime: PortalRuntime,
  requestId: string,
  result: unknown,
  cursor: PortalLedgerCursor
) {
  const parsed = publicationSchema.safeParse(result);
  if (!parsed.success) return null;
  const publication = parsed.data;
  const indexed = (
    await runtime.ledger.db.query<{
      version: string;
      artwork: string;
      report: string;
      scores: number[];
    }>(
      "SELECT completed_version::text AS version,artwork_hash AS artwork,report_hash AS report,scores FROM portal_v5_request WHERE deployment=$1 AND request_id=$2 AND completed_version IS NOT NULL",
      [runtime.ledger.deployment, requestId]
    )
  ).rows[0];
  if (
    !indexed ||
    indexed.artwork !== publication.result.artwork.hash ||
    indexed.report !== publication.result.reportHash ||
    indexed.version !== publication.slab.version ||
    JSON.stringify(indexed.scores) !==
      JSON.stringify(publication.result.scores) ||
    publication.slab.rawArtworkHash !== indexed.artwork
  )
    return null;
  const onchain = await runtime.chain.result(
    BigInt(requestId),
    BigInt(cursor.block)
  );
  if (
    onchain.completedAt === 0n ||
    onchain.requestBinding !== publication.result.requestBinding ||
    onchain.artwork.hash !== indexed.artwork ||
    onchain.reportHash !== indexed.report ||
    onchain.artwork.uri !== publication.result.artwork.uri ||
    JSON.stringify(onchain.scores) !== JSON.stringify(indexed.scores)
  )
    return null;
  return (await stable(runtime, cursor)) ? publication : null;
}

export async function publicPortalCard(
  runtime: PortalRuntime,
  card: Awaited<ReturnType<PortalChain["card"]>>
) {
  const cursor = await runtime.ledger.cursor();
  const ready: {
    requestId: string;
    spell: string;
    result: z.infer<typeof publicationSchema>;
  }[] = [];
  if (cursor && (await stable(runtime, cursor))) {
    const rows = await runtime.store.publicHistory(
      card.tokenId.toString(),
      card.history.map((attempt) => attempt.id.toString())
    );
    for (const row of rows) {
      const publication = await canonicalPublication(
        runtime,
        row.requestId,
        row.result,
        cursor
      );
      if (publication) {
        await runtime.assets.read(publication.slab.hash.slice(2), "png");
        ready.push({ ...row, result: publication });
      }
    }
    if (!(await stable(runtime, cursor))) ready.length = 0;
  }
  const history = card.history.filter((attempt) =>
    ready.some(
      (row) =>
        row.requestId === attempt.id.toString() &&
        row.result.result.artwork.hash === attempt.result.artwork.hash
    )
  );
  return {
    ...card,
    history,
    publication: ready,
    publicationPending: card.history.length > history.length,
    indexedThroughBlock: cursor?.block ?? null
  };
}

export async function publishedPortalArtifact(
  runtime: PortalRuntime,
  hash: string
) {
  const rows = await runtime.store.db.query<{
    request: string;
    result: unknown;
  }>(
    "SELECT request_id::text AS request,result FROM portal_v1_publication WHERE deployment=$1 AND $2=ANY(artifact_hashes) ORDER BY request_id DESC LIMIT 8",
    [runtime.store.deployment, hash]
  );
  if (!rows.rows.length) return false;
  const cursor = await runtime.ledger.cursor();
  if (!cursor || !(await stable(runtime, cursor))) return false;
  for (const row of rows.rows)
    if (await canonicalPublication(runtime, row.request, row.result, cursor))
      return true;
  return false;
}
