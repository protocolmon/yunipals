import type { Pool } from "pg";
import type { PublicClient } from "viem";
import type { OpenSeaChain } from "@protopals/yunipals-market-core/openseaRegistry";
import {
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import { transaction } from "@/db/pool";
import {
  assertOpenSeaObservationCurrent,
  assertOpenSeaRuntimeCode,
  readOpenSeaHead
} from "@/opensea/chain";
import type { OpenSeaPolicyResolver } from "@/opensea/policy";
import { rpcComputeBudgetError } from "@/opensea/rpcComputeBudget";

async function unavailableUnlessRecentlyAvailable(
  pool: Pool,
  chainId: number,
  observedAt: Date
) {
  await pool.query(
    `INSERT INTO yunipals_market.checkpoint(source,chain_id,name,state,checked_at,last_error_code)
    VALUES('chain',$1,'opensea-order-worker','unavailable',$2,'opensea_read_health_unavailable')
    ON CONFLICT(source,chain_id,name) DO UPDATE SET state='unavailable',checked_at=EXCLUDED.checked_at,
      last_error_code=EXCLUDED.last_error_code,generation=yunipals_market.checkpoint.generation+1
    WHERE (yunipals_market.checkpoint.checked_at IS NULL OR yunipals_market.checkpoint.checked_at<=EXCLUDED.checked_at)
      AND NOT (yunipals_market.checkpoint.state='available'
        AND yunipals_market.checkpoint.last_error_code IS NULL
        AND yunipals_market.checkpoint.checked_at>EXCLUDED.checked_at-interval '180 seconds')`,
    [chainId, observedAt]
  );
}

// Frequent health uses one current/finalized head observation. The deeper
// runtime, policy, indexer and canonical checks remain on a slower cadence.
export async function observeOpenSeaHeadHealth(
  pool: Pool,
  client: PublicClient,
  chain: OpenSeaChain,
  now: () => number = Date.now,
  finality: "confirmations" | "finalized" = "confirmations"
) {
  const chainId = marketplaceChains[chain].chainId;
  const startedAt = new Date(now());
  try {
    const head = await readOpenSeaHead(client, chain, now, finality);
    await pool.query(
      `INSERT INTO yunipals_market.checkpoint
      (source,chain_id,name,block_number,block_hash,state,progress_at,checked_at)
      VALUES('chain',$1,'opensea-order-worker',$2,$3,'available',$4,$5)
      ON CONFLICT(source,chain_id,name) DO UPDATE SET block_number=EXCLUDED.block_number,
        block_hash=EXCLUDED.block_hash,state='available',progress_at=EXCLUDED.progress_at,
        checked_at=EXCLUDED.checked_at,last_error_code=NULL,generation=yunipals_market.checkpoint.generation+1
      WHERE yunipals_market.checkpoint.checked_at IS NULL OR yunipals_market.checkpoint.checked_at<=EXCLUDED.checked_at`,
      [
        chainId,
        head.number.toString(),
        head.hash.toLowerCase(),
        new Date(Number(head.timestamp) * 1000),
        startedAt
      ]
    );
    return true;
  } catch (error) {
    if (rpcComputeBudgetError(error)) throw error;
    // A single paced public RPC request can fail even while the last canonical
    // observation is still current. Preserve that bounded evidence and let its
    // normal two-minute freshness limit fail closed if no later probe succeeds.
    await unavailableUnlessRecentlyAvailable(pool, chainId, startedAt);
    return false;
  }
}

// This proves current RPC, provider policy and Ponder checkpoint connectivity.
// Individual order eligibility and complete provider scans are separate checks.
export async function observeOpenSeaReadHealth(
  pool: Pool,
  client: PublicClient,
  chain: OpenSeaChain,
  policies: Pick<OpenSeaPolicyResolver, "resolve">,
  now: () => number = Date.now,
  finality: "confirmations" | "finalized" = "confirmations"
) {
  const chainId = marketplaceChains[chain].chainId;
  const startedAt = new Date(now());
  try {
    const policy = await policies.resolve(chain);
    if (
      policy.collectionSlug !== marketplaceChains[chain].collectionSlug ||
      policy.policy.chain !== chain
    )
      throw new Error();
    const indexed = (
      await pool.query<{
        checkpoint: string;
        version: string;
        ready: string;
        heartbeat: string;
      }>(
        `SELECT c.latest_checkpoint AS checkpoint,m.value->>'version' AS version,
      m.value->>'is_ready' AS ready,m.value->>'heartbeat_at' AS heartbeat
      FROM yunipals_indexer_v3._ponder_checkpoint c CROSS JOIN yunipals_indexer_v3._ponder_meta m
      WHERE c.chain_id=$1 AND m.key='app'`,
        [chainId]
      )
    ).rows[0];
    if (
      !indexed ||
      indexed.version !== "6" ||
      indexed.ready !== "1" ||
      !/^[0-9]{75}$/.test(indexed.checkpoint) ||
      BigInt(indexed.checkpoint.slice(10, 26)) !== BigInt(chainId) ||
      !Number.isSafeInteger(Number(indexed.heartbeat))
    )
      throw new Error();
    const number = BigInt(indexed.checkpoint.slice(26, 42));
    const timestamp = BigInt(indexed.checkpoint.slice(0, 10));
    // Capture the indexer boundary before reading the chain. Reading it after
    // paced RPC calls can compare a newly indexed block with an older head and
    // reject healthy progress. Canonical hash and freshness checks still apply.
    const head = await readOpenSeaHead(client, chain, now, finality);
    if (
      number > head.number ||
      timestamp > head.timestamp ||
      (head.timestamp - timestamp) * 1000n > 60000n ||
      Number(indexed.heartbeat) > now() + 30000 ||
      now() - Number(indexed.heartbeat) > 60000 ||
      policy.policy.expiresAt <= BigInt(Math.floor(now() / 1000))
    )
      throw new Error();
    const [block, code] = await Promise.all([
      client.getBlock({ blockNumber: number }),
      client.getCode({
        address: seaportDeployment.address,
        blockNumber: head.number
      })
    ]);
    assertOpenSeaRuntimeCode(chain, code);
    if (!block.hash || block.timestamp !== timestamp) throw new Error();
    const previous = (
      await pool.query<{
        block_number: string | null;
        block_hash: string | null;
      }>(
        `SELECT block_number::text,block_hash FROM yunipals_market.checkpoint
      WHERE source='chain' AND chain_id=$1 AND name='opensea-order-worker'`,
        [chainId]
      )
    ).rows[0];
    let reorg = false;
    if (previous?.block_number && previous.block_hash) {
      const anchor = await client.getBlock({
        blockNumber: BigInt(previous.block_number)
      });
      reorg = anchor.hash?.toLowerCase() !== previous.block_hash;
    }
    // The production free-first proxy paces deep health across independent
    // public endpoints. Keep the same bounded observation window used by
    // admission while the final canonical hash checks still fail closed.
    await assertOpenSeaObservationCurrent(client, head, now, 30000);
    await transaction(pool, async (db) => {
      for (const [source, height, hash, progress] of [
        [
          "chain",
          head.number,
          head.hash,
          new Date(Number(head.timestamp) * 1000)
        ],
        ["indexer", number, block.hash, new Date(Number(timestamp) * 1000)]
      ] as const)
        await db.query(
          `INSERT INTO yunipals_market.checkpoint
        (source,chain_id,name,block_number,block_hash,state,progress_at,checked_at)
        VALUES($1,$2,'opensea-order-worker',$3,$4,'available',$5,$6)
        ON CONFLICT(source,chain_id,name) DO UPDATE SET block_number=EXCLUDED.block_number,
          block_hash=EXCLUDED.block_hash,state='available',progress_at=EXCLUDED.progress_at,
          checked_at=EXCLUDED.checked_at,last_error_code=NULL,generation=yunipals_market.checkpoint.generation+1
        WHERE yunipals_market.checkpoint.checked_at IS NULL OR yunipals_market.checkpoint.checked_at<=EXCLUDED.checked_at`,
          [
            source,
            chainId,
            String(height),
            hash.toLowerCase(),
            progress,
            startedAt
          ]
        );
      if (reorg)
        await db.query(
          `INSERT INTO yunipals_market.checkpoint
        (source,chain_id,name,block_number,block_hash,state,checked_at)
        VALUES('chain',$1,'opensea-read-reorg',$2,$3,'syncing',$4)
        ON CONFLICT(source,chain_id,name) DO UPDATE SET block_number=EXCLUDED.block_number,
          block_hash=EXCLUDED.block_hash,checked_at=EXCLUDED.checked_at,generation=yunipals_market.checkpoint.generation+1
        WHERE yunipals_market.checkpoint.checked_at<=EXCLUDED.checked_at`,
          [
            chainId,
            String(head.number),
            head.hash.toLowerCase(),
            new Date(now())
          ]
        );
    });
    return true;
  } catch (error) {
    if (rpcComputeBudgetError(error)) throw error;
    await unavailableUnlessRecentlyAvailable(pool, chainId, startedAt);
    return false;
  }
}
