import { setTimeout as delay } from "node:timers/promises";
import { pool } from "../offchain/db.js";
import { safeErrorMessage } from "../safe-error.js";
import { fetchMetadata } from "../metadata/fetch.js";
import { islandMetadataHosts } from "./metadata.js";
import {
  dueIslandJobs,
  publishIslandMetadata,
  retryIslandMetadata
} from "./publication.js";
import {
  baseReadClient,
  getBaseLogs,
  decodeBaseLog,
  type BaseRpcMetrics
} from "./base-rpc.js";
import {
  applyBaseRange,
  readBaseCursor,
  rewindBaseToFinalized,
  type BaseTransfer,
  type BaseContractEvent
} from "./base-sync.js";
import {
  verifyBaseContract,
  verifyBaseOwnership,
  type BaseBlock
} from "./base-verify.js";
import {
  baseIslandCollection as collection,
  fixedIslandUri,
  airdropDistributionSha256,
  airdropSnapshotBlock,
  airdropSnapshotBlockHash
} from "./collections.js";

function setting(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`invalid_${name}`);
  return value;
}
const rpc = process.env.BASE_ISLANDS_RPC_URL;
if (!rpc)
  throw new Error(
    "BASE_ISLANDS_RPC_URL is required; use the existing budget gateway"
  );
const rpcMetrics: BaseRpcMetrics = {
  startedAtUTC: new Date().toISOString(),
  methods: {},
  responses: {}
};
const client = baseReadClient(rpc, rpcMetrics);
const interval = setting("BASE_ISLANDS_POLL_MS", 60_000, 30_000, 3_600_000);
const maxRange = BigInt(
  setting("BASE_ISLANDS_LOG_BLOCK_RANGE", 100_000, 1, 100_000)
);
const schema = collection.schemaName;
const lock = await pool.connect();
let stopping = false;
const abort = new AbortController();
const stop = () => {
  stopping = true;
  abort.abort();
};
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, stop);
lock.on("error", stop);
const blocks = new Map<
  string,
  { number: bigint; hash: string; timestamp: bigint }
>();
async function block(number: bigint, expectedHash?: string) {
  const cached = expectedHash ? blocks.get(expectedHash) : undefined;
  if (cached && cached.number === number) return cached;
  const value = await client.getBlock({
    blockNumber: number,
    includeTransactions: false
  });
  if (
    value.number === null ||
    !value.hash ||
    (expectedHash && value.hash !== expectedHash)
  )
    throw new Error("base_islands_block_hash_mismatch");
  const result = {
    number: value.number,
    hash: value.hash,
    timestamp: value.timestamp
  };
  blocks.set(result.hash, result);
  if (blocks.size > 2048) blocks.delete(blocks.keys().next().value!);
  return result;
}

async function publishMetadata(finalized: BaseBlock) {
  const jobs = await dueIslandJobs(
    pool,
    schema,
    finalized.number,
    1000,
    collection
  );
  const documents = new Map<string, ReturnType<typeof fetchMetadata>>();
  for (let offset = 0; offset < jobs.length && !stopping; offset += 2) {
    await Promise.all(
      jobs.slice(offset, offset + 2).map(async (job) => {
        const uri = fixedIslandUri(job.tokenId);
        try {
          let document = documents.get(uri);
          if (!document) {
            document = fetchMetadata(uri, {
              maxBytes: 1_048_576,
              allowedHosts: islandMetadataHosts
            });
            documents.set(uri, document);
          }
          await publishIslandMetadata(
            pool,
            schema,
            job,
            {
              uri,
              blockNumber: finalized.number,
              blockHash: finalized.hash,
              metadataStorage: null,
              genesisLimit: 1000n
            },
            (await document).document,
            3600,
            collection
          );
        } catch (error) {
          await retryIslandMetadata(
            pool,
            schema,
            job,
            finalized.number,
            error,
            collection
          );
        }
      })
    );
  }
  return jobs.length;
}

async function scan() {
  const safe = await client.getBlock({
    blockTag: "safe",
    includeTransactions: false
  });
  const finalized = await client.getBlock({
    blockTag: "finalized",
    includeTransactions: false
  });
  if (
    safe.number === null ||
    !safe.hash ||
    finalized.number === null ||
    !finalized.hash ||
    finalized.number > safe.number
  )
    throw new Error("base_islands_safe_or_finalized_head_unavailable");
  const endSafe = { number: safe.number, hash: safe.hash };
  blocks.set(safe.hash, { ...endSafe, timestamp: safe.timestamp });
  blocks.set(finalized.hash, {
    number: finalized.number,
    hash: finalized.hash,
    timestamp: finalized.timestamp
  });
  let cursor = await readBaseCursor(pool);
  if (cursor.lastScannedBlock && cursor.lastScannedHash) {
    const previous = await block(BigInt(cursor.lastScannedBlock));
    if (
      previous.hash !== cursor.lastScannedHash ||
      BigInt(cursor.lastScannedBlock) > safe.number
    ) {
      if (!cursor.finalizedBlock || !cursor.finalizedHash)
        throw new Error("base_islands_reorg_without_finalized_anchor");
      const anchor = await block(BigInt(cursor.finalizedBlock));
      if (anchor.hash !== cursor.finalizedHash)
        throw new Error("base_islands_finalized_anchor_mismatch");
      blocks.clear();
      await rewindBaseToFinalized(pool, anchor);
      cursor = await readBaseCursor(pool);
    }
  }
  while (!stopping && BigInt(cursor.nextBlock) <= safe.number) {
    const from = BigInt(cursor.nextBlock);
    // The gateway's free recent-log provider accepts at most ten blocks.
    // Bootstrap keeps large historical ranges; normal polling uses small free reads.
    const range = cursor.verifiedBlock ? 10n : maxRange;
    const to =
      from + range - 1n < safe.number ? from + range - 1n : safe.number;
    const end = await block(to, to === safe.number ? safe.hash : undefined);
    // Keep the one-time bootstrap tail on the budgeted historical route. The
    // overlap is filtered before applying events; every cursor block is still read.
    const requestFrom =
      !cursor.verifiedBlock && to - from < 32768n
        ? from - 65536n > BigInt(collection.deploymentBlock)
          ? from - 65536n
          : BigInt(collection.deploymentBlock)
        : from;
    const raw = await getBaseLogs(client, requestFrom, to);
    const logs = raw
      .map(decodeBaseLog)
      .filter((log) => log.blockNumber >= from)
      .sort((a, b) =>
        a.blockNumber < b.blockNumber
          ? -1
          : a.blockNumber > b.blockNumber
            ? 1
            : a.transactionIndex - b.transactionIndex || a.logIndex - b.logIndex
      );
    const transfers: BaseTransfer[] = [];
    const events: BaseContractEvent[] = [];
    for (const log of logs) {
      if (log.blockNumber < from || log.blockNumber > to)
        throw new Error("base_islands_log_outside_range");
      const header = await block(log.blockNumber, log.blockHash);
      if (log.eventName === "Transfer")
        transfers.push({
          ...log,
          tokenId: log.args.tokenId!,
          from: log.args.from! as `0x${string}`,
          to: log.args.to! as `0x${string}`,
          blockTimestamp: header.timestamp
        });
      else {
        if (
          log.eventName === "AirdropFinalized" &&
          (log.args.totalSupply !== "898" ||
            log.args.sourceBlockNumber !== String(airdropSnapshotBlock) ||
            log.args.sourceBlockHash !== airdropSnapshotBlockHash ||
            log.args.distributionSha256 !== `0x${airdropDistributionSha256}`)
        )
          throw new Error("base_islands_finalization_proof_mismatch");
        events.push(log);
      }
    }
    const check = await block(to);
    if (check.hash !== end.hash)
      throw new Error("base_islands_range_changed_during_scan");
    await applyBaseRange(pool, from, end, transfers, events);
    console.log("Base Islands range indexed", {
      from: String(from),
      to: String(to),
      transfers: transfers.length,
      events: events.length
    });
    cursor = await readBaseCursor(pool);
  }
  if (stopping) return;
  // Establish a canonical anchor before serving the new collection or advancing its finality proof.
  const finalCheck = await block(finalized.number);
  if (finalCheck.hash !== finalized.hash)
    throw new Error("base_islands_finalized_block_changed");
  await pool.query(
    `UPDATE ${schema}.sync_state SET finalized_block=$1,finalized_hash=$2,
    updated_at=now(),last_error=NULL WHERE singleton`,
    [String(finalized.number), finalized.hash]
  );
  const auditDue = await pool.query<{ due: boolean }>(
    `SELECT verified_at IS NULL OR verified_at<now()-interval '7 days' AS due FROM ${schema}.sync_state WHERE singleton`
  );
  if (!cursor.verifiedBlock || auditDue.rows[0]?.due) {
    console.log(
      "Base Islands ownership verified",
      await verifyBaseOwnership(pool, client, finalCheck)
    );
  }
  await publishMetadata(finalCheck);
  await pool.query(
    `UPDATE ${schema}.sync_state SET ready=verified_block IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM ${schema}.token t LEFT JOIN metadata.island_publication p ON p.collection=t.collection
      AND p.token_id=t.token_id::numeric AND p.lifecycle=t.lifecycle
    WHERE NOT t.burned AND t.mint_block<=$1 AND (p.status IS DISTINCT FROM 'published')),
    completed_at=now(),updated_at=now(),last_error=NULL WHERE singleton`,
    [String(finalized.number)]
  );
}

try {
  const acquired = await lock.query<{ acquired: boolean }>(
    "SELECT pg_try_advisory_lock(hashtext('yunipals:base-islands-writer')) AS acquired"
  );
  if (!acquired.rows[0]?.acquired)
    throw new Error("base_islands_writer_already_running");
  const head = await client.getBlock({
    blockTag: "finalized",
    includeTransactions: false
  });
  if (head.number === null || !head.hash)
    throw new Error("base_islands_finalized_head_unavailable");
  await verifyBaseContract(client, { number: head.number, hash: head.hash });
  while (!stopping) {
    try {
      await scan();
    } catch (error) {
      const detail = safeErrorMessage(error);
      const message =
        /base_islands_[a-z_]+/.exec(detail)?.[0] ??
        (/budget|compute.units/i.test(detail)
          ? "base_islands_rpc_budget_deferred"
          : /request limit|block.range|too.many.results/i.test(detail)
            ? "base_islands_rpc_range_limit"
            : "base_islands_rpc_or_metadata_unavailable");
      await pool.query(
        `UPDATE ${schema}.sync_state SET last_error=$1 WHERE singleton`,
        [message]
      );
      if (
        /mismatch|finalized_anchor|provenance|transfer_before|duplicate_mint/.test(
          message
        )
      )
        await pool.query(
          `UPDATE ${schema}.sync_state SET ready=false WHERE singleton`
        );
      console.error("Base Islands scan deferred", message);
    }
    await pool.query(
      `UPDATE ${schema}.sync_state SET rpc_metrics=$1::jsonb WHERE singleton`,
      [JSON.stringify(rpcMetrics)]
    );
    if (!stopping)
      await delay(interval, undefined, { signal: abort.signal }).catch(
        () => undefined
      );
  }
} finally {
  await lock
    .query(
      "SELECT pg_advisory_unlock(hashtext('yunipals:base-islands-writer'))"
    )
    .catch(() => undefined);
  lock.release();
  await pool.end();
}
