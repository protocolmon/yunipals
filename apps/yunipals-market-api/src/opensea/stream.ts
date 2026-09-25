import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { marketplaceChains } from "@protopals/yunipals-market-core/registry";

import { transaction } from "@/db/pool";
import { assertReady } from "@/db/readiness";

const maxSequence = 9223372036854775807n;
const maxUint256 =
  115792089237316195423570985008687907853269984665640564039457584007913129639935n;
const chainIds = [
  marketplaceChains.ethereum.chainId,
  marketplaceChains.base.chainId,
  marketplaceChains.polygon.chainId
] as const;

export const openSeaStreamCollections = {
  "collection:yunipals": {
    chainId: marketplaceChains.ethereum.chainId,
    contract: marketplaceChains.ethereum.contractAddress.toLowerCase()
  },
  "collection:yunipals-base": {
    chainId: marketplaceChains.base.chainId,
    contract: marketplaceChains.base.contractAddress.toLowerCase()
  },
  "collection:yunipals-polygon": {
    chainId: marketplaceChains.polygon.chainId,
    contract: marketplaceChains.polygon.contractAddress.toLowerCase()
  }
} as const;

export type OpenSeaStreamTopic = keyof typeof openSeaStreamCollections;
export const openSeaStreamEventTypes = [
  "item_listed",
  "item_sold",
  "item_transferred",
  "item_metadata_updated",
  "item_received_bid",
  "item_cancelled",
  "collection_offer",
  "trait_offer",
  "order_invalidate",
  "order_revalidate"
] as const;
export type OpenSeaStreamEventType = (typeof openSeaStreamEventTypes)[number];

const openSeaStreamEventsThatDiscoverOrders = new Set<OpenSeaStreamEventType>([
  "item_listed",
  "item_received_bid",
  "collection_offer",
  "trait_offer",
  "order_revalidate"
]);

export type OpenSeaStreamNotice = {
  chainId: number;
  eventHash: `0x${string}`;
  eventType: OpenSeaStreamEventType;
  orderHash: `0x${string}` | null;
  tokenId: string | null;
};

export type OpenSeaStreamLease = {
  generation: string;
  token: string;
  leaseUntil: Date;
};

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function validateJson(
  value: unknown,
  budget: { nodes: number },
  depth = 0
): Json {
  if (++budget.nodes > 4096 || depth > 10)
    throw new Error("stream_event_too_complex");
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    if (typeof value === "string" && value.length > 8192)
      throw new Error("stream_event_too_complex");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value))
      throw new Error("stream_event_unsafe_number");
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 256) throw new Error("stream_event_too_complex");
    return value.map((item) => validateJson(item, budget, depth + 1));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length > 256) throw new Error("stream_event_too_complex");
    const result: { [key: string]: Json } = {};
    for (const [key, item] of entries) {
      if (key.length > 256 || Object.hasOwn(result, key))
        throw new Error("stream_event_too_complex");
      result[key] = validateJson(item, budget, depth + 1);
    }
    return result;
  }
  throw new Error("stream_event_invalid_json");
}

function canonicalJson(value: Json): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
    .join(",")}}`;
}

function collectStrings(
  value: Json,
  keys: ReadonlySet<string>,
  output: string[]
) {
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, keys, output);
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (keys.has(key) && typeof item === "string") output.push(item);
      collectStrings(item, keys, output);
    }
  }
}

function oneValid(
  values: string[],
  validate: (value: string) => string | null
) {
  const valid = [
    ...new Set(values.map(validate).filter((v): v is string => v !== null))
  ];
  return valid.length === 1 ? valid[0]! : null;
}

function orderHash(payload: Json) {
  const values: string[] = [];
  collectStrings(payload, new Set(["order_hash", "orderHash"]), values);
  return oneValid(values, (value) =>
    /^0x[0-9a-fA-F]{64}$/.test(value) ? value.toLowerCase() : null
  ) as `0x${string}` | null;
}

function tokenId(payload: Json, contract: string) {
  const nftIds: string[] = [];
  collectStrings(payload, new Set(["nft_id", "nftId"]), nftIds);
  const fromNftId = oneValid(nftIds, (value) => {
    const parts = value.split("/");
    return parts.length === 3 && parts[1]?.toLowerCase() === contract
      ? validTokenId(parts[2] ?? "")
      : null;
  });
  if (fromNftId !== null) return fromNftId;
  const tokens: string[] = [];
  collectStrings(payload, new Set(["token_id", "tokenId"]), tokens);
  return oneValid(tokens, validTokenId);
}

function validTokenId(value: string) {
  if (!/^(0|[1-9][0-9]{0,77})$/.test(value)) return null;
  try {
    return BigInt(value) <= maxUint256 ? value : null;
  } catch {
    return null;
  }
}

export function parseOpenSeaStreamNotice(
  raw: string
): OpenSeaStreamNotice | null {
  if (Buffer.byteLength(raw) > 262144)
    throw new Error("stream_frame_too_large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("stream_frame_invalid_json");
  }
  if (!Array.isArray(parsed) || parsed.length !== 5)
    throw new Error("stream_frame_invalid_shape");
  const topic = parsed[2];
  const event = parsed[3];
  if (topic === "phoenix" || event === "phx_reply") return null;
  if (
    typeof topic !== "string" ||
    !(topic in openSeaStreamCollections) ||
    typeof event !== "string" ||
    !openSeaStreamEventTypes.includes(event as OpenSeaStreamEventType)
  )
    throw new Error("stream_event_unknown_scope");
  const payload = validateJson(parsed[4], { nodes: 0 });
  const config = openSeaStreamCollections[topic as OpenSeaStreamTopic];
  const canonical = canonicalJson({ topic, event, payload });
  return {
    chainId: config.chainId,
    eventHash: `0x${createHash("sha256").update(canonical).digest("hex")}`,
    eventType: event as OpenSeaStreamEventType,
    orderHash: orderHash(payload),
    tokenId: tokenId(payload, config.contract)
  };
}

async function advanceSequence(db: PoolClient) {
  const result = await db.query<{ sequence: string }>(
    `UPDATE yunipals_market.opensea_stream_state SET sequence=sequence+1
    WHERE singleton AND sequence<9223372036854775807 RETURNING sequence::text`
  );
  if (result.rowCount !== 1) throw new Error("stream_sequence_exhausted");
  return result.rows[0]!.sequence;
}

async function upsertWakeups(
  db: PoolClient,
  sequence: string,
  reason: string,
  targets: { chainId: number; target: string }[]
) {
  for (const target of targets)
    await db.query(
      `INSERT INTO yunipals_market.opensea_stream_wakeup(chain_id,target,version,reason)
      VALUES($1,$2,$3,$4) ON CONFLICT(chain_id,target) DO UPDATE SET
        version=EXCLUDED.version,requested_at=clock_timestamp(),reason=EXCLUDED.reason`,
      [target.chainId, target.target, sequence, reason]
    );
}

async function globalGap(db: PoolClient, reason: string) {
  const sequence = await advanceSequence(db);
  await upsertWakeups(
    db,
    sequence,
    reason,
    chainIds.flatMap((chainId) => [
      { chainId, target: "all" },
      { chainId, target: "scan" }
    ])
  );
  return sequence;
}

async function scanGap(db: PoolClient, reason: string) {
  const sequence = await advanceSequence(db);
  await upsertWakeups(
    db,
    sequence,
    reason,
    chainIds.map((chainId) => ({ chainId, target: "scan" }))
  );
  return sequence;
}

async function boundStorage(db: PoolClient) {
  await db.query(
    "DELETE FROM yunipals_market.opensea_stream_notice WHERE received_at<clock_timestamp()-interval '7 days'"
  );
  await db.query(`DELETE FROM yunipals_market.opensea_stream_notice WHERE (chain_id,event_hash) IN (
    SELECT chain_id,event_hash FROM yunipals_market.opensea_stream_notice
    ORDER BY received_at DESC,chain_id,event_hash OFFSET 100000)`);
  const count = Number(
    (
      await db.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM yunipals_market.opensea_stream_wakeup"
      )
    ).rows[0]!.count
  );
  if (count <= 100000) return;
  await globalGap(db, "stream_wakeup_capacity");
  await db.query(
    `DELETE FROM yunipals_market.opensea_stream_wakeup WHERE (chain_id,target) IN (
    SELECT chain_id,target FROM yunipals_market.opensea_stream_wakeup
    WHERE target NOT IN ('all','scan') ORDER BY requested_at,chain_id,target LIMIT $1)`,
    [count - 100000]
  );
}

export async function claimOpenSeaStreamLease(
  pool: Pool,
  leaseMs = 60000
): Promise<OpenSeaStreamLease | null> {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 30000 || leaseMs > 90000)
    throw new Error("Invalid stream lease duration.");
  return transaction(pool, async (db) => {
    const token = randomUUID();
    const result = await db.query<{
      generation: string;
      lease_until: Date;
    }>(
      `UPDATE yunipals_market.opensea_stream_state SET generation=generation+1,
      lease_token=$1,lease_until=clock_timestamp()+$2*interval '1 millisecond',connected=false,
      connected_at=NULL,heartbeat_at=NULL,last_gap_at=clock_timestamp(),last_error_code='stream_startup_gap'
      WHERE singleton AND generation<9223372036854775807
        AND (lease_until IS NULL OR lease_until<=clock_timestamp())
      RETURNING generation::text,lease_until`,
      [token, leaseMs]
    );
    const row = result.rows[0];
    if (!row) return null;
    await scanGap(db, "stream_startup_gap");
    return { generation: row.generation, token, leaseUntil: row.lease_until };
  });
}

export async function renewOpenSeaStreamLease(
  pool: Pool,
  lease: OpenSeaStreamLease,
  leaseMs = 60000
) {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 30000 || leaseMs > 90000)
    throw new Error("Invalid stream lease duration.");
  const result = await pool.query(
    `UPDATE yunipals_market.opensea_stream_state SET lease_until=clock_timestamp()+$3*interval '1 millisecond'
    WHERE singleton AND generation=$1 AND lease_token=$2 AND lease_until>clock_timestamp()`,
    [lease.generation, lease.token, leaseMs]
  );
  return result.rowCount === 1;
}

export async function markOpenSeaStreamConnected(
  pool: Pool,
  lease: OpenSeaStreamLease
) {
  const result = await pool.query(
    `UPDATE yunipals_market.opensea_stream_state SET connected=true,
    connected_at=clock_timestamp(),heartbeat_at=clock_timestamp(),last_error_code=NULL
    WHERE singleton AND generation=$1 AND lease_token=$2 AND lease_until>clock_timestamp()`,
    [lease.generation, lease.token]
  );
  return result.rowCount === 1;
}

export async function recordOpenSeaStreamHeartbeat(
  pool: Pool,
  lease: OpenSeaStreamLease
) {
  const result = await pool.query(
    `UPDATE yunipals_market.opensea_stream_state SET heartbeat_at=clock_timestamp()
    WHERE singleton AND generation=$1 AND lease_token=$2 AND lease_until>clock_timestamp() AND connected`,
    [lease.generation, lease.token]
  );
  return result.rowCount === 1;
}

export async function recordOpenSeaStreamNotice(
  pool: Pool,
  lease: OpenSeaStreamLease,
  notice: OpenSeaStreamNotice
) {
  return transaction(pool, async (db) => {
    const locked = await db.query(
      `SELECT 1 FROM yunipals_market.opensea_stream_state
      WHERE singleton AND generation=$1 AND lease_token=$2 AND lease_until>clock_timestamp() FOR UPDATE`,
      [lease.generation, lease.token]
    );
    if (locked.rowCount !== 1) throw new Error("stream_lease_lost");
    const inserted = await db.query(
      `INSERT INTO yunipals_market.opensea_stream_notice(chain_id,event_hash,event_type)
      VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
      [notice.chainId, notice.eventHash, notice.eventType]
    );
    if (inserted.rowCount !== 1) return { duplicate: true, sequence: null };
    const sequence = await advanceSequence(db);
    const targets: { chainId: number; target: string }[] = [];
    // New and revalidated orders need provider discovery. Lifecycle-only events
    // already identify the affected order or token and are reconciled through
    // those targeted wakeups plus the canonical chain indexer. Fall back to a
    // collection scan when a lifecycle notice has neither coordinate.
    if (
      openSeaStreamEventsThatDiscoverOrders.has(notice.eventType) ||
      (!notice.orderHash && !notice.tokenId)
    )
      targets.push({ chainId: notice.chainId, target: "scan" });
    if (notice.orderHash)
      targets.push({
        chainId: notice.chainId,
        target: `order:${notice.orderHash}`
      });
    if (notice.tokenId)
      targets.push({
        chainId: notice.chainId,
        target: `token:${notice.tokenId}`
      });
    await upsertWakeups(db, sequence, notice.eventType, targets);
    await boundStorage(db);
    return { duplicate: false, sequence };
  });
}

export async function recordOpenSeaStreamGap(
  pool: Pool,
  lease: OpenSeaStreamLease,
  reason: string
) {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(reason))
    throw new Error("Invalid stream gap reason.");
  return transaction(pool, async (db) => {
    const locked = await db.query(
      `SELECT 1 FROM yunipals_market.opensea_stream_state
      WHERE singleton AND generation=$1 AND lease_token=$2 AND lease_until>clock_timestamp() FOR UPDATE`,
      [lease.generation, lease.token]
    );
    if (locked.rowCount !== 1) return false;
    await scanGap(db, reason);
    await db.query(
      `UPDATE yunipals_market.opensea_stream_state SET connected=false,
      last_gap_at=clock_timestamp(),last_error_code=$3
      WHERE singleton AND generation=$1 AND lease_token=$2`,
      [lease.generation, lease.token, reason]
    );
    return true;
  });
}

export async function releaseOpenSeaStreamLease(
  pool: Pool,
  lease: OpenSeaStreamLease
) {
  const result = await pool.query(
    `UPDATE yunipals_market.opensea_stream_state SET connected=false,
    lease_token=NULL,lease_until=NULL
    WHERE singleton AND generation=$1 AND lease_token=$2`,
    [lease.generation, lease.token]
  );
  return result.rowCount === 1;
}

export async function assertOpenSeaStreamReady(
  pool: Pool,
  deployment: "staging" | "production"
) {
  await assertReady(pool, deployment);
  const result = await pool.query<{
    environment: string;
    unsafe: boolean;
    missing: boolean;
  }>(`SELECT
    (SELECT environment FROM yunipals_market.deployment WHERE singleton) AS environment,
    EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f')
      AND (has_table_privilege(current_user,c.oid,'TRUNCATE') OR
        (has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE') AND NOT
          (n.nspname='yunipals_market' AND c.relname IN
            ('opensea_stream_state','opensea_stream_notice','opensea_stream_wakeup'))))) AS unsafe,
    NOT (
      has_table_privilege(current_user,'yunipals_market.opensea_stream_state','SELECT') AND
      has_table_privilege(current_user,'yunipals_market.opensea_stream_state','UPDATE') AND
      has_table_privilege(current_user,'yunipals_market.opensea_stream_notice','SELECT') AND
      has_table_privilege(current_user,'yunipals_market.opensea_stream_notice','INSERT') AND
      has_table_privilege(current_user,'yunipals_market.opensea_stream_notice','DELETE') AND
      has_table_privilege(current_user,'yunipals_market.opensea_stream_wakeup','SELECT') AND
      has_table_privilege(current_user,'yunipals_market.opensea_stream_wakeup','INSERT') AND
      has_table_privilege(current_user,'yunipals_market.opensea_stream_wakeup','UPDATE') AND
      has_table_privilege(current_user,'yunipals_market.opensea_stream_wakeup','DELETE')
    ) AS missing`);
  const row = result.rows[0];
  if (!row || row.environment !== deployment || row.unsafe || row.missing)
    throw new Error("OpenSea stream database role is not ready.");
}
