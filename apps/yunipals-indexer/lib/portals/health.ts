import { erc20Abi, isAddress } from "viem";
import { portalGradingAbi } from "@protopals/yunipals-market-core/portalAbi";
import { readCompetition } from "./competition.js";
import type { PortalRuntime } from "./runtime.js";

/** Aggregates only. Never expose spell bodies, provider output, signed bytes,
 * connection strings, job errors or secret-bearing RPC URLs. */
export async function portalHealth(
  runtime: PortalRuntime,
  env: NodeJS.ProcessEnv = process.env
) {
  const { chain, ledger, store } = runtime;
  const [head, cursor, workerCursor, jobs, unpublished] = await Promise.all([
    chain.client.getBlock(),
    ledger.cursor(),
    store.cursor(),
    store.db.query<{ queued: number; retrying: number; oldest: number | null }>(
      `SELECT count(*) FILTER (WHERE NOT completed)::int AS queued,
      count(*) FILTER (WHERE NOT completed AND last_error IS NOT NULL)::int AS retrying,
      min(accepted_at) FILTER (WHERE NOT completed)::float8 AS oldest FROM portal_v1_job WHERE deployment=$1`,
      [store.deployment]
    ),
    ledger.db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM portal_v5_request r WHERE r.deployment=$1 AND r.completed_version IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM portal_v1_publication p WHERE p.deployment=$2 AND p.request_id=r.request_id)`,
      [ledger.deployment, store.deployment]
    )
  ]);
  const canonical =
    !!cursor &&
    (await chain.client.getBlock({ blockNumber: BigInt(cursor.block) }))
      .hash === cursor.hash;
  const confirmations = BigInt(env.PORTALS_CONFIRMATIONS ?? "12");
  const safe = head.number > confirmations ? head.number - confirmations : 0n;
  const lag =
    cursor && safe > BigInt(cursor.block)
      ? safe - BigInt(cursor.block)
      : cursor
        ? 0n
        : null;
  const gas =
    env.PORTALS_GRADER_ADDRESS && isAddress(env.PORTALS_GRADER_ADDRESS)
      ? await chain.client.getBalance({
          address: env.PORTALS_GRADER_ADDRESS,
          blockNumber: head.number
        })
      : null;
  const [portalLiability, portalReserves, competition] = await Promise.all([
    chain.client.readContract({
      address: chain.deployment.grading,
      abi: portalGradingAbi,
      functionName: "totalPortalLiability",
      blockNumber: head.number
    }),
    chain.client.readContract({
      address: chain.deployment.usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [chain.deployment.grading],
      blockNumber: head.number
    }),
    readCompetition(chain.client, chain.deployment.grading, head.number)
  ]);
  return {
    ready:
      canonical &&
      lag !== null &&
      lag <= 30n &&
      portalReserves >= portalLiability &&
      !(await ledger.requiresReplay()),
    chainId: chain.deployment.chainId,
    asOfBlock: head.number.toString(),
    ledger: {
      canonical,
      indexedThroughBlock: cursor?.block ?? null,
      lagBlocks: lag?.toString() ?? null
    },
    worker: {
      scannedThroughBlock: workerCursor?.block.toString() ?? null,
      lagBlocks: workerCursor
        ? (safe > workerCursor.block
            ? safe - workerCursor.block
            : 0n
          ).toString()
        : null,
      queued: jobs.rows[0]?.queued ?? 0,
      retrying: jobs.rows[0]?.retrying ?? 0,
      oldestAcceptedSeconds: jobs.rows[0]?.oldest
        ? Math.max(0, Number(head.timestamp) - jobs.rows[0].oldest)
        : null
    },
    publication: { awaiting: unpublished.rows[0]?.count ?? 0 },
    accounting: {
      portalLiability: portalLiability.toString(),
      portalReserves: portalReserves.toString(),
      competitionLiability: competition?.liability.toString() ?? null,
      competitionReserves: competition?.reserves.toString() ?? null,
      unpaidBatches: competition?.pending.toString() ?? null
    },
    challenge: competition
      ? {
          phase: competition.phase,
          nextBatch: competition.nextBatch.toString(),
          themePublished: competition.theme.hash !== `0x${"0".repeat(64)}`
        }
      : null,
    signerGasWei: gas?.toString() ?? null
  };
}
