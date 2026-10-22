import type { Pool, PoolClient } from "pg";
import type { SourceDefinition } from "../../yunipals-indexer-client/src/sources.js";
import {
  decodeIndexedActionLog,
  indexedActionAbi,
  indexedActionEventName,
  matchesIndexedAction,
  parseIndexedActionRequest,
  type IndexedActionRequest,
  type IndexedActionEvidence,
  type IndexedActionReason,
  type IndexedActionState,
  type IndexedActionSelection
} from "../../yunipals-market-core/src/indexedAction.js";
import { seaportDeployment } from "../../yunipals-market-core/src/registry.js";
import { seaportRuntimeHashes } from "../../yunipals-market-core/src/seaportRuntime.js";
import { validateTransactionReceipt } from "../../yunipals-market-core/src/receiptEvidence.js";
import { yunipalMonstersAbi } from "../../yunipals-market-core/src/boosterAbi.js";
import { indexerTransaction, sqlIdentifier } from "./database.js";
import { manifestDigest, transactionEvidenceHash } from "./identity.js";
import { parseIndexedEventTopics } from "./event-topics.js";
import {
  loadIndexerRelease,
  readBoundRuntime,
  type RegisteredRelease
} from "./releases.js";
import { readIndexerSourceStatus } from "./status.js";

export type IndexedActionBinding = {
  releaseId: string;
  physicalSchema: string;
  readSchema: string;
};
export type {
  IndexedActionEvidence,
  IndexedActionSelection
} from "../../yunipals-market-core/src/indexedAction.js";

const hash = /^0x[0-9a-f]{64}$/;
const address = /^0x[0-9a-f]{40}$/;
const decimal = /^(0|[1-9][0-9]{0,77})$/;
const maxEvents = 256;
const maxPointBytes = 524_288;
class EvidenceUnavailable extends Error {
  constructor(readonly reason: IndexedActionReason) {
    super(reason);
  }
}
function unavailable(reason: IndexedActionReason): never {
  throw new EvidenceUnavailable(reason);
}
function unsigned(value: unknown): value is string {
  return typeof value === "string" && decimal.test(value);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function normalizedArgs(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint"
        ? item.toString()
        : typeof item === "string" && /^0x[0-9a-f]+$/i.test(item)
          ? item.toLowerCase()
          : item
    )
  );
}

async function selectedFrame(db: PoolClient, binding: IndexedActionBinding) {
  sqlIdentifier(binding.physicalSchema);
  const read = sqlIdentifier(binding.readSchema);
  if (
    !hash.test(binding.releaseId) ||
    binding.readSchema === binding.physicalSchema
  )
    unavailable("source_selection_changed");
  const release = await loadIndexerRelease(db, binding.releaseId);
  if (
    release.id !== binding.releaseId ||
    release.schema !== binding.physicalSchema
  )
    unavailable("source_selection_changed");
  const markers = (
    await db.query<{
      identity: string;
      release_id: string;
      manifest_hash: string;
    }>(
      `SELECT identity,release_id,manifest_hash FROM ${read}._unified_read_release WHERE singleton LIMIT 2`
    )
  ).rows;
  const marker = markers[0];
  if (
    markers.length !== 1 ||
    !hash.test(marker.identity) ||
    marker.release_id !== release.id ||
    marker.manifest_hash !== release.manifestHash
  )
    unavailable("source_selection_changed");
  return {
    release,
    identity: {
      releaseId: release.id,
      readIdentity: marker.identity,
      manifestHash: release.manifestHash,
      buildId: release.buildId
    }
  };
}

/** Selection discovery is metadata, not source readiness or proof of an action.
 * Pending clients bind this exact identity into their subsequent point read. */
export async function readIndexedActionSelection(
  pool: Pick<Pool, "connect">,
  binding: IndexedActionBinding
): Promise<IndexedActionSelection> {
  return indexerTransaction(
    pool,
    async (db) => {
      await db.query("SET LOCAL statement_timeout = '2000ms'");
      await db.query("SET LOCAL lock_timeout = '500ms'");
      const { release, identity } = await selectedFrame(db, binding);
      await readBoundRuntime(db, release);
      return {
        version: 1,
        identity,
        supportedActions: [
          "bnb-validate",
          "bnb-cancel",
          "booster-request-created"
        ]
      };
    },
    true
  );
}

function sourceFor(release: RegisteredRelease, request: IndexedActionRequest) {
  const booster = request.action.kind === "booster-request-created";
  const source = release.manifest.sources.find(
    (item) =>
      item.id ===
      (booster ? "boosters:boosterengine" : "marketplace:bnb:seaport")
  );
  if (!source?.enabled) return null;
  if (
    source.chainId !== request.chainId ||
    source.feature !== (booster ? "boosters" : "marketplace") ||
    source.contractName !== (booster ? "BoosterEngine" : "BnbSeaport") ||
    !source.address ||
    !address.test(source.address) ||
    /^0x0{40}$/.test(source.address) ||
    (!booster && source.address !== seaportDeployment.address.toLowerCase()) ||
    !unsigned(source.startBlock) ||
    source.abiHash !== manifestDigest(indexedActionAbi(request.action)) ||
    !source.events.includes(indexedActionEventName(request.action)) ||
    source.receiptRequirement !== (booster ? "none" : "full") ||
    !source.policies.some((policy) => policy.kind === "latest")
  )
    unavailable("source_definition_mismatch");
  return source as SourceDefinition & { address: string; startBlock: string };
}

type EventRow = {
  id: string;
  source_id: string;
  chain_id: number;
  address: string;
  abi_hash: string;
  name: string;
  block_number: string;
  block_hash: string;
  transaction_hash: string;
  transaction_index: number;
  log_index: number;
  args: string;
  topics: string;
  data: string;
  point_bytes: string;
};
function checkedLog(
  row: EventRow,
  source: SourceDefinition,
  request: IndexedActionRequest
) {
  if (
    row.source_id !== source.id ||
    row.chain_id !== source.chainId ||
    row.address !== source.address ||
    row.abi_hash !== source.abiHash ||
    !source.events.includes(row.name) ||
    !unsigned(row.block_number) ||
    BigInt(row.block_number) < BigInt(source.startBlock!) ||
    !hash.test(row.block_hash) ||
    row.transaction_hash !== request.transactionHash ||
    !Number.isSafeInteger(row.transaction_index) ||
    row.transaction_index < 0 ||
    !Number.isSafeInteger(row.log_index) ||
    row.log_index < 0 ||
    row.id !==
      `${source.chainId}:${source.address}:${row.transaction_hash}:${row.log_index}`
  )
    unavailable("canonical_event_invalid");
  let topics: unknown, args: unknown;
  try {
    topics = parseIndexedEventTopics(row.topics);
    args = JSON.parse(row.args);
  } catch {
    unavailable("canonical_event_invalid");
  }
  if (
    !Array.isArray(topics) ||
    topics.length < 1 ||
    topics.length > 4 ||
    topics.some((item) => typeof item !== "string" || !hash.test(item)) ||
    typeof row.data !== "string" ||
    !/^0x(?:[0-9a-f]{2})*$/.test(row.data) ||
    !record(args)
  )
    unavailable("canonical_event_invalid");
  return {
    address: row.address,
    logIndex: row.log_index,
    transactionIndex: row.transaction_index,
    topics: topics as string[],
    data: row.data,
    args
  };
}

/** A bounded point read only. No RPC, work queue, admission, source selection,
 * scanner or durable tracking writes. All evidence shares one native snapshot. */
export async function readIndexedActionEvidence(
  pool: Pick<Pool, "connect">,
  binding: IndexedActionBinding,
  input: IndexedActionRequest
): Promise<IndexedActionEvidence> {
  const request = parseIndexedActionRequest(input);
  const booster = request.action.kind === "booster-request-created";
  const result: IndexedActionEvidence = {
    version: 1,
    expectationHash: manifestDigest(request),
    state: "source_unavailable",
    reason: "source_unavailable",
    transaction: {
      chainId: request.chainId,
      hash: request.transactionHash,
      blockNumber: request.blockNumber,
      blockHash: request.blockHash
    },
    identity: null,
    coverage: null,
    proof: null,
    application: {
      state: "not_evaluated",
      component: booster ? "booster_request" : "marketplace"
    }
  };
  const finish = (state: IndexedActionState, reason: IndexedActionReason) => ({
    ...result,
    state,
    reason
  });
  try {
    return await indexerTransaction(
      pool,
      async (db) => {
        await db.query("SET LOCAL statement_timeout = '2000ms'");
        await db.query("SET LOCAL lock_timeout = '500ms'");
        const schema = sqlIdentifier(binding.physicalSchema);
        if (request.releaseId !== binding.releaseId)
          unavailable("source_selection_changed");
        const { release, identity } = await selectedFrame(db, binding);
        if (identity.readIdentity !== request.readIdentity)
          unavailable("source_selection_changed");
        result.identity = identity;
        const source = sourceFor(release, request);
        if (!source) return finish("unsupported", "source_disabled");
        const status = await readIndexerSourceStatus(db, release, source.id, {
          kind: "latest"
        });
        if (
          manifestDigest(status.source) !== manifestDigest(source) ||
          !["ready", "catching_up"].includes(status.readiness.reason) ||
          !status.anchor ||
          status.readiness.availableThroughBlock === null ||
          status.snapshot.completeThroughBlock === null
        )
          unavailable("source_unavailable");
        result.coverage = {
          sourceId: source.id,
          policy: "latest",
          completeThroughBlock: String(status.snapshot.completeThroughBlock),
          availableThroughBlock: String(status.readiness.availableThroughBlock),
          finalizedThroughBlock:
            status.snapshot.finalized?.blockNumber.toString() ?? null,
          anchor: { number: status.anchor.number, hash: status.anchor.hash },
          observationRevision:
            status.observationRevision === null
              ? null
              : String(status.observationRevision)
        };
        const number = BigInt(request.blockNumber);
        if (
          number < BigInt(source.startBlock) ||
          (source.endBlock !== null && number > BigInt(source.endBlock)) ||
          (source.receiptRequirement === "full" &&
            number < BigInt(source.receiptStartBlock ?? source.startBlock))
        )
          return finish("unsupported", "history_unsupported");
        if (number > status.readiness.availableThroughBlock)
          return finish("awaiting_indexing", "block_not_indexed");
        // Budget raw columns before returning them from PostgreSQL. Corrupt or
        // enormous transactions fail closed without exporting their payloads.
        const rows = (
          await db.query<EventRow>(
            `WITH point AS MATERIALIZED (
        SELECT id,source_id,chain_id,address,abi_hash,name,block_number,block_hash,
          transaction_hash,transaction_index,log_index,args,topics,data,
          octet_length(args)+octet_length(topics)+octet_length(data) AS encoded_bytes
        FROM ${schema}.canonical_event WHERE chain_id=$1 AND transaction_hash=$2 AND source_id=$3
        ORDER BY log_index LIMIT 257
      ), budget AS (SELECT count(*) AS n,coalesce(sum(encoded_bytes),0) AS bytes FROM point)
      SELECT p.id,p.source_id,p.chain_id,p.address,p.abi_hash,p.name,p.block_number::text,p.block_hash,
        p.transaction_hash,p.transaction_index,p.log_index,b.bytes::text AS point_bytes,
        CASE WHEN b.n<=256 AND b.bytes<=524288 THEN p.args END AS args,
        CASE WHEN b.n<=256 AND b.bytes<=524288 THEN p.topics END AS topics,
        CASE WHEN b.n<=256 AND b.bytes<=524288 THEN p.data END AS data
      FROM point p CROSS JOIN budget b ORDER BY p.log_index`,
            [request.chainId, request.transactionHash, source.id]
          )
        ).rows;
        if (
          rows.length > maxEvents ||
          rows.some(
            (row) =>
              !unsigned(row.point_bytes) ||
              BigInt(row.point_bytes) > BigInt(maxPointBytes)
          )
        )
          unavailable("event_limit_exceeded");
        const logs = rows.map((row) => checkedLog(row, source, request));
        if (
          new Set(rows.map((row) => row.log_index)).size !== rows.length ||
          new Set(rows.map((row) => row.transaction_index)).size > 1
        )
          unavailable("canonical_event_invalid");
        if (
          rows.some(
            (row) =>
              row.block_number !== request.blockNumber ||
              row.block_hash !== request.blockHash
          )
        )
          return finish("inclusion_changed", "inclusion_changed");
        const witnesses = (
          await db.query<{ block_hash: string }>(
            `SELECT block_hash FROM ${schema}.chain_block WHERE chain_id=$1 AND block_number=$2::bigint LIMIT 2`,
            [request.chainId, request.blockNumber]
          )
        ).rows;
        if (witnesses.length > 1) unavailable("canonical_event_invalid");
        if (witnesses[0] && witnesses[0].block_hash !== request.blockHash)
          return finish("inclusion_changed", "inclusion_changed");
        if (!rows.length && !witnesses.length)
          unavailable("inclusion_evidence_unavailable");
        const matches = rows.filter((row, index) => {
          if (row.name !== indexedActionEventName(request.action)) return false;
          try {
            const args = decodeIndexedActionLog(request.action, logs[index]!);
            if (
              manifestDigest(normalizedArgs(args)) !==
              manifestDigest(normalizedArgs(logs[index]!.args))
            )
              unavailable("canonical_event_invalid");
            return matchesIndexedAction(request.action, args);
          } catch {
            unavailable("canonical_event_invalid");
          }
        });
        if (!matches.length)
          return finish("action_not_observed", "action_not_observed");
        let receiptPayloadHash: string | null = null;
        if (source.receiptRequirement === "full") {
          const candidates = (
            await db.query<{
              chain_id: number;
              block_number: string;
              block_hash: string;
              transaction_hash: string;
              evidence_block_number: string | null;
              payload_hash: string | null;
              receipt: unknown;
              block: unknown;
              too_large: boolean | null;
            }>(
              `SELECT c.chain_id,c.block_number::text,c.block_hash,c.transaction_hash,
          e.block_number::text AS evidence_block_number,e.payload_hash,
          octet_length(e.receipt::text)+octet_length(e.block::text)>2000000 AS too_large,
          CASE WHEN octet_length(e.receipt::text)+octet_length(e.block::text)<=2000000 THEN e.receipt END AS receipt,
          CASE WHEN octet_length(e.receipt::text)+octet_length(e.block::text)<=2000000 THEN e.block END AS block
          FROM ${schema}.transaction_candidate c LEFT JOIN yunipals_indexer_control.transaction_evidence e
          ON e.chain_id=c.chain_id AND e.block_hash=c.block_hash AND e.transaction_hash=c.transaction_hash
          WHERE c.id=$1 LIMIT 2`,
              [
                `${request.chainId}:${request.blockHash}:${request.transactionHash}`
              ]
            )
          ).rows;
          const candidate = candidates[0];
          if (
            candidates.length !== 1 ||
            !candidate ||
            candidate.chain_id !== request.chainId ||
            candidate.block_number !== request.blockNumber ||
            candidate.block_hash !== request.blockHash ||
            candidate.transaction_hash !== request.transactionHash
          )
            unavailable("receipt_candidate_missing");
          if (candidate.payload_hash === null)
            return finish("awaiting_receipt", "receipt_not_enriched");
          try {
            if (
              candidate.too_large !== false ||
              candidate.evidence_block_number !== request.blockNumber ||
              !hash.test(candidate.payload_hash) ||
              !record(candidate.block) ||
              transactionEvidenceHash(candidate.receipt, candidate.block) !==
                candidate.payload_hash ||
              candidate.block.number !== request.blockNumber ||
              candidate.block.hash !== request.blockHash ||
              typeof candidate.block.parentHash !== "string" ||
              !hash.test(candidate.block.parentHash) ||
              !unsigned(candidate.block.timestamp) ||
              candidate.block.seaportRuntimeHash !== seaportRuntimeHashes[56]
            )
              throw new Error();
            const validated = validateTransactionReceipt(
              {
                chainId: request.chainId,
                blockNumber: number,
                blockHash: request.blockHash,
                transactionHash: request.transactionHash
              },
              candidate.receipt,
              {
                number,
                hash: request.blockHash,
                parentHash: candidate.block.parentHash,
                timestamp: BigInt(candidate.block.timestamp)
              },
              logs
            );
            if (!validated.hasSeaport) throw new Error();
            receiptPayloadHash = candidate.payload_hash;
          } catch {
            unavailable("receipt_invalid");
          }
        }
        if (request.action.kind === "booster-request-created") {
          const action = request.action;
          const monsters = release.manifest.sources.find(
            (item) => item.id === "boosters:boostermonsters"
          );
          if (
            !monsters?.enabled ||
            monsters.chainId !== 8453 ||
            monsters.feature !== "boosters" ||
            monsters.contractName !== "BoosterMonsters" ||
            !monsters.address ||
            !address.test(monsters.address) ||
            monsters.abiHash !== manifestDigest(yunipalMonstersAbi)
          )
            unavailable("source_definition_mismatch");
          const projection = (
            await db.query<{
              engine: string;
              request_id: string;
              original_key: string;
              payer: string;
              quantity: number;
              opening: boolean;
              paid: string;
              rule_hash: string;
              callback_gas: number;
              transaction_hash: string;
            }>(
              `SELECT engine,request_id,original_key,payer,quantity,opening,paid,rule_hash,callback_gas,transaction_hash
          FROM ${schema}.booster_request WHERE id=$1 LIMIT 2`,
              [`${source.address}:${action.requestId}`]
            )
          ).rows;
          const row = projection[0];
          if (
            projection.length !== 1 ||
            !row ||
            row.engine !== source.address ||
            row.request_id !== action.requestId ||
            row.original_key !== `${monsters.address}:${action.originalId}` ||
            row.payer !== action.payer ||
            row.quantity !== action.quantity ||
            row.opening !== action.opening ||
            row.paid !== action.paid ||
            row.rule_hash !== action.ruleHash ||
            row.callback_gas !== action.callbackGas ||
            row.transaction_hash !== request.transactionHash
          )
            unavailable("projection_inconsistent");
          result.application = {
            state: "applied",
            component: "booster_request"
          };
        }
        result.proof = {
          kind:
            source.receiptRequirement === "full"
              ? "canonical_event_and_full_receipt"
              : "canonical_event",
          receiptRequirement: source.receiptRequirement,
          receiptPayloadHash,
          events: matches.map((row) => ({
            id: row.id,
            name: row.name,
            logIndex: row.log_index
          }))
        };
        return finish("indexed", "action_indexed");
      },
      true
    );
  } catch (error) {
    // SQL/runtime/ACL errors never masquerade as an empty or pending result.
    result.proof = null;
    result.application = {
      state: "not_evaluated",
      component: booster ? "booster_request" : "marketplace"
    };
    return finish(
      "source_unavailable",
      error instanceof EvidenceUnavailable
        ? error.reason
        : "source_read_unavailable"
    );
  }
}
