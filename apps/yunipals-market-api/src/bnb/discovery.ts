import type { Pool } from "pg";
import {
  decodeEventLog,
  getAddress,
  keccak256,
  toHex,
  type Hex,
  type PublicClient
} from "viem";
import {
  decodeValidatedPublication,
  observeValidatedPublication,
  supportedValidatedPublication,
  validatedComponentsAtCounter,
  type ValidatedOrderParameters,
  type ValidatedPublication
} from "@protopals/yunipals-market-core/bnbDiscovery";
import { marketplaceChains, seaportDeployment } from "@protopals/yunipals-market-core/registry";
import { seaportReadAbi } from "@protopals/yunipals-market-core/seaport";
import { seaportEventAbi } from "@protopals/yunipals-market-core/seaportEvents";
import {
  decodeSeaportOrder,
  encodeSeaportOrder
} from "@protopals/yunipals-market-core/seaportWire";

import type { BnbPolicy } from "@/bnb/orders";
import { bindDiscoveredBnbLifecycles } from "@/bnb/discoveryLifecycle";
import { seaportCodeHash } from "@/bnb/protocol";
import { transaction } from "@/db/pool";

const publicationEvent = seaportEventAbi.find(
  (item) => item.type === "event" && item.name === "OrderValidated"
);
if (!publicationEvent || publicationEvent.type !== "event")
  throw new Error("Missing Seaport validation event.");
const counterEvent = seaportEventAbi.find(
  (item) => item.type === "event" && item.name === "CounterIncremented"
);
if (!counterEvent || counterEvent.type !== "event")
  throw new Error("Missing Seaport counter event.");

const protocol = seaportDeployment.address.toLowerCase();
const collection = marketplaceChains.bnb.contractAddress.toLowerCase();
const maxDuration = 2_592_000n;
const lockNamespace = 561609;
const lockId = 1;

type PublicationRow = {
  order_hash: Hex;
  parameters: unknown;
  maker: string;
  end_time: string;
};

function parameterJson(parameters: ValidatedOrderParameters) {
  const { counter: _counter, ...wire } = encodeSeaportOrder({
    ...parameters,
    counter: 0n
  });
  return {
    ...wire,
    totalOriginalConsiderationItems:
      parameters.totalOriginalConsiderationItems.toString()
  };
}

function storedParameters(value: unknown): ValidatedOrderParameters {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid stored publication.");
  const record = value as Record<string, unknown>;
  const original = record.totalOriginalConsiderationItems;
  if (typeof original !== "string" || !/^(0|[1-9][0-9]*)$/.test(original))
    throw new Error("Invalid original consideration count.");
  const { totalOriginalConsiderationItems: _count, ...withoutCount } = record;
  const { counter: _counter, ...parameters } = decodeSeaportOrder({
    ...withoutCount,
    counter: "0"
  });
  return { ...parameters, totalOriginalConsiderationItems: BigInt(original) };
}

async function rollingBoundary(client: PublicClient, head: bigint, time: bigint) {
  const earliest = await client.getBlock({ blockNumber: 0n });
  if (earliest.timestamp > time) return 0n;
  let low = 0n;
  let high = head;
  while (low < high) {
    const middle = (low + high) / 2n;
    const block = await client.getBlock({ blockNumber: middle });
    if (block.timestamp < time) low = middle + 1n;
    else high = middle;
  }
  return low;
}

export type BnbDiscoveryOptions = {
  pool: Pool;
  logClient: PublicClient;
  stateClient: PublicClient;
  policy: BnbPolicy;
  launchBlock: bigint;
  maxRange?: bigint;
  maxChunks?: number;
};

async function readLogs(
  client: PublicClient,
  fromBlock: bigint,
  toBlock: bigint
): Promise<{
  logs: Awaited<ReturnType<PublicClient["getLogs"]>>;
  toBlock: bigint;
}> {
  let end = toBlock;
  while (true) {
    try {
      const logs = await client.getLogs({
        address: seaportDeployment.address,
        event: publicationEvent,
        fromBlock,
        toBlock: end
      });
      if (logs.length > 5000) throw new Error("Log response too large.");
      return { logs, toBlock: end };
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (
        fromBlock === end ||
        /429|rate limit|too many requests|compute budget/.test(message) ||
        !/(block range|range limit|too many results|response too large|result too large|log response too large)/.test(
          message
        )
      )
        throw error;
      end = (fromBlock + end) / 2n;
    }
  }
}

export async function reconstructPublishedComponents(
  publication: ValidatedPublication,
  log: { blockNumber: bigint; blockHash: Hex; logIndex: number },
  logClient: PublicClient,
  stateClient: PublicClient
) {
  const maker = getAddress(publication.parameters.offerer);
  let counter = await stateClient.readContract({
    address: seaportDeployment.address,
    abi: seaportReadAbi,
    functionName: "getCounter",
    args: [maker],
    blockNumber: log.blockNumber
  });
  let components = validatedComponentsAtCounter(publication, counter);
  if (components) return { counter, components };

  // The maker may have incremented the counter later in the same block.
  // Reconstruct its value at this event rather than using block-end state.
  counter = await stateClient.readContract({
    address: seaportDeployment.address,
    abi: seaportReadAbi,
    functionName: "getCounter",
    args: [maker],
    blockNumber: log.blockNumber - 1n
  });
  const increments = await logClient.getLogs({
    address: seaportDeployment.address,
    event: counterEvent,
    args: { offerer: maker },
    fromBlock: log.blockNumber,
    toBlock: log.blockNumber
  });
  if (increments.length > 1000)
    throw new Error("Too many BNB counter events in a publication block.");
  let latestIndex = -1;
  for (const increment of increments) {
    if (
      increment.blockHash?.toLowerCase() !== log.blockHash.toLowerCase() ||
      increment.logIndex === null
    )
      throw new Error("Malformed BNB counter event.");
    const event = decodeEventLog({
      abi: seaportEventAbi,
      eventName: "CounterIncremented",
      topics: increment.topics as [Hex, ...Hex[]],
      data: increment.data,
      strict: true
    });
    if (getAddress(event.args.offerer) !== maker)
      throw new Error("Counter event maker mismatch.");
    if (increment.logIndex < log.logIndex && increment.logIndex > latestIndex) {
      counter = event.args.newCounter;
      latestIndex = increment.logIndex;
    }
  }
  components = validatedComponentsAtCounter(publication, counter);
  if (!components)
    throw new Error("BNB publication counter does not match its order hash.");
  return { counter, components };
}

/** A single leased pass; API requests never invoke this function. */
export async function runBnbDiscoveryPass(options: BnbDiscoveryOptions) {
  const { pool, logClient, stateClient, policy, launchBlock } = options;
  const policyFingerprint = keccak256(
    toHex(
      JSON.stringify({
        version: policy.version,
        collection: policy.rules.collection.toLowerCase(),
        offerCurrency: policy.rules.offerCurrency.toLowerCase(),
        fees: policy.rules.fees.map((fee) => ({
          recipient: fee.recipient.toLowerCase(),
          basisPoints: fee.basisPoints
        })),
        maxDurationSeconds: policy.rules.maxDurationSeconds.toString()
      })
    )
  );
  if (launchBlock < 1n || launchBlock > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Configure a positive BNB discovery launch block.");
  const range = options.maxRange ?? 100_000n;
  const maxChunks = options.maxChunks ?? 4;
  if (range < 1n || range > 100_000n || maxChunks < 1 || maxChunks > 100)
    throw new Error("Invalid BNB discovery batch limit.");
  const holder = await pool.connect();
  let locked = false;
  try {
    const acquired = await holder.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1,$2) AS locked",
      [lockNamespace, lockId]
    );
    locked = acquired.rows[0]?.locked === true;
    if (!locked) return { locked: false, scanned: 0, observed: 0 };

    const finalized = await stateClient.getBlock({ blockTag: "finalized" });
    const now = BigInt(Date.now());
    if (
      (await stateClient.getChainId()) !== 56 ||
      !finalized.hash ||
      finalized.timestamp * 1000n > now + 30_000n ||
      now - finalized.timestamp * 1000n > 360_000n
    )
      throw new Error("BNB discovery finality is unavailable.");
    const code = await stateClient.getCode({
      address: seaportDeployment.address,
      blockNumber: finalized.number
    });
    if (!code || keccak256(code) !== seaportCodeHash)
      throw new Error("BNB discovery Seaport deployment mismatch.");

    const cursor = await holder.query<{
      launch_block: string;
      next_block: string;
      scanned_block_hash: Hex | null;
      policy_fingerprint: Hex;
      updated_at: Date;
    }>(
      `SELECT launch_block::text,next_block::text,scanned_block_hash,
       policy_fingerprint,updated_at
       FROM yunipals_market.bnb_discovery_cursor WHERE singleton`
    );
    let stored = cursor.rows[0];
    if (stored && BigInt(stored.launch_block) !== launchBlock)
      throw new Error("BNB discovery launch block differs from stored state.");
    const needsBoundary =
      !stored || stored.policy_fingerprint !== policyFingerprint ||
      Date.now() - stored.updated_at.getTime() >= 30 * 86400_000;
    let start = launchBlock;
    if (needsBoundary) {
      const boundary = await rollingBoundary(
        logClient,
        finalized.number,
        finalized.timestamp > maxDuration
          ? finalized.timestamp - maxDuration
          : 0n
      );
      if (boundary > start) start = boundary;
    }
    if (!stored) {
      await holder.query(
        `INSERT INTO yunipals_market.bnb_discovery_cursor
         (singleton,launch_block,next_block,policy_fingerprint)
         VALUES(true,$1,$2,$3) ON CONFLICT(singleton) DO NOTHING`,
        [launchBlock.toString(), start.toString(), policyFingerprint]
      );
      stored = {
        launch_block: launchBlock.toString(),
        next_block: start.toString(),
        scanned_block_hash: null,
        policy_fingerprint: policyFingerprint,
        updated_at: new Date()
      };
    }
    let nextBlock = BigInt(stored.next_block);
    if (stored.policy_fingerprint !== policyFingerprint) {
      await transaction(pool, async (db) => {
        await db.query("DELETE FROM yunipals_market.bnb_discovered_order");
        await db.query(
          `UPDATE yunipals_market.bnb_discovery_cursor SET policy_fingerprint=$1,
           next_block=$2,scanned_block_hash=NULL,
           last_error_code='policy_rebuild',updated_at=clock_timestamp()
           WHERE singleton`,
          [policyFingerprint, start.toString()]
        );
      });
      nextBlock = start;
      stored.scanned_block_hash = null;
    }
    await holder.query(
      `UPDATE yunipals_market.bnb_discovery_cursor SET target_block=$1 WHERE singleton`,
      [finalized.number.toString()]
    );
    if (nextBlock > launchBlock && stored.scanned_block_hash) {
      const prior = await stateClient.getBlock({ blockNumber: nextBlock - 1n });
      if (prior.hash !== stored.scanned_block_hash) {
        const boundary = await rollingBoundary(
          logClient,
          finalized.number,
          finalized.timestamp > maxDuration
            ? finalized.timestamp - maxDuration
            : 0n
        );
        const rebuildStart = launchBlock > boundary ? launchBlock : boundary;
        await transaction(pool, async (db) => {
          await db.query("DELETE FROM yunipals_market.bnb_discovered_order");
          await db.query(
            `UPDATE yunipals_market.bnb_discovery_cursor SET next_block=$1,
             scanned_block_hash=NULL,last_error_code='reorg_rebuild',
             updated_at=clock_timestamp() WHERE singleton`,
            [rebuildStart.toString()]
          );
        });
        nextBlock = rebuildStart;
      }
    }
    if (nextBlock < start) {
      await transaction(pool, async (db) => {
        await db.query(
          `DELETE FROM yunipals_market.bnb_discovered_order
           WHERE end_time<= $1::numeric`,
          [finalized.timestamp.toString()]
        );
        await db.query(
          `UPDATE yunipals_market.bnb_discovery_cursor SET next_block=$1,
           scanned_block_hash=NULL,updated_at=clock_timestamp() WHERE singleton`,
          [start.toString()]
        );
      });
      nextBlock = start;
    }

    let scanned = 0;
    while (nextBlock <= finalized.number && scanned < maxChunks) {
      let end =
        nextBlock + range - 1n < finalized.number
          ? nextBlock + range - 1n
          : finalized.number;
      const batch = await readLogs(logClient, nextBlock, end);
      end = batch.toBlock;
      const { logs } = batch;
      const publications: Array<{
        log: (typeof logs)[number] & {
          blockNumber: bigint;
          blockHash: Hex;
          transactionHash: Hex;
          transactionIndex: number;
          logIndex: number;
        };
        publication: ValidatedPublication;
        timestamp: bigint;
        summary: NonNullable<ReturnType<typeof supportedValidatedPublication>>;
        published: Awaited<ReturnType<typeof reconstructPublishedComponents>>;
      }> = [];
      const timestamps = new Map<bigint, bigint>();
      for (const log of logs) {
        if (
          getAddress(log.address) !== getAddress(seaportDeployment.address) ||
          !log.blockHash ||
          !log.transactionHash ||
          log.blockNumber === null ||
          log.transactionIndex === null ||
          log.logIndex === null ||
          log.blockNumber < nextBlock ||
          log.blockNumber > end ||
          log.removed === true ||
          log.data.length > 262_146
        )
          throw new Error("Malformed BNB publication log.");
        const publication = decodeValidatedPublication(log);
        const collectionItem =
          publication.parameters.offer[0]?.itemType === 2
            ? publication.parameters.offer[0]
            : publication.parameters.consideration[0];
        if (
          collectionItem?.itemType !== 2 ||
          getAddress(collectionItem.token).toLowerCase() !== collection
        )
          continue;
        let timestamp = timestamps.get(log.blockNumber);
        if (timestamp === undefined) {
          const block = await stateClient.getBlock({
            blockNumber: log.blockNumber
          });
          if (block.hash !== log.blockHash)
            throw new Error("BNB publication block hash changed.");
          timestamp = block.timestamp;
          timestamps.set(log.blockNumber, timestamp);
        }
        const summary = supportedValidatedPublication(
          publication,
          timestamp,
          policy.rules
        );
        if (summary) {
          const published = await reconstructPublishedComponents(
            publication,
            log as { blockNumber: bigint; blockHash: Hex; logIndex: number },
            logClient,
            stateClient
          );
          publications.push({
            log: log as (typeof publications)[number]["log"],
            publication,
            timestamp,
            summary,
            published
          });
        }
      }
      const endBlock = await stateClient.getBlock({ blockNumber: end });
      if (!endBlock.hash) throw new Error("Missing BNB scan anchor.");
      await transaction(pool, async (db) => {
        for (const { log, publication, timestamp, summary, published } of publications) {
          await db.query(
            `INSERT INTO yunipals_market.bnb_discovered_order
             (protocol_address,order_hash,contract_address,token_id,maker,side,currency,
              gross_amount,start_time,end_time,parameters,publication_block,
              publication_hash,publication_tx,publication_log_index,publication_time,
              publication_transaction_index,published_counter,published_components)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,
              $17,$18,$19::jsonb)
             ON CONFLICT(protocol_address,order_hash) DO NOTHING`,
            [
              protocol,
              publication.orderHash.toLowerCase(),
              collection,
              summary.tokenId.toString(),
              summary.maker.toLowerCase(),
              summary.side,
              summary.currency.toLowerCase(),
              summary.grossAmount.toString(),
              publication.parameters.startTime.toString(),
              publication.parameters.endTime.toString(),
              JSON.stringify(parameterJson(publication.parameters)),
              log.blockNumber.toString(),
              log.blockHash.toLowerCase(),
              log.transactionHash.toLowerCase(),
              log.logIndex,
              timestamp.toString(),
              log.transactionIndex,
              published.counter.toString(),
              JSON.stringify(encodeSeaportOrder(published.components))
            ]
          );
        }
        const advanced = await db.query(
          `UPDATE yunipals_market.bnb_discovery_cursor SET next_block=$1,
           scanned_block_hash=$2,updated_at=clock_timestamp(),last_error_code=NULL
           WHERE singleton AND next_block=$3`,
          [(end + 1n).toString(), endBlock.hash.toLowerCase(), nextBlock.toString()]
        );
        if (advanced.rowCount !== 1)
          throw new Error("BNB discovery cursor changed concurrently.");
      });
      nextBlock = end + 1n;
      scanned++;
    }

    const binding = await bindDiscoveredBnbLifecycles(
      pool,
      stateClient,
      policy,
      finalized.number
    );
    const due = await holder.query<PublicationRow>(
      `SELECT order_hash,parameters,maker,end_time::text FROM yunipals_market.bnb_discovered_order
       WHERE state IN ('active','unavailable','inconsistent') AND end_time>$1::numeric
       ORDER BY state_observed_at NULLS FIRST,publication_block,order_hash LIMIT 100`,
      [finalized.timestamp.toString()]
    );
    const counters = new Map<string, bigint>();
    const observations: Array<{
      hash: Hex;
      state: string;
      components: string | null;
    }> = [];
    for (const row of due.rows) {
      let counter = counters.get(row.maker);
      if (counter === undefined) {
        counter = await stateClient.readContract({
          address: seaportDeployment.address,
          abi: seaportReadAbi,
          functionName: "getCounter",
          args: [getAddress(row.maker)],
          blockNumber: finalized.number
        });
        counters.set(row.maker, counter);
      }
      const status = await stateClient.readContract({
        address: seaportDeployment.address,
        abi: seaportReadAbi,
        functionName: "getOrderStatus",
        args: [row.order_hash],
        blockNumber: finalized.number
      });
      const result = observeValidatedPublication(
        { orderHash: row.order_hash, parameters: storedParameters(row.parameters) },
        counter,
        {
          isValidated: status[0],
          isCancelled: status[1],
          totalFilled: status[2],
          totalSize: status[3]
        },
        finalized.timestamp
      );
      observations.push({
        hash: row.order_hash,
        state: result.state,
        components: result.components
          ? JSON.stringify(encodeSeaportOrder(result.components))
          : null
      });
    }
    const anchor = await stateClient.getBlock({
      blockNumber: finalized.number
    });
    if (anchor.hash !== finalized.hash)
      throw new Error("BNB observation anchor changed.");
    await transaction(pool, async (db) => {
      for (const observed of observations)
        await db.query(
          `UPDATE yunipals_market.bnb_discovered_order SET state=$2,
           components=$3::jsonb,state_block=$4,state_hash=$5,
           state_observed_at=clock_timestamp()
           WHERE protocol_address=$1 AND order_hash=$6`,
          [
            protocol,
            observed.state,
            observed.components,
            finalized.number.toString(),
            finalized.hash.toLowerCase(),
            observed.hash.toLowerCase()
          ]
        );
      await db.query(
        `UPDATE yunipals_market.bnb_discovery_cursor SET updated_at=clock_timestamp(),
         last_error_code=NULL WHERE singleton AND next_block=$1`,
        [nextBlock.toString()]
      );
    });
    const health = await holder.query<{
      unbound: string;
      stale_active: string;
      oldest_state_observed_at: Date | null;
    }>(
      `SELECT
         count(*) FILTER (WHERE bound_lifecycle IS NULL)::text AS unbound,
         count(*) FILTER (WHERE state IN ('active','unavailable','inconsistent')
           AND (state_observed_at IS NULL OR state_observed_at<clock_timestamp()-interval '720 seconds'))::text AS stale_active,
         min(state_observed_at) FILTER (WHERE state IN ('active','unavailable','inconsistent')) AS oldest_state_observed_at
       FROM yunipals_market.bnb_discovered_order
       WHERE end_time>extract(epoch FROM clock_timestamp())`
    );
    return {
      locked: true,
      scanned,
      observed: observations.length,
      bound: binding.bound,
      lagBlocks: finalized.number >= nextBlock
        ? (finalized.number - nextBlock + 1n).toString()
        : "0",
      unbound: Number(health.rows[0]?.unbound ?? 0),
      staleActive: Number(health.rows[0]?.stale_active ?? 0),
      oldestStateObservedAt: health.rows[0]?.oldest_state_observed_at?.toISOString() ?? null
    };
  } catch (error) {
    if (locked) {
      try {
        await holder.query(
          `UPDATE yunipals_market.bnb_discovery_cursor
           SET last_error_code='discovery_pass_failed' WHERE singleton`
        );
      } catch {
        // Preserve the original failure; the cursor cannot claim fresh coverage.
      }
    }
    throw error;
  } finally {
    if (locked)
      await holder.query("SELECT pg_advisory_unlock($1,$2)", [lockNamespace, lockId]);
    holder.release();
  }
}
