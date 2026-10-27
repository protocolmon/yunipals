import type { Pool, PoolClient } from "pg";
import {
  decodeEventLog,
  getAddress,
  keccak256,
  type Hex,
  type PublicClient
} from "viem";
import {
  decodeValidatedPublication,
  supportedValidatedPublication,
  validatedComponentsAtCounter,
  type ValidatedPublication
} from "@protopals/yunipals-market-core/bnbDiscovery";
import {
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import { seaportReadAbi } from "@protopals/yunipals-market-core/seaport";
import { seaportEventAbi } from "@protopals/yunipals-market-core/seaportEvents";
import { encodeSeaportOrder } from "@protopals/yunipals-market-core/seaportWire";
import { manifestDigest } from "@protopals/yunipals-indexer-server/identity";
import {
  CanonicalCursorInvalidated,
  CanonicalSourceUnavailable,
  type IndexerReader
} from "@protopals/yunipals-indexer-server/readers";

import {
  bnbDiscoveryPolicyFingerprint,
  type BnbDiscoveryPassResult,
  observeDiscoveredBnbOrders,
  parameterJson,
  rollingBoundary
} from "@/bnb/discovery";
import type { BnbPolicy } from "@/bnb/orders";
import { seaportCodeHash } from "@/bnb/protocol";
import { transaction } from "@/db/pool";

export type SharedBnbCursor = NonNullable<
  NonNullable<Parameters<IndexerReader["page"]>[2]>["cursor"]
>;
export type SharedBnbEvent = Awaited<
  ReturnType<IndexerReader["page"]>
>["events"][number];
const consumer = "bnb-discovery";
const sourceId = "marketplace:bnb:seaport";
const finalizedPolicy = { kind: "finalized" } as const;
const protocol = seaportDeployment.address.toLowerCase();
const collection = marketplaceChains.bnb.contractAddress.toLowerCase();
const maxDuration = 2_592_000n;
const lockNamespace = 561609;
const lockId = 1;

type ConsumerRow = {
  chain_id: number;
  release_id: string;
  source_id: string;
  confirmation_policy: unknown;
  configuration_hash: string;
  cursor: SharedBnbCursor | null;
  generation: string;
};

type DiscoveryCursor = {
  launch_block: string;
  next_block: string;
  policy_fingerprint: string;
  reader_mode: string;
  updated_at: Date;
};

/** Owner registration and the worker use this same policy/configuration identity. */
export function sharedBnbDiscoveryConfiguration(
  reader: Pick<IndexerReader, "release">,
  policy: BnbPolicy,
  launchBlock: bigint
) {
  const source = reader.release.manifest.sources.find(
    (row) => row.id === sourceId
  );
  if (
    launchBlock < 1n ||
    launchBlock > BigInt(Number.MAX_SAFE_INTEGER) ||
    !source?.enabled ||
    source.chainId !== 56 ||
    source.feature !== "marketplace" ||
    source.address !== protocol ||
    source.abiHash !== manifestDigest(seaportEventAbi) ||
    source.startBlock === null ||
    BigInt(source.startBlock) > launchBlock ||
    source.endBlock !== null ||
    source.receiptRequirement !== "full" ||
    !source.policies.some((item) => item.kind === "finalized") ||
    !["OrderValidated", "CounterIncremented"].every((name) =>
      source.events.includes(name)
    )
  )
    throw new CanonicalSourceUnavailable(
      "BNB discovery source differs from its registered decoder or launch boundary."
    );
  const policyFingerprint = bnbDiscoveryPolicyFingerprint(policy);
  return {
    consumer,
    chainId: 56,
    sourceId,
    confirmationPolicy: finalizedPolicy,
    policyFingerprint,
    configurationHash: manifestDigest({
      version: 1,
      consumer,
      sourceId,
      chainId: 56,
      address: source.address,
      abiHash: source.abiHash,
      startBlock: source.startBlock,
      launchBlock: launchBlock.toString(),
      confirmationPolicy: finalizedPolicy,
      policyFingerprint
    })
  };
}

function checkedEvent(event: SharedBnbEvent, abiHash: string) {
  if (
    event.sourceId !== sourceId ||
    event.chainId !== 56 ||
    event.address !== protocol ||
    event.abiHash !== abiHash ||
    !/^0x[0-9a-f]{64}$/.test(event.blockHash) ||
    !/^0x[0-9a-f]{64}$/.test(event.transactionHash) ||
    !/^(0|[1-9][0-9]*)$/.test(event.blockNumber) ||
    !/^(0|[1-9][0-9]*)$/.test(event.timestamp) ||
    !Number.isSafeInteger(event.transactionIndex) ||
    event.transactionIndex < 0 ||
    !Number.isSafeInteger(event.logIndex) ||
    event.logIndex < 0 ||
    event.data.length > 262_146 ||
    !/^0x(?:[0-9a-f]{2})*$/.test(event.data) ||
    !event.topics.length ||
    event.topics.length > 4 ||
    event.topics.some((topic) => !/^0x[0-9a-f]{64}$/.test(topic))
  )
    throw new Error("Malformed shared BNB publication event.");
  const decoded = decodeEventLog({
    abi: seaportEventAbi,
    data: event.data as Hex,
    topics: event.topics as [Hex, ...Hex[]],
    strict: true
  });
  if (decoded.eventName !== event.name)
    throw new Error("Shared BNB event name differs from its ABI payload.");
  return decoded;
}

function initialCursor(
  reader: IndexerReader,
  completed: SharedBnbCursor["completed"]
): SharedBnbCursor {
  return {
    version: 1,
    releaseId: reader.release.id,
    sourceId,
    policy: "finalized",
    completed,
    target: null,
    after: null
  };
}

async function requireReady(reader: IndexerReader) {
  const status = await reader.status(sourceId, finalizedPolicy);
  if (
    !["ready", "catching_up"].includes(status.readiness.reason) ||
    !status.anchor
  )
    throw new CanonicalSourceUnavailable(
      "BNB discovery shared source is unavailable."
    );
  return status;
}

/** At most one block of indexed counter events; there is no RPC log fallback. */
async function blockCounterEvents(
  reader: IndexerReader,
  stateClient: PublicClient,
  event: SharedBnbEvent,
  limit: number
) {
  const number = BigInt(event.blockNumber);
  const prior = await stateClient.getBlock({ blockNumber: number - 1n });
  if (!prior.hash) throw new Error("Missing BNB publication predecessor.");
  let cursor: SharedBnbCursor = {
    ...initialCursor(reader, {
      number: prior.number.toString(),
      hash: prior.hash.toLowerCase()
    }),
    target: { number: event.blockNumber, hash: event.blockHash }
  };
  const increments: SharedBnbEvent[] = [];
  // A publication block is bounded independently of the steady-state page limit.
  // Reject pathological blocks rather than silently dropping preceding increments.
  for (let pages = 0; pages < 100; pages++) {
    const page = await reader.page(sourceId, finalizedPolicy, {
      cursor,
      limit,
      includeReceipts: false,
      verifyOldAnchor: async (anchor, chainId) =>
        chainId === 56 &&
        (
          await stateClient.getBlock({ blockNumber: BigInt(anchor.number) })
        ).hash?.toLowerCase() === anchor.hash
    });
    for (const row of page.events) {
      if (
        row.blockNumber !== event.blockNumber ||
        row.blockHash !== event.blockHash
      )
        throw new Error("Shared counter block differs from its publication.");
      checkedEvent(row, event.abiHash);
      if (row.name === "CounterIncremented") increments.push(row);
    }
    if (increments.length > 1000)
      throw new Error("Too many BNB counter events in a publication block.");
    if (page.complete) return increments;
    if (JSON.stringify(page.cursor) === JSON.stringify(cursor))
      throw new CanonicalSourceUnavailable(
        "BNB publication counter page did not advance."
      );
    cursor = page.cursor;
  }
  throw new Error("BNB publication block exceeds the indexed event budget.");
}

export async function reconstructSharedPublishedComponents(
  publication: ValidatedPublication,
  event: SharedBnbEvent,
  stateClient: PublicClient,
  increments: () => Promise<readonly SharedBnbEvent[]>
) {
  const maker = getAddress(publication.parameters.offerer);
  let counter = await stateClient.readContract({
    address: seaportDeployment.address,
    abi: seaportReadAbi,
    functionName: "getCounter",
    args: [maker],
    blockNumber: BigInt(event.blockNumber)
  });
  let components = validatedComponentsAtCounter(publication, counter);
  if (components) return { counter, components };
  counter = await stateClient.readContract({
    address: seaportDeployment.address,
    abi: seaportReadAbi,
    functionName: "getCounter",
    args: [maker],
    blockNumber: BigInt(event.blockNumber) - 1n
  });
  let latestIndex = -1;
  for (const increment of await increments()) {
    const decoded = checkedEvent(increment, event.abiHash);
    if (
      decoded.eventName !== "CounterIncremented" ||
      increment.blockNumber !== event.blockNumber ||
      increment.blockHash !== event.blockHash
    )
      throw new Error("Malformed indexed BNB counter event.");
    if (
      getAddress(decoded.args.offerer) === maker &&
      increment.logIndex < event.logIndex &&
      increment.logIndex > latestIndex
    ) {
      counter = decoded.args.newCounter;
      latestIndex = increment.logIndex;
    }
  }
  components = validatedComponentsAtCounter(publication, counter);
  if (!components)
    throw new Error("BNB publication counter does not match its order hash.");
  return { counter, components };
}

export type SharedBnbDiscoveryOptions = {
  pool: Pool;
  reader: IndexerReader;
  stateClient: PublicClient;
  policy: BnbPolicy;
  launchBlock: bigint;
  pageSize?: number;
  maxPages?: number;
};

async function assertSelected(db: Pick<PoolClient, "query">) {
  const result = await db.query<{ reader_mode: string }>(
    "SELECT reader_mode FROM yunipals_market.bnb_discovery_cursor WHERE singleton"
  );
  if (result.rows[0]?.reader_mode !== "unified")
    throw new Error("The shared BNB discovery consumer is not selected.");
}

async function advanceConsumer(
  db: PoolClient,
  generation: string,
  cursor: SharedBnbCursor,
  nextBlock: bigint,
  hash: string | null,
  targetBlock: bigint,
  errorCode: string | null = null
) {
  await assertSelected(db);
  const updated = await db.query(
    `UPDATE yunipals_market.shared_indexer_consumer
     SET cursor=$2::jsonb,generation=generation+1,updated_at=clock_timestamp()
     WHERE consumer=$1 AND generation=$3::bigint`,
    [consumer, JSON.stringify(cursor), generation]
  );
  if (updated.rowCount !== 1)
    throw new Error("Shared BNB discovery cursor changed concurrently.");
  const status = await db.query(
    `UPDATE yunipals_market.bnb_discovery_cursor SET next_block=$1,
      scanned_block_hash=$2,target_block=$3,last_error_code=$4,updated_at=clock_timestamp()
     WHERE singleton AND reader_mode='unified'`,
    [nextBlock.toString(), hash, targetBlock.toString(), errorCode]
  );
  if (status.rowCount !== 1)
    throw new Error("Shared BNB discovery selection changed.");
}

/** A policy-qualified DB consumer. The only RPC calls are bounded historical
 * points/runtime proofs and the existing order-state reconciliation reads. */
export async function runSharedBnbDiscoveryPass(
  options: SharedBnbDiscoveryOptions
): Promise<BnbDiscoveryPassResult> {
  const { pool, reader, stateClient, policy, launchBlock } = options;
  const configuration = sharedBnbDiscoveryConfiguration(
    reader,
    policy,
    launchBlock
  );
  const limit = options.pageSize ?? 250;
  const maxPages = options.maxPages ?? 4;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 1000 ||
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > 100
  )
    throw new Error("Invalid shared BNB discovery batch limit.");
  const holder = await pool.connect();
  let locked = false;
  try {
    const lock = await holder.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1,$2) AS locked",
      [lockNamespace, lockId]
    );
    locked = lock.rows[0]?.locked === true;
    if (!locked) return { locked: false, scanned: 0, observed: 0 };
    await assertSelected(holder);
    const selected = await holder.query<ConsumerRow>(
      `SELECT chain_id,release_id,source_id,confirmation_policy,configuration_hash,cursor,
       generation::text FROM yunipals_market.shared_indexer_consumer WHERE consumer=$1`,
      [consumer]
    );
    const registration = selected.rows[0];
    if (
      !registration ||
      registration.chain_id !== 56 ||
      registration.release_id !== reader.release.id ||
      registration.source_id !== sourceId ||
      registration.configuration_hash !== configuration.configurationHash ||
      manifestDigest(registration.confirmation_policy) !==
        manifestDigest(finalizedPolicy)
    )
      throw new Error(
        "Shared BNB discovery registration differs from the worker configuration."
      );
    const legacy = await holder.query<DiscoveryCursor>(
      `SELECT launch_block::text,next_block::text,policy_fingerprint,reader_mode,updated_at
       FROM yunipals_market.bnb_discovery_cursor WHERE singleton`
    );
    const discovery = legacy.rows[0]!;
    if (
      BigInt(discovery.launch_block) !== launchBlock ||
      discovery.policy_fingerprint !== configuration.policyFingerprint
    )
      throw new Error(
        "BNB discovery launch block or policy differs from registered state."
      );
    const sourceStatus = await requireReady(reader);
    const finalized = await stateClient.getBlock({ blockTag: "finalized" });
    const now = BigInt(Date.now());
    if (
      (await stateClient.getChainId()) !== 56 ||
      !finalized.hash ||
      finalized.timestamp * 1000n > now + 30_000n ||
      now - finalized.timestamp * 1000n > 360_000n ||
      BigInt(sourceStatus.anchor!.number) > finalized.number
    )
      throw new Error("BNB discovery finality is unavailable.");
    const runtime = await stateClient.getCode({
      address: seaportDeployment.address,
      blockNumber: finalized.number
    });
    if (!runtime || keccak256(runtime) !== seaportCodeHash)
      throw new Error("BNB discovery Seaport deployment mismatch.");
    const indexedAnchor = await stateClient.getBlock({
      blockNumber: BigInt(sourceStatus.anchor!.number)
    });
    if (indexedAnchor.hash?.toLowerCase() !== sourceStatus.anchor!.hash)
      throw new Error("Shared BNB discovery anchor differs from the chain.");

    let cursor = registration.cursor;
    let generation = registration.generation;
    let nextBlock = BigInt(discovery.next_block);
    const verifyOldAnchor = async (
      anchor: { number: string; hash: string },
      chainId: number
    ) =>
      chainId === 56 &&
      (
        await stateClient.getBlock({ blockNumber: BigInt(anchor.number) })
      ).hash?.toLowerCase() === anchor.hash;
    const reset = async (reason: string | null) => {
      const boundary = await rollingBoundary(
        stateClient,
        finalized.number,
        finalized.timestamp > maxDuration
          ? finalized.timestamp - maxDuration
          : 0n
      );
      const start = boundary > launchBlock ? boundary : launchBlock;
      const prior = await stateClient.getBlock({ blockNumber: start - 1n });
      if (!prior.hash)
        throw new Error("Missing shared BNB discovery launch predecessor.");
      const replacement = initialCursor(reader, {
        number: prior.number.toString(),
        hash: prior.hash.toLowerCase()
      });
      await transaction(pool, async (db) => {
        await db.query("DELETE FROM yunipals_market.bnb_discovered_order");
        await advanceConsumer(
          db,
          generation,
          replacement,
          start,
          prior.hash!.toLowerCase(),
          finalized.number,
          reason
        );
      });
      generation = (BigInt(generation) + 1n).toString();
      cursor = replacement;
      nextBlock = start;
    };
    if (
      !cursor ||
      Date.now() - discovery.updated_at.getTime() >= 30 * 86400_000
    )
      await reset(null);
    let scanned = 0;
    let resetAfterReorg = false;
    const counterBlocks = new Map<string, Promise<SharedBnbEvent[]>>();
    while (scanned < maxPages) {
      let page: Awaited<ReturnType<IndexerReader["page"]>>;
      try {
        page = await reader.page(sourceId, finalizedPolicy, {
          cursor,
          limit,
          includeReceipts: false,
          verifyOldAnchor
        });
      } catch (error) {
        if (!(error instanceof CanonicalCursorInvalidated) || resetAfterReorg)
          throw error;
        await reset("reorg_rebuild");
        resetAfterReorg = true;
        continue;
      }
      const publications: Array<{
        event: SharedBnbEvent;
        publication: ValidatedPublication;
        summary: NonNullable<ReturnType<typeof supportedValidatedPublication>>;
        published: Awaited<
          ReturnType<typeof reconstructSharedPublishedComponents>
        >;
      }> = [];
      for (const event of page.events) {
        checkedEvent(event, manifestDigest(seaportEventAbi));
        if (
          event.name !== "OrderValidated" ||
          BigInt(event.blockNumber) < launchBlock
        )
          continue;
        const publication = decodeValidatedPublication({
          topics: event.topics as readonly Hex[],
          data: event.data as Hex
        });
        const item =
          publication.parameters.offer[0]?.itemType === 2
            ? publication.parameters.offer[0]
            : publication.parameters.consideration[0];
        if (
          item?.itemType !== 2 ||
          getAddress(item.token).toLowerCase() !== collection
        )
          continue;
        const summary = supportedValidatedPublication(
          publication,
          BigInt(event.timestamp),
          policy.rules
        );
        if (!summary) continue;
        const point = await stateClient.getBlock({
          blockNumber: BigInt(event.blockNumber)
        });
        if (
          point.hash?.toLowerCase() !== event.blockHash ||
          point.timestamp.toString() !== event.timestamp
        )
          throw new Error("Shared BNB publication block changed.");
        const published = await reconstructSharedPublishedComponents(
          publication,
          event,
          stateClient,
          () => {
            const key = `${event.blockNumber}:${event.blockHash}`;
            let pending = counterBlocks.get(key);
            if (!pending) {
              pending = blockCounterEvents(reader, stateClient, event, limit);
              counterBlocks.set(key, pending);
            }
            return pending;
          }
        );
        publications.push({ event, publication, summary, published });
      }
      const currentStatus = await requireReady(reader);
      if (
        page.cursor.completed &&
        BigInt(page.cursor.completed.number) >
          BigInt(currentStatus.anchor!.number)
      )
        throw new CanonicalSourceUnavailable(
          "Shared BNB discovery is recovering previously applied coverage."
        );
      // Historical points close races while the shared ledger supplies coverage.
      for (const anchor of [page.cursor.completed, page.cursor.target]) {
        if (anchor && !(await verifyOldAnchor(anchor, 56)))
          throw new CanonicalCursorInvalidated(
            "Shared BNB page anchor changed before commit."
          );
      }
      const completed = page.cursor.completed;
      nextBlock = completed ? BigInt(completed.number) + 1n : launchBlock;
      await transaction(pool, async (db) => {
        for (const { event, publication, summary, published } of publications)
          await db.query(
            `INSERT INTO yunipals_market.bnb_discovered_order
             (protocol_address,order_hash,contract_address,token_id,maker,side,currency,
              gross_amount,start_time,end_time,parameters,publication_block,
              publication_hash,publication_tx,publication_log_index,publication_time,
              publication_transaction_index,published_counter,published_components)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)
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
              event.blockNumber,
              event.blockHash,
              event.transactionHash,
              event.logIndex,
              event.timestamp,
              event.transactionIndex,
              published.counter.toString(),
              JSON.stringify(encodeSeaportOrder(published.components))
            ]
          );
        await advanceConsumer(
          db,
          generation,
          page.cursor,
          nextBlock,
          completed?.hash ?? null,
          finalized.number
        );
      });
      generation = (BigInt(generation) + 1n).toString();
      cursor = page.cursor;
      scanned++;
      if (page.complete) break;
    }
    await requireReady(reader);
    const observation = await observeDiscoveredBnbOrders(
      pool,
      stateClient,
      policy,
      {
        number: finalized.number,
        hash: finalized.hash,
        timestamp: finalized.timestamp
      },
      nextBlock,
      async () => {
        await assertSelected(holder);
        const status = await requireReady(reader);
        if (
          cursor?.completed &&
          BigInt(cursor.completed.number) > BigInt(status.anchor!.number)
        )
          throw new CanonicalSourceUnavailable(
            "Shared BNB discovery is recovering previously applied coverage."
          );
        // Confirm the saved event/anchor remains canonical after order-status RPC.
        await reader.page(sourceId, finalizedPolicy, {
          cursor,
          limit: 1,
          includeReceipts: false,
          verifyOldAnchor
        });
      }
    );
    return {
      locked: true,
      scanned,
      lagBlocks:
        finalized.number >= nextBlock
          ? (finalized.number - nextBlock + 1n).toString()
          : "0",
      ...observation
    };
  } catch (error) {
    if (locked) {
      try {
        await holder.query(`UPDATE yunipals_market.bnb_discovery_cursor SET
          last_error_code='discovery_pass_failed' WHERE singleton AND reader_mode='unified'`);
      } catch {
        /* Retain the original failure. */
      }
    }
    throw error;
  } finally {
    if (locked)
      await holder.query("SELECT pg_advisory_unlock($1,$2)", [
        lockNamespace,
        lockId
      ]);
    holder.release();
  }
}
