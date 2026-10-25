import { createRequire as __runtimeCreateRequire } from "node:module"; const require = __runtimeCreateRequire(import.meta.url);

// scripts/unified-observer.ts
import { createHash as createHash2 } from "node:crypto";
import { readFileSync as readFileSync2 } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";

// ../../packages/yunipals-indexer-server/src/database.ts
function sqlIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value) || Buffer.byteLength(value) > 63)
    throw new Error("Invalid shared indexer SQL identifier.");
  return `"${value}"`;
}
async function indexerTransaction(pool, task, readOnly = false) {
  const db = await pool.connect();
  try {
    await db.query(
      readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN ISOLATION LEVEL REPEATABLE READ"
    );
    const result = await task(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

// ../../packages/yunipals-indexer-client/src/sources.ts
function confirmationPolicyKey(policy) {
  switch (policy.kind) {
    case "latest":
    case "finalized":
      return policy.kind;
    case "depth":
      if (!Number.isSafeInteger(policy.subsequentBlocks) || policy.subsequentBlocks < 1) {
        throw new Error("Confirmation depth must be a positive safe integer.");
      }
      return `depth:${policy.subsequentBlocks}`;
    default:
      throw new Error("Unsupported confirmation policy.");
  }
}
var features = [
  "ownership",
  "islands",
  "boosters",
  "base-metadata",
  "marketplace",
  "arena"
];
var chains = /* @__PURE__ */ new Set([1, 56, 137, 8453]);
var decimal = /^(0|[1-9][0-9]*)$/;
function validateSourceManifest(manifest) {
  if (manifest.version !== 1 || manifest.ponderVersion !== "0.17.5" || manifest.ordering !== "multichain" || manifest.coverage !== "ponder-live-blocks-v1") {
    throw new Error("Unsupported source manifest runtime.");
  }
  const ids = /* @__PURE__ */ new Set();
  const subscriptions = /* @__PURE__ */ new Set();
  for (const source of manifest.sources) {
    if (!/^[a-z0-9][a-z0-9:_-]*$/.test(source.id) || ids.has(source.id)) {
      throw new Error("Invalid or duplicate source ID.");
    }
    ids.add(source.id);
    if (!features.includes(source.feature) || !chains.has(source.chainId) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(source.contractName) || typeof source.enabled !== "boolean" || !/^0x[0-9a-f]{64}$/.test(source.abiHash) || !["none", "full"].includes(source.receiptRequirement)) {
      throw new Error(`Invalid source configuration: ${source.id}.`);
    }
    if (source.address !== null && (!/^0x[0-9a-f]{40}$/.test(source.address) || /^0x0{40}$/.test(source.address))) {
      throw new Error(`Invalid source address: ${source.id}.`);
    }
    for (const value of [source.startBlock, source.endBlock]) {
      if (value !== null && (!decimal.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER))) {
        throw new Error(`Invalid source block: ${source.id}.`);
      }
    }
    if (source.enabled && (source.address === null || source.startBlock === null) || source.endBlock !== null && (source.startBlock === null || BigInt(source.endBlock) < BigInt(source.startBlock))) {
      throw new Error(`Incomplete source bounds: ${source.id}.`);
    }
    if (source.receiptStartBlock !== void 0 && (!source.enabled || source.receiptRequirement !== "full" || typeof source.receiptStartBlock !== "string" || !decimal.test(source.receiptStartBlock) || BigInt(source.receiptStartBlock) > BigInt(Number.MAX_SAFE_INTEGER) || source.startBlock === null || BigInt(source.receiptStartBlock) < BigInt(source.startBlock) || source.endBlock !== null && BigInt(source.receiptStartBlock) > BigInt(source.endBlock))) {
      throw new Error(`Invalid source receipt history: ${source.id}.`);
    }
    if (source.events.length === 0 || new Set(source.events).size !== source.events.length || source.events.some((event) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(event)) || source.policies.length === 0) {
      throw new Error(`Invalid source filters: ${source.id}.`);
    }
    const policies = source.policies.map(confirmationPolicyKey);
    if (new Set(policies).size !== policies.length) {
      throw new Error(`Duplicate confirmation policy: ${source.id}.`);
    }
    if (source.enabled) {
      for (const event of source.events) {
        const subscription = JSON.stringify([
          source.chainId,
          source.address,
          event
        ]);
        if (subscriptions.has(subscription)) {
          throw new Error(`Duplicate source subscription: ${source.id}.`);
        }
        subscriptions.add(subscription);
      }
    }
  }
}

// ../../packages/yunipals-indexer-server/src/identity.ts
import { createHash } from "node:crypto";
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object2 = value;
    return `{${Object.keys(object2).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object2[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === void 0)
    throw new Error("Manifest contains a non-JSON value.");
  return encoded;
}
function manifestDigest(value) {
  return `0x${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}
function sourceManifestHash(manifest) {
  validateSourceManifest(manifest);
  return manifestDigest({
    ...manifest,
    sources: [...manifest.sources].sort((a, b) => a.id.localeCompare(b.id))
  });
}

// ../../packages/yunipals-indexer-client/src/ponder.ts
function decodePonderCheckpoint(value) {
  if (!/^[0-9]{75}$/.test(value)) {
    throw new Error("Unsupported Ponder checkpoint encoding.");
  }
  return {
    blockTimestamp: BigInt(value.slice(0, 10)),
    chainId: BigInt(value.slice(10, 26)),
    blockNumber: BigInt(value.slice(26, 42)),
    transactionIndex: BigInt(value.slice(42, 58)),
    eventType: Number(value.slice(58, 59)),
    eventIndex: BigInt(value.slice(59, 75))
  };
}
function completePonderBlock(value, chainId) {
  const checkpoint = decodePonderCheckpoint(value);
  if (/^0{75}$/.test(value)) return null;
  if (checkpoint.chainId !== BigInt(chainId)) {
    throw new Error("Ponder checkpoint chain mismatch.");
  }
  const isBlockEnd = checkpoint.transactionIndex === 9999999999999999n && checkpoint.eventType === 9 && checkpoint.eventIndex === 9999999999999999n;
  const block = checkpoint.blockNumber - (isBlockEnd ? 0n : 1n);
  return block < 0n ? null : block;
}
function ponderChainCoverage(row) {
  if (!/^[1-9][0-9]*$/.test(row.chain_id)) {
    throw new Error("Invalid Ponder checkpoint chain ID.");
  }
  const chainId = Number(row.chain_id);
  if (!Number.isSafeInteger(chainId)) {
    throw new Error("Invalid Ponder checkpoint chain ID.");
  }
  return {
    chainId,
    chainName: row.chain_name,
    completeThroughBlock: completePonderBlock(row.latest_checkpoint, chainId),
    // These are Ponder recovery boundaries, never RPC/consensus finality.
    recoveryThroughBlock: completePonderBlock(row.safe_checkpoint, chainId),
    frameworkFinalizedThroughBlock: completePonderBlock(
      row.finalized_checkpoint,
      chainId
    )
  };
}

// ../../packages/yunipals-indexer-server/src/ponder-reader.ts
async function readPonderRuntime(db, schemaName) {
  const schema = sqlIdentifier(schemaName);
  const { rows } = await db.query(`
    SELECT value AS app, COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'chain_id', chain_id::text, 'chain_name', chain_name,
        'latest_checkpoint', latest_checkpoint,
        'safe_checkpoint', safe_checkpoint,
        'finalized_checkpoint', finalized_checkpoint
      ) ORDER BY chain_id) FROM ${schema}._ponder_checkpoint
    ), '[]'::jsonb) AS checkpoints, COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'chain_id', chain_id, 'block_number', block_number::text,
        'block_hash', block_hash, 'parent_hash', parent_hash, 'timestamp', timestamp::text
      ) ORDER BY chain_id) FROM ${schema}.chain_checkpoint
    ), '[]'::jsonb) AS witnesses
    FROM ${schema}._ponder_meta WHERE key='app'
  `);
  const row = rows[0];
  if (!row || row.app.version !== "6" || !row.app.build_id || !Number.isSafeInteger(row.app.heartbeat_at) || row.app.heartbeat_at < 0 || ![0, 1].includes(row.app.is_locked) || ![0, 1].includes(row.app.is_ready) || row.app.is_dev !== 0) {
    throw new Error(
      "Unsupported or missing production Ponder runtime metadata."
    );
  }
  const chains3 = row.checkpoints.map(ponderChainCoverage);
  if (new Set(chains3.map((chain) => chain.chainId)).size !== chains3.length) {
    throw new Error("Conflicting Ponder chain checkpoints.");
  }
  const witnesses = row.witnesses.map((witness) => {
    if (!Number.isSafeInteger(witness.chain_id) || !/^(0|[1-9][0-9]*)$/.test(witness.block_number) || !/^(0|[1-9][0-9]*)$/.test(witness.timestamp) || !/^0x[0-9a-f]{64}$/.test(witness.block_hash) || !/^0x[0-9a-f]{64}$/.test(witness.parent_hash)) {
      throw new Error("Invalid Ponder block witness.");
    }
    return {
      chainId: witness.chain_id,
      blockNumber: BigInt(witness.block_number),
      blockHash: witness.block_hash,
      parentHash: witness.parent_hash,
      timestamp: BigInt(witness.timestamp)
    };
  });
  if (new Set(witnesses.map((witness) => witness.chainId)).size !== witnesses.length || witnesses.some(
    (witness) => !chains3.some((chain) => chain.chainId === witness.chainId)
  )) {
    throw new Error("Conflicting Ponder block witnesses.");
  }
  return {
    schema: schemaName,
    buildId: row.app.build_id,
    observedAtMs: row.app.heartbeat_at,
    running: row.app.is_locked === 1,
    frameworkReady: row.app.is_ready === 1,
    chains: chains3,
    witnesses
  };
}

// ../../packages/yunipals-indexer-server/src/releases.ts
async function readBoundRuntime(db, release) {
  validateSourceManifest(release.manifest);
  if (sourceManifestHash(release.manifest) !== release.manifestHash)
    throw new Error("Release manifest hash mismatch.");
  const runtime = await readPonderRuntime(db, release.schema);
  if (runtime.buildId !== release.buildId)
    throw new Error(
      "Ponder build changed; a new candidate release is required."
    );
  const { rows } = await db.query(
    `SELECT id,chain_id,manifest_hash,definition FROM ${sqlIdentifier(release.schema)}.indexer_source ORDER BY id`
  );
  if (rows.length !== release.manifest.sources.length)
    throw new Error("Ponder source setup is incomplete.");
  for (const row of rows) {
    const expected = release.manifest.sources.find(
      (source) => source.id === row.id
    );
    if (!expected || row.chain_id !== expected.chainId || row.manifest_hash !== release.manifestHash || manifestDigest(JSON.parse(row.definition)) !== manifestDigest(expected)) {
      throw new Error(
        "Ponder source definition does not match the registered release."
      );
    }
  }
  return runtime;
}
async function loadIndexerRelease(db, id) {
  const { rows } = await db.query(
    id ? "SELECT * FROM yunipals_indexer_control.release WHERE id=$1" : `SELECT r.* FROM yunipals_indexer_control.active_release a
      JOIN yunipals_indexer_control.release r ON r.id=a.release_id WHERE a.name='main'`,
    id ? [id] : []
  );
  const row = rows[0];
  if (!row) throw new Error("No selected shared indexer release.");
  const release = {
    id: row.id,
    schema: row.physical_schema,
    buildId: row.build_id,
    manifestHash: row.manifest_hash,
    manifest: row.manifest
  };
  validateSourceManifest(release.manifest);
  if (release.manifestHash !== sourceManifestHash(release.manifest) || release.id !== manifestDigest({
    schema: release.schema,
    buildId: release.buildId,
    manifestHash: release.manifestHash
  }))
    throw new Error("Stored indexer release identity is invalid.");
  return release;
}

// ../../packages/yunipals-indexer-server/src/chain-status.ts
async function readChainStatus(db, releaseId, chainId) {
  return (await db.query(
    `SELECT revision::text,head_number::text,head_hash,head_timestamp::text,
    finalized_number::text,finalized_hash,witness_number::text,witness_hash,
    observed_at_ms::text,provider_id,anchors,halted,error_code,finality_error_code
    FROM yunipals_indexer_control.chain_status WHERE release_id=$1 AND chain_id=$2`,
    [releaseId, chainId]
  )).rows[0] ?? null;
}

// lib/unified/observer.ts
function validBlock(block, number) {
  if (block.number < 0n || block.timestamp < 0n || number !== void 0 && block.number !== number || !/^0x[0-9a-f]{64}$/.test(block.hash) || /^0x0{64}$/.test(block.hash) || !/^0x[0-9a-f]{64}$/.test(block.parentHash))
    throw new Error("invalid_block");
  return block;
}
var anchor = (block) => ({
  number: String(block.number),
  hash: block.hash,
  timestamp: String(block.timestamp)
});
async function observeIndexerChain(pool, release, chainId, rpc, options = {}) {
  const now = options.now ?? Date.now;
  if (!Number.isSafeInteger(now()) || !Number.isSafeInteger(options.maxHeadAgeMs ?? 18e4) || (options.maxHeadAgeMs ?? 18e4) <= 0) {
    throw new Error("Invalid chain observation clock or freshness limit.");
  }
  const read = await indexerTransaction(
    pool,
    async (db) => ({
      runtime: await readBoundRuntime(db, release),
      previous: await readChainStatus(db, release.id, chainId)
    }),
    true
  );
  const revision = read.previous?.revision ?? "0";
  if (read.previous?.halted) return "halted";
  const chain = read.runtime.chains.find((chain2) => chain2.chainId === chainId);
  const witness = read.runtime.witnesses.find(
    (witness2) => witness2.chainId === chainId
  );
  const commitError = async (code, halt = false) => {
    const result = await pool.query(
      `INSERT INTO yunipals_indexer_control.chain_status(release_id,chain_id,revision,halted,error_code)
      VALUES($1,$2,1,$4,$5) ON CONFLICT(release_id,chain_id) DO UPDATE
      SET revision=chain_status.revision+1,halted=chain_status.halted OR $4,error_code=$5,checked_at=clock_timestamp()
      WHERE chain_status.revision=$3::bigint`,
      [release.id, chainId, revision, halt, code]
    );
    return result.rowCount !== 1 ? "superseded" : halt ? "halted" : "waiting";
  };
  if (!chain || chain.completeThroughBlock === null || !witness || !read.runtime.running || now() - read.runtime.observedAtMs > 18e4 || read.runtime.observedAtMs > now())
    return commitError("indexer_not_ready");
  const indexed = chain.completeThroughBlock < witness.blockNumber ? chain.completeThroughBlock : witness.blockNumber;
  const commitProviderLag = async () => {
    const previous = read.previous;
    const maximumAge = Math.min(options.maxHeadAgeMs ?? 18e4, 18e4);
    const unsigned = (value) => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
    const hash = (value) => typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0{64}$/.test(value);
    const fresh = () => previous !== null && unsigned(previous.observed_at_ms) && BigInt(previous.observed_at_ms) <= BigInt(now()) && BigInt(now()) - BigInt(previous.observed_at_ms) <= BigInt(maximumAge) && unsigned(previous.head_timestamp) && BigInt(previous.head_timestamp) * 1000n <= BigInt(now() + 3e4) && BigInt(now()) - BigInt(previous.head_timestamp) * 1000n <= BigInt(maximumAge);
    const anchors = Object.entries(previous?.anchors ?? {});
    const maximumAnchors = 1 + release.manifest.sources.filter((source) => source.enabled && source.chainId === chainId).reduce((count, source) => count + source.policies.length, 0);
    if (previous && !previous.halted && (previous.error_code === null || previous.error_code === "provider_lag") && fresh() && unsigned(previous.head_number) && hash(previous.head_hash) && unsigned(previous.witness_number) && hash(previous.witness_hash) && BigInt(previous.witness_number) <= BigInt(previous.head_number) && anchors.length > 0 && anchors.length <= maximumAnchors && anchors.every(
      ([key, value]) => unsigned(key) && value !== null && value.number === key && hash(value.hash) && unsigned(value.timestamp) && BigInt(key) <= BigInt(previous.witness_number) && BigInt(value.timestamp) <= BigInt(previous.head_timestamp)
    )) {
      const retained = await indexerTransaction(pool, async (db) => {
        const current = await readBoundRuntime(db, release);
        const coverage = current.chains.find(
          (chain2) => chain2.chainId === chainId
        )?.completeThroughBlock;
        if (!current.running || !current.frameworkReady || now() - current.observedAtMs > 18e4 || current.observedAtMs > now() || coverage === null || coverage === void 0 || anchors.some(([height]) => BigInt(height) > coverage) || !fresh())
          return false;
        const proof = await db.query(
          `SELECT 1 WHERE EXISTS (SELECT 1 FROM ${sqlIdentifier(release.schema)}.chain_block
             WHERE chain_id=$1 AND block_number=$2::bigint AND block_hash=$3)
           AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset($4::jsonb) AS a(number text,hash text)
             WHERE NOT EXISTS (SELECT 1 FROM yunipals_indexer_control.chain_anchor c
               WHERE c.release_id=$5 AND c.chain_id=$1 AND c.block_number=a.number::bigint
                 AND c.block_hash=a.hash AND c.witness_number=$2::bigint AND c.witness_hash=$3))`,
          [
            chainId,
            previous.witness_number,
            previous.witness_hash,
            JSON.stringify(anchors.map(([, value]) => value)),
            release.id
          ]
        );
        if (proof.rowCount !== 1 || !fresh()) return false;
        const result = await db.query(
          `UPDATE yunipals_indexer_control.chain_status SET revision=revision+1,
             error_code=NULL,checked_at=clock_timestamp()
           WHERE release_id=$1 AND chain_id=$2 AND revision=$3::bigint AND NOT halted
             AND (error_code IS NULL OR error_code='provider_lag')
             AND observed_at_ms=$4::bigint AND witness_number=$5::bigint AND witness_hash=$6
             AND anchors=$7::jsonb`,
          [
            release.id,
            chainId,
            revision,
            previous.observed_at_ms,
            previous.witness_number,
            previous.witness_hash,
            JSON.stringify(previous.anchors)
          ]
        );
        return result.rowCount === 1 ? "waiting_retained" : "superseded";
      });
      if (retained !== false) return retained;
    }
    return commitError(
      previous?.error_code && previous.error_code !== "provider_lag" ? previous.error_code : "provider_lag"
    );
  };
  try {
    if (await rpc.chainId() !== chainId)
      return commitError("rpc_chain_mismatch");
    let finalized = null;
    let finalityError = null;
    try {
      finalized = validBlock(await rpc.block("finalized"));
    } catch {
      finalityError = "finality_unavailable";
    }
    const head = validBlock(await rpc.block("latest"));
    const cache = /* @__PURE__ */ new Map([[head.number, head]]);
    const blockAt = async (number) => {
      const cached = cache.get(number);
      if (cached) return cached;
      const block = validBlock(await rpc.block(number), number);
      cache.set(number, block);
      return block;
    };
    const freshHead = () => head.timestamp * 1000n <= BigInt(now() + 3e4) && BigInt(now()) - head.timestamp * 1000n <= BigInt(options.maxHeadAgeMs ?? 18e4);
    if (!freshHead()) return commitError("head_stale");
    if (read.previous?.head_number !== null && read.previous?.head_number !== void 0 && head.number < BigInt(read.previous.head_number))
      return commitProviderLag();
    if (read.previous?.finalized_number !== null && read.previous?.finalized_number !== void 0 && (await blockAt(BigInt(read.previous.finalized_number))).hash !== read.previous.finalized_hash) {
      return commitError("finalized_history_changed", true);
    }
    if (finalized) {
      if (finalized.number > head.number || finalized.timestamp > head.timestamp || finalized.number === head.number && finalized.hash !== head.hash)
        return commitError("provider_inconsistent");
      if (read.previous?.finalized_number !== null && read.previous?.finalized_number !== void 0) {
        if (finalized.number < BigInt(read.previous.finalized_number))
          return commitProviderLag();
      }
      cache.set(finalized.number, finalized);
    }
    if (indexed > head.number || witness.blockNumber > head.number)
      return commitProviderLag();
    if ((await blockAt(witness.blockNumber)).hash !== witness.blockHash)
      return commitError("indexer_branch_mismatch");
    const heights = /* @__PURE__ */ new Set([indexed]);
    for (const source of release.manifest.sources.filter(
      (source2) => source2.enabled && source2.chainId === chainId
    )) {
      for (const policy of source.policies) {
        const boundary = policy.kind === "latest" ? head.number : policy.kind === "depth" ? head.number - BigInt(policy.subsequentBlocks) : finalized?.number;
        if (boundary === void 0 || boundary < 0n) continue;
        let through = boundary < indexed ? boundary : indexed;
        if (source.endBlock !== null && through > BigInt(source.endBlock))
          through = BigInt(source.endBlock);
        if (source.startBlock !== null && through >= BigInt(source.startBlock))
          heights.add(through);
      }
    }
    const anchors = {};
    for (const height of [...heights].sort(
      (a, b) => a < b ? -1 : a > b ? 1 : 0
    ))
      anchors[String(height)] = anchor(await blockAt(height));
    if (validBlock(await rpc.block(head.number), head.number).hash !== head.hash || !freshHead())
      return commitError("observation_changed");
    const observedAt = now();
    return indexerTransaction(pool, async (db) => {
      const current = await readBoundRuntime(db, release);
      const proof = await db.query(
        `SELECT 1 FROM ${sqlIdentifier(release.schema)}.chain_block
        WHERE chain_id=$1 AND block_number=$2::bigint AND block_hash=$3`,
        [chainId, String(witness.blockNumber), witness.blockHash]
      );
      const coverage = current.chains.find(
        (chain2) => chain2.chainId === chainId
      )?.completeThroughBlock;
      if (!current.running || coverage === void 0 || coverage === null || coverage < indexed || proof.rowCount !== 1)
        return "superseded";
      const result = await db.query(
        `INSERT INTO yunipals_indexer_control.chain_status
        (release_id,chain_id,revision,head_number,head_hash,head_timestamp,finalized_number,finalized_hash,
         witness_number,witness_hash,observed_at_ms,provider_id,anchors,error_code,finality_error_code)
        VALUES($1,$2,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NULL,$14)
        ON CONFLICT(release_id,chain_id) DO UPDATE SET revision=chain_status.revision+1,
          head_number=$4,head_hash=$5,head_timestamp=$6,
          finalized_number=COALESCE($7,chain_status.finalized_number),finalized_hash=COALESCE($8,chain_status.finalized_hash),
          witness_number=$9,witness_hash=$10,observed_at_ms=$11,provider_id=$12,anchors=$13,
          error_code=NULL,finality_error_code=$14,checked_at=clock_timestamp()
        WHERE chain_status.revision=$3::bigint AND NOT chain_status.halted`,
        [
          release.id,
          chainId,
          revision,
          String(head.number),
          head.hash,
          String(head.timestamp),
          finalized?.number.toString() ?? null,
          finalized?.hash ?? null,
          String(witness.blockNumber),
          witness.blockHash,
          observedAt,
          rpc.providerId,
          JSON.stringify(anchors),
          finalityError
        ]
      );
      if (result.rowCount !== 1) return "superseded";
      for (const value of Object.values(anchors)) {
        await db.query(
          `INSERT INTO yunipals_indexer_control.chain_anchor
          (release_id,chain_id,block_number,block_hash,witness_number,witness_hash) VALUES($1,$2,$3,$4,$5,$6)
          ON CONFLICT(release_id,chain_id,block_number) DO UPDATE
          SET block_hash=$4,witness_number=$5,witness_hash=$6`,
          [
            release.id,
            chainId,
            value.number,
            value.hash,
            String(witness.blockNumber),
            witness.blockHash
          ]
        );
      }
      await db.query(
        `DELETE FROM yunipals_indexer_control.chain_anchor WHERE release_id=$1 AND chain_id=$2
        AND witness_number<$3::bigint`,
        [release.id, chainId, String(witness.blockNumber - 4096n)]
      );
      return "observed";
    });
  } catch {
    return commitError("rpc_unavailable");
  }
}

// lib/unified/rpc.ts
import { createPublicClient } from "viem";

// lib/rpc.ts
function baseRpcUrlOf(environment = process.env) {
  if (environment.PONDER_RPC_URL_8453) return environment.PONDER_RPC_URL_8453;
  const ethereumUrl = environment.PONDER_RPC_URL_1;
  if (!ethereumUrl) throw new Error("PONDER_RPC_URL_1 is required");
  const url = new URL(ethereumUrl);
  if (url.hostname !== "eth-mainnet.g.alchemy.com") {
    throw new Error("PONDER_RPC_URL_8453 is required unless PONDER_RPC_URL_1 uses Alchemy");
  }
  url.hostname = "base-mainnet.g.alchemy.com";
  return url.toString();
}
function polygonRpcUrlOf(environment = process.env) {
  if (environment.PONDER_RPC_URL_137) return environment.PONDER_RPC_URL_137;
  const ethereumUrl = environment.PONDER_RPC_URL_1;
  if (!ethereumUrl) throw new Error("PONDER_RPC_URL_1 is required");
  const url = new URL(ethereumUrl);
  if (url.hostname !== "eth-mainnet.g.alchemy.com") {
    throw new Error("PONDER_RPC_URL_137 is required unless PONDER_RPC_URL_1 uses Alchemy");
  }
  url.hostname = "polygon-mainnet.g.alchemy.com";
  return url.toString();
}
function bnbRpcUrlOf(environment = process.env) {
  if (environment.PONDER_RPC_URL_56) return environment.PONDER_RPC_URL_56;
  const ethereumUrl = environment.PONDER_RPC_URL_1;
  if (!ethereumUrl) throw new Error("PONDER_RPC_URL_1 is required");
  const url = new URL(ethereumUrl);
  if (url.hostname !== "eth-mainnet.g.alchemy.com") {
    throw new Error("PONDER_RPC_URL_56 is required unless PONDER_RPC_URL_1 uses Alchemy");
  }
  url.hostname = "bnb-mainnet.g.alchemy.com";
  return url.toString();
}

// lib/unified/rpc-preflight.ts
import { readFileSync } from "node:fs";
import { http } from "viem";

// ../../packages/yunipals-indexer-server/src/rpc-policy.ts
var unifiedRpcProfileHeader = "x-yunipals-unified-rpc-profile";
var unifiedRpcPermitHeader = "x-yunipals-unified-rpc-permit";
function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid unified RPC policy.");
  return value;
}
function exact(value, keys) {
  if (Object.keys(value).sort().join() !== [...keys].sort().join())
    throw new Error("Invalid unified RPC policy fields.");
}
function integer(value, maximum) {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum)
    throw new Error("Invalid unified RPC policy limit.");
}
function validateUnifiedRpcProfile(value) {
  const profile = object(value);
  exact(profile, [
    "version",
    "model",
    "scope",
    "coordinatorId",
    "manifest",
    "limits",
    ...profile.reviewId !== void 0 ? ["reviewId"] : []
  ]);
  if (profile.version !== 1 || profile.model !== "alchemy-2026-09-08" || typeof profile.scope !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profile.scope) || typeof profile.coordinatorId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    profile.coordinatorId
  ))
    throw new Error("Invalid unified RPC policy identity.");
  if (profile.reviewId !== void 0 && (typeof profile.reviewId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    profile.reviewId
  )))
    throw new Error("Invalid unified RPC review identity.");
  validateSourceManifest(profile.manifest);
  const limits = object(profile.limits);
  exact(limits, ["batchCalls", "logRange", "addresses", "topicValues"]);
  integer(limits.batchCalls, 100);
  integer(limits.logRange, 1e4);
  integer(limits.addresses, 50);
  integer(limits.topicValues, 128);
  return profile;
}
function unifiedRpcProfileId(profile) {
  validateUnifiedRpcProfile(profile);
  return manifestDigest(profile);
}
function unifiedRpcManifestId(profile) {
  return sourceManifestHash(profile.manifest);
}

// ../../packages/yunipals-market-core/src/seaportEvents.ts
import { parseAbi } from "viem";
var seaportEventAbi = parseAbi([
  "struct OfferItem { uint8 itemType; address token; uint256 identifierOrCriteria; uint256 startAmount; uint256 endAmount; }",
  "struct ConsiderationItem { uint8 itemType; address token; uint256 identifierOrCriteria; uint256 startAmount; uint256 endAmount; address recipient; }",
  "struct OrderParameters { address offerer; address zone; OfferItem[] offer; ConsiderationItem[] consideration; uint8 orderType; uint256 startTime; uint256 endTime; bytes32 zoneHash; uint256 salt; bytes32 conduitKey; uint256 totalOriginalConsiderationItems; }",
  "struct SpentItem { uint8 itemType; address token; uint256 identifier; uint256 amount; }",
  "struct ReceivedItem { uint8 itemType; address token; uint256 identifier; uint256 amount; address recipient; }",
  "event OrderValidated(bytes32 orderHash, OrderParameters orderParameters)",
  "event OrderFulfilled(bytes32 orderHash, address indexed offerer, address indexed zone, address recipient, SpentItem[] offer, ReceivedItem[] consideration)",
  "event OrderCancelled(bytes32 orderHash, address indexed offerer, address indexed zone)",
  "event CounterIncremented(uint256 newCounter, address indexed offerer)"
]);

// lib/abi.ts
import { parseAbi as parseAbi3 } from "viem";

// ../../packages/yunipals-market-core/src/collectionAbi.ts
import { parseAbi as parseAbi2 } from "viem";
var collectionAbi = parseAbi2([
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)",
  "event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function setBaseURI(string baseURI)",
  "function setTokenURI(uint256 tokenId, string tokenURI)"
]);

// lib/abi.ts
var islandsAbi = parseAbi3([
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function tokenByIndex(uint256 index) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function genesisLimit() view returns (uint256)",
  "function metadataStorage() view returns (address)"
]);
var baseIslandsAbi = parseAbi3([
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
  "event OwnershipTransferred(address indexed previousOwner,address indexed newOwner)",
  "event AirdropFinalized(uint256 totalSupply,uint256 sourceBlockNumber,bytes32 sourceBlockHash,bytes32 distributionSha256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function totalSupply() view returns (uint256)"
]);

// lib/boosters/config.ts
import { isAddress, zeroAddress } from "viem";

// lib/constants.ts
var indexedChains = {
  ethereum: { chainId: 1, ensCoinType: 60 },
  base: { chainId: 8453, ensCoinType: 2147492101 },
  polygon: { chainId: 137, ensCoinType: 2147483785 },
  bnb: { chainId: 56, ensCoinType: 2147483704 }
};
var collections = {
  ethereum: {
    slug: "ethereum",
    ...indexedChains.ethereum,
    address: "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d",
    deploymentBlock: 12134519
  },
  base: {
    slug: "base",
    ...indexedChains.base,
    address: "0x98433df878e8c898cb907345c3a7756e5f72240f",
    deploymentBlock: 22224075
  },
  polygon: {
    slug: "polygon",
    ...indexedChains.polygon,
    address: "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d",
    deploymentBlock: 21814218
  },
  bnb: {
    slug: "bnb",
    ...indexedChains.bnb,
    address: "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d",
    deploymentBlock: 7579197
  }
};
var collectionSlugs = Object.keys(collections);
var CHAIN_ID = collections.ethereum.chainId;
var COLLECTION_ADDRESS = collections.ethereum.address;
var DEPLOYMENT_BLOCK = collections.ethereum.deploymentBlock;
var DEFAULT_ADMIN_ROLE = `0x${"00".repeat(32)}`;
var islandCollection = {
  slug: "ethereum-islands",
  chain: "ethereum",
  ...indexedChains.ethereum,
  address: "0xa22e2f53ca787414dc0643c399f92234949e2305",
  deploymentBlock: 14570451,
  deploymentTransaction: "0x5d60ee3e3b46fa806eedfd560be277905c9d5057772dfe5c104b5ce18519897e",
  name: "Grassland Archipelago",
  openseaSlug: "yunipals-islands",
  genesisLimit: 1e3
};
var indexedCollections = {
  ethereum: { ...collections.ethereum, chain: "ethereum" },
  base: { ...collections.base, chain: "base" },
  polygon: { ...collections.polygon, chain: "polygon" },
  bnb: { ...collections.bnb, chain: "bnb" },
  "ethereum-islands": islandCollection,
  "base-islands-v2": {
    slug: "base-islands-v2",
    chain: "base",
    ...indexedChains.base,
    address: "0x79b68a12a2952a9a8d0cc4d0b3fb00252c41d168",
    deploymentBlock: 52587956,
    name: "Grassland Archipelago",
    genesisLimit: 1e3
  }
};
var baseIslandCollection = indexedCollections["base-islands-v2"];

// lib/metadata/base-abi.ts
import { parseAbi as parseAbi4 } from "viem";
var baseMetadataAbi = parseAbi4([
  "event Mint(address indexed to,uint256 indexed tokenId,(uint16 monsterType,uint16 color,uint16 horn,uint8 background,uint8 glitter,uint40 rarityScore) yunipal)",
  "event Update(address indexed to,uint256 indexed tokenId,(uint16 monsterType,uint16 color,uint16 horn,uint8 background,uint8 glitter,uint40 rarityScore) yunipal)",
  "function yunipal(uint256 tokenId) view returns ((uint16 monsterType,uint16 color,uint16 horn,uint8 background,uint8 glitter,uint40 rarityScore))"
]);

// lib/unified/rpc-preflight.ts
var productionEndpoints = {
  1: "http://127.0.0.1:19201/unified",
  8453: "http://127.0.0.1:19202/unified",
  137: "http://127.0.0.1:19203/unified",
  56: "http://127.0.0.1:19204/unified"
};
function unifiedRpcConfiguration(env = process.env) {
  const required = env.UNIFIED_RPC_POLICY_REQUIRED;
  if (required !== void 0 && !["true", "false"].includes(required))
    throw new Error("Invalid unified RPC policy requirement.");
  const path = env.UNIFIED_RPC_PROFILE_FILE;
  if (!path && required !== "true") return null;
  if (!path?.startsWith("/"))
    throw new Error(
      "A reviewed absolute unified RPC profile file is required."
    );
  const profile = validateUnifiedRpcProfile(
    JSON.parse(readFileSync(path, "utf8"))
  );
  if (unifiedRpcProfileId(profile) !== env.UNIFIED_RPC_PROFILE_ID)
    throw new Error("Unified RPC profile hash differs from review.");
  const permit = env.UNIFIED_RPC_REPLAY_PERMIT_ID;
  if (permit && !/^0x[0-9a-f]{64}$/.test(permit))
    throw new Error("Invalid unified RPC permit identity.");
  return {
    profile,
    headers(workload, chainId) {
      const selectedPermit = (chainId ? env[`UNIFIED_RPC_REPLAY_PERMIT_ID_${chainId}`] : void 0) ?? permit;
      if (selectedPermit && !/^0x[0-9a-f]{64}$/.test(selectedPermit))
        throw new Error("Invalid unified RPC permit identity.");
      return {
        "x-yunipals-rpc-workload": workload,
        [unifiedRpcProfileHeader]: unifiedRpcProfileId(profile),
        ...selectedPermit ? { [unifiedRpcPermitHeader]: selectedPermit } : {}
      };
    }
  };
}
async function preflightUnifiedRpc(manifest, env = process.env, options = {}) {
  const config = unifiedRpcConfiguration(env);
  if (!config) return null;
  if (unifiedRpcManifestId(config.profile) !== sourceManifestHash(manifest))
    throw new Error("Unified RPC source manifest differs from review.");
  const endpoints = options.endpoints ?? productionEndpoints;
  const request = options.fetch ?? fetch;
  const diagnostics = [];
  for (const [chain, endpoint] of Object.entries(endpoints)) {
    const chainId = Number(chain);
    const url = env[`PONDER_RPC_URL_${chainId}`];
    if (!url || new URL(url).href !== new URL(endpoint).href)
      throw new Error(
        "Explicit reviewed production budget proxy URLs are required for every chain."
      );
    for (const workload of ["unified_source", "unified_evidence"]) {
      let reply;
      try {
        const result = await request(new URL("/unified/preflight", url), {
          headers: config.headers(workload, chainId),
          signal: AbortSignal.timeout(5e3)
        });
        if (!result.ok) throw new Error("Unavailable RPC policy.");
        reply = await result.json();
      } catch {
        throw new Error("Unified RPC profile/budget preflight unavailable.");
      }
      if (reply.profileId !== unifiedRpcProfileId(config.profile) || reply.manifestHash !== sourceManifestHash(manifest) || reply.chainId !== chainId || reply.coordinatorId !== config.profile.coordinatorId || reply.scope !== config.profile.scope || reply.workload !== workload || reply.paid !== "explicit_bounded_permit_only")
        throw new Error("Unified RPC proxy identity differs from review.");
      if (!reply.budget || typeof reply.budget !== "object" || !reply.replay || typeof reply.replay !== "object")
        throw new Error("Unified RPC budget/permit evidence is missing.");
      diagnostics.push({
        chainId,
        workload,
        budget: reply.budget,
        replay: reply.replay
      });
    }
    try {
      const response = await request(url, {
        method: "POST",
        headers: {
          ...config.headers("unified_evidence", chainId),
          "content-type": "application/json"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_chainId",
          params: []
        }),
        signal: AbortSignal.timeout(5e3)
      });
      const body = await response.json();
      if (!response.ok || body.error || body.result !== `0x${chainId.toString(16)}`)
        throw new Error("Wrong chain.");
    } catch {
      throw new Error("Unified RPC upstream chain check failed.");
    }
  }
  return { ...config, diagnostics };
}
function unifiedRpcHttpTransport(url, chainId, workload, env = process.env, options = {}) {
  const config = unifiedRpcConfiguration(env);
  if (!config) return http(url, options);
  const transport = http(url, {
    ...options,
    batch: {
      batchSize: Math.min(10, config.profile.limits.batchCalls),
      wait: 10
    },
    fetchOptions: { headers: config.headers(workload, chainId) }
  });
  const isolatedSignal = new AbortController().signal;
  const requestSignals = /* @__PURE__ */ new WeakMap();
  return (parameters) => {
    const initialized = transport(parameters);
    return {
      ...initialized,
      request: (args, requestOptions) => {
        let signal = isolatedSignal;
        if (requestOptions?.signal) {
          const input = requestOptions.signal;
          const retained = requestSignals.get(input);
          signal = retained ?? AbortSignal.any([isolatedSignal, input]);
          if (!retained) requestSignals.set(input, signal);
        }
        return initialized.request(args, { ...requestOptions, signal });
      }
    };
  };
}

// lib/unified/rpc.ts
function evidenceRpc(chainId, env = process.env) {
  const urls = {
    1: () => env.PONDER_RPC_URL_1,
    56: () => bnbRpcUrlOf(env),
    137: () => polygonRpcUrlOf(env),
    8453: () => baseRpcUrlOf(env)
  };
  const url = urls[chainId]?.();
  if (!url) throw new Error("Missing shared indexer RPC configuration.");
  const client = createPublicClient({
    transport: unifiedRpcHttpTransport(url, chainId, "unified_evidence", env, {
      timeout: 15e3,
      retryCount: 0
    })
  });
  return {
    // Store a nonsecret selector, never the URL, API key or raw RPC error.
    providerId: `configured-rpc-${chainId}`,
    chainId: () => client.getChainId(),
    block: async (numberOrTag) => {
      const block = await client.getBlock(
        typeof numberOrTag === "bigint" ? { blockNumber: numberOrTag } : { blockTag: numberOrTag }
      );
      if (block.number === null || block.hash === null)
        throw new Error("Pending block is not indexed evidence.");
      return {
        number: block.number,
        hash: block.hash.toLowerCase(),
        parentHash: block.parentHash.toLowerCase(),
        timestamp: block.timestamp
      };
    },
    receipt: (hash) => client.request({
      method: "eth_getTransactionReceipt",
      params: [hash]
    }),
    code: async (address, blockNumber) => await client.getCode({ address, blockNumber }) ?? "0x"
  };
}

// scripts/unified-observer.ts
var combinedObserver = Object.freeze({
  releaseId: "0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3",
  manifestHash: "0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112",
  schema: "unified_ypal_20261023_v1",
  buildId: "71e2a7f3b7",
  profileId: "0xebc51f361d9eb029d93f6f3f0ff2be78be8b7330ab7daff9a43deca1ae99aaff",
  profileSha256: "c77235fd2729cf2676cd0e038c33fa33014f87e1ef12c0f2ab3f3b35be45631b",
  profileFile: "/opt/yunipals-unified/operations/free-replay-20261020/ypal-combined-rpc-v1/profile.json",
  endpoints: Object.freeze({
    1: "http://127.0.0.1:19221/unified",
    8453: "http://127.0.0.1:19222/unified",
    137: "http://127.0.0.1:19223/unified",
    56: "http://127.0.0.1:19224/unified"
  }),
  delays: Object.freeze({ 1: 12e3, 56: 15e3, 137: 3e4, 8453: 4e3 })
});
var observerPoolConfiguration = Object.freeze({
  host: "/var/run/postgresql",
  port: 5432,
  database: "yunipals_backfill",
  user: "yunipals_unified_support",
  max: 2,
  connectionTimeoutMillis: 5e3,
  statement_timeout: 8e3,
  application_name: "yunipals_combined_observer_v1"
});
var chains2 = [1, 56, 137, 8453];
var ordinary = {
  load: loadIndexerRelease,
  runtime: readBoundRuntime,
  preflight: preflightUnifiedRpc,
  rpc: evidenceRpc,
  observe: observeIndexerChain,
  sleep
};
function observerEnvironment(env) {
  if (env.UNIFIED_INDEXER_RELEASE_ID !== combinedObserver.releaseId || env.UNIFIED_RPC_PROFILE_ID !== combinedObserver.profileId || env.UNIFIED_RPC_PROFILE_FILE !== combinedObserver.profileFile || env.UNIFIED_RPC_POLICY_REQUIRED !== "true" || env.UNIFIED_RPC_FREE_ONLY !== "true" || Object.entries(env).some(
    ([key, value]) => key.startsWith("UNIFIED_RPC_REPLAY_PERMIT_ID") && Boolean(value)
  ) || chains2.some(
    (chain) => env[`PONDER_RPC_URL_${chain}`] !== combinedObserver.endpoints[chain]
  ))
    throw new Error("combined_observer_configuration_required");
  return Object.freeze({
    UNIFIED_INDEXER_RELEASE_ID: combinedObserver.releaseId,
    UNIFIED_RPC_PROFILE_ID: combinedObserver.profileId,
    UNIFIED_RPC_PROFILE_FILE: combinedObserver.profileFile,
    UNIFIED_RPC_POLICY_REQUIRED: "true",
    UNIFIED_RPC_FREE_ONLY: "true",
    ...Object.fromEntries(
      chains2.map((chain) => [
        `PONDER_RPC_URL_${chain}`,
        combinedObserver.endpoints[chain]
      ])
    )
  });
}
function releaseIdentity(release) {
  if (release.id !== combinedObserver.releaseId || release.schema !== combinedObserver.schema || release.buildId !== combinedObserver.buildId || release.manifestHash !== combinedObserver.manifestHash || JSON.stringify(
    [
      ...new Set(
        release.manifest.sources.filter((s) => s.enabled).map((s) => s.chainId)
      )
    ].sort((a, b) => a - b)
  ) !== JSON.stringify(chains2))
    throw new Error("combined_observer_release_required");
}
async function runCombinedObserver(pool, command, environment, options = {}) {
  if (!["inspect", "observe-once", "worker"].includes(command))
    throw new Error("combined_observer_command_required");
  const env = observerEnvironment(environment);
  const deps = { ...ordinary, ...options.dependencies };
  const log = options.log ?? (() => {
  });
  const stopping = options.stopping ?? (() => false);
  const release = await deps.load(pool, combinedObserver.releaseId);
  releaseIdentity(release);
  if (command === "inspect") {
    const runtime = await indexerTransaction(
      pool,
      (client) => deps.runtime(client, release),
      true
    );
    log({
      event: "combined_observer_inspected",
      releaseId: release.id,
      buildId: runtime.buildId,
      running: runtime.running,
      frameworkReady: runtime.frameworkReady,
      providerCalls: 0,
      writes: 0
    });
    return;
  }
  const lease = await pool.connect();
  let acquired = false;
  const lock = `yunipals:combined-observer:${release.id}`;
  try {
    acquired = (await lease.query(
      "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired",
      [lock]
    )).rows[0]?.acquired === true;
    if (!acquired) throw new Error("combined_observer_already_running");
    await deps.preflight(release.manifest, env, {
      endpoints: combinedObserver.endpoints
    });
    const rpcs = new Map(chains2.map((chain) => [chain, deps.rpc(chain, env)]));
    const observe = async (chainId) => {
      try {
        const result = await deps.observe(
          pool,
          release,
          chainId,
          rpcs.get(chainId)
        );
        log({
          event: "combined_chain_observation",
          chainId,
          result,
          ...result === "waiting_retained" ? {
            reason: "provider_lag",
            retainedLastGoodProof: true,
            observationTimestampAdvanced: false
          } : {}
        });
      } catch {
        log({ event: "combined_chain_observation_failed", chainId });
      }
    };
    const loop = async (chainId) => {
      while (!stopping()) {
        await observe(chainId);
        for (let waited = 0; waited < combinedObserver.delays[chainId] && !stopping(); waited += 500)
          await deps.sleep(500);
      }
    };
    await Promise.all(
      chains2.map(
        (chain) => command === "worker" ? loop(chain) : observe(chain)
      )
    );
  } finally {
    if (acquired) {
      try {
        await lease.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
          lock
        ]);
      } finally {
        lease.release(true);
      }
    } else lease.release(true);
  }
}
async function combinedObserverMain(args = process.argv.slice(2)) {
  if (args.length !== 1 || !["inspect", "observe-once", "worker"].includes(args[0]))
    throw new Error("Use unified-observer inspect|observe-once|worker.");
  const env = observerEnvironment(process.env);
  if (createHash2("sha256").update(readFileSync2(combinedObserver.profileFile)).digest("hex") !== combinedObserver.profileSha256)
    throw new Error("combined_observer_profile_file_changed");
  const pool = new pg.Pool(observerPoolConfiguration);
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    await runCombinedObserver(pool, args[0], env, {
      stopping: () => stopping,
      log: (value) => console.log(JSON.stringify(value))
    });
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    await pool.end();
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  combinedObserverMain().catch(() => {
    console.error(JSON.stringify({ event: "combined_observer_failed" }));
    process.exitCode = 1;
  });
export {
  combinedObserver,
  combinedObserverMain,
  observerEnvironment,
  observerPoolConfiguration,
  runCombinedObserver
};
//# sourceMappingURL=unified-observer.mjs.map
