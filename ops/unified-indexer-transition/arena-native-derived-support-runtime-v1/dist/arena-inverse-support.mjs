// accepted-native-support:packages/yunipals-indexer-server/src/database.ts
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

// accepted-native-support:packages/yunipals-indexer-client/src/sources.ts
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

// accepted-native-support:packages/yunipals-indexer-client/src/events.ts
function validateCanonicalCursor(cursor) {
  const decimal6 = /^(0|[1-9][0-9]*)$/;
  const hash4 = /^0x[0-9a-f]{64}$/;
  const block = (value) => decimal6.test(value) && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER);
  if (cursor.version !== 1 || !hash4.test(cursor.releaseId) || !cursor.sourceId || !cursor.policy)
    throw new Error("Invalid canonical cursor identity.");
  for (const anchor of [cursor.completed, cursor.target]) {
    if (anchor && (!block(anchor.number) || !hash4.test(anchor.hash)))
      throw new Error("Invalid canonical cursor anchor.");
  }
  if (cursor.target && cursor.completed && BigInt(cursor.target.number) <= BigInt(cursor.completed.number))
    throw new Error("Invalid canonical cursor range.");
  if (cursor.after && (!cursor.target || !block(cursor.after.blockNumber) || !hash4.test(cursor.after.blockHash) || !cursor.after.id || !Number.isSafeInteger(cursor.after.transactionIndex) || cursor.after.transactionIndex < 0 || !Number.isSafeInteger(cursor.after.logIndex) || cursor.after.logIndex < 0 || BigInt(cursor.after.blockNumber) > BigInt(cursor.target.number) || cursor.completed && BigInt(cursor.after.blockNumber) <= BigInt(cursor.completed.number)))
    throw new Error("Invalid canonical cursor position.");
}

// accepted-native-support:packages/yunipals-indexer-client/src/readiness.ts
function evaluateSourceReadiness(source, snapshot, options) {
  if (!Number.isFinite(options.nowMs) || !Number.isFinite(options.maxObservationAgeMs) || options.maxObservationAgeMs <= 0 || options.requiredThroughBlock !== void 0 && options.requiredThroughBlock < 0n) {
    throw new Error("Invalid readiness evaluation options.");
  }
  const result = (reason, availableThroughBlock = null, requiredThroughBlock = null) => ({
    ready: reason === "ready",
    reason,
    availableThroughBlock,
    requiredThroughBlock
  });
  if (!source.enabled) return result("disabled");
  const policyKey = confirmationPolicyKey(options.policy);
  if (!source.policies.some(
    (policy) => confirmationPolicyKey(policy) === policyKey
  )) {
    return result("policy_unsupported");
  }
  if (snapshot.release.schema !== options.expectedRelease.schema || snapshot.release.buildId !== options.expectedRelease.buildId || snapshot.release.manifestHash !== options.expectedRelease.manifestHash)
    return result("release_mismatch");
  if (source.id !== snapshot.sourceId || source.chainId !== snapshot.chainId) {
    return result("source_mismatch");
  }
  if (snapshot.halted) return result("halted");
  if (source.startBlock === null || snapshot.coverageStartBlock > BigInt(source.startBlock))
    return result("history_missing");
  const fresh = (at) => Number.isFinite(at) && at <= options.nowMs && options.nowMs - at <= options.maxObservationAgeMs;
  const valid = (observation) => observation.chainId === source.chainId && observation.blockNumber >= 0n && /^0x[0-9a-f]{64}$/.test(observation.blockHash);
  if (!fresh(snapshot.indexerObservedAtMs) || !snapshot.head || !fresh(snapshot.head.observedAtMs)) {
    return result("observation_stale");
  }
  if (!valid(snapshot.head)) return result("observation_inconsistent");
  let boundary = snapshot.head.blockNumber;
  if (options.policy.kind === "depth") {
    boundary -= BigInt(options.policy.subsequentBlocks);
  } else if (options.policy.kind === "finalized") {
    if (!snapshot.finalized) return result("finality_unavailable");
    if (!fresh(snapshot.finalized.observedAtMs))
      return result("observation_stale");
    if (!valid(snapshot.finalized) || snapshot.finalized.blockNumber > snapshot.head.blockNumber || snapshot.finalized.blockNumber === snapshot.head.blockNumber && snapshot.finalized.blockHash !== snapshot.head.blockHash)
      return result("observation_inconsistent");
    boundary = snapshot.finalized.blockNumber;
  }
  if (source.endBlock !== null && boundary > BigInt(source.endBlock)) {
    boundary = BigInt(source.endBlock);
  }
  const indexed = snapshot.completeThroughBlock;
  const latestComplete = options.policy.kind === "latest" && options.requiredThroughBlock === void 0;
  const required = options.requiredThroughBlock ?? (latestComplete && indexed !== null && indexed < boundary ? indexed : boundary);
  if (indexed === null || indexed < BigInt(source.startBlock)) {
    return result("not_indexed", null, required);
  }
  if (indexed > snapshot.head.blockNumber) {
    return result("observation_inconsistent", null, required);
  }
  const available2 = indexed < boundary ? indexed : boundary;
  return result(
    available2 >= required && required >= BigInt(source.startBlock) && (!latestComplete || snapshot.frameworkReady) ? "ready" : "catching_up",
    available2 < BigInt(source.startBlock) ? null : available2,
    required
  );
}

// accepted-native-support:packages/yunipals-indexer-server/src/chain-status.ts
async function readChainStatus(db, releaseId, chainId) {
  return (await db.query(
    `SELECT revision::text,head_number::text,head_hash,head_timestamp::text,
    finalized_number::text,finalized_hash,witness_number::text,witness_hash,
    observed_at_ms::text,provider_id,anchors,halted,error_code,finality_error_code
    FROM yunipals_indexer_control.chain_status WHERE release_id=$1 AND chain_id=$2`,
    [releaseId, chainId]
  )).rows[0] ?? null;
}

// accepted-native-support:packages/yunipals-indexer-client/src/ponder.ts
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

// accepted-native-support:packages/yunipals-indexer-server/src/ponder-reader.ts
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
  const chains2 = row.checkpoints.map(ponderChainCoverage);
  if (new Set(chains2.map((chain) => chain.chainId)).size !== chains2.length) {
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
    (witness) => !chains2.some((chain) => chain.chainId === witness.chainId)
  )) {
    throw new Error("Conflicting Ponder block witnesses.");
  }
  return {
    schema: schemaName,
    buildId: row.app.build_id,
    observedAtMs: row.app.heartbeat_at,
    running: row.app.is_locked === 1,
    frameworkReady: row.app.is_ready === 1,
    chains: chains2,
    witnesses
  };
}

// accepted-native-support:packages/yunipals-indexer-server/src/identity.ts
import { createHash } from "node:crypto";
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
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
function transactionEvidenceHash(receipt, block) {
  return manifestDigest({ receipt, block });
}

// accepted-native-support:packages/yunipals-indexer-server/src/releases.ts
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

// accepted-native-support:packages/yunipals-indexer-server/src/status.ts
async function readIndexerSourceStatus(db, release, sourceId, policy, options = {}) {
  const source = release.manifest.sources.find(
    (source2) => source2.id === sourceId
  );
  if (!source) throw new Error("Unknown shared indexer source.");
  const runtime = await readBoundRuntime(db, release);
  const status = await readChainStatus(db, release.id, source.chainId);
  const indexed = runtime.chains.find((chain) => chain.chainId === source.chainId)?.completeThroughBlock ?? null;
  const observationTime = Number(status?.observed_at_ms ?? "0");
  const numbers = Object.values(status?.anchors ?? {}).map((anchor2) => {
    if (!/^(0|[1-9][0-9]*)$/.test(anchor2.number) || !/^0x[0-9a-f]{64}$/.test(anchor2.hash))
      throw new Error("Invalid retained chain anchor.");
    return BigInt(anchor2.number);
  });
  const verified = numbers.length ? numbers.reduce((a, b) => a > b ? a : b) : null;
  let branchMatches = false;
  if (status?.witness_number !== null && status?.witness_number !== void 0 && status.witness_hash) {
    branchMatches = (await db.query(
      `SELECT 1 FROM ${sqlIdentifier(release.schema)}.chain_block
      WHERE chain_id=$1 AND block_number=$2::bigint AND block_hash=$3`,
      [source.chainId, status.witness_number, status.witness_hash]
    )).rowCount === 1;
  }
  const observationValid = status !== null && status.error_code === null && branchMatches;
  const snapshot = {
    sourceId,
    chainId: source.chainId,
    release,
    coverageStartBlock: BigInt(source.startBlock ?? "0"),
    frameworkReady: runtime.frameworkReady,
    completeThroughBlock: indexed === null || verified === null ? null : indexed < verified ? indexed : verified,
    indexerObservedAtMs: runtime.observedAtMs,
    halted: status?.halted === true || !runtime.running,
    head: observationValid && status.head_number !== null && status.head_hash ? {
      chainId: source.chainId,
      blockNumber: BigInt(status.head_number),
      blockHash: status.head_hash,
      observedAtMs: observationTime
    } : null,
    finalized: observationValid && status.finality_error_code === null && status.finalized_number !== null && status.finalized_hash ? {
      chainId: source.chainId,
      blockNumber: BigInt(status.finalized_number),
      blockHash: status.finalized_hash,
      observedAtMs: observationTime
    } : null
  };
  let readiness = evaluateSourceReadiness(source, snapshot, {
    expectedRelease: release,
    policy,
    nowMs: options.nowMs ?? Date.now(),
    maxObservationAgeMs: options.maxObservationAgeMs ?? 18e4,
    requiredThroughBlock: options.requiredThroughBlock
  });
  const anchor = readiness.availableThroughBlock === null ? null : status?.anchors[String(readiness.availableThroughBlock)] ?? null;
  const anchorMissing = readiness.availableThroughBlock !== null && (!anchor || anchor.number !== String(readiness.availableThroughBlock) || !/^(0|[1-9][0-9]*)$/.test(anchor.timestamp));
  if (anchorMissing) {
    readiness = {
      ...readiness,
      ready: false,
      reason: "observation_inconsistent",
      availableThroughBlock: null
    };
  }
  return {
    source,
    snapshot,
    readiness,
    anchor: anchorMissing ? null : anchor,
    observationRevision: status?.revision ?? null,
    errorCode: status?.error_code ?? (!branchMatches ? "indexer_witness_unverified" : anchorMissing ? "indexer_anchor_unverified" : null)
  };
}
async function indexerSourceStatus(pool, release, sourceId, policy, options = {}) {
  return indexerTransaction(
    pool,
    (db) => readIndexerSourceStatus(db, release, sourceId, policy, options),
    true
  );
}

// accepted-native-support:packages/yunipals-indexer-server/src/event-topics.ts
function parseIndexedEventTopics(raw) {
  const value = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > 4)
    throw new Error("Invalid indexed event topics.");
  const topics = [];
  let padding = false;
  for (const topic of value) {
    if (topic === null) {
      padding = true;
      continue;
    }
    if (padding || typeof topic !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(topic))
      throw new Error("Invalid indexed event topics.");
    topics.push(topic.toLowerCase());
  }
  return topics;
}

// accepted-native-support:packages/yunipals-indexer-server/src/paging.ts
var CanonicalCursorInvalidated = class extends Error {
};
var CanonicalSourceUnavailable = class extends Error {
};
var receiptKey = (hash4, transaction2) => `${hash4}:${transaction2}`;
async function retainedAnchor(db, release, chainId, anchor) {
  const direct = await db.query(
    `SELECT block_hash FROM ${sqlIdentifier(release.schema)}.chain_block
    WHERE chain_id=$1 AND block_number=$2::bigint`,
    [chainId, anchor.number]
  );
  if (direct.rows[0])
    return direct.rows[0].block_hash === anchor.hash ? "valid" : "changed";
  const retained = await db.query(
    `
    SELECT a.block_hash,a.witness_hash,b.block_hash AS canonical_witness
    FROM yunipals_indexer_control.chain_anchor a LEFT JOIN ${sqlIdentifier(release.schema)}.chain_block b
      ON b.chain_id=a.chain_id AND b.block_number=a.witness_number
    WHERE a.release_id=$1 AND a.chain_id=$2 AND a.block_number=$3::bigint`,
    [release.id, chainId, anchor.number]
  );
  const row = retained.rows[0];
  if (!row || row.canonical_witness !== row.witness_hash) return "expired";
  return row.block_hash === anchor.hash ? "valid" : "changed";
}
async function readCanonicalPage(pool, release, sourceId, policy, options = {}) {
  const pageLimit = options.limit ?? 250;
  if (!Number.isSafeInteger(pageLimit) || pageLimit < 1 || pageLimit > 1e3)
    throw new Error("Invalid canonical page size.");
  const policyKey = confirmationPolicyKey(policy);
  const source = release.manifest.sources.find(
    (source2) => source2.id === sourceId
  );
  if (!source?.enabled || source.startBlock === null)
    throw new CanonicalSourceUnavailable("Source is disabled or unknown.");
  const cursor = options.cursor ?? {
    version: 1,
    releaseId: release.id,
    sourceId,
    policy: policyKey,
    completed: null,
    target: null,
    after: null
  };
  validateCanonicalCursor(cursor);
  if (cursor.releaseId !== release.id || cursor.sourceId !== sourceId || cursor.policy !== policyKey)
    throw new CanonicalCursorInvalidated(
      "Cursor belongs to another release, source or policy."
    );
  const from = cursor.completed ? BigInt(cursor.completed.number) + 1n : BigInt(source.startBlock);
  if (options.includeReceipts && source.receiptStartBlock !== void 0 && from < BigInt(source.receiptStartBlock))
    throw new CanonicalSourceUnavailable(
      "Requested receipt history predates the registered receipt history floor."
    );
  const verified = /* @__PURE__ */ new Set();
  for (const anchor of [cursor.completed, cursor.target]) {
    if (!anchor) continue;
    const retained = await retainedAnchor(
      pool,
      release,
      source.chainId,
      anchor
    );
    if (retained === "changed")
      throw new CanonicalCursorInvalidated("Cursor anchor was reorged.");
    if (retained === "expired") {
      if (!options.verifyOldAnchor)
        throw new CanonicalCursorInvalidated(
          "Cursor anchor expired; refresh or verify it against canonical history."
        );
      if (!await options.verifyOldAnchor(anchor, source.chainId))
        throw new CanonicalCursorInvalidated(
          "Cursor anchor is no longer canonical."
        );
      verified.add(`${anchor.number}:${anchor.hash}`);
    }
  }
  return indexerTransaction(
    pool,
    async (db) => {
      const status = await readIndexerSourceStatus(
        db,
        release,
        sourceId,
        policy,
        { nowMs: options.nowMs }
      );
      if (!["ready", "catching_up"].includes(status.readiness.reason) || !status.anchor || status.readiness.availableThroughBlock === null) {
        throw new CanonicalSourceUnavailable(
          status.errorCode ?? status.readiness.reason
        );
      }
      for (const anchor of [cursor.completed, cursor.target]) {
        if (!anchor) continue;
        const retained = await retainedAnchor(
          db,
          release,
          source.chainId,
          anchor
        );
        if (retained !== "valid" && !(retained === "expired" && verified.has(`${anchor.number}:${anchor.hash}`))) {
          throw new CanonicalCursorInvalidated(
            "Canonical cursor evidence changed during paging."
          );
        }
      }
      if (cursor.after) {
        const previous = await db.query(
          `SELECT 1 FROM ${sqlIdentifier(release.schema)}.canonical_event
        WHERE id=$1 AND source_id=$2 AND block_number=$3::bigint AND block_hash=$4 AND transaction_index=$5 AND log_index=$6`,
          [
            cursor.after.id,
            sourceId,
            cursor.after.blockNumber,
            cursor.after.blockHash,
            cursor.after.transactionIndex,
            cursor.after.logIndex
          ]
        );
        if (previous.rowCount !== 1)
          throw new CanonicalCursorInvalidated(
            "Previously applied event was reorged."
          );
      }
      const target = cursor.target ?? {
        number: status.anchor.number,
        hash: status.anchor.hash
      };
      if (BigInt(target.number) > status.readiness.availableThroughBlock)
        throw new CanonicalSourceUnavailable(
          "Indexer is recovering the cursor boundary."
        );
      if (cursor.completed && BigInt(cursor.completed.number) > status.readiness.availableThroughBlock)
        throw new CanonicalSourceUnavailable(
          "Indexer has not recovered the previously completed cursor boundary."
        );
      if (cursor.completed && BigInt(target.number) <= BigInt(cursor.completed.number)) {
        return {
          events: [],
          receipts: [],
          cursor,
          complete: true,
          waitingReceipt: false
        };
      }
      const rows = (await db.query(
        `SELECT e.*,e.block_number::text,e.timestamp::text,
      EXISTS(SELECT 1 FROM ${sqlIdentifier(release.schema)}.transaction_candidate c
        WHERE c.chain_id=e.chain_id AND c.block_hash=e.block_hash AND c.transaction_hash=e.transaction_hash) AS needs_receipt
      FROM ${sqlIdentifier(release.schema)}.canonical_event e
      WHERE e.source_id=$1 AND e.block_number>=$2::bigint AND e.block_number<=$3::bigint
      AND ($4::bigint IS NULL OR (e.block_number,e.transaction_index,e.log_index)>($4::bigint,$5::integer,$6::integer))
      ORDER BY e.block_number,e.transaction_index,e.log_index LIMIT $7`,
        [
          sourceId,
          String(from),
          target.number,
          cursor.after?.blockNumber ?? null,
          cursor.after?.transactionIndex ?? null,
          cursor.after?.logIndex ?? null,
          pageLimit + 1
        ]
      )).rows;
      const requested = [];
      const identities = /* @__PURE__ */ new Set();
      let candidates = rows.slice(0, pageLimit);
      if (options.includeReceipts) {
        for (let index = 0; index < candidates.length; index++) {
          const event = candidates[index];
          if (!event.needs_receipt) continue;
          const key = receiptKey(event.block_hash, event.transaction_hash);
          if (!identities.has(key)) {
            if (requested.length === 16) {
              candidates = candidates.slice(0, index);
              break;
            }
            identities.add(key);
            requested.push({
              blockHash: event.block_hash,
              transactionHash: event.transaction_hash
            });
          }
        }
      }
      const evidence2 = requested.length ? (await db.query(
        `SELECT r.* FROM yunipals_indexer_control.transaction_evidence r
      JOIN jsonb_to_recordset($2::jsonb) AS x("blockHash" text,"transactionHash" text)
        ON r.block_hash=x."blockHash" AND r.transaction_hash=x."transactionHash" WHERE r.chain_id=$1`,
        [source.chainId, JSON.stringify(requested)]
      )).rows : [];
      const byReceipt = new Map(
        evidence2.map((row) => [
          receiptKey(row.block_hash, row.transaction_hash),
          row
        ])
      );
      const events = [];
      const receipts = /* @__PURE__ */ new Map();
      let bytes = 0;
      let waitingReceipt = false;
      for (const row of candidates) {
        if (row.chain_id !== source.chainId || row.address !== source.address || row.abi_hash !== source.abiHash || !source.events.includes(row.name)) {
          throw new CanonicalSourceUnavailable(
            "Indexed event does not match its source decoder."
          );
        }
        const key = receiptKey(row.block_hash, row.transaction_hash);
        const receipt = options.includeReceipts && row.needs_receipt ? byReceipt.get(key) : void 0;
        if (options.includeReceipts && row.needs_receipt && !receipt) {
          waitingReceipt = true;
          break;
        }
        if (receipt && transactionEvidenceHash(receipt.receipt, receipt.block) !== receipt.payload_hash)
          throw new Error("Receipt evidence checksum mismatch.");
        const event = {
          id: row.id,
          sourceId: row.source_id,
          chainId: row.chain_id,
          address: row.address,
          name: row.name,
          args: JSON.parse(row.args),
          abiHash: row.abi_hash,
          blockNumber: row.block_number,
          blockHash: row.block_hash,
          timestamp: row.timestamp,
          transactionHash: row.transaction_hash,
          transactionIndex: row.transaction_index,
          logIndex: row.log_index,
          topics: parseIndexedEventTopics(row.topics),
          data: row.data
        };
        const size = Buffer.byteLength(JSON.stringify(event)) + (receipt && !receipts.has(key) ? Buffer.byteLength(JSON.stringify(receipt)) : 0);
        if (bytes + size > 8e6) {
          if (!events.length)
            throw new Error("Canonical evidence exceeds page budget.");
          break;
        }
        bytes += size;
        events.push(event);
        if (receipt) receipts.set(key, receipt);
      }
      const complete = !waitingReceipt && events.length === rows.length;
      const last = events.at(-1);
      const next = complete ? { ...cursor, completed: target, target: null, after: null } : {
        ...cursor,
        target,
        after: last ? {
          id: last.id,
          blockNumber: last.blockNumber,
          blockHash: last.blockHash,
          transactionIndex: last.transactionIndex,
          logIndex: last.logIndex
        } : cursor.after
      };
      return {
        events,
        receipts: [...receipts.values()],
        cursor: next,
        complete,
        waitingReceipt
      };
    },
    true
  );
}

// accepted-native-support:packages/yunipals-indexer-server/src/readers.ts
async function createIndexerReader(pool, options = {}) {
  const release = await indexerTransaction(
    pool,
    async (db) => {
      const selected = await loadIndexerRelease(db, options.releaseId);
      await readBoundRuntime(db, selected);
      return selected;
    },
    true
  );
  return {
    release,
    status(sourceId, policy) {
      return indexerSourceStatus(pool, release, sourceId, policy, {
        nowMs: options.now?.()
      });
    },
    page(sourceId, policy, pageOptions) {
      return readCanonicalPage(pool, release, sourceId, policy, {
        nowMs: options.now?.(),
        ...pageOptions
      });
    },
    snapshot(sourceId, policy, read) {
      return indexerTransaction(
        pool,
        async (db) => {
          const status = await readIndexerSourceStatus(
            db,
            release,
            sourceId,
            policy,
            { nowMs: options.now?.() }
          );
          return read(db, { release, status });
        },
        true
      );
    }
  };
}

// accepted-native-support:packages/yunipals-indexer-server/src/arena.ts
var decimal2 = /^(0|[1-9][0-9]*)$/;
var hash = /^0x[0-9a-f]{64}$/;
function sourceOf(reader, definition) {
  if (!/^0x[0-9a-f]{40}$/.test(definition.contract) || /^0x0{40}$/.test(definition.contract) || !decimal2.test(definition.startBlock) || !hash.test(definition.abiHash))
    throw new Error("Invalid Arena read deployment.");
  const source = reader.release.manifest.sources.find(
    (source2) => source2.id === `arena:8453:${definition.contract}`
  );
  if (!source?.enabled || source.feature !== "arena" || source.chainId !== 8453 || source.address !== definition.contract || source.startBlock !== definition.startBlock || source.abiHash !== definition.abiHash)
    throw new Error(
      "Arena read deployment differs from the registered source."
    );
  return source;
}
function available(status) {
  if (!["ready", "catching_up"].includes(status.readiness.reason) || !status.anchor)
    throw new CanonicalSourceUnavailable(
      `Arena source unavailable: ${status.readiness.reason}.`
    );
}
function eventArgs(row) {
  try {
    const args = JSON.parse(row.args);
    if (!args || typeof args !== "object" || Array.isArray(args))
      throw new Error();
    return args;
  } catch {
    throw new CanonicalSourceUnavailable("Arena event payload is invalid.");
  }
}
function evidence(row, source, tournamentId) {
  if (!row || row.source_id !== source.id || row.chain_id !== 8453 || row.address !== source.address || row.abi_hash !== source.abiHash || !source.events.includes(row.name) || !decimal2.test(row.block_number) || !hash.test(row.block_hash) || !hash.test(row.transaction_hash) || !Number.isSafeInteger(row.log_index) || row.log_index < 0 || row.id !== `8453:${source.address}:${row.transaction_hash}:${row.log_index}`)
    throw new CanonicalSourceUnavailable("Arena event evidence is incomplete.");
  const args = eventArgs(row);
  if (!args || typeof args !== "object" || tournamentId !== void 0 && (!("id" in args) || String(args.id) !== tournamentId))
    throw new CanonicalSourceUnavailable(
      "Arena event belongs to another tournament."
    );
  return {
    id: row.id,
    blockNumber: row.block_number,
    blockHash: row.block_hash,
    transactionHash: row.transaction_hash,
    logIndex: row.log_index
  };
}
async function frame(db, reader, status, source) {
  available(status);
  const runtime = await readBoundRuntime(db, reader.release);
  const indexed = runtime.chains.find(
    (chain) => chain.chainId === 8453
  )?.completeThroughBlock;
  if (indexed === null || indexed === void 0)
    throw new CanonicalSourceUnavailable(
      "Arena complete block is unavailable."
    );
  return {
    indexed,
    coverage: {
      releaseId: reader.release.id,
      sourceId: source.id,
      indexedThroughBlock: String(indexed),
      observedThroughBlock: status.anchor.number
    }
  };
}
async function readArenaTransaction(reader, definition, transactionHash, options = {}) {
  const source = sourceOf(reader, definition);
  if (!hash.test(transactionHash) || options.tournamentId !== void 0 && (!decimal2.test(options.tournamentId) || BigInt(options.tournamentId) >= 2n ** 256n) || options.blockNumber === void 0 !== (options.blockHash === void 0) || options.blockNumber !== void 0 && options.blockNumber < 0n || options.blockHash !== void 0 && !hash.test(options.blockHash))
    throw new Error("Invalid Arena transaction proof request.");
  return reader.snapshot(
    source.id,
    { kind: "latest" },
    async (db, { status }) => {
      const { indexed, coverage } = await frame(db, reader, status, source), schema = sqlIdentifier(reader.release.schema);
      const finalizedThroughBlock = status.snapshot.finalized?.blockNumber.toString() ?? null;
      let inclusion = null;
      const empty = {
        ...coverage,
        finalizedThroughBlock,
        events: [],
        origin: null
      };
      if (options.blockNumber !== void 0 && options.blockNumber > indexed)
        return { ...empty, inclusion: "not_indexed" };
      const rows = (await db.query(
        `SELECT id,source_id,chain_id,address,abi_hash,name,args,block_number::text,block_hash,transaction_hash,log_index
      FROM ${schema}.canonical_event WHERE source_id=$1 AND chain_id=8453 AND transaction_hash=$2 ORDER BY log_index LIMIT 257`,
        [source.id, transactionHash]
      )).rows;
      if (rows.length > 256)
        throw new CanonicalSourceUnavailable(
          "Arena transaction event limit exceeded."
        );
      const events = rows.map((row) => ({
        ...evidence(row, source),
        name: row.name,
        args: eventArgs(row)
      }));
      if (events.some((event) => BigInt(event.blockNumber) > indexed))
        return { ...empty, inclusion: "not_indexed" };
      if (options.blockNumber !== void 0) {
        const witness = (await db.query(
          `SELECT block_hash FROM ${schema}.chain_block WHERE chain_id=8453 AND block_number=$1`,
          [String(options.blockNumber)]
        )).rows[0];
        inclusion = witness ? witness.block_hash === options.blockHash ? "canonical" : "changed" : events.some(
          (event) => event.blockNumber === String(options.blockNumber) && event.blockHash === options.blockHash
        ) ? "canonical" : "expired";
        if (events.some(
          (event) => event.blockNumber !== String(options.blockNumber) || event.blockHash !== options.blockHash
        ))
          inclusion = "changed";
      }
      let origin = null;
      if (options.tournamentId !== void 0) {
        const row = (await db.query(
          `SELECT opened_event_id,opened_block_hash,block_number::text FROM ${schema}.arena_tournament WHERE deployment=$1 AND tournament_id=$2`,
          [`8453:${definition.contract}`, options.tournamentId]
        )).rows[0];
        if (row) {
          if (!decimal2.test(row.block_number) || BigInt(row.block_number) > indexed)
            return { ...empty, inclusion: "not_indexed" };
          const opening = (await db.query(
            `SELECT id,source_id,chain_id,address,abi_hash,name,args,block_number::text,block_hash,transaction_hash,log_index
          FROM ${schema}.canonical_event WHERE id=$1`,
            [row.opened_event_id]
          )).rows[0];
          const opened = evidence(opening, source, options.tournamentId);
          if (opening.name !== "TournamentOpened" || opened.blockHash !== row.opened_block_hash || BigInt(opened.blockNumber) > indexed)
            throw new CanonicalSourceUnavailable(
              "Arena transaction opening proof is invalid."
            );
          if (events.some(
            (event) => String(event.args.id) === options.tournamentId && event.name !== "TournamentOpened" && (BigInt(event.blockNumber) < BigInt(opened.blockNumber) || event.blockNumber === opened.blockNumber && event.logIndex <= opened.logIndex)
          ))
            throw new CanonicalSourceUnavailable(
              "Arena transaction predates its current opening."
            );
          origin = {
            opened,
            incarnation: manifestDigest({
              deployment: `8453:${definition.contract}`,
              tournamentId: options.tournamentId,
              openedEventId: opened.id,
              openedBlockHash: opened.blockHash
            })
          };
        }
      }
      return { ...coverage, finalizedThroughBlock, inclusion, events, origin };
    }
  );
}
async function readArenaCredit(reader, definition, wallet) {
  const source = sourceOf(reader, definition);
  if (!/^0x[0-9a-f]{40}$/.test(wallet))
    throw new Error("Invalid Arena credit wallet.");
  return reader.snapshot(
    source.id,
    { kind: "latest" },
    async (db, { status }) => {
      const { indexed, coverage } = await frame(db, reader, status, source), schema = sqlIdentifier(reader.release.schema);
      const row = (await db.query(
        `SELECT amount::text,last_event_id,block_number::text,block_hash FROM ${schema}.arena_credit WHERE deployment=$1 AND wallet=$2`,
        [`8453:${definition.contract}`, wallet]
      )).rows[0];
      if (!row) return { ...coverage, amount: "0", last: null };
      if (!decimal2.test(row.amount) || BigInt(row.amount) >= 2n ** 256n || !decimal2.test(row.block_number) || BigInt(row.block_number) > indexed)
        throw new CanonicalSourceUnavailable(
          "Arena credit exceeds complete indexing coverage."
        );
      const event = (await db.query(
        `SELECT id,source_id,chain_id,address,abi_hash,name,args,block_number::text,block_hash,transaction_hash,log_index
      FROM ${schema}.canonical_event WHERE id=$1`,
        [row.last_event_id]
      )).rows[0];
      if (!event || !["Claimed", "PayoutsReleased", "TournamentExpired"].includes(
        event.name
      ))
        throw new CanonicalSourceUnavailable(
          "Arena credit event proof is incomplete."
        );
      const args = eventArgs(event);
      if (!args || typeof args !== "object" || event.name === "Claimed" && (!("player" in args) || String(args.player).toLowerCase() !== wallet))
        throw new CanonicalSourceUnavailable(
          "Arena credit event wallet disagrees."
        );
      const eventId = event.name === "Claimed" ? "0" : String("id" in args ? args.id : "");
      const last = evidence(
        event,
        source,
        event.name === "Claimed" ? void 0 : eventId
      );
      if (last.blockNumber !== row.block_number || last.blockHash !== row.block_hash)
        throw new CanonicalSourceUnavailable(
          "Arena credit and event inclusion disagree."
        );
      return { ...coverage, amount: row.amount, last };
    }
  );
}
async function readArenaTournamentIds(reader, definition, options = {}) {
  const source = sourceOf(reader, definition), limit = options.limit ?? 30;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || options.wallet !== void 0 && !/^0x[0-9a-f]{40}$/.test(options.wallet))
    throw new Error("Invalid Arena tournament list.");
  return reader.snapshot(
    source.id,
    { kind: "latest" },
    async (db, { status }) => {
      const { indexed, coverage } = await frame(db, reader, status, source), schema = sqlIdentifier(reader.release.schema);
      if ((await db.query(
        `SELECT 1 FROM ${schema}.arena_tournament WHERE deployment=$1 AND block_number>$2 LIMIT 1`,
        [`8453:${definition.contract}`, String(indexed)]
      )).rowCount)
        throw new CanonicalSourceUnavailable(
          "Arena list is still indexing the current block."
        );
      const rows = (await db.query(
        `SELECT tournament_id AS id FROM ${schema}.arena_tournament WHERE deployment=$1
      ${options.workOnly ? `AND (state->>'phase' IN ('open','strategies','resolving') OR (state->>'phase'='settled' AND state->>'videoHash' IS NULL))` : ""}
      ${options.wallet ? `AND (state->>'islandBeneficiary'=$3 OR EXISTS(SELECT 1 FROM jsonb_array_elements(state->'seats') seat WHERE seat->>'player'=$3))` : ""}
      ORDER BY tournament_id::numeric ${options.workOnly ? "ASC" : "DESC"} LIMIT $2`,
        [
          `8453:${definition.contract}`,
          limit,
          ...options.wallet ? [options.wallet] : []
        ]
      )).rows;
      return { ...coverage, ids: rows.map((row) => row.id) };
    }
  );
}
async function readArenaTournament(reader, definition, tournamentId, options = {}) {
  const source = sourceOf(reader, definition);
  if (!decimal2.test(tournamentId) || BigInt(tournamentId) >= 2n ** 256n)
    throw new Error("Invalid Arena tournament ID.");
  if (options.requiredThroughBlock !== void 0 && options.requiredThroughBlock < 0n || options.expectedIncarnation !== void 0 && !hash.test(options.expectedIncarnation))
    throw new Error("Invalid Arena read requirement.");
  return reader.snapshot(
    source.id,
    { kind: "latest" },
    async (db, { status }) => {
      available(status);
      const runtime = await readBoundRuntime(db, reader.release);
      const indexed = runtime.chains.find(
        (chain) => chain.chainId === 8453
      )?.completeThroughBlock;
      if (indexed === void 0 || indexed === null || options.requiredThroughBlock !== void 0 && indexed < options.requiredThroughBlock)
        throw new CanonicalSourceUnavailable(
          "Arena is still indexing the required block."
        );
      const deployment = `8453:${definition.contract}`, schema = sqlIdentifier(reader.release.schema);
      const row = (await db.query(
        `SELECT state,opened_event_id,opened_block_hash,last_event_id,
      block_number::text,block_hash FROM ${schema}.arena_tournament WHERE deployment=$1 AND tournament_id=$2`,
        [deployment, tournamentId]
      )).rows[0];
      const coverage = {
        releaseId: reader.release.id,
        sourceId: source.id,
        indexedThroughBlock: indexed.toString(),
        observedThroughBlock: status.anchor.number
      };
      if (!row) {
        if (options.expectedIncarnation)
          throw new CanonicalSourceUnavailable(
            "Arena tournament is no longer canonical."
          );
        return { ...coverage, tournament: null };
      }
      if (!decimal2.test(row.block_number) || BigInt(row.block_number) > indexed)
        throw new CanonicalSourceUnavailable(
          "Arena tournament exceeds complete indexing coverage."
        );
      const events = (await db.query(
        `SELECT id,source_id,chain_id,address,abi_hash,name,args,
      block_number::text,block_hash,transaction_hash,log_index FROM ${schema}.canonical_event WHERE id=ANY($1::text[])`,
        [[row.opened_event_id, row.last_event_id]]
      )).rows;
      const openedRow = events.find(
        (event) => event.id === row.opened_event_id
      );
      const opened = evidence(openedRow, source, tournamentId), last = evidence(
        events.find((event) => event.id === row.last_event_id),
        source,
        tournamentId
      );
      if (openedRow.name !== "TournamentOpened" || opened.blockHash !== row.opened_block_hash || last.blockHash !== row.block_hash || last.blockNumber !== row.block_number || BigInt(opened.blockNumber) > BigInt(last.blockNumber))
        throw new CanonicalSourceUnavailable(
          "Arena state and event evidence disagree."
        );
      if (!row.state || typeof row.state !== "object" || !("id" in row.state) || String(row.state.id) !== tournamentId)
        throw new CanonicalSourceUnavailable(
          "Arena tournament state identity is invalid."
        );
      const incarnation = manifestDigest({
        deployment,
        tournamentId,
        openedEventId: opened.id,
        openedBlockHash: opened.blockHash
      });
      let inputFrozen = null;
      if ("inputHash" in row.state && row.state.inputHash !== null && row.state.inputHash !== void 0) {
        const frozenRow = (await db.query(
          `SELECT id,source_id,chain_id,address,abi_hash,name,args,
          block_number::text,block_hash,transaction_hash,log_index FROM ${schema}.canonical_event
          WHERE source_id=$1 AND name='InputFrozen' AND args::jsonb->>'id'=$2
          ORDER BY block_number DESC,transaction_index DESC,log_index DESC LIMIT 1`,
          [source.id, tournamentId]
        )).rows[0];
        inputFrozen = evidence(frozenRow, source, tournamentId);
        const args = JSON.parse(frozenRow.args);
        if (!args || typeof args !== "object" || !("inputHash" in args) || !("strategyCommitments" in args) || args.inputHash !== row.state.inputHash || !("commitments" in row.state) || JSON.stringify(args.strategyCommitments) !== JSON.stringify(row.state.commitments) || BigInt(inputFrozen.blockNumber) > BigInt(last.blockNumber) || inputFrozen.blockNumber === last.blockNumber && inputFrozen.logIndex > last.logIndex)
          throw new CanonicalSourceUnavailable(
            "Arena frozen input evidence disagrees with public state."
          );
      }
      if (options.expectedIncarnation && options.expectedIncarnation !== incarnation)
        throw new CanonicalSourceUnavailable(
          "Arena tournament incarnation changed."
        );
      return {
        ...coverage,
        tournament: {
          deployment,
          id: tournamentId,
          state: row.state,
          incarnation,
          opened,
          last,
          inputFrozen
        }
      };
    }
  );
}
async function readArenaBrowse(reader, definition, request) {
  const source = sourceOf(reader, definition), limit = request.limit ?? 25;
  if (!["tournaments", "wallet", "island", "timeline", "rewards"].includes(
    request.kind
  ) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || request.wallet !== void 0 && !/^0x[0-9a-f]{40}$/.test(request.wallet) || [request.before, request.islandId, request.tournamentId].some(
    (v) => v != null && (!decimal2.test(v) || BigInt(v) >= 2n ** 256n)
  ) || request.role !== void 0 && !["any", "entrant", "host"].includes(request.role) || request.status !== void 0 && !["all", "active", "completed", "refunded"].includes(request.status) || ["wallet", "rewards"].includes(request.kind) && !request.wallet || request.kind === "island" && !request.islandId || request.kind === "timeline" && !request.tournamentId || request.cursorAnchor !== void 0 && (!decimal2.test(request.cursorAnchor.number) || !hash.test(request.cursorAnchor.hash)) || request.role && request.role !== "any" && !request.wallet)
    throw new Error("Invalid Arena public browse request.");
  return reader.snapshot(
    source.id,
    { kind: "latest" },
    async (db, { status }) => {
      const { indexed, coverage } = await frame(db, reader, status, source), schema = sqlIdentifier(reader.release.schema), deployment = `8453:${definition.contract}`;
      if ((await db.query(
        `SELECT 1 FROM ${schema}.arena_tournament WHERE deployment=$1 AND block_number>$2
       UNION ALL SELECT 1 FROM ${schema}.arena_credit WHERE deployment=$1 AND block_number>$2 LIMIT 1`,
        [deployment, String(indexed)]
      )).rowCount)
        throw new CanonicalSourceUnavailable(
          "Arena public history is still indexing the current block."
        );
      if (request.cursorAnchor && (BigInt(request.cursorAnchor.number) > indexed || (await db.query(
        `SELECT 1 FROM ${schema}.chain_block WHERE chain_id=8453 AND block_number=$1 AND block_hash=$2`,
        [request.cursorAnchor.number, request.cursorAnchor.hash]
      )).rowCount !== 1))
        throw new CanonicalSourceUnavailable(
          "Arena history cursor anchor changed or expired."
        );
      const currentAnchor = request.cursorAnchor ?? {
        number: status.anchor.number,
        hash: status.anchor.hash
      };
      if (BigInt(currentAnchor.number) > indexed || (await db.query(
        `SELECT 1 FROM ${schema}.chain_block WHERE chain_id=8453 AND block_number=$1 AND block_hash=$2`,
        [currentAnchor.number, currentAnchor.hash]
      )).rowCount !== 1)
        throw new CanonicalSourceUnavailable(
          "Arena history canonical anchor is unavailable."
        );
      if ((await db.query(
        `SELECT 1 FROM ${schema}.arena_tournament t
      LEFT JOIN ${schema}.canonical_event o ON o.id=t.opened_event_id
      LEFT JOIN ${schema}.canonical_event e ON e.id=t.last_event_id
      WHERE t.deployment=$1 AND NOT COALESCE(
        o.name='TournamentOpened' AND o.source_id=$2 AND e.source_id=$2
        AND o.chain_id=8453 AND e.chain_id=8453 AND o.address=$3 AND e.address=$3 AND o.abi_hash=$4 AND e.abi_hash=$4
        AND o.args::jsonb->>'id'=t.tournament_id AND e.args::jsonb->>'id'=t.tournament_id AND t.state->>'id'=t.tournament_id
        AND o.block_hash=t.opened_block_hash AND e.block_hash=t.block_hash AND e.block_number=t.block_number
        AND o.block_number<=e.block_number AND e.block_number<=$5
        AND (o.block_number<e.block_number OR o.log_index<=e.log_index),false) LIMIT 1`,
        [
          deployment,
          source.id,
          definition.contract,
          definition.abiHash,
          String(indexed)
        ]
      )).rowCount)
        throw new CanonicalSourceUnavailable(
          "Arena history aggregate evidence disagrees."
        );
      if ((await db.query(
        `SELECT 1 FROM ${schema}.arena_credit c LEFT JOIN ${schema}.canonical_event e ON e.id=c.last_event_id
      WHERE c.deployment=$1 AND NOT COALESCE(e.source_id=$2 AND e.chain_id=8453 AND e.address=$3 AND e.abi_hash=$4
       AND e.name IN ('Claimed','PayoutsReleased','TournamentExpired') AND e.block_hash=c.block_hash AND e.block_number=c.block_number
       AND e.block_number<=$5 AND (e.name<>'Claimed' OR lower(e.args::jsonb->>'player')=c.wallet),false) LIMIT 1`,
        [
          deployment,
          source.id,
          definition.contract,
          definition.abiHash,
          String(indexed)
        ]
      )).rowCount)
        throw new CanonicalSourceUnavailable(
          "Arena history credit evidence disagrees."
        );
      const result = {
        ...coverage,
        cursorAnchor: currentAnchor,
        rows: [],
        events: [],
        totals: null,
        island: null,
        amount: "0",
        withdrawals: "0"
      };
      if (request.kind === "island") {
        result.island = (await db.query(
          `SELECT count(*)::text AS hosted,
       (count(*) FILTER(WHERE state->>'videoHash' IS NOT NULL)*400000)::text AS released,
       (count(*) FILTER(WHERE state->>'phase'='settled' AND state->>'videoHash' IS NULL)*400000)::text AS pending
       FROM ${schema}.arena_tournament WHERE deployment=$1 AND state->>'islandId'=$2`,
          [deployment, request.islandId]
        )).rows[0];
      }
      if (request.kind === "tournaments" || request.kind === "island") {
        const rows = (await db.query(
          `SELECT tournament_id AS id,state,opened_event_id,opened_block_hash,last_event_id,block_number::text,block_hash
       FROM ${schema}.arena_tournament t WHERE deployment=$1 AND ($2::numeric IS NULL OR tournament_id::numeric<$2)
       AND ($3::text IS NULL OR ($4 IN ('any','entrant') AND EXISTS(SELECT 1 FROM jsonb_array_elements(state->'seats') s WHERE s->>'player'=$3))
         OR ($4 IN ('any','host') AND state->>'islandBeneficiary'=$3))
       AND ($5='all' OR ($5='active' AND state->>'phase' IN ('open','strategies','resolving'))
         OR ($5='completed' AND state->>'phase'='settled') OR ($5='refunded' AND state->>'phase'='expired'))
       AND ($6::text IS NULL OR state->>'islandId'=$6) ORDER BY tournament_id::numeric DESC LIMIT $7`,
          [
            deployment,
            request.before ?? null,
            request.wallet ?? null,
            request.role ?? "any",
            request.status ?? "all",
            request.islandId ?? null,
            limit
          ]
        )).rows;
        const events = rows.length ? (await db.query(
          `SELECT id,source_id,chain_id,address,abi_hash,name,args,block_number::text,block_hash,transaction_hash,log_index
       FROM ${schema}.canonical_event WHERE id=ANY($1::text[])`,
          [rows.flatMap((r) => [r.opened_event_id, r.last_event_id])]
        )).rows : [];
        result.rows = await Promise.all(
          rows.map(async (row) => {
            const opening = events.find((e) => e.id === row.opened_event_id), opened = evidence(opening, source, row.id), last = evidence(
              events.find((e) => e.id === row.last_event_id),
              source,
              row.id
            );
            if (opening?.name !== "TournamentOpened" || opened.blockHash !== row.opened_block_hash || last.blockHash !== row.block_hash || last.blockNumber !== row.block_number || BigInt(last.blockNumber) > indexed || BigInt(opened.blockNumber) > BigInt(last.blockNumber) || !row.state || typeof row.state !== "object" || !("id" in row.state) || row.state.id !== row.id)
              throw new CanonicalSourceUnavailable(
                "Arena public history evidence disagrees."
              );
            let inputFrozen = null;
            if ("inputHash" in row.state && row.state.inputHash != null) {
              const frozen = (await db.query(
                `SELECT id,source_id,chain_id,address,abi_hash,name,args,block_number::text,block_hash,transaction_hash,log_index
            FROM ${schema}.canonical_event WHERE source_id=$1 AND name='InputFrozen' AND args::jsonb->>'id'=$2
            ORDER BY block_number DESC,transaction_index DESC,log_index DESC LIMIT 1`,
                [source.id, row.id]
              )).rows[0];
              inputFrozen = evidence(frozen, source, row.id);
              const args = eventArgs(frozen);
              if (args.inputHash !== row.state.inputHash || !("commitments" in row.state) || JSON.stringify(args.strategyCommitments) !== JSON.stringify(row.state.commitments) || BigInt(inputFrozen.blockNumber) > BigInt(last.blockNumber) || BigInt(inputFrozen.blockNumber) < BigInt(opened.blockNumber) || inputFrozen.blockNumber === opened.blockNumber && inputFrozen.logIndex <= opened.logIndex || inputFrozen.blockNumber === last.blockNumber && inputFrozen.logIndex > last.logIndex)
                throw new CanonicalSourceUnavailable(
                  "Arena history frozen input disagrees."
                );
            }
            return {
              id: row.id,
              state: row.state,
              inputFrozen,
              incarnation: manifestDigest({
                deployment,
                tournamentId: row.id,
                openedEventId: opened.id,
                openedBlockHash: opened.blockHash
              })
            };
          })
        );
      } else if (request.kind === "wallet") {
        result.totals = (await db.query(
          `WITH participants AS (
        SELECT state,(SELECT count(*) FROM jsonb_array_elements(state->'seats') s WHERE s->>'player'=$2) AS own,
         state->>'islandBeneficiary'=$2 AS host,state->>'treasury'=$2 AS treasury,
         state->'seats'->((state->'winners'->>2)::int)->>'player'=$2 AS winner
        FROM ${schema}.arena_tournament WHERE deployment=$1)
       SELECT count(*) FILTER(WHERE own>0)::text AS entered_tournaments,coalesce(sum(own),0)::text AS entered_seats,
        count(*) FILTER(WHERE host)::text AS hosted_tournaments,count(*) FILTER(WHERE state->>'phase'='settled' AND winner)::text AS championships,
        (count(*) FILTER(WHERE state->>'videoHash' IS NOT NULL AND winner)*6000000)::text AS winnings,
        (count(*) FILTER(WHERE state->>'videoHash' IS NOT NULL AND host)*400000)::text AS hosting,
        (count(*) FILTER(WHERE state->>'videoHash' IS NOT NULL AND treasury)*1600000)::text AS operations,
        coalesce(sum(own*2000000) FILTER(WHERE state->>'phase'='expired'),0)::text AS refunds,
        coalesce(sum((CASE WHEN winner THEN 6000000 ELSE 0 END)+(CASE WHEN host THEN 400000 ELSE 0 END)+(CASE WHEN treasury THEN 1600000 ELSE 0 END))
          FILTER(WHERE state->>'phase'='settled' AND state->>'videoHash' IS NULL),0)::text AS pending FROM participants`,
          [deployment, request.wallet]
        )).rows[0];
        result.amount = (await db.query(
          `SELECT amount::text FROM ${schema}.arena_credit WHERE deployment=$1 AND wallet=$2`,
          [deployment, request.wallet]
        )).rows[0]?.amount ?? "0";
        result.withdrawals = (await db.query(
          `SELECT coalesce(sum((args::jsonb->>'amount')::numeric),0)::text AS amount
       FROM ${schema}.canonical_event WHERE source_id=$1 AND name='Claimed' AND lower(args::jsonb->>'player')=$2 AND block_number<=$3`,
          [source.id, request.wallet, String(indexed)]
        )).rows[0].amount;
      } else {
        const rows = (await db.query(
          `SELECT e.id,e.source_id,e.chain_id,e.address,e.abi_hash,e.name,e.args,e.block_number::text,e.block_hash,e.transaction_hash,e.log_index,t.state
       FROM ${schema}.canonical_event e LEFT JOIN ${schema}.arena_tournament t ON t.deployment=$1 AND t.tournament_id=e.args::jsonb->>'id'
       LEFT JOIN ${schema}.canonical_event o ON o.id=t.opened_event_id
       WHERE e.source_id=$2 AND e.block_number<=$3
       AND (e.name='Claimed' OR (e.block_number>o.block_number OR (e.block_number=o.block_number AND e.log_index>=o.log_index)))
       AND ($4::numeric IS NULL OR e.block_number::numeric*4294967296+e.log_index+1<$4)
       AND (${request.kind === "timeline" ? "e.args::jsonb->>'id'=$5" : "e.name IN ('PayoutsReleased','TournamentExpired','Claimed') AND ((e.name='Claimed' AND lower(e.args::jsonb->>'player')=$5) OR (e.name<>'Claimed' AND (t.state->>'islandBeneficiary'=$5 OR t.state->>'treasury'=$5 OR EXISTS(SELECT 1 FROM jsonb_array_elements(t.state->'seats') s WHERE s->>'player'=$5))))"})
       ORDER BY e.block_number ${request.kind === "timeline" ? "ASC" : "DESC"},e.log_index ${request.kind === "timeline" ? "ASC" : "DESC"} LIMIT $6`,
          [
            deployment,
            source.id,
            String(indexed),
            request.before ?? null,
            request.kind === "timeline" ? request.tournamentId : request.wallet,
            limit
          ]
        )).rows;
        result.events = rows.map((row) => {
          evidence(
            row,
            source,
            request.kind === "timeline" ? request.tournamentId : void 0
          );
          return {
            n: String(
              BigInt(row.block_number) * 4294967296n + BigInt(row.log_index) + 1n
            ),
            event_name: row.name,
            args: eventArgs(row),
            transaction_hash: row.transaction_hash,
            block_number: row.block_number,
            log_index: row.log_index,
            state: row.state
          };
        });
      }
      return result;
    }
  );
}

// accepted-native-support:packages/yunipals-market-core/src/arenaAbi.ts
var arenaAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "c",
        type: "tuple",
        internalType: "struct YunipalsArena.Config",
        components: [
          {
            name: "admin",
            type: "address",
            internalType: "address"
          },
          {
            name: "lobbyOperator",
            type: "address",
            internalType: "address"
          },
          {
            name: "admissionSigner",
            type: "address",
            internalType: "address"
          },
          {
            name: "referee",
            type: "address",
            internalType: "address"
          },
          {
            name: "treasury",
            type: "address",
            internalType: "address"
          },
          {
            name: "islands",
            type: "address",
            internalType: "address"
          },
          {
            name: "vrfWrapper",
            type: "address",
            internalType: "address"
          },
          {
            name: "paymentToken",
            type: "address",
            internalType: "address"
          },
          {
            name: "entryFee",
            type: "uint128",
            internalType: "uint128"
          },
          {
            name: "winnerBps",
            type: "uint16",
            internalType: "uint16"
          },
          {
            name: "islandBps",
            type: "uint16",
            internalType: "uint16"
          },
          {
            name: "joinWindow",
            type: "uint32",
            internalType: "uint32"
          },
          {
            name: "strategyWindow",
            type: "uint32",
            internalType: "uint32"
          },
          {
            name: "resolutionWindow",
            type: "uint32",
            internalType: "uint32"
          },
          {
            name: "maxVrfCost",
            type: "uint128",
            internalType: "uint128"
          },
          {
            name: "rulesHash",
            type: "bytes32",
            internalType: "bytes32"
          }
        ]
      }
    ],
    stateMutability: "nonpayable"
  },
  {
    type: "receive",
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "BASE_YUNIPALS",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "CALLBACK_GAS_LIMIT",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint32",
        internalType: "uint32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "DRAW_DOMAIN",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "ENTRY_TYPEHASH",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "FALLBACK_COMMITMENT_DOMAIN",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "FALLBACK_DOMAIN",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "OTHER_YUNIPALS",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "REQUEST_CONFIRMATIONS",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint16",
        internalType: "uint16"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "STRATEGY_TYPEHASH",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "acceptOwnership",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "activeNftTournament",
    inputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "admissionSigner",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "automaticStrategyMask",
    inputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [
      {
        name: "",
        type: "uint8",
        internalType: "uint8"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "availableVrfFunds",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "claim",
    inputs: [
      {
        name: "recipient",
        type: "address",
        internalType: "address payable"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "claimable",
    inputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "drawTicket",
    inputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "word",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [
      {
        name: "",
        type: "uint16",
        internalType: "uint16"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "eip712Domain",
    inputs: [],
    outputs: [
      {
        name: "fields",
        type: "bytes1",
        internalType: "bytes1"
      },
      {
        name: "name",
        type: "string",
        internalType: "string"
      },
      {
        name: "version",
        type: "string",
        internalType: "string"
      },
      {
        name: "chainId",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "verifyingContract",
        type: "address",
        internalType: "address"
      },
      {
        name: "salt",
        type: "bytes32",
        internalType: "bytes32"
      },
      {
        name: "extensions",
        type: "uint256[]",
        internalType: "uint256[]"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "entries",
    inputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [
      {
        name: "",
        type: "tuple[4]",
        internalType: "struct YunipalsArena.Entry[4]",
        components: [
          {
            name: "player",
            type: "address",
            internalType: "address"
          },
          {
            name: "nftChainId",
            type: "uint256",
            internalType: "uint256"
          },
          {
            name: "collection",
            type: "address",
            internalType: "address"
          },
          {
            name: "tokenId",
            type: "uint256",
            internalType: "uint256"
          }
        ]
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "entriesPaused",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "entryDigest",
    inputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "e",
        type: "tuple",
        internalType: "struct YunipalsArena.Entry",
        components: [
          {
            name: "player",
            type: "address",
            internalType: "address"
          },
          {
            name: "nftChainId",
            type: "uint256",
            internalType: "uint256"
          },
          {
            name: "collection",
            type: "address",
            internalType: "address"
          },
          {
            name: "tokenId",
            type: "uint256",
            internalType: "uint256"
          }
        ]
      },
      {
        name: "expiry",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "entryFee",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint128",
        internalType: "uint128"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "expire",
    inputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "fallbackAttack",
    inputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "seat",
        type: "uint8",
        internalType: "uint8"
      }
    ],
    outputs: [
      {
        name: "",
        type: "uint8",
        internalType: "uint8"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "fallbackCommitment",
    inputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "seat",
        type: "uint8",
        internalType: "uint8"
      }
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "finalizeIsland",
    inputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "freezeInput",
    inputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "inputHash",
        type: "bytes32",
        internalType: "bytes32"
      },
      {
        name: "commitments",
        type: "bytes32[4]",
        internalType: "bytes32[4]"
      },
      {
        name: "signatures",
        type: "bytes[4]",
        internalType: "bytes[4]"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "freezeInputWithFallback",
    inputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "inputHash",
        type: "bytes32",
        internalType: "bytes32"
      },
      {
        name: "commitments",
        type: "bytes32[4]",
        internalType: "bytes32[4]"
      },
      {
        name: "signatures",
        type: "bytes[4]",
        internalType: "bytes[4]"
      },
      {
        name: "seatMask",
        type: "uint8",
        internalType: "uint8"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "getBalance",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "getLinkToken",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract LinkTokenInterface"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "i_vrfV2PlusWrapper",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IVRFV2PlusWrapper"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "islandBps",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint16",
        internalType: "uint16"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "islandForTicket",
    inputs: [
      {
        name: "ticket",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [
      {
        name: "",
        type: "uint16",
        internalType: "uint16"
      }
    ],
    stateMutability: "pure"
  },
  {
    type: "function",
    name: "islands",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IERC721"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "join",
    inputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "e",
        type: "tuple",
        internalType: "struct YunipalsArena.Entry",
        components: [
          {
            name: "player",
            type: "address",
            internalType: "address"
          },
          {
            name: "nftChainId",
            type: "uint256",
            internalType: "uint256"
          },
          {
            name: "collection",
            type: "address",
            internalType: "address"
          },
          {
            name: "tokenId",
            type: "uint256",
            internalType: "uint256"
          }
        ]
      },
      {
        name: "expiry",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "permit",
        type: "bytes",
        internalType: "bytes"
      }
    ],
    outputs: [],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "joinWindow",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint32",
        internalType: "uint32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "lobbyOperator",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "maxVrfCost",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint128",
        internalType: "uint128"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "nextTournamentId",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "nftKey",
    inputs: [
      {
        name: "e",
        type: "tuple",
        internalType: "struct YunipalsArena.Entry",
        components: [
          {
            name: "player",
            type: "address",
            internalType: "address"
          },
          {
            name: "nftChainId",
            type: "uint256",
            internalType: "uint256"
          },
          {
            name: "collection",
            type: "address",
            internalType: "address"
          },
          {
            name: "tokenId",
            type: "uint256",
            internalType: "uint256"
          }
        ]
      }
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "pure"
  },
  {
    type: "function",
    name: "openTournament",
    inputs: [],
    outputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "paymentLiability",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "paymentToken",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "pendingOwner",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "poolHash",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "pure"
  },
  {
    type: "function",
    name: "publishedVideoHash",
    inputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "rawFulfillRandomWords",
    inputs: [
      {
        name: "_requestId",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "_randomWords",
        type: "uint256[]",
        internalType: "uint256[]"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "referee",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "releasePayouts",
    inputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "videoHash",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "renounceOwnership",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "requestTournament",
    inputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "resolutionWindow",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint32",
        internalType: "uint32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "rulesHash",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "setEntriesPaused",
    inputs: [
      {
        name: "paused",
        type: "bool",
        internalType: "bool"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "setLobbyOperator",
    inputs: [
      {
        name: "newOperator",
        type: "address",
        internalType: "address"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "setTreasury",
    inputs: [
      {
        name: "newTreasury",
        type: "address",
        internalType: "address"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "settle",
    inputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "resultHash",
        type: "bytes32",
        internalType: "bytes32"
      },
      {
        name: "semiOne",
        type: "uint8",
        internalType: "uint8"
      },
      {
        name: "semiTwo",
        type: "uint8",
        internalType: "uint8"
      },
      {
        name: "champion",
        type: "uint8",
        internalType: "uint8"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "strategyDigest",
    inputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "seat",
        type: "uint8",
        internalType: "uint8"
      },
      {
        name: "commitment",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "strategyWindow",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint32",
        internalType: "uint32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "supportedCollection",
    inputs: [
      {
        name: "chainId",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "collection",
        type: "address",
        internalType: "address"
      }
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool"
      }
    ],
    stateMutability: "pure"
  },
  {
    type: "function",
    name: "tournament",
    inputs: [
      {
        name: "id",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct YunipalsArena.Tournament",
        components: [
          {
            name: "phase",
            type: "uint8",
            internalType: "enum YunipalsArena.Phase"
          },
          {
            name: "count",
            type: "uint8",
            internalType: "uint8"
          },
          {
            name: "islandId",
            type: "uint16",
            internalType: "uint16"
          },
          {
            name: "randomnessReceived",
            type: "bool",
            internalType: "bool"
          },
          {
            name: "deadline",
            type: "uint64",
            internalType: "uint64"
          },
          {
            name: "islandBeneficiary",
            type: "address",
            internalType: "address"
          },
          {
            name: "treasuryBeneficiary",
            type: "address",
            internalType: "address"
          },
          {
            name: "requestId",
            type: "uint256",
            internalType: "uint256"
          },
          {
            name: "randomWord",
            type: "uint256",
            internalType: "uint256"
          },
          {
            name: "inputHash",
            type: "bytes32",
            internalType: "bytes32"
          },
          {
            name: "resultHash",
            type: "bytes32",
            internalType: "bytes32"
          },
          {
            name: "semifinalOneWinner",
            type: "uint8",
            internalType: "uint8"
          },
          {
            name: "semifinalTwoWinner",
            type: "uint8",
            internalType: "uint8"
          },
          {
            name: "champion",
            type: "uint8",
            internalType: "uint8"
          }
        ]
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "transferOwnership",
    inputs: [
      {
        name: "newOwner",
        type: "address",
        internalType: "address"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "treasury",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "winnerBps",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint16",
        internalType: "uint16"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "withdrawVrfFunds",
    inputs: [
      {
        name: "recipient",
        type: "address",
        internalType: "address payable"
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "event",
    name: "AutomaticStrategiesAssigned",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "seatMask",
        type: "uint8",
        indexed: false,
        internalType: "uint8"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      {
        name: "player",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "recipient",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "EIP712DomainChanged",
    inputs: [],
    anonymous: false
  },
  {
    type: "event",
    name: "Entered",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "seat",
        type: "uint8",
        indexed: true,
        internalType: "uint8"
      },
      {
        name: "player",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "nftChainId",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      },
      {
        name: "collection",
        type: "address",
        indexed: false,
        internalType: "address"
      },
      {
        name: "tokenId",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "EntryPauseChanged",
    inputs: [
      {
        name: "paused",
        type: "bool",
        indexed: false,
        internalType: "bool"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "InputFrozen",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "inputHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32"
      },
      {
        name: "strategyCommitments",
        type: "bytes32[4]",
        indexed: false,
        internalType: "bytes32[4]"
      },
      {
        name: "deadline",
        type: "uint64",
        indexed: false,
        internalType: "uint64"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "IslandRequested",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "requestId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "cost",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "IslandSelected",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "islandId",
        type: "uint16",
        indexed: true,
        internalType: "uint16"
      },
      {
        name: "ticket",
        type: "uint16",
        indexed: false,
        internalType: "uint16"
      },
      {
        name: "beneficiary",
        type: "address",
        indexed: false,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "JoinWindowStarted",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "deadline",
        type: "uint64",
        indexed: false,
        internalType: "uint64"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "LobbyOperatorChanged",
    inputs: [
      {
        name: "previousOperator",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "newOperator",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "OwnershipTransferStarted",
    inputs: [
      {
        name: "previousOwner",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "newOwner",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "OwnershipTransferred",
    inputs: [
      {
        name: "previousOwner",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "newOwner",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "PayoutsReleased",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "videoHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RandomnessReceived",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "requestId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "word",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "ResultSettled",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "resultHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32"
      },
      {
        name: "semifinalOneWinner",
        type: "uint8",
        indexed: false,
        internalType: "uint8"
      },
      {
        name: "semifinalTwoWinner",
        type: "uint8",
        indexed: false,
        internalType: "uint8"
      },
      {
        name: "champion",
        type: "uint8",
        indexed: false,
        internalType: "uint8"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "StrategiesOpened",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "deadline",
        type: "uint64",
        indexed: false,
        internalType: "uint64"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "TournamentExpired",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "TournamentOpened",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "rulesHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32"
      },
      {
        name: "poolHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32"
      },
      {
        name: "deadline",
        type: "uint64",
        indexed: false,
        internalType: "uint64"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "TournamentTreasuryAssigned",
    inputs: [
      {
        name: "id",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "beneficiary",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "TreasuryChanged",
    inputs: [
      {
        name: "previousTreasury",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "newTreasury",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "error",
    name: "DeadlinePassed",
    inputs: []
  },
  {
    type: "error",
    name: "IncorrectPayment",
    inputs: []
  },
  {
    type: "error",
    name: "InsufficientVrfFunding",
    inputs: []
  },
  {
    type: "error",
    name: "InvalidConfig",
    inputs: []
  },
  {
    type: "error",
    name: "InvalidEntry",
    inputs: []
  },
  {
    type: "error",
    name: "InvalidShortString",
    inputs: []
  },
  {
    type: "error",
    name: "InvalidSignature",
    inputs: []
  },
  {
    type: "error",
    name: "InvalidState",
    inputs: []
  },
  {
    type: "error",
    name: "OnlyVRFWrapperCanFulfill",
    inputs: [
      {
        name: "have",
        type: "address",
        internalType: "address"
      },
      {
        name: "want",
        type: "address",
        internalType: "address"
      }
    ]
  },
  {
    type: "error",
    name: "OwnableInvalidOwner",
    inputs: [
      {
        name: "owner",
        type: "address",
        internalType: "address"
      }
    ]
  },
  {
    type: "error",
    name: "OwnableUnauthorizedAccount",
    inputs: [
      {
        name: "account",
        type: "address",
        internalType: "address"
      }
    ]
  },
  {
    type: "error",
    name: "ReentrancyGuardReentrantCall",
    inputs: []
  },
  {
    type: "error",
    name: "SafeCastOverflowedUintDowncast",
    inputs: [
      {
        name: "bits",
        type: "uint8",
        internalType: "uint8"
      },
      {
        name: "value",
        type: "uint256",
        internalType: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "SafeERC20FailedOperation",
    inputs: [
      {
        name: "token",
        type: "address",
        internalType: "address"
      }
    ]
  },
  {
    type: "error",
    name: "StringTooLong",
    inputs: [
      {
        name: "str",
        type: "string",
        internalType: "string"
      }
    ]
  },
  {
    type: "error",
    name: "TransferFailed",
    inputs: []
  },
  {
    type: "error",
    name: "Unauthorized",
    inputs: []
  }
];

// accepted-native-support:apps/yunipals-market-api/src/arena/live/nativeSource.ts
var decimal3 = (value) => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) < 2n ** 256n;
var hash2 = (value) => typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value);
var address = (value) => typeof value === "string" && /^0x[0-9a-f]{40}$/.test(value);
var integer = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
var record = (value) => !!value && typeof value === "object" && !Array.isArray(value);
function nativeTournamentState(value) {
  if (!record(value) || !decimal3(value.id) || !["open", "strategies", "resolving", "settled", "expired"].includes(
    String(value.phase)
  ) || !integer(value.deadline) || !hash2(value.rulesHash) || !hash2(value.poolHash) || ![value.treasury, value.islandBeneficiary].every(
    (item) => item === null || address(item)
  ) || ![value.islandId, value.requestId, value.randomWord].every(
    (item) => item === null || decimal3(item)
  ) || !(value.ticket === null || integer(value.ticket)) || ![value.inputHash, value.resultHash, value.videoHash].every(
    (item) => item === null || hash2(item)
  ) || !(value.commitments === null || Array.isArray(value.commitments) && value.commitments.length === 4 && value.commitments.every(hash2)) || !(value.winners === null || Array.isArray(value.winners) && value.winners.length === 3 && value.winners.every((item) => integer(item) && item < 4)) || !(value.automaticStrategyMask === void 0 || integer(value.automaticStrategyMask) && value.automaticStrategyMask <= 15) || !Array.isArray(value.seats) || value.seats.length > 4 || !value.seats.every(
    (seat, index) => record(seat) && seat.seat === index && address(seat.player) && address(seat.collection) && integer(seat.nftChainId) && seat.nftChainId > 0 && decimal3(seat.tokenId)
  ))
    throw new Error("Native Arena state has an unsupported shape.");
  return value;
}
var NativeArenaSource = class {
  constructor(pool, releaseId, contract, startBlock) {
    this.pool = pool;
    this.releaseId = releaseId;
    if (!hash2(releaseId) || !address(contract.toLowerCase()) || /^0x0{40}$/i.test(contract) || startBlock < 0n)
      throw new Error("Invalid native Arena source configuration.");
    this.definition = {
      contract: contract.toLowerCase(),
      startBlock: String(startBlock),
      abiHash: manifestDigest(arenaAbi)
    };
  }
  definition;
  async read(id, options = {}) {
    const reader = await createIndexerReader(this.pool, {
      releaseId: this.releaseId
    });
    const result = await readArenaTournament(
      reader,
      this.definition,
      id,
      options
    );
    return {
      ...result,
      tournament: result.tournament ? {
        ...result.tournament,
        state: nativeTournamentState(result.tournament.state)
      } : null
    };
  }
  async credit(wallet) {
    return readArenaCredit(
      await createIndexerReader(this.pool, { releaseId: this.releaseId }),
      this.definition,
      wallet.toLowerCase()
    );
  }
  async list(wallet) {
    return readArenaTournamentIds(
      await createIndexerReader(this.pool, { releaseId: this.releaseId }),
      this.definition,
      { wallet: wallet?.toLowerCase(), limit: 30 }
    );
  }
  async work() {
    return readArenaTournamentIds(
      await createIndexerReader(this.pool, { releaseId: this.releaseId }),
      this.definition,
      { workOnly: true, limit: 100 }
    );
  }
  async browse(request) {
    return readArenaBrowse(
      await createIndexerReader(this.pool, { releaseId: this.releaseId }),
      this.definition,
      request
    );
  }
  async transaction(hash4, options = {}) {
    return readArenaTransaction(
      await createIndexerReader(this.pool, { releaseId: this.releaseId }),
      this.definition,
      hash4.toLowerCase(),
      {
        ...options,
        ...options.blockHash ? { blockHash: options.blockHash.toLowerCase() } : {}
      }
    );
  }
};

// accepted-native-support:apps/yunipals-market-api/src/arena/draw.ts
import { createHash as createHash2 } from "node:crypto";
function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === void 0) throw new Error("Cannot hash undefined input.");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

// accepted-native-support:apps/yunipals-market-api/src/arena/live/rollbackSource.ts
var hash3 = (value) => typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value);
var decimal4 = (value) => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
function arenaRollbackSourceId(url, contract, start) {
  const parsed = new URL(url);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol))
    throw new Error("Arena rollback requires PostgreSQL.");
  return manifestDigest({
    kind: "arena-legacy-rollback-v1",
    host: parsed.hostname,
    port: parsed.port || "5432",
    database: parsed.pathname,
    deployment: `8453:${contract.toLowerCase()}`,
    startBlock: String(start),
    abiHash: manifestDigest(arenaAbi)
  });
}
var ArenaRollbackSource = class {
  constructor(pool, releaseId, contract, startBlock, floor, client) {
    this.pool = pool;
    this.releaseId = releaseId;
    this.contract = contract;
    this.startBlock = startBlock;
    this.floor = floor;
    this.client = client;
    if (!hash3(releaseId) || !/^0x[0-9a-f]{40}$/.test(contract) || startBlock < 0n || !decimal4(floor.block) || !hash3(floor.hash) || BigInt(floor.block) < startBlock)
      throw new Error("Invalid Arena rollback source/floor.");
    this.deployment = `8453:${contract}`;
  }
  deployment;
  async snapshot(read) {
    const db = await this.pool.connect();
    let frame2;
    let result;
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      frame2 = (await db.query(
        "SELECT cursor::text,cursor_hash,finalized_at,start_block::text,contract,indexer_mode,halted FROM yunipals_arena.deployment WHERE id=$1",
        [this.deployment]
      )).rows[0];
      if (!frame2 || frame2.halted || frame2.indexer_mode !== "legacy" || frame2.contract !== this.contract || frame2.start_block !== String(this.startBlock) || !decimal4(frame2.cursor) || !hash3(frame2.cursor_hash) || !frame2.finalized_at || Math.abs(Date.now() - frame2.finalized_at.getTime()) > 18e4 || BigInt(frame2.cursor) < BigInt(this.floor.block))
        throw new Error(
          "Arena rollback source is stale, halted or below its accepted floor."
        );
      result = await read(db, frame2);
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
    if (await this.client.getChainId() !== 8453)
      throw new Error("Arena rollback source requires Base.");
    const [head, boundary, floor] = await Promise.all([
      this.client.getBlock({ blockTag: "latest" }),
      this.client.getBlock({ blockNumber: BigInt(frame2.cursor) }),
      this.client.getBlock({ blockNumber: BigInt(this.floor.block) })
    ]);
    if (!head.hash || Math.abs(Date.now() - Number(head.timestamp) * 1e3) > 12e4 || head.number < BigInt(frame2.cursor) || boundary.hash !== frame2.cursor_hash || floor.hash !== this.floor.hash || (await this.client.getBlock({ blockNumber: head.number })).hash !== head.hash)
      throw new Error("Arena rollback coverage is not currently canonical.");
    return result;
  }
  coverage(frame2) {
    return {
      releaseId: this.releaseId,
      sourceId: `arena:${this.deployment}`,
      indexedThroughBlock: frame2.cursor,
      observedThroughBlock: frame2.cursor
    };
  }
  evidence(event, frame2) {
    if (!decimal4(event.block_number) || BigInt(event.block_number) < this.startBlock || BigInt(event.block_number) > BigInt(frame2.cursor) || !hash3(event.block_hash) || !hash3(event.transaction_hash) || !Number.isSafeInteger(event.log_index) || event.log_index < 0 || !arenaAbi.some(
      (entry) => entry.type === "event" && entry.name === event.event_name
    ) || !event.args || typeof event.args !== "object" || Array.isArray(event.args))
      throw new Error("Arena rollback event evidence is incomplete.");
    return {
      id: `${this.deployment}:${event.transaction_hash}:${event.log_index}`,
      blockNumber: event.block_number,
      blockHash: event.block_hash,
      transactionHash: event.transaction_hash,
      logIndex: event.log_index
    };
  }
  async tournament(db, frame2, id) {
    const row = (await db.query(
      "SELECT state FROM yunipals_arena.tournament WHERE deployment=$1 AND id=$2",
      [this.deployment, id]
    )).rows[0];
    if (!row) return null;
    const state = nativeTournamentState(row.state);
    const events = (await db.query(
      `SELECT block_number::text,block_hash,transaction_hash,log_index,event_name,args
      FROM yunipals_arena.chain_event WHERE deployment=$1 AND args->>'id'=$2
      ORDER BY block_number,log_index LIMIT 257`,
      [this.deployment, id]
    )).rows;
    if (state.id !== id || !events.length || events.length > 256 || events[0].event_name !== "TournamentOpened" || events.filter((e) => e.event_name === "TournamentOpened").length !== 1 || events[0].args.rulesHash !== state.rulesHash || events[0].args.poolHash !== state.poolHash)
      throw new Error("Arena rollback opening/public state is incomplete.");
    const proofs = events.map((event) => this.evidence(event, frame2));
    const opened = proofs[0], last = proofs.at(-1);
    let freezeIndex = -1;
    for (let index = events.length - 1; index >= 0; index--)
      if (events[index].event_name === "InputFrozen") {
        freezeIndex = index;
        break;
      }
    const freeze = freezeIndex < 0 ? null : events[freezeIndex];
    if (state.inputHash ? !freeze || freeze.args.inputHash !== state.inputHash || canonicalJson(freeze.args.strategyCommitments) !== canonicalJson(state.commitments) : freeze !== null)
      throw new Error("Arena rollback frozen input differs from public state.");
    return {
      deployment: this.deployment,
      id,
      state,
      incarnation: manifestDigest({
        deployment: this.deployment,
        tournamentId: id,
        openedEventId: opened.id,
        openedBlockHash: opened.blockHash
      }),
      opened,
      last,
      inputFrozen: freezeIndex < 0 ? null : proofs[freezeIndex]
    };
  }
  async read(id, options = {}) {
    if (!decimal4(id) || BigInt(id) >= 2n ** 256n || options.requiredThroughBlock !== void 0 && options.requiredThroughBlock < 0n || options.expectedIncarnation !== void 0 && !hash3(options.expectedIncarnation))
      throw new Error("Invalid rollback tournament selector.");
    return this.snapshot(async (db, frame2) => {
      if (options.requiredThroughBlock !== void 0 && BigInt(frame2.cursor) < options.requiredThroughBlock)
        throw new Error(
          "Arena rollback source has not indexed the required block."
        );
      const tournament = await this.tournament(db, frame2, id);
      if (options.expectedIncarnation && tournament?.incarnation !== options.expectedIncarnation)
        throw new Error("Arena rollback tournament opening changed.");
      return { ...this.coverage(frame2), tournament };
    });
  }
  ids(wallet, work = false) {
    if (wallet && !/^0x[0-9a-f]{40}$/.test(wallet))
      throw new Error("Invalid Arena wallet.");
    return this.snapshot(async (db, frame2) => {
      const rows = (await db.query(
        `SELECT id::text FROM yunipals_arena.tournament WHERE deployment=$1
        ${work ? "AND (state->>'phase' IN('open','strategies','resolving') OR (state->>'phase'='settled' AND state->>'videoHash' IS NULL))" : ""}
        ${wallet ? "AND (state->>'islandBeneficiary'=$2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(state->'seats') seat WHERE seat->>'player'=$2))" : ""}
        ORDER BY id ${work ? "ASC LIMIT 100" : "DESC LIMIT 30"}`,
        [this.deployment, ...wallet ? [wallet] : []]
      )).rows;
      return { ...this.coverage(frame2), ids: rows.map((row) => row.id) };
    });
  }
  list(wallet) {
    return this.ids(wallet?.toLowerCase());
  }
  work() {
    return this.ids(void 0, true);
  }
  async credit(wallet) {
    wallet = wallet.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(wallet))
      throw new Error("Invalid Arena wallet.");
    return this.snapshot(async (db, frame2) => {
      const amount = (await db.query(
        "SELECT amount::text FROM yunipals_arena.credit WHERE deployment=$1 AND wallet=$2",
        [this.deployment, wallet]
      )).rows[0]?.amount ?? "0";
      if (!decimal4(amount) || BigInt(amount) >= 2n ** 256n)
        throw new Error("Invalid rollback credit.");
      const row = (await db.query(
        `SELECT e.block_number::text,e.block_hash,e.transaction_hash,e.log_index,e.event_name,e.args
        FROM yunipals_arena.chain_event e LEFT JOIN yunipals_arena.tournament t
        ON t.deployment=e.deployment AND t.id::text=e.args->>'id'
        WHERE e.deployment=$1 AND ((e.event_name='Claimed' AND e.args->>'player'=$2)
        OR (e.event_name='TournamentExpired' AND EXISTS(SELECT 1 FROM jsonb_array_elements(t.state->'seats') seat WHERE seat->>'player'=$2))
        OR (e.event_name='PayoutsReleased' AND (t.state->>'treasury'=$2 OR t.state->>'islandBeneficiary'=$2
        OR t.state->'seats'->((t.state->'winners'->>2)::integer)->>'player'=$2)))
        ORDER BY e.block_number DESC,e.log_index DESC LIMIT 1`,
        [this.deployment, wallet]
      )).rows[0];
      if (!row && amount !== "0")
        throw new Error("Rollback credit has no event proof.");
      return {
        ...this.coverage(frame2),
        amount,
        last: row ? this.evidence(row, frame2) : null
      };
    });
  }
  /** Browsing rollback uses only the isolated, verified public endpoint. Never
   * read the operational deployment's retired tournament or credit projection. */
  async browse(request) {
    const limit = request.limit ?? 25;
    if (!["tournaments", "wallet", "island", "timeline", "rewards"].includes(
      request.kind
    ) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || request.wallet !== void 0 && !/^0x[0-9a-f]{40}$/.test(request.wallet) || [request.before, request.islandId, request.tournamentId].some(
      (v) => v != null && (!decimal4(v) || BigInt(v) >= 2n ** 256n)
    ) || request.role !== void 0 && !["any", "entrant", "host"].includes(request.role) || request.status !== void 0 && !["all", "active", "completed", "refunded"].includes(request.status) || ["wallet", "rewards"].includes(request.kind) && !request.wallet || request.kind === "island" && !request.islandId || request.kind === "timeline" && !request.tournamentId || request.role && request.role !== "any" && !request.wallet || request.cursorAnchor && (!decimal4(request.cursorAnchor.number) || !hash3(request.cursorAnchor.hash)))
      throw new Error("Invalid rollback public browse request.");
    return this.snapshot(async (db, frame2) => {
      const cursorAnchor = request.cursorAnchor ?? {
        number: frame2.cursor,
        hash: frame2.cursor_hash
      };
      if (BigInt(cursorAnchor.number) > BigInt(frame2.cursor) || (await this.client.getBlock({
        blockNumber: BigInt(cursorAnchor.number)
      })).hash !== cursorAnchor.hash)
        throw new Error("Rollback history cursor anchor changed or expired.");
      const result = {
        ...this.coverage(frame2),
        cursorAnchor,
        rows: [],
        events: [],
        totals: null,
        island: null,
        amount: "0",
        withdrawals: "0"
      };
      if (request.kind === "tournaments" || request.kind === "island") {
        const selected = (await db.query(
          `SELECT id::text FROM yunipals_arena.tournament t WHERE deployment=$1
          AND ($2::numeric IS NULL OR id<$2)
          AND ($3::text IS NULL OR ($4 IN ('any','entrant') AND EXISTS(SELECT 1 FROM jsonb_array_elements(state->'seats') s WHERE s->>'player'=$3))
            OR ($4 IN ('any','host') AND state->>'islandBeneficiary'=$3))
          AND ($5='all' OR ($5='active' AND state->>'phase' IN ('open','strategies','resolving'))
            OR ($5='completed' AND state->>'phase'='settled') OR ($5='refunded' AND state->>'phase'='expired'))
          AND ($6::text IS NULL OR state->>'islandId'=$6) ORDER BY id DESC LIMIT $7`,
          [
            this.deployment,
            request.before ?? null,
            request.wallet ?? null,
            request.role ?? "any",
            request.status ?? "all",
            request.islandId ?? null,
            limit
          ]
        )).rows;
        for (const { id } of selected) {
          const t = await this.tournament(db, frame2, id);
          if (!t) throw new Error("Rollback tournament changed in snapshot.");
          result.rows.push({
            id,
            state: t.state,
            incarnation: t.incarnation,
            inputFrozen: t.inputFrozen
          });
        }
      }
      if (request.kind === "island") {
        result.island = (await db.query(
          `SELECT count(*)::text AS hosted,
          (count(*) FILTER(WHERE state->>'videoHash' IS NOT NULL)*400000)::text AS released,
          (count(*) FILTER(WHERE state->>'phase'='settled' AND state->>'videoHash' IS NULL)*400000)::text AS pending
          FROM yunipals_arena.tournament WHERE deployment=$1 AND state->>'islandId'=$2`,
          [this.deployment, request.islandId]
        )).rows[0];
      }
      if (request.kind === "wallet") {
        result.totals = (await db.query(
          `WITH participants AS (
          SELECT state,(SELECT count(*) FROM jsonb_array_elements(state->'seats') s WHERE s->>'player'=$2) AS own,
            state->>'islandBeneficiary'=$2 AS host,state->>'treasury'=$2 AS treasury,
            state->'seats'->((state->'winners'->>2)::int)->>'player'=$2 AS winner
          FROM yunipals_arena.tournament WHERE deployment=$1)
          SELECT count(*) FILTER(WHERE own>0)::text AS entered_tournaments,coalesce(sum(own),0)::text AS entered_seats,
            count(*) FILTER(WHERE host)::text AS hosted_tournaments,count(*) FILTER(WHERE state->>'phase'='settled' AND winner)::text AS championships,
            (count(*) FILTER(WHERE state->>'videoHash' IS NOT NULL AND winner)*6000000)::text AS winnings,
            (count(*) FILTER(WHERE state->>'videoHash' IS NOT NULL AND host)*400000)::text AS hosting,
            (count(*) FILTER(WHERE state->>'videoHash' IS NOT NULL AND treasury)*1600000)::text AS operations,
            coalesce(sum(own*2000000) FILTER(WHERE state->>'phase'='expired'),0)::text AS refunds,
            coalesce(sum((CASE WHEN winner THEN 6000000 ELSE 0 END)+(CASE WHEN host THEN 400000 ELSE 0 END)+(CASE WHEN treasury THEN 1600000 ELSE 0 END))
              FILTER(WHERE state->>'phase'='settled' AND state->>'videoHash' IS NULL),0)::text AS pending FROM participants`,
          [this.deployment, request.wallet]
        )).rows[0];
        result.amount = (await db.query(
          "SELECT amount::text FROM yunipals_arena.credit WHERE deployment=$1 AND wallet=$2",
          [this.deployment, request.wallet]
        )).rows[0]?.amount ?? "0";
        result.withdrawals = (await db.query(
          `SELECT coalesce(sum((args->>'amount')::numeric),0)::text AS amount FROM yunipals_arena.chain_event
          WHERE deployment=$1 AND event_name='Claimed' AND lower(args->>'player')=$2 AND block_number<=$3`,
          [this.deployment, request.wallet, frame2.cursor]
        )).rows[0].amount;
      }
      if (request.kind === "rewards" || request.kind === "timeline") {
        if (request.kind === "timeline" && !await this.tournament(db, frame2, request.tournamentId))
          throw new Error("Rollback tournament not found.");
        const events = (await db.query(
          `SELECT e.block_number::text,e.block_hash,e.transaction_hash,e.log_index,e.event_name,e.args,t.state
          FROM yunipals_arena.chain_event e LEFT JOIN yunipals_arena.tournament t ON t.deployment=e.deployment AND t.id::text=e.args->>'id'
          WHERE e.deployment=$1 AND e.block_number<=$2 AND ($3::numeric IS NULL OR e.block_number::numeric*4294967296+e.log_index+1<$3)
          AND (${request.kind === "timeline" ? "e.args->>'id'=$4" : "e.event_name IN ('PayoutsReleased','TournamentExpired','Claimed') AND ((e.event_name='Claimed' AND lower(e.args->>'player')=$4) OR (e.event_name<>'Claimed' AND (t.state->>'islandBeneficiary'=$4 OR t.state->>'treasury'=$4 OR EXISTS(SELECT 1 FROM jsonb_array_elements(t.state->'seats') s WHERE s->>'player'=$4))))"})
          ORDER BY e.block_number ${request.kind === "timeline" ? "ASC" : "DESC"},e.log_index ${request.kind === "timeline" ? "ASC" : "DESC"} LIMIT $5`,
          [
            this.deployment,
            frame2.cursor,
            request.before ?? null,
            request.kind === "timeline" ? request.tournamentId : request.wallet,
            limit
          ]
        )).rows;
        for (const e of events) {
          this.evidence(e, frame2);
          if (e.event_name !== "Claimed") {
            const t = await this.tournament(db, frame2, String(e.args.id));
            if (!t || BigInt(e.block_number) < BigInt(t.opened.blockNumber) || e.block_number === t.opened.blockNumber && e.log_index < t.opened.logIndex)
              throw new Error(
                "Rollback history event predates its current opening."
              );
          }
          result.events.push({
            n: String(
              BigInt(e.block_number) * 4294967296n + BigInt(e.log_index) + 1n
            ),
            event_name: e.event_name,
            args: e.args,
            transaction_hash: e.transaction_hash,
            block_number: e.block_number,
            log_index: e.log_index,
            state: e.state
          });
        }
      }
      if ((await this.client.getBlock({
        blockNumber: BigInt(cursorAnchor.number)
      })).hash !== cursorAnchor.hash)
        throw new Error("Rollback history cursor changed during read.");
      return result;
    });
  }
  async transaction(transactionHash, options = {}) {
    transactionHash = transactionHash.toLowerCase();
    if (!hash3(transactionHash) || options.tournamentId !== void 0 && !decimal4(options.tournamentId) || options.blockNumber === void 0 !== (options.blockHash === void 0) || options.blockNumber !== void 0 && options.blockNumber < 0n || options.blockHash !== void 0 && !hash3(options.blockHash))
      throw new Error("Invalid rollback transaction selector.");
    return this.snapshot(async (db, frame2) => {
      const empty = {
        ...this.coverage(frame2),
        finalizedThroughBlock: null,
        events: [],
        origin: null
      };
      if (options.blockNumber !== void 0 && options.blockNumber > BigInt(frame2.cursor))
        return { ...empty, inclusion: "not_indexed" };
      const rows = (await db.query(
        `SELECT block_number::text,block_hash,transaction_hash,log_index,event_name,args
        FROM yunipals_arena.chain_event WHERE deployment=$1 AND transaction_hash=$2 ORDER BY log_index LIMIT 257`,
        [this.deployment, transactionHash]
      )).rows;
      if (rows.length > 256)
        throw new Error("Rollback transaction event limit exceeded.");
      const events = rows.map((row) => ({
        ...this.evidence(row, frame2),
        name: row.event_name,
        args: row.args
      }));
      let inclusion = null;
      if (options.blockNumber !== void 0) {
        const block = await this.client.getBlock({
          blockNumber: options.blockNumber
        });
        inclusion = block.hash === options.blockHash ? "canonical" : "changed";
        if (events.some(
          (event) => event.blockNumber !== String(options.blockNumber) || event.blockHash !== options.blockHash
        ))
          inclusion = "changed";
      }
      const tournament = options.tournamentId ? await this.tournament(db, frame2, options.tournamentId) : null;
      if (tournament && events.some(
        (event) => String(event.args.id) === options.tournamentId && (BigInt(event.blockNumber) < BigInt(tournament.opened.blockNumber) || event.blockNumber === tournament.opened.blockNumber && event.logIndex < tournament.opened.logIndex)
      ))
        throw new Error("Rollback transaction predates the current opening.");
      return {
        ...empty,
        events,
        inclusion,
        origin: tournament ? { incarnation: tournament.incarnation, opened: tournament.opened } : null
      };
    });
  }
};

// accepted-native-support:apps/yunipals-market-api/src/arena/live/sourceSwitch.ts
import { randomUUID as randomUUID3 } from "node:crypto";

// accepted-native-support:apps/yunipals-market-api/src/arena/live/identitySchema.ts
import { createHash as createHash3 } from "node:crypto";
var arenaPrivateTables = [
  "submission",
  "fighter_snapshot",
  "frozen_input",
  "admission",
  "provider_task",
  "transaction_intent",
  "adjudication",
  "media_job"
];
var statements = [
  `ALTER TABLE yunipals_arena.deployment ADD COLUMN IF NOT EXISTS indexer_mode text NOT NULL DEFAULT 'legacy'
    CHECK(indexer_mode IN('legacy','unified'))`,
  `CREATE TABLE yunipals_arena.tournament_identity (
    deployment text NOT NULL REFERENCES yunipals_arena.deployment(id) ON DELETE CASCADE,
    tournament_id numeric(78) NOT NULL,incarnation text NOT NULL,
    opened_event_id text,opened_block_hash text,bound_release_id text,bound_at timestamptz,
    cipher_context text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(deployment,tournament_id,incarnation),
    CHECK((incarnation='legacy' AND opened_event_id IS NULL AND opened_block_hash IS NULL
      AND bound_release_id IS NULL AND bound_at IS NULL)
      OR (incarnation~'^0x[0-9a-f]{64}$' AND opened_event_id IS NOT NULL
      AND opened_block_hash~'^0x[0-9a-f]{64}$' AND bound_release_id~'^0x[0-9a-f]{64}$' AND bound_at IS NOT NULL))
  )`,
  `CREATE FUNCTION yunipals_arena.ensure_legacy_identity() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $identity$
    DECLARE mode text; selected_id numeric;
    BEGIN
      IF TG_TABLE_NAME='tournament' THEN selected_id:=NEW.id;
      ELSE selected_id:=NEW.tournament_id; END IF;
      IF TG_TABLE_NAME<>'tournament' THEN
        IF NEW.incarnation<>'legacy' THEN RETURN NEW; END IF;
      END IF;
      SELECT d.indexer_mode INTO mode FROM yunipals_arena.deployment d WHERE d.id=NEW.deployment;
      IF mode IS DISTINCT FROM 'legacy' THEN RAISE EXCEPTION 'Legacy Arena writes are fenced'; END IF;
      INSERT INTO yunipals_arena.tournament_identity(deployment,tournament_id,incarnation,cipher_context)
        VALUES(NEW.deployment,selected_id,'legacy',NEW.deployment||'/'||selected_id::text) ON CONFLICT DO NOTHING;
      RETURN NEW;
    END $identity$`,
  `REVOKE ALL ON FUNCTION yunipals_arena.ensure_legacy_identity() FROM PUBLIC`,
  `CREATE TRIGGER arena_legacy_identity AFTER INSERT ON yunipals_arena.tournament
    FOR EACH ROW EXECUTE FUNCTION yunipals_arena.ensure_legacy_identity()`,
  `CREATE FUNCTION yunipals_arena.identity_immutable() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $identity$
    BEGIN
      IF (OLD.deployment,OLD.tournament_id,OLD.cipher_context,OLD.created_at)
        IS DISTINCT FROM (NEW.deployment,NEW.tournament_id,NEW.cipher_context,NEW.created_at)
        OR (OLD.incarnation<>'legacy' AND OLD IS DISTINCT FROM NEW)
        THEN RAISE EXCEPTION 'Arena identity history is immutable'; END IF;
      RETURN NEW;
    END $identity$`,
  `REVOKE ALL ON FUNCTION yunipals_arena.identity_immutable() FROM PUBLIC`,
  `CREATE TRIGGER arena_identity_immutable BEFORE UPDATE ON yunipals_arena.tournament_identity
    FOR EACH ROW EXECUTE FUNCTION yunipals_arena.identity_immutable()`
];
var checksum = createHash3("sha256").update(
  JSON.stringify({ statements, tables: arenaPrivateTables, version: 1 })
).digest("hex");
var evidenceSql = `ALTER TABLE yunipals_arena.tournament_identity ADD CONSTRAINT arena_identity_bound_evidence
  CHECK(incarnation='legacy' OR (opened_event_id IS NOT NULL AND length(opened_event_id)>0
    AND opened_block_hash IS NOT NULL AND bound_release_id IS NOT NULL AND bound_at IS NOT NULL))`;
var evidenceChecksum = createHash3("sha256").update(evidenceSql).digest("hex");

// accepted-native-support:apps/yunipals-market-api/src/arena/live/nativeAction.ts
var zeroHash = `0x${"0".repeat(64)}`;
var zeroAddress = `0x${"0".repeat(40)}`;
var phases = {
  open: 1,
  strategies: 2,
  resolving: 3,
  settled: 4,
  expired: 5
};
async function verifyNativeArenaAction(client, observed) {
  if (await client.getChainId() !== 8453)
    throw new Error("Native Arena action requires Base.");
  const t = observed.tournament, state = t.state;
  const head = await client.getBlock({ blockTag: "latest" });
  if (!head.hash || Math.abs(Number(head.timestamp) * 1e3 - Date.now()) > 12e4 || head.number < BigInt(t.last.blockNumber))
    throw new Error("Native Arena action head is unavailable.");
  const anchors = /* @__PURE__ */ new Map();
  for (const event of [t.opened, t.last, t.inputFrozen].filter(
    (event2) => event2 !== null
  )) {
    const prior = anchors.get(event.blockNumber);
    if (prior && prior !== event.blockHash)
      throw new Error("Native Arena event anchors disagree.");
    anchors.set(event.blockNumber, event.blockHash);
  }
  await Promise.all(
    [...anchors].map(async ([number, hash4]) => {
      if ((await client.getBlock({ blockNumber: BigInt(number) })).hash?.toLowerCase() !== hash4)
        throw new Error("Native Arena action event is no longer canonical.");
    })
  );
  const contract = t.deployment.slice(5);
  const [live, mask] = await Promise.all([
    client.readContract({
      address: contract,
      abi: arenaAbi,
      functionName: "tournament",
      args: [BigInt(t.id)],
      blockNumber: head.number
    }),
    client.readContract({
      address: contract,
      abi: arenaAbi,
      functionName: "automaticStrategyMask",
      args: [BigInt(t.id)],
      blockNumber: head.number
    })
  ]);
  if (live.phase !== phases[state.phase] || live.count !== state.seats.length || live.deadline !== BigInt(state.deadline) || live.inputHash.toLowerCase() !== (state.inputHash ?? zeroHash) || live.resultHash.toLowerCase() !== (state.resultHash ?? zeroHash) || mask !== (state.automaticStrategyMask ?? 0) || live.requestId !== BigInt(state.requestId ?? "0") || live.randomnessReceived !== (state.randomWord !== null) || live.randomWord !== BigInt(state.randomWord ?? "0") || String(live.islandId) !== (state.islandId ?? "0") || live.islandBeneficiary.toLowerCase() !== (state.islandBeneficiary ?? zeroAddress) || live.treasuryBeneficiary.toLowerCase() !== (state.treasury ?? zeroAddress) || state.winners !== null && (live.semifinalOneWinner !== state.winners[0] || live.semifinalTwoWinner !== state.winners[1] || live.champion !== state.winners[2]))
    throw new Error("Native Arena action state changed.");
  if ((await client.getBlock({ blockNumber: head.number })).hash !== head.hash)
    throw new Error("Native Arena action head changed during verification.");
}

// accepted-native-support:apps/yunipals-market-api/src/arena/live/mediaAdoption.ts
import { readFile as readFile3 } from "node:fs/promises";
import { join as join2 } from "node:path";

// accepted-native-support:apps/yunipals-market-api/src/db/pool.ts
import pg from "pg";

// accepted-native-support:apps/yunipals-market-api/src/arena/live/mediaPaths.ts
import { resolve } from "node:path";

// accepted-native-support:apps/yunipals-market-api/src/arena/live/mediaSchema.ts
import { createHash as createHash4 } from "node:crypto";
var statements2 = [
  `CREATE TABLE yunipals_arena.media_publication (
    deployment text NOT NULL,tournament_id numeric(78) NOT NULL,incarnation text NOT NULL CHECK(incarnation~'^0x[0-9a-f]{64}$'),
    publication_hash text NOT NULL CHECK(publication_hash~'^0x[0-9a-f]{64}$'),
    manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='object' AND octet_length(manifest::text)<=16384),
    source_evidence jsonb NOT NULL CHECK(jsonb_typeof(source_evidence)='object' AND octet_length(source_evidence::text)<=8192),
    published_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(deployment,tournament_id,incarnation,publication_hash),
    UNIQUE(deployment,tournament_id,incarnation),
    FOREIGN KEY(deployment,tournament_id,incarnation) REFERENCES yunipals_arena.tournament_identity(deployment,tournament_id,incarnation))`,
  `CREATE FUNCTION yunipals_arena.media_publication_binding() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $media$
    BEGIN
      IF NOT COALESCE(NEW.manifest->>'deployment'=NEW.deployment AND NEW.manifest->>'tournamentId'=NEW.tournament_id::text
        AND NEW.manifest->>'incarnation'=NEW.incarnation AND NEW.source_evidence->>'deployment'=NEW.deployment
        AND NEW.source_evidence->>'tournamentId'=NEW.tournament_id::text AND NEW.source_evidence->>'incarnation'=NEW.incarnation
        AND (NEW.manifest->>'inputHash')~'^0x[0-9a-f]{64}$' AND (NEW.manifest->>'outcomeHash')~'^0x[0-9a-f]{64}$'
        AND NEW.source_evidence->>'inputHash'=NEW.manifest->>'inputHash' AND NEW.source_evidence->>'resultHash'=NEW.manifest->>'outcomeHash'
        AND (NEW.source_evidence->>'releaseId')~'^0x[0-9a-f]{64}$' AND (NEW.source_evidence->>'openedBlockHash')~'^0x[0-9a-f]{64}$'
        AND (NEW.source_evidence->>'frozenBlockHash')~'^0x[0-9a-f]{64}$' AND length(NEW.source_evidence->>'openedEventId')>0
        AND length(NEW.source_evidence->>'frozenEventId')>0,false) THEN RAISE EXCEPTION 'Arena media publication evidence is invalid'; END IF;
      RETURN NEW;
    END $media$`,
  `REVOKE ALL ON FUNCTION yunipals_arena.media_publication_binding() FROM PUBLIC`,
  `CREATE TRIGGER arena_media_publication_binding BEFORE INSERT ON yunipals_arena.media_publication
    FOR EACH ROW EXECUTE FUNCTION yunipals_arena.media_publication_binding()`,
  `ALTER TABLE yunipals_arena.media_job ADD COLUMN input_hash text,ADD COLUMN outcome_hash text,ADD COLUMN publication_hash text,
    ADD COLUMN native_check_at timestamptz NOT NULL DEFAULT now(),ADD COLUMN native_check_lease uuid,
    ADD CONSTRAINT arena_media_input_pair CHECK((input_hash IS NULL AND outcome_hash IS NULL) OR
      (input_hash IS NOT NULL AND outcome_hash IS NOT NULL AND input_hash~'^0x[0-9a-f]{64}$' AND outcome_hash~'^0x[0-9a-f]{64}$')),
    ADD CONSTRAINT arena_media_publication_parent FOREIGN KEY(deployment,tournament_id,incarnation,publication_hash)
      REFERENCES yunipals_arena.media_publication(deployment,tournament_id,incarnation,publication_hash),
    ADD CONSTRAINT arena_media_publication_ready CHECK(publication_hash IS NULL OR (state='ready' AND input_hash IS NOT NULL
      AND outcome_hash IS NOT NULL AND film_sha256 IS NOT NULL AND film_sha256~'^[0-9a-f]{64}$'))`,
  `CREATE INDEX arena_native_media_queue ON yunipals_arena.media_job(deployment,native_check_at) WHERE incarnation<>'legacy'`,
  `CREATE FUNCTION yunipals_arena.media_publication_immutable() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $media$
    BEGIN IF OLD IS DISTINCT FROM NEW THEN RAISE EXCEPTION 'Arena media publication is immutable'; END IF; RETURN NEW; END $media$`,
  `REVOKE ALL ON FUNCTION yunipals_arena.media_publication_immutable() FROM PUBLIC`,
  `CREATE TRIGGER arena_media_publication_immutable BEFORE UPDATE ON yunipals_arena.media_publication
    FOR EACH ROW EXECUTE FUNCTION yunipals_arena.media_publication_immutable()`,
  `CREATE FUNCTION yunipals_arena.media_job_binding() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $media$
    BEGIN
      IF TG_OP='UPDATE' AND OLD.input_hash IS NOT NULL AND (OLD.input_hash,OLD.outcome_hash)
        IS DISTINCT FROM (NEW.input_hash,NEW.outcome_hash) THEN RAISE EXCEPTION 'Arena media input binding is immutable'; END IF;
      IF NEW.publication_hash IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM yunipals_arena.media_publication p WHERE p.deployment=NEW.deployment AND p.tournament_id=NEW.tournament_id
          AND p.incarnation=NEW.incarnation AND p.publication_hash=NEW.publication_hash
          AND p.manifest->>'inputHash'=NEW.input_hash AND p.manifest->>'outcomeHash'=NEW.outcome_hash
          AND p.manifest->>'filmSha256'=NEW.film_sha256 AND p.manifest->>'incarnation'=NEW.incarnation
          AND p.manifest->>'deployment'=NEW.deployment AND p.manifest->>'tournamentId'=NEW.tournament_id::text
      ) THEN RAISE EXCEPTION 'Arena media publication binding is invalid'; END IF;
      RETURN NEW;
    END $media$`,
  `REVOKE ALL ON FUNCTION yunipals_arena.media_job_binding() FROM PUBLIC`,
  `CREATE TRIGGER arena_media_job_binding BEFORE INSERT OR UPDATE ON yunipals_arena.media_job
    FOR EACH ROW EXECUTE FUNCTION yunipals_arena.media_job_binding()`
];
var checksum2 = createHash4("sha256").update(JSON.stringify(statements2)).digest("hex");

// accepted-native-support:apps/yunipals-market-api/src/arena/live/mediaPublication.ts
import { createHash as createHash7 } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat, readFile as readFile2 } from "node:fs/promises";
import { join } from "node:path";

// accepted-native-support:apps/yunipals-market-api/src/arena/live/intake.ts
import { randomBytes as randomBytes2, randomUUID } from "node:crypto";

// accepted-native-support:packages/yunipals-market-core/src/arena.ts
import {
  encodeAbiParameters,
  keccak256,
  stringToHex
} from "viem";
var ARENA_FALLBACK_ATTACKS = [
  "Move within reach and use quick direct strikes whenever recovered. Otherwise recover and face the opponent.",
  "Move within reach and use heavy direct body strikes whenever recovered. Otherwise recover and face the opponent.",
  "Approach the opponent's exposed side and use quick direct strikes, recovering between attacks.",
  "Approach the opponent's exposed side and use heavy direct body strikes, recovering between attacks."
];
function automaticStrategy(contract, tournamentId, seat, rulesHash, word) {
  if (!Number.isInteger(seat) || seat < 0 || seat > 3 || tournamentId <= 0n)
    throw new Error("Invalid automatic strategy seat.");
  const common = [
    8453n,
    contract,
    tournamentId,
    seat,
    rulesHash,
    word
  ];
  const attack = Number(
    BigInt(
      keccak256(
        encodeAbiParameters(
          [
            { type: "bytes32" },
            { type: "uint256" },
            { type: "address" },
            { type: "uint256" },
            { type: "uint8" },
            { type: "bytes32" },
            { type: "uint256" }
          ],
          [
            keccak256(stringToHex("yunipals-arena/automatic-attack/v1")),
            ...common
          ]
        )
      )
    ) % 4n
  );
  const commitment = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint8" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "uint8" }
      ],
      [
        keccak256(stringToHex("yunipals-arena/automatic-commitment/v1")),
        ...common,
        attack
      ]
    )
  );
  return {
    seat,
    text: ARENA_FALLBACK_ATTACKS[attack],
    commitment,
    salt: `0x${"0".repeat(64)}`,
    signature: "0x",
    source: "automatic"
  };
}

// accepted-native-support:apps/yunipals-market-api/src/arena/live/crypto.ts
import {
  createCipheriv,
  createDecipheriv,
  createHash as createHash5,
  randomBytes
} from "node:crypto";

// accepted-native-support:apps/yunipals-market-api/src/arena/live/sourceSelection.ts
var sourceLeaseKey = (deployment) => `arena/source-selection/${deployment}`;
async function selectedArenaSource(db, deployment) {
  return (await db.query(
    "SELECT epoch,kind,source_id FROM yunipals_arena.source_selection WHERE deployment=$1",
    [deployment]
  )).rows[0];
}

// accepted-native-support:apps/yunipals-market-api/src/arena/live/mediaApi.ts
import { randomUUID as randomUUID2, createHash as createHash6 } from "node:crypto";
import { readFile, realpath, mkdir, writeFile, rename } from "node:fs/promises";
import { resolve as resolve2, relative, dirname } from "node:path";

// accepted-native-support:apps/yunipals-market-api/src/arena/live/mediaAdoption.ts
var assets = ["SF1", "SF2", "FINAL"].flatMap(
  (match) => ["image", "opening", "continuation"].map((kind) => `${match}/${kind}`)
).sort();
async function verifyNativeArenaFilm(client, observed) {
  await verifyNativeArenaAction(client, observed);
  const head = await client.getBlock({ blockTag: "latest" });
  if (!head.hash || head.number < BigInt(observed.tournament.last.blockNumber) || Math.abs(Number(head.timestamp) * 1e3 - Date.now()) > 12e4)
    throw new Error("Arena publication head is unavailable.");
  const film = await client.readContract({
    address: observed.tournament.deployment.slice(5),
    abi: arenaAbi,
    functionName: "publishedVideoHash",
    args: [BigInt(observed.tournament.id)],
    blockNumber: head.number
  });
  if (film.toLowerCase() !== (observed.tournament.state.videoHash ?? `0x${"0".repeat(64)}`) || (await client.getBlock({ blockNumber: head.number })).hash !== head.hash)
    throw new Error("Arena publication hash changed.");
}

// accepted-native-support:apps/yunipals-market-api/src/arena/live/sourceSelectionSchema.ts
import { createHash as createHash8 } from "node:crypto";
var statements3 = [
  `CREATE TABLE yunipals_arena.source_operational_cursor (
    deployment text PRIMARY KEY REFERENCES yunipals_arena.deployment(id),
    indexed_block bigint NOT NULL CHECK(indexed_block>=0),
    source_id text NOT NULL CHECK(source_id~'^0x[0-9a-f]{64}$'),
    observed_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE yunipals_arena.source_selection (
    deployment text PRIMARY KEY REFERENCES yunipals_arena.deployment(id),
    epoch uuid NOT NULL,kind text NOT NULL CHECK(kind IN('unified','legacy_rollback')),
    source_id text NOT NULL CHECK(source_id~'^0x[0-9a-f]{64}$'),
    accepted_block bigint NOT NULL CHECK(accepted_block>=0),
    accepted_hash text NOT NULL CHECK(accepted_hash~'^0x[0-9a-f]{64}$'),
    review_hash text NOT NULL CHECK(review_hash~'^0x[0-9a-f]{64}$'),
    switched_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE yunipals_arena.source_switch_history (
    epoch uuid PRIMARY KEY,deployment text NOT NULL REFERENCES yunipals_arena.deployment(id),
    review_hash text NOT NULL CHECK(review_hash~'^0x[0-9a-f]{64}$'),
    review jsonb NOT NULL,switched_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE FUNCTION yunipals_arena.source_switch_immutable() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $source$
    BEGIN RAISE EXCEPTION 'Arena source switch history is immutable'; END $source$`,
  `REVOKE ALL ON FUNCTION yunipals_arena.source_switch_immutable() FROM PUBLIC`,
  `CREATE TRIGGER arena_source_switch_immutable BEFORE UPDATE OR DELETE ON yunipals_arena.source_switch_history
    FOR EACH ROW EXECUTE FUNCTION yunipals_arena.source_switch_immutable()`,
  `CREATE FUNCTION yunipals_arena.source_selection_fence() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $source$
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext('arena/source-selection/'||NEW.deployment));
      IF NOT EXISTS(SELECT 1 FROM yunipals_arena.deployment d WHERE d.id=NEW.deployment AND d.halted AND d.indexer_mode='unified')
        THEN RAISE EXCEPTION 'Arena source change requires halted compatible consumers'; END IF;
      IF TG_OP='UPDATE' AND (NEW.deployment<>OLD.deployment OR NEW.accepted_block<OLD.accepted_block)
        THEN RAISE EXCEPTION 'Arena source floor cannot be reset'; END IF;
      IF NOT EXISTS(SELECT 1 FROM yunipals_arena.source_switch_history h
        WHERE h.epoch=NEW.epoch AND h.deployment=NEW.deployment AND h.review_hash=NEW.review_hash
        AND h.review#>>'{target,kind}'=NEW.kind AND h.review#>>'{target,sourceId}'=NEW.source_id
        AND h.review#>>'{accepted,block}'=NEW.accepted_block::text AND h.review#>>'{accepted,hash}'=NEW.accepted_hash)
        THEN RAISE EXCEPTION 'Arena source change has no matching immutable review'; END IF;
      RETURN NEW;
    END $source$`,
  `REVOKE ALL ON FUNCTION yunipals_arena.source_selection_fence() FROM PUBLIC`,
  `CREATE TRIGGER arena_source_selection_fence BEFORE INSERT OR UPDATE ON yunipals_arena.source_selection
    FOR EACH ROW EXECUTE FUNCTION yunipals_arena.source_selection_fence()`
];
var arenaSourceSelectionMigration = {
  version: 9,
  checksum: createHash8("sha256").update(JSON.stringify(statements3)).digest("hex")
};
var watermarkSql = `ALTER TABLE yunipals_arena.source_operational_cursor
  DROP CONSTRAINT source_operational_cursor_deployment_fkey,
  ADD CONSTRAINT source_operational_cursor_deployment_fkey FOREIGN KEY(deployment)
  REFERENCES yunipals_arena.deployment(id) ON DELETE CASCADE`;
var arenaSourceWatermarkMigration = {
  version: 10,
  checksum: createHash8("sha256").update(watermarkSql).digest("hex")
};
var deleteFenceSql = `CREATE TRIGGER arena_source_selection_no_delete BEFORE DELETE ON yunipals_arena.source_selection
  FOR EACH ROW EXECUTE FUNCTION yunipals_arena.source_switch_immutable()`;
var arenaSourceDeleteFenceMigration = {
  version: 11,
  checksum: createHash8("sha256").update(deleteFenceSql).digest("hex")
};
var predecessorStatements = [
  `CREATE OR REPLACE FUNCTION yunipals_arena.source_selection_fence() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $source$
    DECLARE previous jsonb;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext('arena/source-selection/'||NEW.deployment));
      IF NOT EXISTS(SELECT 1 FROM yunipals_arena.deployment d WHERE d.id=NEW.deployment AND d.halted AND d.indexer_mode='unified')
        THEN RAISE EXCEPTION 'Arena source change requires halted compatible consumers'; END IF;
      IF TG_OP='UPDATE' THEN
        IF NEW.deployment<>OLD.deployment OR NEW.accepted_block<OLD.accepted_block OR NEW.epoch=OLD.epoch
          THEN RAISE EXCEPTION 'Arena source change requires a fresh epoch and nondecreasing floor'; END IF;
        previous:=jsonb_build_object('epoch',OLD.epoch::text,'kind',OLD.kind,'source_id',OLD.source_id);
      ELSE previous:='null'::jsonb; END IF;
      IF NEW.accepted_block<COALESCE((SELECT c.indexed_block FROM yunipals_arena.source_operational_cursor c WHERE c.deployment=NEW.deployment),0)
        THEN RAISE EXCEPTION 'Arena source is below the accepted operational floor'; END IF;
      IF NOT EXISTS(SELECT 1 FROM yunipals_arena.source_switch_history h
        WHERE h.epoch=NEW.epoch AND h.deployment=NEW.deployment AND h.review_hash=NEW.review_hash
        AND h.review#>>'{target,kind}'=NEW.kind AND h.review#>>'{target,sourceId}'=NEW.source_id
        AND h.review#>>'{accepted,block}'=NEW.accepted_block::text AND h.review#>>'{accepted,hash}'=NEW.accepted_hash
        AND h.review->'previous'=previous)
        THEN RAISE EXCEPTION 'Arena source change has no matching immutable review for its current predecessor'; END IF;
      RETURN NEW;
    END $source$`,
  `CREATE FUNCTION yunipals_arena.source_watermark_fence() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $source$
    DECLARE selected text; selected_deployment text;
    BEGIN
      IF TG_OP='DELETE' THEN selected_deployment:=OLD.deployment; ELSE selected_deployment:=NEW.deployment; END IF;
      PERFORM pg_advisory_xact_lock_shared(hashtext('arena/source-selection/'||selected_deployment));
      IF TG_OP='DELETE' THEN
        IF EXISTS(SELECT 1 FROM yunipals_arena.deployment d WHERE d.id=OLD.deployment)
          THEN RAISE EXCEPTION 'Arena operational floor cannot be deleted'; END IF;
        RETURN OLD;
      END IF;
      IF TG_OP='UPDATE' AND (NEW.deployment<>OLD.deployment OR NEW.indexed_block<OLD.indexed_block)
        THEN RAISE EXCEPTION 'Arena operational floor cannot decrease'; END IF;
      SELECT s.source_id INTO selected FROM yunipals_arena.source_selection s WHERE s.deployment=NEW.deployment;
      IF selected IS NOT NULL AND NEW.source_id<>selected
        THEN RAISE EXCEPTION 'Arena watermark source epoch changed'; END IF;
      RETURN NEW;
    END $source$`,
  `REVOKE ALL ON FUNCTION yunipals_arena.source_watermark_fence() FROM PUBLIC`,
  `CREATE TRIGGER arena_source_watermark_fence BEFORE INSERT OR UPDATE OR DELETE ON yunipals_arena.source_operational_cursor
    FOR EACH ROW EXECUTE FUNCTION yunipals_arena.source_watermark_fence()`
];
var arenaSourcePredecessorMigration = {
  version: 12,
  checksum: createHash8("sha256").update(JSON.stringify(predecessorStatements)).digest("hex")
};

// accepted-native-support:apps/yunipals-market-api/src/arena/live/sourceSwitch.ts
var ArenaSourceSwitch = class {
  constructor(service, target, client, verify, minimum) {
    this.service = service;
    this.target = target;
    this.client = client;
    this.verify = verify;
    this.minimum = minimum;
    if (!service.nativeSource || !/^0x[0-9a-f]{64}$/.test(target.sourceId))
      throw new Error(
        "Arena source switch requires explicit compatible sources."
      );
    if (minimum && (!/^(0|[1-9][0-9]*)$/.test(minimum.block) || !/^0x[0-9a-f]{64}$/.test(minimum.hash)))
      throw new Error("Invalid accepted Arena floor.");
  }
  async review(db) {
    const deployment = (await db.query(
      "SELECT halted,indexer_mode,start_block::text FROM yunipals_arena.deployment WHERE id=$1 FOR UPDATE",
      [this.service.deployment]
    )).rows[0];
    if (!deployment?.halted || deployment.indexer_mode !== "unified")
      throw new Error(
        "Arena source switch requires a halted compatible deployment."
      );
    await this.service.assertSourceSelection(db);
    for (const migration of [
      arenaSourceSelectionMigration,
      arenaSourceWatermarkMigration,
      arenaSourceDeleteFenceMigration,
      arenaSourcePredecessorMigration
    ]) {
      const marker = (await db.query(
        "SELECT checksum FROM yunipals_arena.operational_migration WHERE version=$1",
        [migration.version]
      )).rows[0];
      if (marker?.checksum !== migration.checksum)
        throw new Error("Arena source switch schema differs.");
    }
    const accepted = (await db.query(
      `SELECT GREATEST(
      COALESCE((SELECT indexed_block FROM yunipals_arena.source_operational_cursor WHERE deployment=$1),0),
      COALESCE((SELECT accepted_block FROM yunipals_arena.source_selection WHERE deployment=$1),0),
      COALESCE((SELECT max(receipt_block_number) FROM yunipals_arena.client_transaction WHERE deployment=$1),0),
      COALESCE((SELECT max(block_number) FROM yunipals_arena.transaction_receipt_history h
      JOIN yunipals_arena.transaction_intent i USING(action_id) WHERE i.deployment=$1 AND h.canonical),0),
      $2::bigint,$3::bigint)::text AS block`,
      [
        this.service.deployment,
        deployment.start_block,
        this.minimum?.block ?? "0"
      ]
    )).rows[0].block;
    const next = await this.target.source.read("0", {
      requiredThroughBlock: BigInt(accepted)
    });
    if (next.releaseId !== this.target.sourceId || BigInt(next.indexedThroughBlock) < BigInt(accepted))
      throw new Error(
        "Target Arena source has not reached the accepted operational cursor."
      );
    const boundary = await this.client.getBlock({
      blockNumber: BigInt(accepted)
    });
    if (this.minimum && (await this.client.getBlock({ blockNumber: BigInt(this.minimum.block) })).hash !== this.minimum.hash)
      throw new Error("The reviewed Arena floor is no longer canonical.");
    const head = await this.client.getBlock({ blockTag: "latest" });
    if (await this.client.getChainId() !== 8453 || !boundary.hash || !head.hash || head.number < BigInt(next.indexedThroughBlock) || Math.abs(Date.now() - Number(head.timestamp) * 1e3) > 12e4)
      throw new Error("Arena switch canonical coverage is unavailable.");
    const identities = (await db.query(
      `SELECT tournament_id::text AS id,incarnation,opened_event_id,opened_block_hash FROM yunipals_arena.tournament_identity
      WHERE deployment=$1 ORDER BY tournament_id,incarnation LIMIT 1001`,
      [this.service.deployment]
    )).rows;
    if (identities.length > 1e3 || identities.some((row) => row.incarnation === "legacy"))
      throw new Error(
        "Arena switch requires reviewed bound identities within its verification limit."
      );
    const latest = await this.target.source.list();
    const ids = /* @__PURE__ */ new Set([...identities.map((row) => row.id), ...latest.ids]);
    const origins = [];
    for (const id of ids) {
      const observed = await this.target.source.read(id, {
        requiredThroughBlock: BigInt(accepted)
      }), t = observed.tournament;
      if (!t)
        throw new Error(
          "An accepted Arena opening is absent from the rollback source."
        );
      const known = identities.filter((row) => row.id === id);
      if (known.length && !known.some(
        (row) => row.incarnation === t.incarnation && row.opened_event_id === t.opened.id && row.opened_block_hash === t.opened.blockHash
      ))
        throw new Error(
          "Arena source switch changed an accepted opening; reconcile its origin first."
        );
      await this.verify({ ...observed, tournament: t });
      origins.push({
        id,
        incarnation: t.incarnation,
        opened: t.opened,
        inputFrozen: t.inputFrozen,
        stateHash: manifestDigest(t.state)
      });
    }
    const privateRecords = {};
    for (const table of [
      ...arenaPrivateTables,
      "provider_action_evidence",
      "media_publication",
      "client_transaction"
    ]) {
      const rows = (await db.query(
        table === "provider_action_evidence" ? `SELECT to_jsonb(e) AS body FROM yunipals_arena.provider_action_evidence e JOIN yunipals_arena.provider_task t USING(request_id)
            WHERE t.deployment=$1 ORDER BY e.request_id LIMIT 10001` : `SELECT to_jsonb(t) AS body FROM yunipals_arena.${table} t WHERE deployment=$1 ORDER BY to_jsonb(t)::text LIMIT 10001`,
        [this.service.deployment]
      )).rows;
      if (rows.length > 1e4)
        throw new Error(
          "Arena private-state review limit exceeded; use a larger measured rehearsal."
        );
      privateRecords[table] = {
        count: rows.length,
        digest: manifestDigest(rows.map((row) => row.body))
      };
    }
    if ((await this.client.getBlock({ blockNumber: BigInt(accepted) })).hash !== boundary.hash)
      throw new Error("Arena source switch boundary changed during review.");
    return {
      version: 1,
      deployment: this.service.deployment,
      migrationChecksum: arenaSourceSelectionMigration.checksum,
      sourceMigrationChecksums: [
        arenaSourceSelectionMigration,
        arenaSourceWatermarkMigration,
        arenaSourceDeleteFenceMigration,
        arenaSourcePredecessorMigration
      ],
      previous: await selectedArenaSource(db, this.service.deployment) ?? null,
      target: { kind: this.target.kind, sourceId: this.target.sourceId },
      accepted: { block: accepted, hash: boundary.hash.toLowerCase() },
      origins,
      privateRecords
    };
  }
  async run(applyReviewHash) {
    if (applyReviewHash !== void 0 && !/^0x[0-9a-f]{64}$/.test(applyReviewHash))
      throw new Error("An exact review hash is required.");
    const db = await this.service.pool.connect();
    try {
      await db.query("BEGIN");
      const lock = (await db.query(
        "SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked",
        [sourceLeaseKey(this.service.deployment)]
      )).rows[0];
      if (!lock?.locked)
        throw new Error(
          "Arena source switch is waiting for an in-flight action."
        );
      const review = await this.review(db), reviewHash = manifestDigest(review);
      if (!applyReviewHash) {
        await db.query("ROLLBACK");
        return { applied: false, reviewHash, review };
      }
      if (reviewHash !== applyReviewHash)
        throw new Error("Arena source switch review changed; review again.");
      const epoch = randomUUID3();
      await db.query(
        "INSERT INTO yunipals_arena.source_switch_history(epoch,deployment,review_hash,review) VALUES($1,$2,$3,$4)",
        [epoch, this.service.deployment, reviewHash, review]
      );
      const published = await db.query(
        review.previous ? `UPDATE yunipals_arena.source_selection SET epoch=$2,kind=$3,source_id=$4,accepted_block=$5,
            accepted_hash=$6,review_hash=$7,switched_at=now() WHERE deployment=$1` : `INSERT INTO yunipals_arena.source_selection(deployment,epoch,kind,source_id,accepted_block,accepted_hash,review_hash)
            VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          this.service.deployment,
          epoch,
          this.target.kind,
          this.target.sourceId,
          review.accepted.block,
          review.accepted.hash,
          reviewHash
        ]
      );
      if (published.rowCount !== 1)
        throw new Error("Arena source selector changed during publication.");
      await db.query("COMMIT");
      return { applied: true, epoch, reviewHash, review };
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
};
var arenaSourceSwitchVerifier = (client) => (observed) => observed.tournament.state.phase === "settled" ? verifyNativeArenaFilm(client, observed) : verifyNativeArenaAction(client, observed);

// accepted-native-support:apps/yunipals-market-api/src/arena/live/projection.ts
var json = (value) => JSON.stringify(
  value,
  (_, v) => typeof v === "bigint" ? v.toString() : v
);
function decimal5(value) {
  const text = String(value);
  if (!/^(0|[1-9][0-9]*)$/.test(text))
    throw new Error("Invalid event integer.");
  return text;
}
var address2 = (value) => String(value).toLowerCase();
async function credit(db, deployment, wallet, amount) {
  if (amount < 0n) {
    const result = await db.query(
      "UPDATE yunipals_arena.credit SET amount=amount+$3 WHERE deployment=$1 AND wallet=$2",
      [deployment, wallet.toLowerCase(), amount.toString()]
    );
    if (result.rowCount !== 1)
      throw new Error("Claim has no preceding credit.");
    return;
  }
  await db.query(
    `INSERT INTO yunipals_arena.credit VALUES($1,$2,$3)
    ON CONFLICT(deployment,wallet) DO UPDATE SET amount=yunipals_arena.credit.amount+EXCLUDED.amount`,
    [deployment, wallet.toLowerCase(), amount.toString()]
  );
}
async function projectEvent(db, deployment, event) {
  const inserted = await db.query(
    `INSERT INTO yunipals_arena.chain_event
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
    [
      deployment,
      event.blockNumber.toString(),
      event.blockHash,
      event.transactionHash,
      event.logIndex,
      event.eventName,
      json(event.args)
    ]
  );
  if (!inserted.rowCount) return;
  const a = event.args;
  if (event.eventName === "Claimed") {
    await credit(db, deployment, address2(a.player), -BigInt(decimal5(a.amount)));
    return;
  }
  if (a.id === void 0) return;
  const id = decimal5(a.id);
  let state;
  if (event.eventName === "TournamentOpened") {
    state = {
      id,
      phase: "open",
      deadline: Number(a.deadline),
      rulesHash: a.rulesHash,
      poolHash: a.poolHash,
      treasury: null,
      islandId: null,
      islandBeneficiary: null,
      requestId: null,
      randomWord: null,
      ticket: null,
      seats: [],
      inputHash: null,
      commitments: null,
      resultHash: null,
      winners: null,
      videoHash: null,
      automaticStrategyMask: 0
    };
    await db.query(
      "INSERT INTO yunipals_arena.tournament(deployment,id,state) VALUES($1,$2,$3)",
      [deployment, id, json(state)]
    );
    return;
  }
  const result = await db.query(
    "SELECT state FROM yunipals_arena.tournament WHERE deployment=$1 AND id=$2 FOR UPDATE",
    [deployment, id]
  );
  if (!result.rows[0])
    throw new Error("Arena event has no preceding tournament.");
  state = result.rows[0].state;
  switch (event.eventName) {
    case "TournamentTreasuryAssigned":
      state.treasury = address2(a.beneficiary);
      break;
    case "JoinWindowStarted":
      state.deadline = Number(a.deadline);
      break;
    case "Entered": {
      const seat = Number(a.seat);
      if (seat !== state.seats.length || seat > 3)
        throw new Error("Invalid arena seat order.");
      state.seats.push({
        seat,
        player: address2(a.player),
        nftChainId: Number(a.nftChainId),
        collection: address2(a.collection),
        tokenId: decimal5(a.tokenId)
      });
      break;
    }
    case "IslandRequested":
      state.requestId = decimal5(a.requestId);
      break;
    case "RandomnessReceived":
      state.randomWord = decimal5(a.word);
      break;
    case "IslandSelected":
      state.islandId = decimal5(a.islandId);
      state.ticket = Number(a.ticket);
      state.islandBeneficiary = address2(a.beneficiary);
      break;
    case "StrategiesOpened":
      state.phase = "strategies";
      state.deadline = Number(a.deadline);
      break;
    case "AutomaticStrategiesAssigned":
      if (state.phase !== "strategies" || !Number.isInteger(Number(a.seatMask)) || Number(a.seatMask) < 1 || Number(a.seatMask) > 15)
        throw new Error("Invalid automatic strategy assignment.");
      state.automaticStrategyMask = Number(a.seatMask);
      break;
    case "InputFrozen": {
      state.phase = "resolving";
      state.deadline = Number(a.deadline);
      state.inputHash = a.inputHash;
      state.commitments = a.strategyCommitments;
      const submissions = await db.query(
        "SELECT seat,commitment FROM yunipals_arena.submission WHERE deployment=$1 AND tournament_id=$2 ORDER BY seat",
        [deployment, id]
      );
      const mask = state.automaticStrategyMask ?? 0;
      const configured = mask ? (await db.query(
        "SELECT contract FROM yunipals_arena.deployment WHERE id=$1",
        [deployment]
      )).rows[0] : null;
      const matches = [0, 1, 2, 3].every((seat) => {
        const submission = submissions.rows.find((s) => s.seat === seat);
        if ((mask & 1 << seat) === 0)
          return submission?.commitment === state.commitments?.[seat];
        if (submission || !configured || state.randomWord === null)
          return false;
        return automaticStrategy(
          configured.contract,
          BigInt(id),
          seat,
          state.rulesHash,
          BigInt(state.randomWord)
        ).commitment === state.commitments?.[seat];
      });
      if (matches) {
        await db.query(
          "UPDATE yunipals_arena.frozen_input SET revealed_at=now() WHERE deployment=$1 AND tournament_id=$2 AND input_hash=$3",
          [deployment, id, state.inputHash]
        );
      }
      break;
    }
    case "ResultSettled": {
      if (state.phase !== "resolving" || !state.treasury || !state.islandBeneficiary)
        throw new Error("Invalid settlement projection.");
      state.phase = "settled";
      state.resultHash = a.resultHash;
      state.winners = [
        Number(a.semifinalOneWinner),
        Number(a.semifinalTwoWinner),
        Number(a.champion)
      ];
      break;
    }
    case "PayoutsReleased": {
      if (state.phase !== "settled" || state.videoHash || !state.winners || !state.treasury || !state.islandBeneficiary || !/^0x[0-9a-f]{64}$/i.test(String(a.videoHash)) || /^0x0{64}$/i.test(String(a.videoHash)))
        throw new Error("Invalid payout release projection.");
      state.videoHash = a.videoHash;
      const winner = state.seats[state.winners[2]];
      if (!winner) throw new Error("Missing winning seat.");
      await credit(db, deployment, winner.player, 6000000n);
      await credit(db, deployment, state.islandBeneficiary, 400000n);
      await credit(db, deployment, state.treasury, 1600000n);
      break;
    }
    case "TournamentExpired":
      if (state.phase === "settled" || state.phase === "expired")
        throw new Error("Invalid expiry projection.");
      state.phase = "expired";
      for (const seat of state.seats)
        await credit(db, deployment, seat.player, 2000000n);
      break;
  }
  await db.query(
    "UPDATE yunipals_arena.tournament SET state=$3,updated_at=now() WHERE deployment=$1 AND id=$2",
    [deployment, id, json(state)]
  );
}

// accepted-native-support:apps/yunipals-market-api/src/arena/live/nativeDerivedPublicOnly.ts
function need(value, code) {
  if (!value) throw new Error(code);
}
var PUBLIC_TABLES = ["chain_event", "credit", "deployment", "tournament"];
var PRIVATE_READ = "SELECT seat,commitment FROM yunipals_arena.submission WHERE deployment=$1 AND tournament_id=$2 ORDER BY seat";
var PRIVATE_WRITE = "UPDATE yunipals_arena.frozen_input SET revealed_at=now() WHERE deployment=$1 AND tournament_id=$2 AND input_hash=$3";
function publicOnlyPool(pool, counters = { privateDisclosureReadsSkipped: 0, privateDisclosureWritesSkipped: 0 }) {
  return { connect: async () => {
    const db = await pool.connect();
    return { query: async (text, args) => {
      need(typeof text === "string", "fixed_official_projector_sql_required");
      if (text === PRIVATE_READ) {
        counters.privateDisclosureReadsSkipped++;
        return { rows: [], rowCount: 0 };
      }
      if (text === PRIVATE_WRITE) {
        counters.privateDisclosureWritesSkipped++;
        return { rows: [], rowCount: 0 };
      }
      const relations = [...text.matchAll(/yunipals_arena\.([a-z_]+)/g)].map((x) => x[1]);
      need(relations.every((x) => PUBLIC_TABLES.includes(x)), "public_only_projection_relation_required");
      need(relations.length || /^(BEGIN|COMMIT|ROLLBACK|SELECT pg_(try_advisory_lock|advisory_unlock)\(hashtext\(\$1\)\)( AS locked)?)$/.test(text), "fixed_projector_control_statement_required");
      return db.query(text, args);
    }, release: () => db.release() };
  } };
}
async function targetCatalog(db, expected, writer = false) {
  const role = (await db.query("SELECT current_user AS name,(SELECT oid::int FROM pg_roles WHERE rolname=current_user) AS oid,current_database() AS database,(SELECT oid::int FROM pg_database WHERE datname=current_database()) AS database_oid,inet_server_addr()::text AS host,inet_server_port() AS port")).rows[0];
  need(role.name === (writer ? expected.writerRole.name : expected.readerRole.name) && role.oid === (writer ? expected.writerRole.oid : expected.readerRole.oid) && role.database_oid === expected.databaseOid, "actual_isolated_target_role_and_database_required");
  const attrs = (await db.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname=current_user")).rows[0];
  need(attrs.rolcanlogin && ["rolsuper", "rolcreatedb", "rolcreaterole", "rolinherit", "rolreplication", "rolbypassrls"].every((k) => !attrs[k]), "nonowner_noninheriting_public_source_role_required");
  const owned = (await db.query("SELECT count(*)::int AS n FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)")).rows[0].n;
  const member = (await db.query("SELECT count(*)::int AS n FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user) OR roleid=(SELECT oid FROM pg_roles WHERE rolname=current_user)")).rows[0].n;
  need(owned === 0 && member === 0, "no_public_source_ownership_or_memberships_required");
  const rows = (await db.query(`SELECT c.relname,c.oid::int AS oid,c.relkind,has_table_privilege(current_user,c.oid,'SELECT') AS s,has_table_privilege(current_user,c.oid,'INSERT') AS i,has_table_privilege(current_user,c.oid,'UPDATE') AS u,has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER') AS extra FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='yunipals_arena' AND c.relkind IN('r','p','v','m','f') ORDER BY c.relname`)).rows;
  need(rows.length === 4 && rows.every((r, i) => r.relname === PUBLIC_TABLES[i] && r.oid === expected.tables[r.relname] && r.relkind === "r" && r.s && !r.extra && r.i === writer && r.u === (writer && r.relname !== "chain_event")), "exact_four_public_table_effective_permissions_required");
  const schema = (await db.query("SELECT has_schema_privilege(current_user,'yunipals_arena','USAGE') AS usage,has_schema_privilege(current_user,'yunipals_arena','CREATE') AS create,has_database_privilege(current_user,current_database(),'CREATE,TEMP') AS extra")).rows[0];
  need(schema.usage && !schema.create && !schema.extra, "no_public_source_schema_database_creation_required");
  const ambient = (await db.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN('pg_catalog','information_schema','yunipals_arena') AND n.nspname !~ '^pg_toast|^pg_temp' AND c.relkind IN('r','p','v','m','f') AND has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')")).rows[0].n;
  need(ambient === 0, "no_nonpublic_source_relation_access_required");
  return { name: role.name, oid: role.oid, databaseOid: role.database_oid, host: role.host, port: role.port, tables: expected.tables, writer };
}

// accepted-native-support:apps/yunipals-market-api/src/arena/live/nativeReadPool.ts
import { createServer, Socket } from "node:net";
import { EventEmitter } from "node:events";
import { createHash as createHash9, randomBytes as randomBytes3 } from "node:crypto";
import { fstatSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
var POOL_FORMAT = "yunipals-arena-native-read-pool-v1";
var MAX_LINE = 16 * 1024 * 1024;
var MAX_QUERY = 2e5;
var LEASE_MILLISECONDS = 12e4;
var need2 = (ok, code) => {
  if (!ok) throw Error(code);
};
var encode = (value) => {
  if (value instanceof Date) return ["date", value.toISOString()];
  if (Buffer.isBuffer(value)) return ["buffer", value.toString("base64")];
  if (typeof value === "bigint") return ["bigint", String(value)];
  if (typeof value === "undefined") return ["undefined"];
  if (Array.isArray(value)) return ["array", value.map(encode)];
  if (value && typeof value === "object") return ["object", Object.entries(value).map(([key, row]) => [key, encode(row)])];
  return ["value", value];
};
var decode = (value) => {
  need2(Array.isArray(value), "typed_native_pool_value_required");
  if (value[0] === "undefined" && value.length === 1) return void 0;
  need2(value.length === 2, "exact_typed_native_pool_value_required");
  if (value[0] === "date") return new Date(value[1]);
  if (value[0] === "buffer") return Buffer.from(value[1], "base64");
  if (value[0] === "bigint") return BigInt(value[1]);
  if (value[0] === "array") return value[1].map(decode);
  if (value[0] === "object") return Object.fromEntries(value[1].map(([key, row]) => [key, decode(row)]));
  need2(value[0] === "value", "known_native_pool_value_type_required");
  return value[1];
};
var identityHash = (value) => createHash9("sha256").update(JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item)).digest("hex");
function serviceRuntimeEpoch() {
  const stat2 = readFileSync("/proc/self/stat", "utf8"), startTicks = Number(stat2.slice(stat2.lastIndexOf(")") + 2).split(" ")[19]);
  const invocation = process.env.INVOCATION_ID, bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  need2(
    Number.isSafeInteger(startTicks) && startTicks > 0 && /^[a-f0-9]{32}$/.test(invocation) && /^[a-f0-9-]{36}$/.test(bootId),
    "actual_systemd_process_invocation_and_boot_epoch_required"
  );
  return { pid: process.pid, startTicks, invocation, bootId };
}
function sharedReadPool(raw) {
  need2(raw?.options?.max === 1, "one_actual_shared_PG_connection_required");
  const events = new EventEmitter(), waiters = [];
  let active = false, closed = false;
  const acquire = () => new Promise((resolve3, reject) => {
    if (closed) {
      reject(Error("shared_read_pool_closed"));
      return;
    }
    if (!active) {
      active = true;
      resolve3();
      return;
    }
    if (waiters.length >= 9) {
      reject(Error("bounded_shared_read_pool_waiters_required"));
      return;
    }
    const entry = { resolve: resolve3, reject, timer: null };
    entry.timer = setTimeout(() => {
      const index = waiters.indexOf(entry);
      if (index >= 0) waiters.splice(index, 1);
      reject(Error("bounded_shared_read_pool_wait_required"));
    }, LEASE_MILLISECONDS);
    waiters.push(entry);
  });
  const release = () => {
    const entry = waiters.shift();
    if (entry) {
      clearTimeout(entry.timer);
      entry.resolve();
    } else active = false;
  };
  events.options = { ...raw.options, max: 1 };
  events.connect = async () => {
    await acquire();
    let client;
    try {
      client = await raw.connect();
    } catch (error) {
      release();
      throw error;
    }
    let released = false;
    return { query: (...args) => client.query(...args), release: (error) => {
      need2(!released, "one_shared_read_pool_release_required");
      released = true;
      try {
        client.release(error);
      } finally {
        release();
      }
    } };
  };
  events.query = async (...args) => {
    const client = await events.connect();
    try {
      return await client.query(...args);
    } finally {
      client.release();
    }
  };
  events.end = async () => {
    closed = true;
    for (const entry of waiters.splice(0)) {
      clearTimeout(entry.timer);
      entry.reject(Error("shared_read_pool_closed"));
    }
    await raw.end();
  };
  raw.on("error", () => {
  });
  events.sharedMaximumConnections = 1;
  return events;
}
function lines(socket, receive, fail) {
  let pending = Buffer.alloc(0);
  socket.on("data", (raw) => {
    try {
      pending = Buffer.concat([pending, raw]);
      need2(pending.length <= MAX_LINE, "bounded_native_pool_frame_required");
      for (; ; ) {
        const offset = pending.indexOf(10);
        if (offset < 0) break;
        const row = pending.subarray(0, offset);
        pending = pending.subarray(offset + 1);
        need2(row.length > 0, "one_native_pool_JSON_frame_required");
        receive(JSON.parse(row.toString("utf8")));
      }
    } catch (error) {
      fail(error);
    }
  });
}
function send(socket, value) {
  const raw = Buffer.from(JSON.stringify(value) + "\n");
  need2(raw.length <= MAX_LINE, "bounded_native_pool_response_required");
  socket.write(raw);
}
function readQuery(value) {
  need2(typeof value === "string" && value.length > 0 && value.length <= MAX_QUERY, "bounded_native_read_query_required");
  const text = value.trim();
  need2(
    /^(SELECT|WITH)\b/i.test(text) && !text.includes(";") && !/\b(set_config|pg_advisory_lock|pg_terminate_backend|pg_cancel_backend|lo_import|lo_export)\b/i.test(text) || /^(BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY|COMMIT|ROLLBACK);?$/i.test(text),
    "native_read_or_exact_snapshot_control_query_required"
  );
  return value;
}
async function serveNativeReadPool(pool, options) {
  need2(
    options && Number.isInteger(options.fd) && options.fd >= 3 && options.identity && options.identity.sourceRole.name === "arena_native_reader",
    "fixed_root_socket_and_native_pool_identity_required"
  );
  need2(identityHash(options.identity.runtimeEpoch) === identityHash(serviceRuntimeEpoch()), "actual_self_runtime_epoch_required_for_shared_listener");
  const file = lstatSync(options.path), descriptor = fstatSync(options.fd);
  need2(
    file.isSocket() && file.uid === 0 && file.gid === 0 && (file.mode & 511) === 384 && descriptor.isSocket() && descriptor.uid === 0 && descriptor.gid === 0,
    "actual_root_owned_mode0600_listener_required"
  );
  const link = readlinkSync("/proc/self/fd/" + options.fd), inode = /^socket:\[([1-9][0-9]*)\]$/.exec(link)?.[1];
  const registrations = readFileSync("/proc/net/unix", "utf8").trim().split("\n").slice(1).map((line) => line.trim().split(/\s+/)).filter((row) => row[6] === inode);
  need2(
    registrations.length === 1 && registrations[0][3] === "00010000" && registrations[0][4] === "0001" && registrations[0].slice(7).join(" ") === options.path,
    "inherited_listener_must_match_fixed_root_socket_path"
  );
  const sockets = /* @__PURE__ */ new Set();
  let closing = false;
  const server = createServer((socket) => {
    if (closing || sockets.size >= 8) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    let client = null, lease = null, expected = 1, chain = Promise.resolve(), timer = null, dead = false, queued = 0;
    const cleanup = async () => {
      clearTimeout(timer);
      timer = null;
      const actual = client;
      client = null;
      lease = null;
      if (actual) {
        try {
          await actual.query("ROLLBACK");
          await actual.query("DISCARD ALL");
          actual.release();
        } catch (error) {
          actual.release(error);
          throw error;
        }
      }
    };
    const fail = () => {
      dead = true;
      socket.destroy();
    };
    socket.on("error", fail);
    socket.on("close", () => {
      dead = true;
      sockets.delete(socket);
      chain = chain.then(cleanup, cleanup).catch(() => {
      });
    });
    lines(socket, (message) => {
      if (++queued > 8) {
        fail();
        return;
      }
      chain = chain.then(async () => {
        if (dead) return;
        try {
          need2(message && message.format === POOL_FORMAT && Number.isSafeInteger(message.id) && message.id === expected++ && ["connect", "query", "release"].includes(message.action), "ordered_native_pool_request_required");
          const keys = message.action === "connect" ? ["format", "id", "action", "poolKind", "identitySha256"] : message.action === "release" ? ["format", "id", "action", "lease"] : ["format", "id", "action", "lease", "text", "values"];
          need2(Object.keys(message).sort().join() === keys.sort().join(), "exact_native_pool_request_shape_required");
          if (message.action === "connect") {
            need2(client === null && lease === null, "one_native_pool_session_per_channel_required");
            need2(["native", "target"].includes(message.poolKind) && (message.poolKind === "native" || options.targetPool), "explicit_actual_shared_read_pool_kind_required");
            need2(message.identitySha256 === identityHash(options.identity), "same_actual_projector_source_pool_epoch_required");
            client = await (message.poolKind === "native" ? pool : options.targetPool).connect();
            if (dead) {
              await cleanup();
              return;
            }
            const expectedRole = message.poolKind === "native" ? options.identity.sourceRole : options.identity.publicReaderRole;
            const expectedDatabase = message.poolKind === "native" ? options.identity.nativeDatabaseOid : options.identity.publicDatabaseOid;
            const current = (await client.query("SELECT current_user AS name,session_user AS authenticated_name,(SELECT oid::int FROM pg_roles WHERE rolname=current_user) AS oid,(SELECT oid::int FROM pg_database WHERE datname=current_database()) AS database_oid,current_setting('default_transaction_read_only') AS default_readonly,current_setting('transaction_read_only') AS readonly")).rows[0];
            need2(current?.name === expectedRole?.name && current.authenticated_name === expectedRole.name && current.oid === expectedRole.oid && current.database_oid === expectedDatabase && current.default_readonly === "on" && current.readonly === "on", "actual_readonly_shared_pool_role_database_required");
            lease = randomBytes3(24).toString("hex");
            timer = setTimeout(fail, LEASE_MILLISECONDS);
            send(socket, { format: POOL_FORMAT, id: message.id, ok: true, lease, poolKind: message.poolKind, identity: options.identity });
          } else {
            need2(client && typeof message.lease === "string" && message.lease === lease, "same_native_pool_session_lease_required");
            if (message.action === "release") {
              await cleanup();
              send(socket, { format: POOL_FORMAT, id: message.id, ok: true });
            } else {
              const values = decode(message.values);
              need2(Array.isArray(values), "native_query_parameter_array_required");
              const result = await client.query(readQuery(message.text), values);
              send(socket, { format: POOL_FORMAT, id: message.id, ok: true, result: encode({
                rows: result.rows,
                fields: result.fields,
                rowCount: result.rowCount,
                command: result.command,
                oid: result.oid
              }) });
            }
          }
        } catch (error) {
          if (message.action === "connect" && client && lease === null) {
            try {
              await cleanup();
            } catch {
              fail();
              return;
            }
          }
          if (!dead) send(socket, {
            format: POOL_FORMAT,
            id: message.id,
            ok: false,
            code: typeof error.code === "string" && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : "native_pool_request_refused"
          });
        }
      }).finally(() => {
        queued--;
      }).catch(fail);
    }, fail);
  });
  await new Promise((resolve3, reject) => {
    server.once("error", reject);
    server.listen({ fd: options.fd }, resolve3);
  });
  return { close: async () => {
    closing = true;
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve3) => server.close(resolve3));
  } };
}
function nativeReadPoolClient(fd, expectedIdentity) {
  need2(
    Number.isInteger(fd) && fd >= 3 && expectedIdentity && expectedIdentity.sourceRole.name === "arena_native_reader",
    "actual_root_delegated_native_pool_descriptor_required"
  );
  return nativeReadPoolSession(new Socket({ fd, readable: true, writable: true }), expectedIdentity, "native");
}
function publicReadPoolClient(fd, expectedIdentity) {
  need2(Number.isInteger(fd) && fd >= 3, "actual_root_delegated_public_pool_descriptor_required");
  return nativeReadPoolSession(new Socket({ fd, readable: true, writable: true }), expectedIdentity, "target");
}
function nativeReadPoolSession(socket, expectedIdentity, poolKind = "native") {
  need2(socket instanceof Socket && expectedIdentity?.sourceRole?.name === "arena_native_reader" && ["native", "target"].includes(poolKind), "actual_connected_native_pool_channel_required");
  const events = new EventEmitter(), requests = /* @__PURE__ */ new Map();
  let counter = 0, active = false, ended = false, leaseTail = Promise.resolve();
  const fail = (error = Error("native_pool_channel_closed")) => {
    for (const request of requests.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    requests.clear();
  };
  socket.on("error", fail);
  socket.on("close", () => {
    ended = true;
    fail();
  });
  lines(socket, (message) => {
    need2(message && message.format === POOL_FORMAT && requests.has(message.id), "same_native_pool_response_required");
    const request = requests.get(message.id);
    requests.delete(message.id);
    clearTimeout(request.timer);
    if (!message.ok) {
      const error = Error("native_pool_query_refused");
      error.code = message.code;
      request.reject(error);
    } else request.resolve(message);
  }, (error) => {
    fail(error);
    socket.destroy();
  });
  const ask = (value) => new Promise((resolve3, reject) => {
    if (ended) {
      reject(Error("native_pool_channel_closed"));
      return;
    }
    const id = ++counter, timer = setTimeout(() => {
      socket.destroy();
      reject(Error("bounded_native_pool_roundtrip_required"));
    }, LEASE_MILLISECONDS);
    requests.set(id, { resolve: resolve3, reject, timer });
    try {
      send(socket, { format: POOL_FORMAT, id, ...value });
    } catch (error) {
      clearTimeout(timer);
      requests.delete(id);
      reject(error);
    }
  });
  const pool = events;
  pool.connect = async () => {
    let unlock;
    const previous = leaseTail, own = new Promise((resolve3) => {
      unlock = resolve3;
    });
    leaseTail = previous.then(() => own);
    await previous;
    try {
      need2(!active && !ended, "one_borrowed_native_pool_session_required");
    } catch (error) {
      unlock();
      throw error;
    }
    active = true;
    let response;
    try {
      response = await ask({ action: "connect", poolKind, identitySha256: identityHash(expectedIdentity) });
    } catch (error) {
      active = false;
      unlock();
      throw error;
    }
    if (response.poolKind !== poolKind || identityHash(response.identity) !== identityHash(expectedIdentity)) {
      socket.destroy();
      active = false;
      unlock();
      throw Error("same_actual_projector_source_pool_identity_required");
    }
    let released = false;
    return { query: async (text, values = []) => {
      need2(!released, "native_pool_session_already_released");
      if (text && typeof text === "object") {
        need2(Object.keys(text).every((key) => ["text", "values"].includes(key)), "plain_native_query_config_required");
        values = text.values ?? [];
        text = text.text;
      }
      return decode((await ask({ action: "query", lease: response.lease, text: readQuery(text), values: encode(values) })).result);
    }, release: () => {
      need2(!released, "one_native_pool_release_required");
      released = true;
      pool._released = ask({ action: "release", lease: response.lease }).then(() => {
        active = false;
        unlock();
      });
      pool._released.catch((error) => {
        active = false;
        unlock();
        socket.destroy();
        fail(error);
      });
    } };
  };
  pool.query = async (text, values) => {
    const client = await pool.connect();
    try {
      return await client.query(text, values);
    } finally {
      client.release();
    }
  };
  pool.end = async () => {
    if (pool._released) await pool._released;
    socket.destroy();
    ended = true;
  };
  pool.sharedNativeReadPool = true;
  return pool;
}
export {
  ArenaRollbackSource,
  ArenaSourceSwitch,
  NativeArenaSource,
  arenaAbi,
  arenaRollbackSourceId,
  arenaSourceSwitchVerifier,
  createIndexerReader,
  nativeReadPoolClient,
  nativeTournamentState,
  projectEvent,
  publicOnlyPool,
  publicReadPoolClient,
  readBoundRuntime,
  serveNativeReadPool,
  serviceRuntimeEpoch,
  sharedReadPool,
  sqlIdentifier,
  targetCatalog
};
//# sourceMappingURL=arena-inverse-support.mjs.map
