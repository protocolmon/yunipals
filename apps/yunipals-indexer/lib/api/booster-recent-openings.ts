import type { Pool } from "pg";
import { isAddress } from "viem";
import {
  boosterIdentity,
  type BoosterMonster,
  type BoosterRecentOpening
} from "../../../../packages/yunipals-market-core/src/boosters.js";
import type { BoosterDeployment } from "../boosters/config.js";

type Journal = {
  id: string;
  args: string;
  blockNumber: string;
  blockHash: string;
  timestamp: string;
  transactionHash: string;
  logIndex: number;
};
type Row = {
  requestKey: string;
  requestId: string;
  opening: boolean;
  quantity: number;
  originalKey: string;
  originalId: string;
  packTypeId: string;
  maxBatch: number;
  recipient: string;
  completed: Journal;
  pulls: { monster: BoosterMonster; events: Journal[] }[];
};
const decimal = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(0|[1-9][0-9]{0,77})$/.test(value) &&
  BigInt(value) < 2n ** 256n;
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value);
function requireProof(value: unknown): asserts value {
  if (!value) throw new Error("Recent opening provenance unavailable");
}
function args(event: Journal, keys: string[]) {
  const parsed: unknown = JSON.parse(event.args);
  requireProof(
    parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      JSON.stringify(parsed) === event.args &&
      Object.keys(parsed).length === keys.length &&
      keys.every((key) => Object.hasOwn(parsed, key))
  );
  return parsed as Record<string, unknown>;
}
function journal(alias: string) {
  return `jsonb_build_object('id',${alias}.id,'args',${alias}.args,
    'blockNumber',${alias}.block_number::text,'blockHash',${alias}.block_hash,
    'timestamp',${alias}.timestamp::text,'transactionHash',${alias}.transaction_hash,
    'logIndex',${alias}.log_index)`;
}
function verifyJournal(
  event: Journal,
  indexedBlock: string,
  indexedTimestamp: string,
  deploymentBlock: bigint
) {
  requireProof(
    decimal(event.blockNumber) &&
      BigInt(event.blockNumber) >= deploymentBlock &&
      BigInt(event.blockNumber) <= BigInt(indexedBlock) &&
      decimal(event.timestamp) &&
      BigInt(event.timestamp) > 0n &&
      BigInt(event.timestamp) <= BigInt(indexedTimestamp) &&
      hash(event.blockHash) &&
      hash(event.transactionHash) &&
      Number.isSafeInteger(event.logIndex) &&
      event.logIndex >= 0 &&
      event.id ===
        `${event.blockHash}:${event.transactionHash}:${event.logIndex}`
  );
}

export async function recentBoosterOpenings(
  pool: Pick<Pool, "query">,
  schema: string,
  deployment: BoosterDeployment,
  snapshot: { indexedBlock: string; indexedTimestamp: string },
  monsterColumns: string,
  limit: number
): Promise<BoosterRecentOpening[]> {
  // One SQL statement sees one MVCC snapshot. All completion/mint witnesses
  // must be inside the previously proven ready prefix, including full batches.
  const result = await pool.query<Row>(
    `SELECT r.id AS "requestKey",r.request_id AS "requestId",r.opening,r.quantity,
      r.original_key AS "originalKey",o.token_id AS "originalId",p.pack_type_id AS "packTypeId",p.max_batch AS "maxBatch",
      r.recipient,${journal("e")} AS completed,batch.pulls
     FROM ${schema}.booster_event e
     JOIN ${schema}.booster_request r ON r.engine=$1 AND r.wrapper=$8 AND r.status='completed'
       AND r.id='8453:'||$1||':'||r.request_id AND e.args::jsonb->>'requestId'=r.request_id
     JOIN ${schema}.booster_original o ON o.id=r.original_key AND o.collection=$2
       AND o.id='8453:'||$2||':'||o.token_id AND o.engine=$1
     JOIN ${schema}.booster_type p ON p.id=o.type_key AND p.registry=$3 AND p.engine=$1
       AND p.id='8453:'||$3||':'||p.pack_type_id AND p.rule_hash=r.rule_hash
     JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object('monster',row_to_json(item),'events',mint.events)
         ORDER BY m.token_id::numeric,m.id) AS pulls
       FROM ${schema}.booster_monster m
       CROSS JOIN LATERAL (SELECT ${monsterColumns}) item
       CROSS JOIN LATERAL (
         SELECT coalesce(jsonb_agg(${journal("w")}),'[]'::jsonb) AS events
         FROM (SELECT * FROM ${schema}.booster_event
           WHERE name='MonsterMinted' AND address=$2 AND block_number=m.mint_block
             AND block_number<=$4::bigint AND args::jsonb->>'tokenId'=m.token_id
           ORDER BY log_index LIMIT 2) w
       ) mint
       WHERE m.request_key=r.id
       HAVING count(*)=r.quantity AND bool_and(
         m.collection=$2 AND m.id='8453:'||$2||':'||m.token_id
         AND m.original_key=o.id AND m.type_key=p.id AND m.is_original=r.opening
         AND ((m.is_original AND m.id=o.id) OR (NOT m.is_original AND m.id<>o.id))
         AND m.minted_to=r.recipient AND m.mint_block=e.block_number
         AND m.mint_block>=$6::bigint AND m.mint_block<=$4::bigint
         AND jsonb_array_length(mint.events)=1)
     ) batch ON true
     WHERE e.name='RequestCompleted' AND e.address=$1 AND p.max_batch BETWEEN 1 AND 32 AND r.quantity BETWEEN 1 AND p.max_batch
       AND (NOT r.opening OR r.quantity=1)
       AND e.block_number BETWEEN $6::bigint AND $4::bigint
       AND e.timestamp>0 AND e.timestamp<=$5::bigint
       AND e.args::jsonb->>'originalId'=o.token_id
       AND lower(e.args::jsonb->>'recipient')=r.recipient
       AND (SELECT count(*) FROM ${schema}.booster_event duplicate
         WHERE duplicate.name='RequestCompleted' AND duplicate.address=$1
           AND duplicate.block_number<=$4::bigint
           AND duplicate.args::jsonb->>'requestId'=r.request_id)=1
     ORDER BY e.block_number DESC,e.log_index DESC,e.id DESC LIMIT $7`,
    [
      deployment.engine,
      deployment.monsters,
      deployment.registry,
      snapshot.indexedBlock,
      snapshot.indexedTimestamp,
      String(deployment.startBlock),
      limit,
      deployment.wrapper
    ]
  );
  return result.rows.map((row) => {
    requireProof(
      decimal(row.requestId) &&
        row.requestKey === boosterIdentity(deployment.engine, row.requestId) &&
        decimal(row.originalId) &&
        row.originalKey ===
          boosterIdentity(deployment.monsters, row.originalId) &&
        decimal(row.packTypeId) &&
        isAddress(row.recipient) &&
        typeof row.opening === "boolean" &&
        Number.isInteger(row.quantity) &&
        row.quantity >= 1 &&
        Number.isInteger(row.maxBatch) &&
        row.maxBatch >= 1 &&
        row.maxBatch <= 32 &&
        row.quantity <= row.maxBatch &&
        (!row.opening || row.quantity === 1)
    );
    verifyJournal(
      row.completed,
      snapshot.indexedBlock,
      snapshot.indexedTimestamp,
      BigInt(deployment.startBlock)
    );
    const completed = args(row.completed, [
      "requestId",
      "originalId",
      "recipient",
      "quantity",
      "minted",
      "remaining"
    ]);
    requireProof(
      completed.requestId === row.requestId &&
        completed.originalId === row.originalId &&
        typeof completed.recipient === "string" &&
        completed.recipient.toLowerCase() === row.recipient &&
        completed.quantity === row.quantity &&
        [completed.minted, completed.remaining].every(
          (value) =>
            typeof value === "number" &&
            Number.isInteger(value) &&
            value >= 0 &&
            value <= 0xffffffff
        ) &&
        Array.isArray(row.pulls) &&
        row.pulls.length === row.quantity &&
        new Set(row.pulls.map(({ monster }) => monster.id)).size ===
          row.quantity
    );
    const pulls = row.pulls.map(({ monster, events }) => {
      requireProof(events.length === 1);
      const mint = events[0];
      verifyJournal(
        mint,
        snapshot.indexedBlock,
        snapshot.indexedTimestamp,
        BigInt(deployment.startBlock)
      );
      requireProof(
        decimal(monster.tokenId) &&
          monster.id ===
            boosterIdentity(deployment.monsters, monster.tokenId) &&
          monster.requestKey === row.requestKey &&
          monster.originalKey === row.originalKey &&
          monster.collection === deployment.monsters &&
          monster.mintedTo === row.recipient &&
          monster.typeKey ===
            boosterIdentity(deployment.registry, row.packTypeId) &&
          monster.isOriginal === row.opening &&
          monster.isOriginal === (monster.id === row.originalKey) &&
          mint.blockNumber === row.completed.blockNumber &&
          mint.blockNumber === monster.mintBlock &&
          mint.blockHash === row.completed.blockHash &&
          mint.transactionHash === row.completed.transactionHash &&
          mint.timestamp === row.completed.timestamp &&
          mint.logIndex < row.completed.logIndex
      );
      const minted = args(mint, [
        "tokenId",
        "originalTokenId",
        "packTypeId",
        "recipient",
        "variantId",
        "monsterType",
        "color",
        "horn",
        "glitter",
        "isOriginal"
      ]);
      requireProof(
        minted.tokenId === monster.tokenId &&
          minted.originalTokenId === row.originalId &&
          minted.packTypeId === row.packTypeId &&
          typeof minted.recipient === "string" &&
          minted.recipient.toLowerCase() === monster.mintedTo &&
          minted.isOriginal === monster.isOriginal
      );
      for (const field of [
        "variantId",
        "monsterType",
        "color",
        "horn",
        "glitter"
      ] as const)
        requireProof(
          typeof minted[field] === "number" &&
            Number.isInteger(minted[field]) &&
            minted[field] >= 0 &&
            minted[field] <= 0xffffffff &&
            String(minted[field]) === monster[field]
        );
      return { monster, logIndex: mint.logIndex };
    });
    requireProof(
      new Set(pulls.map((pull) => pull.logIndex)).size === row.quantity
    );
    pulls.sort((a, b) => a.logIndex - b.logIndex);
    return {
      requestKey: row.requestKey,
      requestId: row.requestId,
      engine: deployment.engine,
      opening: row.opening,
      quantity: row.quantity,
      revealedAt: row.completed.timestamp,
      monster: pulls[0].monster
    };
  });
}
