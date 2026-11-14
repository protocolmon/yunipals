import { canonicalPublication } from "./publication.js";
import type { Hono } from "hono";
import { TransactionReceiptNotFoundError, type Hex } from "viem";
import { z } from "zod";
import {
  portalGradingAbi,
  portalCompetitionAbi
} from "@protopals/yunipals-market-core/portalAbi";
import {
  portalEventDigest,
  portalIndexExpectationHash,
  portalIndexSourceId,
  portalReceiptEvents,
  type PortalIndexEvidence,
  type PortalIndexRequest,
  type PortalIndexSelection
} from "@protopals/yunipals-market-core/portalIndex";
import type { PortalRuntime } from "./runtime.js";
import type { PortalLedgerEvent } from "./ledger-store.js";
import { portalProjectionApplied } from "./ledger-application.js";

const hash = z
  .string()
  .regex(/^0x[\da-f]{64}$/i)
  .transform((v) => v.toLowerCase());
const address = z
  .string()
  .regex(/^0x[\da-f]{40}$/i)
  .transform((v) => v.toLowerCase());
export const portalEvidenceRequestSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    shared: z
      .object({ releaseId: hash, readIdentity: hash })
      .strict()
      .optional(),
    sourceId: hash,
    generation: z.string().uuid().nullable(),
    chainId: z.number().int().positive(),
    transactionHash: hash,
    blockNumber: z.string().regex(/^(0|[1-9][0-9]{0,19})$/),
    blockHash: hash,
    sender: address,
    events: z
      .array(
        z
          .object({
            source: address,
            name: z
              .string()
              .regex(/^[A-Za-z]+$/)
              .max(64),
            logIndex: z.number().int().min(0).max(2147483647),
            digest: hash
          })
          .strict()
      )
      .min(1)
      .max(256)
  })
  .strict()
  .refine((v) =>
    v.version === 1 ? v.shared === undefined : v.shared !== undefined
  )
  .refine((v) =>
    v.events.every(
      (event, i) => i === 0 || event.logIndex > v.events[i - 1].logIndex
    )
  );

export async function portalIndexSelection(
  runtime: PortalRuntime,
  version: 1 | 2 = 1
): Promise<PortalIndexSelection> {
  const { chain, ledger } = runtime;
  const shared = ledger.sourceIdentity();
  const competition = shared ? (await ledger.cursor())!.competition! : await chain.client.readContract({
    address: chain.deployment.grading,
    abi: portalGradingAbi,
    functionName: "competition"
  });
  const deployment = { ...chain.deployment, competition };
  return {
    version: shared ? version : 1,
    ...(shared && version === 2
      ? {
          shared: {
            releaseId: shared.releaseId,
            readIdentity: shared.readIdentity
          }
        }
      : {}),
    sourceId: portalIndexSourceId(deployment),
    generation: (await ledger.cursor())?.generation ?? null,
    deployment
  };
}

export async function readPortalActionEvidence(
  runtime: PortalRuntime,
  request: PortalIndexRequest
): Promise<PortalIndexEvidence> {
  const base: PortalIndexEvidence = {
    version: request.version,
    expectationHash: portalIndexExpectationHash(request),
    state: "source_unavailable",
    reason: "source_read_unavailable",
    transaction: {
      chainId: request.chainId,
      hash: request.transactionHash,
      blockNumber: request.blockNumber,
      blockHash: request.blockHash
    },
    coverage: null,
    proof: null,
    application: { state: "not_evaluated", component: "portal" }
  };
  const answer = (
    state: PortalIndexEvidence["state"],
    reason: PortalIndexEvidence["reason"]
  ) => ({ ...base, state, reason });
  try {
    const { chain, ledger, store, assets } = runtime;
    const selected = await portalIndexSelection(runtime, request.version);
    const shared = ledger.sourceIdentity();
    if (shared) base.shared = shared;
    if (
      request.version === 2 &&
      (!shared ||
        request.shared?.releaseId !== shared.releaseId ||
        request.shared?.readIdentity !== shared.readIdentity)
    )
      return answer("unsupported", "source_selection_changed");
    if (
      selected.deployment.chainId !== request.chainId ||
      selected.sourceId !== request.sourceId
    )
      return answer("unsupported", "source_selection_changed");
    const cursor = await ledger.cursor();
    if (!cursor) return answer("awaiting_indexing", "block_not_indexed");
    if (cursor.generation !== request.generation)
      return answer("inclusion_changed", "source_selection_changed");
    if (
      (
        await chain.client.getBlock({ blockNumber: BigInt(cursor.block) })
      ).hash?.toLowerCase() !== cursor.hash.toLowerCase()
    )
      return answer("inclusion_changed", "inclusion_changed");
    base.coverage = {
      sourceId: selected.sourceId,
      policy: "latest",
      completeThroughBlock: cursor.block,
      availableThroughBlock: cursor.block,
      finalizedThroughBlock: null,
      anchor: { number: cursor.block, hash: cursor.hash },
      observationRevision: cursor.generation
    };
    const receipt = await chain.client.getTransactionReceipt({
      hash: request.transactionHash as Hex
    });
    if (
      receipt.blockNumber.toString() !== request.blockNumber ||
      receipt.blockHash.toLowerCase() !== request.blockHash ||
      (
        await chain.client.getBlock({ blockNumber: receipt.blockNumber })
      ).hash?.toLowerCase() !== request.blockHash
    )
      return answer("inclusion_changed", "inclusion_changed");
    if (
      receipt.status !== "success" ||
      receipt.from.toLowerCase() !== request.sender
    )
      return answer("action_not_observed", "receipt_invalid");
    const events = portalReceiptEvents(selected.deployment, receipt);
    if (JSON.stringify(events) !== JSON.stringify(request.events))
      return answer("action_not_observed", "action_not_observed");
    if (BigInt(cursor.block) < receipt.blockNumber)
      return answer("awaiting_indexing", "block_not_indexed");
    const rows = await ledger.db.query<PortalLedgerEvent>(
      `SELECT event_type AS type,token_id::text AS "tokenId",block_number::text AS block,block_hash AS "blockHash",transaction_hash AS "transactionHash",transaction_index AS "transactionIndex",log_index AS "logIndex",source,args
      FROM portal_v2_ledger_event WHERE deployment=$1 AND transaction_hash=$2 ORDER BY log_index LIMIT 257`,
      [ledger.deployment, request.transactionHash]
    );
    if (rows.rows.length !== events.length)
      return answer("awaiting_indexing", "projection_inconsistent");
    for (let i = 0; i < events.length; i++) {
      const event = rows.rows[i],
        expected = events[i];
      if (
        event.block !== request.blockNumber ||
        event.blockHash.toLowerCase() !== request.blockHash ||
        event.source !== expected.source ||
        event.logIndex !== expected.logIndex ||
        event.type !== expected.name ||
        portalEventDigest(event.type, event.args) !== expected.digest
      )
        return answer("awaiting_indexing", "canonical_event_invalid");
      if (!(await portalProjectionApplied(ledger.db, ledger.deployment, event)))
        return answer("awaiting_indexing", "projection_inconsistent");
      if (event.type === "GradingCompleted") {
        const history = await store.publicHistory(event.args.tokenId, [
          event.args.requestId
        ]);
        if (!history.some((entry) => entry.requestId === event.args.requestId))
          return answer("awaiting_indexing", "projection_inconsistent");
        const row = history.find(
          (entry) => entry.requestId === event.args.requestId
        )!;
        const publication = await canonicalPublication(
          runtime,
          event.args.requestId,
          row.result,
          cursor
        );
        if (!publication)
          return answer("awaiting_indexing", "projection_inconsistent");
        await assets.read(publication.slab.hash.slice(2), "png");
        for (const [hash, extension] of [
          [event.args.artworkHash, "png"],
          [event.args.reportHash, "json"]
        ] as const) {
          if (!(await store.isPublishedArtifact(hash.slice(2))))
            return answer("awaiting_indexing", "projection_inconsistent");
          await assets.read(hash.slice(2), extension);
        }
      }
      if (event.type === "ThemePublished") {
        const theme = await chain.client.readContract({
          address: selected.deployment.competition as `0x${string}`,
          abi: portalCompetitionAbi,
          functionName: "getTheme",
          args: [BigInt(event.args.batchId)],
          blockNumber: BigInt(cursor.block)
        });
        if (
          theme.hash !== event.args.themeHash ||
          theme.sourcesHash !== event.args.sourcesHash
        )
          return answer("awaiting_indexing", "projection_inconsistent");
        if (event.args.batchId !== "1")
          await assets.read(theme.artifactHash.slice(2), "json");
      }
    }
    // A concurrent replay or advancing projection invalidates this read; retry
    // instead of combining evidence from different database generations.
    const after = await ledger.cursor();
    if (JSON.stringify(after) !== JSON.stringify(cursor))
      return answer("awaiting_indexing", "source_selection_changed");
    if (
      (await chain.client.getBlock({ blockNumber: BigInt(cursor.block) }))
        .hash !== cursor.hash ||
      (await chain.client.getBlock({ blockNumber: receipt.blockNumber }))
        .hash !== receipt.blockHash
    )
      return answer("inclusion_changed", "inclusion_changed");
    base.proof = {
      kind: "canonical_event_and_full_receipt",
      receiptRequirement: "full",
      receiptPayloadHash: portalIndexExpectationHash(request),
      events: events.map((event) => ({
        id: `${request.transactionHash}:${event.logIndex}`,
        name: event.name,
        logIndex: event.logIndex
      }))
    };
    base.application = { state: "applied", component: "portal" };
    return answer("indexed", "action_indexed");
  } catch (error) {
    if (error instanceof TransactionReceiptNotFoundError)
      return answer("awaiting_receipt", "receipt_candidate_missing");
    return answer("source_unavailable", "source_read_unavailable");
  }
}

export function registerPortalEvidenceRoutes(
  router: Hono,
  get: () => Promise<PortalRuntime>
) {
  router.get("/v1/portals/action-evidence", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(
      await portalIndexSelection(
        await get(),
        c.req.query("version") === "2" ? 2 : 1
      )
    );
  });
  router.post("/v1/portals/action-evidence", async (c) => {
    c.header("Cache-Control", "no-store");
    const input = portalEvidenceRequestSchema.parse(await c.req.json());
    return c.json(await readPortalActionEvidence(await get(), input));
  });
}
