import { pool } from "../offchain/db.js";
import { ponderSchema } from "../offchain/sql.js";
import { verifyCurrentBaseUri } from "../uri/verify.js";
import { fetchMetadata } from "./fetch.js";
import { metadataRetry } from "./retry.js";
import { createPublicClient, http, parseAbi } from "viem";
import { base, bsc, polygon } from "viem/chains";
import { collectionAbi } from "../abi.js";
import { collections, type CollectionSlug } from "../constants.js";
import { baseRpcUrlOf, bnbRpcUrlOf, polygonRpcUrlOf } from "../rpc.js";
import { metadataFetchUrl } from "../uri/fetch-url.js";
import { safeErrorMessage } from "../safe-error.js";
import { calculateRarity } from "../rarity/calculate.js";
import { storeRarityCalculations } from "../rarity/store.js";

const concurrency = Number(process.env.METADATA_CONCURRENCY ?? 8);
const pollMs = Number(process.env.METADATA_POLL_MS ?? 2_000);
const maxBytes = Number(process.env.METADATA_MAX_BYTES ?? 1_048_576);
const allowedHosts = new Set((process.env.METADATA_ALLOWED_HOSTS ?? "meta.polkamon.com,meta.yunipals.com").split(",").map((v) => v.trim()));
const polygonUriAuditMs = Number(process.env.POLYGON_URI_AUDIT_MS ?? 7 * 86_400_000);
const bnbUriAuditMs = Number(process.env.BNB_URI_AUDIT_MS ?? 7 * 86_400_000);
const enqueueIdleMs = Number(process.env.METADATA_ENQUEUE_IDLE_MS ?? 60_000);
let stopping = false;
let nextUpdateSyncAt = 0;
let nextEnqueueAt = 0;
let uriResolution: Promise<void> | undefined;
const baseRpcUrl = baseRpcUrlOf();
const baseClient = createPublicClient({ chain: base, transport: http(baseRpcUrl) });
const polygonClient = createPublicClient({ chain: polygon, transport: http(polygonRpcUrlOf()) });
const bnbClient = createPublicClient({ chain: bsc, transport: http(bnbRpcUrlOf()) });
const metadataUpdateAbi = parseAbi([
  "event Update(address indexed to, uint256 indexed tokenId, (uint16 monsterType, uint16 color, uint16 horn, uint8 background, uint8 glitter, uint40 rarityScore) yunipal)"
]);

async function enqueueLifecycles() {
  if (Date.now() < nextEnqueueAt) return 0;
  const result = await pool.query(`
    WITH candidates AS (
      SELECT l.collection, l.token_id, l.lifecycle
      FROM ${ponderSchema}.token_lifecycle l
      JOIN ${ponderSchema}.token t ON t.collection=l.collection AND t.token_id=l.token_id
      LEFT JOIN metadata.token_metadata m ON m.collection=l.collection
        AND m.token_id=l.token_id::numeric AND m.lifecycle=l.lifecycle
      WHERE m.token_id IS NULL LIMIT 10000
    )
    INSERT INTO metadata.token_metadata(collection, token_id, lifecycle, token_uri, uri_provenance, audit_status)
    SELECT collection, token_id::numeric, lifecycle,
      CASE WHEN collection='ethereum' THEN 'https://meta.polkamon.com/meta?id=' || token_id
        ELSE 'onchain:' || collection || ':' || token_id END,
      CASE WHEN collection='ethereum' THEN 'current_base_formula' ELSE 'pending_token_uri_call' END,
      CASE WHEN collection='ethereum' THEN 'sample_verified' ELSE 'onchain_resolved' END
    FROM candidates ON CONFLICT DO NOTHING
  `);
  const inserted = result.rowCount ?? 0;
  if (inserted < 10000) nextEnqueueAt = Date.now() + enqueueIdleMs;
  return inserted;
}

async function resolveTokenUris(collection: "base" | "polygon" | "bnb") {
  const client = collection === "base" ? baseClient : collection === "polygon" ? polygonClient : bnbClient;
  const pending = await pool.query(`
    SELECT token_id::text AS "tokenId", lifecycle
    FROM metadata.token_metadata
    WHERE collection=$1 AND token_uri LIKE 'onchain:' || $1 || ':%'
    ORDER BY token_id LIMIT 1000
  `, [collection]);
  if (!pending.rowCount) return 0;
  const results = await client.multicall({
    allowFailure: true,
    batchSize: 16_384,
    contracts: pending.rows.map((row) => ({
      address: collections[collection].address,
      abi: collectionAbi,
      functionName: "tokenURI" as const,
      args: [BigInt(row.tokenId)] as const
    }))
  });
  const tokenIds: string[] = [];
  const lifecycles: number[] = [];
  const tokenUris: string[] = [];
  const fallbackTokenIds: string[] = [];
  const fallbackLifecycles: number[] = [];
  for (const [index, result] of results.entries()) {
    const row = pending.rows[index]!;
    if (result.status !== "success" || typeof result.result !== "string") {
      if (collection === "polygon" || collection === "bnb") {
        fallbackTokenIds.push(row.tokenId);
        fallbackLifecycles.push(row.lifecycle);
      }
      continue;
    }
    tokenIds.push(row.tokenId);
    lifecycles.push(row.lifecycle);
    tokenUris.push(result.result);
  }
  let count = 0;
  if (tokenIds.length) {
    const resolved = await pool.query(`UPDATE metadata.token_metadata m SET token_uri=v.token_uri,
      uri_provenance='current_token_uri_call', audit_status='onchain_resolved', uri_checked_at=now(), updated_at=now()
      FROM unnest($1::numeric[], $2::integer[], $3::text[]) AS v(token_id, lifecycle, token_uri)
      WHERE m.collection=$4 AND m.token_id=v.token_id AND m.lifecycle=v.lifecycle
        AND m.token_uri LIKE 'onchain:' || $4 || ':%'`, [tokenIds, lifecycles, tokenUris, collection]);
    count += resolved.rowCount ?? 0;
  }
  if (fallbackTokenIds.length) {
    const fallback = await pool.query(`UPDATE metadata.token_metadata m
      SET token_uri='https://meta.polkamon.com/meta?id=' || v.token_id,
        uri_provenance='historical_formula_fallback', audit_status='token_uri_unavailable', updated_at=now()
      FROM unnest($1::numeric[], $2::integer[]) AS v(token_id, lifecycle)
      WHERE m.collection=$3 AND m.token_id=v.token_id AND m.lifecycle=v.lifecycle
        AND m.token_uri LIKE 'onchain:' || $3 || ':%'`, [fallbackTokenIds, fallbackLifecycles, collection]);
    count += fallback.rowCount ?? 0;
  }
  return count;
}

async function auditTokenUris(collection: "polygon" | "bnb") {
  const auditMs = collection === "polygon" ? polygonUriAuditMs : bnbUriAuditMs;
  const onchainClient = collection === "polygon" ? polygonClient : bnbClient;
  const due = await pool.query(`
    SELECT m.token_id::text AS "tokenId", m.lifecycle, m.token_uri AS "tokenUri"
    FROM metadata.token_metadata m
    JOIN ${ponderSchema}.token t ON t.collection=$1 AND t.token_id::numeric=m.token_id
      AND t.lifecycle=m.lifecycle AND NOT t.burned
    WHERE m.collection=$1
      AND m.token_uri NOT LIKE 'onchain:%'
      AND (m.uri_checked_at IS NULL OR m.uri_checked_at < now() - ($2 * interval '1 millisecond'))
    ORDER BY m.uri_checked_at NULLS FIRST, m.token_id LIMIT 250
  `, [collection, auditMs]);
  if (!due.rowCount) return 0;
  const results = await onchainClient.multicall({
    allowFailure: true,
    batchSize: 16_384,
    contracts: due.rows.map((row) => ({
      address: collections[collection].address,
      abi: collectionAbi,
      functionName: "tokenURI" as const,
      args: [BigInt(row.tokenId)] as const
    }))
  });
  const client = await pool.connect();
  let checked = 0;
  try {
    await client.query("BEGIN");
    for (const [index, result] of results.entries()) {
      if (result.status !== "success" || typeof result.result !== "string") continue;
      const row = due.rows[index]!;
      await client.query(`UPDATE metadata.token_metadata SET token_uri=$3,
        uri_provenance='current_token_uri_call', audit_status='onchain_resolved', uri_checked_at=now(),
        fetch_status=CASE WHEN token_uri<>$3 THEN 'pending' ELSE fetch_status END,
        next_attempt_at=CASE WHEN token_uri<>$3 THEN now() ELSE next_attempt_at END,
        last_error=CASE WHEN token_uri<>$3 THEN NULL ELSE last_error END, updated_at=now()
        WHERE collection=$4 AND token_id=$1 AND lifecycle=$2`,
      [row.tokenId, row.lifecycle, result.result, collection]);
      checked++;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  return checked;
}

function startTokenUriResolution() {
  if (uriResolution) return;
  uriResolution = Promise.all([resolveTokenUris("base"), resolveTokenUris("polygon"), resolveTokenUris("bnb")])
    .then(() => undefined)
    .catch((error) => console.error("Token URI resolution failed", safeErrorMessage(error)))
    .finally(() => { uriResolution = undefined; });
}

async function syncBaseMetadataUpdates() {
  if (Date.now() < nextUpdateSyncAt) return;
  nextUpdateSyncAt = Date.now() + 15_000;
  const latestBlock = await baseClient.getBlockNumber();
  await pool.query(`INSERT INTO metadata.chain_event_cursor(name, block_number)
    VALUES ('base_metadata_update', $1) ON CONFLICT (name) DO NOTHING`, [latestBlock.toString()]);
  const cursorResult = await pool.query(`SELECT block_number::text AS "blockNumber"
    FROM metadata.chain_event_cursor WHERE name='base_metadata_update'`);
  const fromBlock = BigInt(cursorResult.rows[0].blockNumber) + 1n;
  if (fromBlock > latestBlock) return;
  const toBlock = fromBlock + 1_999n < latestBlock ? fromBlock + 1_999n : latestBlock;
  const updates = await baseClient.getContractEvents({
    address: collections.base.address,
    abi: metadataUpdateAbi,
    eventName: "Update",
    fromBlock,
    toBlock
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const event of updates) {
      const tokenId = event.args.tokenId?.toString();
      if (!tokenId) continue;
      await client.query(`UPDATE metadata.token_metadata SET fetch_status='pending',
        next_attempt_at=now(), last_error=NULL, updated_at=now()
        WHERE collection='base' AND token_id=$1 AND fetch_status IN ('success', 'retry', 'not_found')`, [tokenId]);
    }
    await client.query(`UPDATE metadata.chain_event_cursor SET block_number=$2, updated_at=now()
      WHERE name=$1`, ["base_metadata_update", toBlock.toString()]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

type ClaimedMetadata = { collection: CollectionSlug; tokenId: string; lifecycle: number; tokenUri: string; attempts: number; lastError: string | null };

async function claimBatch(limit: number) {
  const result = await pool.query(`
    WITH claimed AS (
      SELECT collection, token_id, lifecycle FROM metadata.token_metadata
      WHERE fetch_status IN ('pending', 'retry', 'not_found') AND next_attempt_at <= now()
        AND token_uri NOT LIKE 'onchain:%'
      ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT $1
    )
    UPDATE metadata.token_metadata m SET fetch_status='fetching', updated_at=now()
    FROM claimed c WHERE m.collection=c.collection AND m.token_id=c.token_id AND m.lifecycle=c.lifecycle
    RETURNING m.collection, m.token_id::text AS "tokenId", m.lifecycle,
      m.token_uri AS "tokenUri", m.attempts, m.last_error AS "lastError"
  `, [limit]);
  return result.rows as ClaimedMetadata[];
}

async function processBatch() {
  const items = await claimBatch(concurrency);
  if (!items.length) return 0;
  const results = await Promise.all(items.map(async (item) => {
    try {
      const fetchUrl = metadataFetchUrl(item.tokenUri);
      const { document, contentHash } = await fetchMetadata(fetchUrl, { maxBytes, allowedHosts });
      return { ok: true as const, collection: item.collection, token_id: item.tokenId,
        lifecycle: item.lifecycle, content_hash: contentHash, fetch_url: fetchUrl,
        used_fallback: fetchUrl !== item.tokenUri, name: document.name ?? null,
        description: document.description ?? null, image: document.image ?? null,
        animation_url: document.animation_url ?? null, attributes: document.attributes ?? [], document,
        rarity: calculateRarity(item.tokenId, document) };
    } catch (error) {
      const retry = metadataRetry(error, item.attempts + 1, item.lastError);
      return { ok: false as const, collection: item.collection, token_id: item.tokenId,
        lifecycle: item.lifecycle, last_error: retry.lastError,
        fetch_status: retry.fetchStatus, delay_seconds: retry.delaySeconds };
    }
  }));
  const successes = results.filter((result) => result.ok);
  const failures = results.filter((result) => !result.ok);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (successes.length) {
      const payload = JSON.stringify(successes);
      await client.query(`INSERT INTO metadata.metadata_revision
        (collection, token_id, lifecycle, content_hash, token_uri, document)
        SELECT collection, token_id, lifecycle, content_hash, fetch_url, document
        FROM jsonb_to_recordset($1::jsonb) AS x(collection text, token_id numeric, lifecycle integer,
          content_hash text, fetch_url text, document jsonb) ON CONFLICT DO NOTHING`, [payload]);
      await client.query(`UPDATE metadata.token_metadata m SET name=x.name, description=x.description,
        image=x.image, animation_url=x.animation_url, attributes=x.attributes, document=x.document,
        content_hash=x.content_hash, fetch_status='success', attempts=m.attempts+1,
        fetched_at=now(), updated_at=now(), last_error=NULL,
        uri_provenance=CASE WHEN x.used_fallback THEN 'current_token_uri_call_host_fallback' ELSE m.uri_provenance END,
        audit_status=CASE WHEN x.used_fallback THEN 'host_fallback_sample_verified' ELSE m.audit_status END
        FROM jsonb_to_recordset($1::jsonb) AS x(collection text, token_id numeric, lifecycle integer,
          content_hash text, used_fallback boolean, name text, description text, image text,
          animation_url text, attributes jsonb, document jsonb)
        WHERE m.collection=x.collection AND m.token_id=x.token_id AND m.lifecycle=x.lifecycle`, [payload]);
      await storeRarityCalculations(client, successes.map((item) => ({
        collection: item.collection,
        tokenId: item.token_id,
        lifecycle: item.lifecycle,
        metadataContentHash: item.content_hash,
        ...item.rarity
      })));
    }
    if (failures.length) {
      await client.query(`UPDATE metadata.token_metadata m SET fetch_status=x.fetch_status, attempts=m.attempts+1,
        last_error=x.last_error, next_attempt_at=now() + (x.delay_seconds * interval '1 second'), updated_at=now()
        FROM jsonb_to_recordset($1::jsonb) AS x(collection text, token_id numeric, lifecycle integer,
          last_error text, fetch_status text, delay_seconds integer)
        WHERE m.collection=x.collection AND m.token_id=x.token_id AND m.lifecycle=x.lifecycle`,
      [JSON.stringify(failures)]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    await pool.query(`UPDATE metadata.token_metadata SET fetch_status='retry', next_attempt_at=now(),
      updated_at=now(), last_error='Batch persistence failed; queued for retry'
      WHERE (collection, token_id, lifecycle) IN (
        SELECT collection, token_id, lifecycle
        FROM jsonb_to_recordset($1::jsonb) AS x(collection text, token_id numeric, lifecycle integer)
      ) AND fetch_status='fetching'`, [JSON.stringify(items)]);
    throw error;
  } finally {
    client.release();
  }
  return items.length;
}

process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

const verification = await verifyCurrentBaseUri();
console.log(`Verified current token URI formula at block ${verification.blockNumber} using token ${verification.tokenId}`);
const recovered = await pool.query(`UPDATE metadata.token_metadata SET fetch_status='retry',
  next_attempt_at=now(), updated_at=now(), last_error='Recovered after metadata worker restart'
  WHERE fetch_status='fetching'`);
if (recovered.rowCount) console.log(`Recovered ${recovered.rowCount} interrupted metadata fetches`);

while (!stopping) {
  try {
    await enqueueLifecycles();
    await syncBaseMetadataUpdates();
    startTokenUriResolution();
    await auditTokenUris("polygon");
    await auditTokenUris("bnb");
    const processed = await processBatch();
    if (!processed) await new Promise((resolve) => setTimeout(resolve, pollMs));
  } catch (error) {
    console.error(safeErrorMessage(error));
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
await uriResolution;
await pool.end();
