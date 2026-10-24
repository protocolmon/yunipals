import {
  decodeIndexedActionLog,
  matchesIndexedAction,
  parseIndexedActionRequest
} from "../../packages/yunipals-market-core/src/indexedAction.ts";
import { boosterPacksSourceAbi } from "../../packages/yunipals-market-core/src/boosterSourceAbi.ts";
import { boosterIdentity } from "../../packages/yunipals-market-core/src/boosters.ts";
import { parseIndexedEventTopics } from "../../packages/yunipals-indexer-server/src/event-topics.ts";
import { manifestDigest } from "../../packages/yunipals-indexer-server/src/identity.ts";

export const ypalActionIdentity = Object.freeze({
  releaseId:
    "0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3",
  readIdentity:
    "0xcac869bf65116323b9e1e8e539d999964ad740ab1e4194be0a335ce624c5ea67",
  manifestHash:
    "0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112",
  buildId: "71e2a7f3b7"
});
const transactionHash =
  "0x62e4c5d0792f1dc955b28601debabaa9240d9aeb596479a9e1f297adcb03e8a7";
const engine = "0xdf4aaa47fe0e8208b5a33c74898f834b2952189e";
const monsters = "0x7d62628806e7eef76a354c7c48787879e3440b16";
const hex = /^0x[0-9a-f]{64}$/;
const uint = /^(0|[1-9][0-9]{0,77})$/;
const source = "boosters:boosterengine";
export const ypalActionSourceAbiHash =
  "0x4127c2493eff266363adae3bb24fcf53038b7da4d72af5f517600e2a7920635d";
const sourceAbiHash = manifestDigest(
  boosterPacksSourceAbi(ypalActionSourceAbiHash)
);
need(
  sourceAbiHash === ypalActionSourceAbiHash,
  "exact_published_ypal_source_abi_required"
);
const normalized = (value) =>
  JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === "bigint"
        ? item.toString()
        : typeof item === "string" && /^0x[0-9a-f]+$/i.test(item)
          ? item.toLowerCase()
          : item
    )
  );
function need(value, code) {
  if (!value) throw new Error(code);
}
function same(left, right) {
  return manifestDigest(left) === manifestDigest(right);
}

// Fixed public transaction and identifiers only. An empty result is unavailable;
// it must never be replaced with generated or legacy PROTO event data.
export const ypalOpeningSelectionSql = `WITH point AS MATERIALIZED (
  SELECT id,source_id,chain_id,address,abi_hash,name,block_number::text,
    block_hash,transaction_hash,transaction_index,log_index,args,topics,data,
    octet_length(args)+octet_length(topics)+octet_length(data) AS encoded_bytes
  FROM unified_ypal_20261023_v1.canonical_event
  WHERE chain_id=8453 AND source_id='boosters:boosterengine'
    AND transaction_hash=$1 ORDER BY log_index LIMIT 257
), budget AS (SELECT count(*) AS n,coalesce(sum(encoded_bytes),0) AS bytes FROM point)
SELECT jsonb_build_object(
  'marker',(SELECT jsonb_build_object('releaseId',release_id,'readIdentity',identity,
    'manifestHash',manifest_hash,'buildId',(SELECT value->>'build_id'
    FROM unified_ypal_20261023_v1._ponder_meta WHERE key='app'))
    FROM yunipals_ownership_4e77f52b_v4._unified_read_release WHERE singleton),
  'eventCount',budget.n,'pointBytes',budget.bytes,
  'events',CASE WHEN budget.n<=256 AND budget.bytes<=524288 THEN
    COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.log_index) FROM point p),'[]'::jsonb)
    ELSE NULL END,
  'witnesses',COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'blockNumber',b.block_number::text,'blockHash',b.block_hash))
    FROM (SELECT block_number,block_hash FROM unified_ypal_20261023_v1.chain_block
    WHERE chain_id=8453 AND block_number IN(SELECT block_number::bigint FROM point) LIMIT 2) b),'[]'::jsonb),
  'requests',COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id',r.id,'engine',r.engine,'requestId',r.request_id,'originalKey',r.original_key,
    'payer',r.payer,'quantity',r.quantity,'opening',r.opening,'paid',r.paid,
    'ruleHash',r.rule_hash,'callbackGas',r.callback_gas,'transactionHash',r.transaction_hash))
    FROM (SELECT id,engine,request_id,original_key,payer,quantity,opening,paid,
      rule_hash,callback_gas,transaction_hash FROM unified_ypal_20261023_v1.booster_request
      WHERE engine=$2 AND transaction_hash=$1 LIMIT 11) r),'[]'::jsonb)) AS value FROM budget`;

/** Decode and validate one actual snapshot. This does not assert source readiness
 * or API acceptance; the API must subsequently recheck its current source. */
export function openingFixtureFromSnapshot(value) {
  need(
    value && same(value.marker, ypalActionIdentity),
    "actual_ypal_marker_required"
  );
  need(
    Number.isSafeInteger(value.eventCount) &&
      value.eventCount >= 0 &&
      value.eventCount <= 256 &&
      Number.isSafeInteger(value.pointBytes) &&
      value.pointBytes >= 0 &&
      value.pointBytes <= 524288 &&
      Array.isArray(value.events) &&
      value.events.length === value.eventCount &&
      Array.isArray(value.witnesses) &&
      value.witnesses.length <= 1 &&
      Array.isArray(value.requests) &&
      value.requests.length <= 10,
    "bounded_actual_ypal_point_required"
  );
  const seen = new Set();
  const requests = [];
  let inclusion;
  for (const row of value.events) {
    need(
      row.chain_id === 8453 &&
        row.source_id === source &&
        row.address === engine &&
        row.abi_hash === sourceAbiHash &&
        row.transaction_hash === transactionHash &&
        hex.test(row.block_hash) &&
        typeof row.block_number === "string" &&
        uint.test(row.block_number) &&
        BigInt(row.block_number) >= 52995174n &&
        Number.isSafeInteger(row.log_index) &&
        row.log_index >= 0 &&
        Number.isSafeInteger(row.transaction_index) &&
        row.transaction_index >= 0 &&
        row.id === `8453:${engine}:${transactionHash}:${row.log_index}` &&
        !seen.has(row.log_index),
      "actual_ypal_event_identity_required"
    );
    seen.add(row.log_index);
    const current = [row.block_number, row.block_hash, row.transaction_index];
    need(
      !inclusion || same(current, inclusion),
      "single_ypal_inclusion_required"
    );
    inclusion = current;
    for (const witness of value.witnesses) {
      need(
        witness.blockNumber === row.block_number &&
          witness.blockHash === row.block_hash,
        "ypal_canonical_witness_conflict"
      );
    }
    if (row.name !== "RequestCreated") continue;
    const args = JSON.parse(row.args);
    const request = parseIndexedActionRequest({
      version: 1,
      releaseId: ypalActionIdentity.releaseId,
      readIdentity: ypalActionIdentity.readIdentity,
      chainId: 8453,
      transactionHash,
      blockNumber: row.block_number,
      blockHash: row.block_hash,
      action: { kind: "booster-request-created", ...args }
    });
    need(
      request.action.opening &&
        request.action.quantity === 1 &&
        request.action.packTypeId === "1",
      "actual_public_original_opening_required"
    );
    const decoded = decodeIndexedActionLog(
      request.action,
      { topics: parseIndexedEventTopics(row.topics), data: row.data },
      ypalActionSourceAbiHash
    );
    need(
      same(normalized(decoded), normalized(args)) &&
        matchesIndexedAction(request.action, decoded),
      "compiled_ypal_event_decode_required"
    );
    const matching = value.requests.filter(
      (r) => r.requestId === request.action.requestId
    );
    need(
      matching.length === 1 &&
        same(matching[0], {
          id: boosterIdentity(engine, request.action.requestId),
          engine,
          requestId: request.action.requestId,
          originalKey: boosterIdentity(monsters, request.action.originalId),
          payer: request.action.payer,
          quantity: request.action.quantity,
          opening: request.action.opening,
          paid: request.action.paid,
          ruleHash: request.action.ruleHash,
          callbackGas: request.action.callbackGas,
          transactionHash
        }),
      "actual_ypal_projection_required"
    );
    requests.push(request);
  }
  need(requests.length <= 10, "bounded_ypal_original_count_required");
  if (!requests.length)
    return {
      format: "yunipals-consumer-known-ypal-action-unavailable-v1",
      actualFixtureAvailable: false
    };
  need(
    new Set(requests.map((r) => r.action.requestId)).size === requests.length,
    "distinct_ypal_requests_required"
  );
  return {
    format: "yunipals-consumer-known-ypal-action-v1",
    request: requests[0]
  };
}

/** A new dedicated client is required. Never borrow a consumer's active write
 * transaction. The fixture leaves no persistent state and invokes no provider. */
export async function selectOpeningFixture(db) {
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await db.query("SET LOCAL statement_timeout='2s'");
    await db.query("SET LOCAL lock_timeout='500ms'");
    await db.query("SET LOCAL search_path=pg_catalog");
    const result = await db.query(ypalOpeningSelectionSql, [
      transactionHash,
      engine
    ]);
    need(result.rows.length === 1, "single_actual_ypal_snapshot_required");
    return openingFixtureFromSnapshot(result.rows[0].value);
  } finally {
    await db.query("ROLLBACK");
  }
}

/** Fresh-main preview acceptance for this known opening. Marketplace acceptance
 * retains its independent full-receipt requirement; it is not passed here. */
export function positiveYpalAction(value, input, selection) {
  try {
    const request = parseIndexedActionRequest(input);
    need(
      same(request, input) &&
        request.chainId === 8453 &&
        request.action.kind === "booster-request-created" &&
        request.transactionHash === transactionHash &&
        request.releaseId === ypalActionIdentity.releaseId &&
        request.readIdentity === ypalActionIdentity.readIdentity,
      "known_ypal_request_required"
    );
    need(
      selection?.version === 1 &&
        same(selection.identity, ypalActionIdentity) &&
        Array.isArray(selection.supportedActions) &&
        selection.supportedActions.length === 3 &&
        same([...selection.supportedActions].sort(), [
          "bnb-cancel",
          "bnb-validate",
          "booster-request-created"
        ]),
      "selected_ypal_action_identity_required"
    );
    const coverage = value?.coverage;
    const proof = value?.proof;
    return (
      value?.version === 1 &&
      value.state === "indexed" &&
      value.reason === "action_indexed" &&
      value.expectationHash === manifestDigest(request) &&
      same(value.identity, selection.identity) &&
      same(value.transaction, {
        chainId: 8453,
        hash: request.transactionHash,
        blockNumber: request.blockNumber,
        blockHash: request.blockHash
      }) &&
      coverage?.sourceId === source &&
      coverage.policy === "latest" &&
      typeof coverage.completeThroughBlock === "string" &&
      uint.test(coverage.completeThroughBlock) &&
      typeof coverage.availableThroughBlock === "string" &&
      uint.test(coverage.availableThroughBlock) &&
      BigInt(coverage.completeThroughBlock) >=
        BigInt(coverage.availableThroughBlock) &&
      BigInt(coverage.availableThroughBlock) >= BigInt(request.blockNumber) &&
      typeof coverage.anchor?.number === "string" &&
      uint.test(coverage.anchor.number) &&
      coverage.anchor.number === coverage.availableThroughBlock &&
      hex.test(coverage.anchor.hash) &&
      proof?.kind === "canonical_event" &&
      proof.receiptRequirement === "none" &&
      proof.receiptPayloadHash === null &&
      Array.isArray(proof.events) &&
      proof.events.length >= 1 &&
      proof.events.length <= 256 &&
      new Set(proof.events.map((e) => e.logIndex)).size ===
        proof.events.length &&
      proof.events.every(
        (e) =>
          e.name === "RequestCreated" &&
          Number.isSafeInteger(e.logIndex) &&
          e.logIndex >= 0 &&
          e.id === `8453:${engine}:${transactionHash}:${e.logIndex}`
      ) &&
      same(value.application, {
        state: "applied",
        component: "booster_request"
      })
    );
  } catch {
    return false;
  }
}
