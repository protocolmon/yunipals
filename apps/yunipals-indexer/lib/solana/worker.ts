import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { pool } from "../offchain/db.js";
import { ArchiveReader } from "../metadata/source/read.js";
import { validateMetadata } from "../metadata/publication.js";
import { contentHash } from "../metadata/source/canonical.js";
import { calculateRarity } from "../rarity/calculate.js";
import { reserveRpcCredits, finishRpcUsage, RpcBudgetExhausted } from "./budget.js";
import { DasError, getAssetBatch, isSolanaAddress, parseDasBatch, type DasAsset } from "./das.js";

type ManifestAsset = { mint: string; legacy_alias: string; asset_key: string; source_hash: string };
type StageItem = DasAsset & { status: "observed" } | { mint: string; status: "missing" };

const numberSetting = (name: string, fallback: number, minimum: number, maximum: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`invalid_${name}`);
  return value;
};
const batchSize = numberSetting("SOLANA_BATCH_SIZE", 1000, 1, 1000);
const intervalMs = numberSetting("SOLANA_SYNC_INTERVAL_MS", 900_000, 60_000, 86_400_000);
const timeoutMs = numberSetting("SOLANA_RPC_TIMEOUT_MS", 20_000, 1000, 120_000);
const maxRetries = numberSetting("SOLANA_RPC_MAX_ATTEMPTS", 3, 1, 5);
const dailyCredits = numberSetting("SOLANA_RPC_DAILY_CREDIT_LIMIT", 15_000, 10, 1_000_000);
const rollingCredits = numberSetting("SOLANA_RPC_ROLLING_31D_CREDIT_LIMIT", 500_000, 10, 10_000_000);
const maxMissing = numberSetting("SOLANA_MAX_MISSING", 0, 0, 10_000);
const maxScanCredits = numberSetting("SOLANA_RPC_MAX_SCAN_CREDITS", 500, 10, 50_000);
const maxRepairCalls = numberSetting("SOLANA_MAX_REPAIR_CALLS_PER_SCAN", 32, 0, 256);
const requestGapMs = numberSetting("SOLANA_RPC_REQUEST_GAP_MS", 1000, 500, 60_000);
const key = process.env.HELIUS_API_KEY;
let lastRequestAt = 0;
let repairCalls = 0;
let requestCount = 0;
let stopping = false;
let lockLost = false;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const manifestChecksum = (assets: ManifestAsset[]) => createHash("sha256")
  .update(JSON.stringify(assets)).digest("hex");

export async function archiveManifest() {
  const release = (await pool.query<{ release_id: string }>(
    `SELECT release_id FROM metadata_source.archive_release WHERE state='active'`
  )).rows[0]?.release_id;
  if (!release) throw new Error("solana_active_archive_missing");
  const result = await pool.query<ManifestAsset>(`SELECT a.source_key AS legacy_alias,
    b.payload->>'targetId' AS mint, source.asset_key, source.content_hash AS source_hash
    FROM metadata_source.source_record a
    JOIN metadata_source.source_blob b ON b.content_hash=a.content_hash
    JOIN LATERAL (
      SELECT r.asset_key,r.content_hash FROM metadata_source.source_record r
      WHERE r.release_id=a.release_id AND r.legacy_id=b.payload->>'targetId'
        AND r.family='GEN1' AND r.chain_id='mainnet-beta'
        AND r.origin_type='GEN1_EXOMON_DROP' AND r.issue IS NULL
        AND r.asset_key IS NOT NULL
      ORDER BY r.source_burned ASC NULLS LAST,r.source_key ASC LIMIT 1
    ) source ON true
    WHERE a.release_id=$1 AND a.namespace='legacy.exomon-aliases'
    ORDER BY a.source_key`, [release]);
  const assets = result.rows;
  if (assets.length !== 10_000 || new Set(assets.map(a => a.mint)).size !== assets.length
    || new Set(assets.map(a => a.legacy_alias)).size !== assets.length
    || assets.some(a => !isSolanaAddress(a.mint) || !/^\d+$/.test(a.legacy_alias)
      || !/^[0-9a-f]{64}$/.test(a.asset_key) || !/^[0-9a-f]{64}$/.test(a.source_hash))) {
    throw new Error("solana_archive_manifest_invalid");
  }
  return { release, assets, checksum: manifestChecksum(assets) };
}

async function persistManifest(release: string, assets: ManifestAsset[], checksum: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = (await client.query<{ checksum: string; release_id: string }>(
      `SELECT checksum,release_id FROM solana_indexer.manifest WHERE singleton FOR UPDATE`
    )).rows[0];
    if (existing && existing.checksum !== checksum) throw new Error("solana_manifest_changed_requires_reconciliation");
    if (existing) {
      const count = (await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM solana_indexer.manifest_asset`
      )).rows[0]?.count;
      if (Number(count) !== assets.length) throw new Error("solana_manifest_asset_count_mismatch");
      if (existing.release_id !== release) {
        await client.query(`UPDATE solana_indexer.manifest_asset SET release_id=$1`,[release]);
        await client.query(`UPDATE solana_indexer.manifest SET release_id=$1 WHERE singleton`,[release]);
      }
    }
    if (!existing) {
      for (let offset = 0; offset < assets.length; offset += 500) {
        await client.query(`INSERT INTO solana_indexer.manifest_asset(mint,legacy_alias,asset_key,source_hash,release_id)
          SELECT mint,legacy_alias,asset_key,source_hash,$2
          FROM jsonb_to_recordset($1::jsonb) AS x(mint text,legacy_alias text,asset_key text,source_hash text)`,
          [JSON.stringify(assets.slice(offset,offset + 500)),release]);
      }
      await client.query(`INSERT INTO solana_indexer.manifest(singleton,release_id,checksum,asset_count)
        VALUES(true,$1,$2,$3)`, [release,checksum,assets.length]);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function ensureMetadata(release: string) {
  const missing = (await pool.query<ManifestAsset>(`SELECT a.mint,a.legacy_alias,a.asset_key,a.source_hash
    FROM solana_indexer.manifest_asset a LEFT JOIN solana_indexer.asset_metadata m ON m.mint=a.mint
    WHERE m.mint IS NULL OR m.release_id<>a.release_id OR m.source_hash<>a.source_hash
    ORDER BY a.mint`)).rows;
  if (!missing.length) return;
  const reader = new ArchiveReader(pool,release);
  for (let offset = 0; offset < missing.length; offset += 50) {
    const chunk = missing.slice(offset,offset + 50);
    const rendered = await Promise.all(chunk.map(async asset => {
      const snapshot = await reader.snapshotByAsset(asset.asset_key);
      validateMetadata(snapshot.document);
      const document = snapshot.document;
      const rarity = calculateRarity(asset.mint,document);
      return { mint:asset.mint,release_id:release,source_hash:asset.source_hash,
        document,content_hash:contentHash(document),name:typeof document.name === "string" ? document.name : null,
        image:typeof document.image === "string" ? document.image : null,
        attributes:Array.isArray(document.attributes) ? document.attributes : [],
        rarity_points:rarity.rarityPoints,rarity_points_capped:rarity.rarityPointsCapped };
    }));
    await pool.query(`INSERT INTO solana_indexer.asset_metadata
      (mint,release_id,source_hash,document,content_hash,name,image,attributes,rarity_points,rarity_points_capped)
      SELECT mint,release_id,source_hash,document,content_hash,name,image,attributes,rarity_points,rarity_points_capped
      FROM jsonb_to_recordset($1::jsonb) AS x(mint text,release_id text,source_hash text,document jsonb,
        content_hash text,name text,image text,attributes jsonb,rarity_points numeric,rarity_points_capped numeric)
      ON CONFLICT(mint) DO UPDATE SET release_id=excluded.release_id,source_hash=excluded.source_hash,
        document=excluded.document,content_hash=excluded.content_hash,name=excluded.name,image=excluded.image,
        attributes=excluded.attributes,rarity_points=excluded.rarity_points,
        rarity_points_capped=excluded.rarity_points_capped,updated_at=now()`, [JSON.stringify(rendered)]);
    if (stopping) throw new Error("solana_worker_stopping");
  }
}

async function loadRun(checksum: string, assetCount: number): Promise<{ id: number; nextBatch: number; requests: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = (await client.query<{ id: string; next_batch: number; request_count: number; manifest_checksum: string; batch_size: number; fresh: boolean }>(
      `SELECT id::text,next_batch,request_count,manifest_checksum,batch_size,
        started_at>now()-interval '5 minutes' AS fresh
       FROM solana_indexer.scan_run WHERE state='running' ORDER BY id DESC LIMIT 1 FOR UPDATE`
    )).rows[0];
    if (existing && existing.fresh && existing.manifest_checksum === checksum && existing.batch_size === batchSize) {
      await client.query("COMMIT"); return { id:Number(existing.id), nextBatch:existing.next_batch,requests:existing.request_count };
    }
    if (existing) await client.query(`UPDATE solana_indexer.scan_run SET state='abandoned',completed_at=now() WHERE id=$1`,[existing.id]);
    const created = (await client.query<{ id: string }>(`INSERT INTO solana_indexer.scan_run(manifest_checksum,state,asset_count,batch_size)
      VALUES($1,'running',$2,$3) RETURNING id::text`,[checksum,assetCount,batchSize])).rows[0]!;
    await client.query("COMMIT"); return { id:Number(created.id), nextBatch:0,requests:0 };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function meteredBatch(ids: string[], runId: number): Promise<unknown[]> {
  if (!key) throw new Error("HELIUS_API_KEY_missing");
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (lockLost || stopping) throw new Error("solana_worker_stopping");
    if ((requestCount+1)*10 > maxScanCredits) throw new Error("solana_scan_credit_limit");
    const delay = lastRequestAt + requestGapMs - Date.now();
    if (delay > 0) await sleep(delay);
    const usageId = await reserveRpcCredits(pool,"getAssetBatch",runId,10,dailyCredits,rollingCredits);
    lastRequestAt = Date.now(); requestCount++;
    try {
      const result = await getAssetBatch(key,ids,timeoutMs);
      await finishRpcUsage(pool,usageId,"success",null);
      return result;
    } catch (error) {
      const code = error instanceof DasError ? error.code : "das_unexpected_error";
      await finishRpcUsage(pool,usageId,"failed",code);
      if (!(error instanceof DasError) || !error.retryable || attempt+1 === maxRetries) throw error;
      await sleep(Math.min(10_000, 1000 * 2**attempt + Math.floor(Math.random()*500)));
    }
  }
  throw new Error("das_attempts_exhausted");
}

async function fetchVerified(ids: string[], runId: number): Promise<StageItem[]> {
  let response: unknown[];
  try { response = await meteredBatch(ids,runId); }
  catch (error) {
    if (!(error instanceof DasError) || error.code !== "das_asset_missing") throw error;
    if (ids.length === 1) return [{ mint:ids[0]!, status:"missing" }];
    if (repairCalls + 2 > maxRepairCalls) throw new Error("solana_repair_request_limit");
    repairCalls += 2;
    const middle = Math.floor(ids.length/2);
    return [...await fetchVerified(ids.slice(0,middle),runId), ...await fetchVerified(ids.slice(middle),runId)];
  }
  return parseDasBatch(response,ids).map((asset,index) => asset
    ? { ...asset,status:"observed" as const }
    : { mint:ids[index]!,status:"missing" as const });
}

async function stageBatch(runId: number, batchIndex: number, items: StageItem[]) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rows = items.map(item => ({ mint:item.mint,status:item.status,
      owner:item.status==="observed"?item.owner:null,
      burnt:item.status==="observed"?item.burnt:null,
      delegated:item.status==="observed"?item.delegated:false,
      delegate:item.status==="observed"?item.delegate:null,
      metadata_uri:item.status==="observed"?item.metadataUri:null,
      metadata_slot:item.status==="observed"?item.metadataSlot:null,
      observed_at:new Date().toISOString() }));
    await client.query(`INSERT INTO solana_indexer.scan_stage
      (run_id,mint,status,owner,burnt,delegated,delegate,metadata_uri,metadata_slot,observed_at)
      SELECT $2,mint,status,owner,burnt,delegated,delegate,metadata_uri,metadata_slot,observed_at
      FROM jsonb_to_recordset($1::jsonb) AS x(mint text,status text,owner text,burnt boolean,
        delegated boolean,delegate text,metadata_uri text,metadata_slot bigint,observed_at timestamptz)
      ON CONFLICT(run_id,mint) DO NOTHING`,[JSON.stringify(rows),runId]);
    const advanced = await client.query(`UPDATE solana_indexer.scan_run SET next_batch=$2,request_count=$3
      WHERE id=$1 AND state='running' AND next_batch=$2-1`,[runId,batchIndex+1,requestCount]);
    if (advanced.rowCount !== 1) throw new Error("solana_scan_checkpoint_conflict");
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function publishScan(runId: number, expected: number) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const run = (await client.query<{state:string;error_code:string|null;asset_count:number;manifest_checksum:string;fresh:boolean}>(
      `SELECT state,error_code,asset_count,manifest_checksum,
        started_at>now()-interval '30 minutes' AS fresh
       FROM solana_indexer.scan_run WHERE id=$1 AND id=(SELECT max(id) FROM solana_indexer.scan_run)
       FOR UPDATE`,[runId])).rows[0];
    const manifest = (await client.query<{checksum:string;asset_count:number}>(
      `SELECT checksum,asset_count FROM solana_indexer.manifest WHERE singleton`)).rows[0];
    if (!run || !manifest || !run.fresh || run.asset_count!==expected
      || manifest.asset_count!==expected || run.manifest_checksum!==manifest.checksum
      || !(run.state==="running" || (run.state==="failed" && run.error_code==="solana_scan_incomplete")))
      throw new Error("solana_scan_publish_guard_failed");
    const status = (await client.query<{ total: string; missing: string }>(`SELECT count(*)::text AS total,
      count(*) FILTER (WHERE status='missing')::text AS missing
      FROM solana_indexer.scan_stage WHERE run_id=$1`,[runId])).rows[0]!;
    if (Number(status.total) !== expected || Number(status.missing) > maxMissing) {
      throw new Error("solana_scan_incomplete");
    }
    await client.query(`INSERT INTO solana_indexer.observed_change
      (run_id,mint,previous_owner,owner,previous_burnt,burnt,observed_at)
      SELECT $1,s.mint,t.owner,s.owner,t.burnt,s.burnt,s.observed_at
      FROM solana_indexer.scan_stage s JOIN solana_indexer.token t USING(mint)
      WHERE s.run_id=$1 AND s.status='observed'
        AND (s.owner IS DISTINCT FROM t.owner OR s.burnt IS DISTINCT FROM t.burnt)
      ON CONFLICT DO NOTHING`,[runId]);
    await client.query(`INSERT INTO solana_indexer.token
      (mint,owner,burnt,delegated,delegate,metadata_uri,metadata_slot,observed_at,published_run_id)
      SELECT mint,owner,burnt,delegated,delegate,metadata_uri,metadata_slot,observed_at,$1
      FROM solana_indexer.scan_stage WHERE run_id=$1 AND status='observed'
      ON CONFLICT(mint) DO UPDATE SET owner=excluded.owner,burnt=excluded.burnt,
        delegated=excluded.delegated,delegate=excluded.delegate,metadata_uri=excluded.metadata_uri,
        metadata_slot=excluded.metadata_slot,observed_at=excluded.observed_at,
        published_run_id=excluded.published_run_id`,[runId]);
    // An omitted DAS asset has unknown current ownership. Do not retain a stale owner.
    await client.query(`DELETE FROM solana_indexer.token t USING solana_indexer.scan_stage s
      WHERE s.run_id=$1 AND s.status='missing' AND t.mint=s.mint`,[runId]);
    const updated = await client.query(`UPDATE solana_indexer.scan_run SET state='published',missing_count=$2,
      completed_at=now(),error_code=NULL WHERE id=$1 AND (state='running' OR (state='failed' AND error_code='solana_scan_incomplete'))`,[runId,Number(status.missing)]);
    if (updated.rowCount!==1) throw new Error("solana_scan_publish_conflict");
    await client.query(`DELETE FROM solana_indexer.wallet_stats`);
    await client.query(`INSERT INTO solana_indexer.wallet_stats
      (owner,monster_count,total_rarity,unique_types,special_count,glitter_count,
        collector_score,updated_at,published_run_id)
      WITH traits AS (
        SELECT t.owner,m.rarity_points_capped,
          max(a->>'value') FILTER (WHERE a->>'trait_type'='Type') AS monster_type,
          bool_or(a->>'trait_type'='Special' AND a->>'value'='Yes') AS is_special,
          bool_or(a->>'trait_type'='Glitter' AND a->>'value'<>'None') AS is_glitter
        FROM solana_indexer.token t JOIN solana_indexer.asset_metadata m USING(mint)
        LEFT JOIN LATERAL jsonb_array_elements(m.attributes) a ON true
        WHERE NOT t.burnt GROUP BY t.mint,t.owner,m.rarity_points_capped
      ), totals AS (
        SELECT owner,count(*)::int AS monster_count,
          sum(COALESCE(rarity_points_capped,0)) AS total_rarity,
          count(DISTINCT monster_type)::int AS unique_types,
          count(*) FILTER (WHERE is_special)::int AS special_count,
          count(*) FILTER (WHERE is_glitter)::int AS glitter_count
        FROM traits GROUP BY owner
      )
      SELECT owner,monster_count,total_rarity,unique_types,special_count,glitter_count,
        round((1000*ln(1+total_rarity)+50*monster_count+500*unique_types
          +750*special_count+250*glitter_count)::numeric,4),now(),$1 FROM totals`,[runId]);
    await client.query(`UPDATE solana_indexer.sync_state SET published_run_id=$1,
      next_scan_at=now()+($2::integer*interval '1 millisecond'),last_error=NULL,updated_at=now()
      WHERE singleton`,[runId,intervalMs]);
    await client.query(`DELETE FROM solana_indexer.scan_stage WHERE run_id<>$1`,[runId]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function syncOnce() {
  // Held for the entire scan. A second service instance exits without spending RPC credits.
  const lock = await pool.connect();
  lockLost = false;
  lock.on("error", () => { lockLost = true; stopping = true; });
  let activeRunId: number | null = null;
  try {
    const obtained = (await lock.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(hashtext('solana:indexer:worker')) AS locked`
    )).rows[0]?.locked;
    if (!obtained) throw new Error("solana_worker_already_running");
    const { release, assets, checksum } = await archiveManifest();
    await persistManifest(release,assets,checksum);
    await ensureMetadata(release);
    const ordered = [...assets].sort((a,b) => a.mint < b.mint ? -1 : a.mint > b.mint ? 1 : 0);
    const run = await loadRun(checksum,ordered.length);
    activeRunId = run.id;
    repairCalls = 0; requestCount = run.requests;
    for (let index = run.nextBatch; index*batchSize < ordered.length; index++) {
      if (stopping) break;
      const ids = ordered.slice(index*batchSize,(index+1)*batchSize).map(a => a.mint);
      const items = await fetchVerified(ids,run.id);
      await stageBatch(run.id,index,items);
    }
    if (stopping || lockLost) return { state:"stopping",runId:run.id };
    await publishScan(run.id,ordered.length);
    return { state:"published",runId:run.id,assets:ordered.length,requests:requestCount };
  } catch (error) {
    const code = error instanceof RpcBudgetExhausted ? error.message
      : error instanceof DasError ? error.code
        : error instanceof Error && /^(solana_|das_|HELIUS_API_KEY)/.test(error.message) ? error.message : "internal_error";
    if (code === "solana_scan_incomplete" && activeRunId !== null) {
      await pool.query(`UPDATE solana_indexer.scan_run SET state='failed',completed_at=now(),
        error_code=$2,missing_count=(SELECT count(*)::int FROM solana_indexer.scan_stage WHERE run_id=$1 AND status='missing')
        WHERE id=$1 AND state='running'`,[activeRunId,code]).catch(()=>undefined);
    }
    const retryMs = code === "das_transport_error" || code === "das_rate_limited" ? 300_000 : intervalMs;
    await pool.query(`UPDATE solana_indexer.sync_state SET last_error=$1,
      next_scan_at=now()+($2::integer*interval '1 millisecond'),updated_at=now() WHERE singleton`,
      [code,retryMs]).catch(()=>undefined);
    throw error;
  } finally {
    await lock.query(`SELECT pg_advisory_unlock(hashtext('solana:indexer:worker'))`).catch(()=>undefined);
    lock.release();
  }
}

async function main() {
  if (process.env.SOLANA_SYNC_ENABLED !== "true") throw new Error("SOLANA_SYNC_ENABLED must be true");
  if (!key) throw new Error("HELIUS_API_KEY is required");
  process.on("SIGTERM",() => { stopping=true; });
  process.on("SIGINT",() => { stopping=true; });
  while (!stopping) {
    const scheduled = await pool.query<{ next_scan_at: Date }>(
      `SELECT next_scan_at FROM solana_indexer.sync_state WHERE singleton`
    ).catch(() => ({ rows: [] as { next_scan_at: Date }[] }));
    const until = scheduled.rows[0]?.next_scan_at
      ? new Date(scheduled.rows[0].next_scan_at).getTime()-Date.now() : 0;
    if (until > 0) {
      for (let elapsed=0;elapsed<until && !stopping;elapsed+=1000)
        await sleep(Math.min(1000,until-elapsed));
      if (stopping) break;
    }
    try { console.log("Solana scan",await syncOnce()); }
    catch (error) { console.error("Solana scan failed", {
      code:error instanceof RpcBudgetExhausted ? error.message
        : error instanceof DasError ? error.code
          : error instanceof Error && /^(solana_|das_|HELIUS_API_KEY)/.test(error.message) ? error.message : "internal_error"
    }); }
    if (stopping) break;
    let next: Date | undefined;
    try { next = (await pool.query<{ next_scan_at: Date }>(`SELECT next_scan_at FROM solana_indexer.sync_state WHERE singleton`)).rows[0]?.next_scan_at; }
    catch { next = new Date(Date.now()+intervalMs); }
    const delay = Math.max(1000, Math.min(intervalMs, next ? new Date(next).getTime()-Date.now() : intervalMs));
    for (let elapsed = 0; elapsed < delay && !stopping; elapsed += 1000) await sleep(Math.min(1000,delay-elapsed));
  }
  await pool.end();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { process.exitCode=1; });
}
