import { createRequire as __runtimeCreateRequire } from "node:module"; const require = __runtimeCreateRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// lib/offchain/read-snapshot.ts
import { AsyncLocalStorage } from "node:async_hooks";
async function open(snapshot) {
  return snapshot.opening ??= (async () => {
    const client = await snapshot.pool.connect();
    snapshot.client = client;
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    snapshot.proof = await snapshot.validate(client);
    return client;
  })();
}
function submit(snapshot, task) {
  const pending = snapshot.queue.then(async () => task(await open(snapshot)));
  snapshot.queue = pending.then(
    () => void 0,
    () => {
      snapshot.failed = true;
    }
  );
  return pending;
}
function requestSnapshotPool(pool2) {
  if (originals.has(pool2)) return pool2;
  const wrapped = new Proxy(pool2, {
    get(target, key) {
      if (key === "query")
        return (...args) => {
          const snapshot = storage.getStore();
          if (!snapshot || snapshot.pool !== pool2)
            return Reflect.apply(target.query, target, args);
          if (typeof args.at(-1) === "function")
            throw new Error("Request snapshots require promise queries.");
          return submit(
            snapshot,
            (client) => Reflect.apply(client.query, client, args)
          );
        };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  originals.set(wrapped, pool2);
  return wrapped;
}
async function withOwnershipRequest(pool2, validate, task) {
  const snapshot = {
    pool: original(pool2),
    validate,
    queue: Promise.resolve(),
    failed: false,
    savepoint: 0
  };
  let succeeded = false;
  try {
    const result = await storage.run(snapshot, task);
    succeeded = true;
    return result;
  } finally {
    await snapshot.queue;
    if (snapshot.client) {
      const client = snapshot.client;
      let discard = false;
      try {
        await client.query(
          succeeded && !snapshot.failed ? "COMMIT" : "ROLLBACK"
        );
      } catch (error) {
        discard = true;
        throw error;
      } finally {
        client.release(discard);
      }
    }
  }
}
function ownershipRequestFingerprint() {
  return storage.getStore()?.proof?.fingerprint ?? null;
}
async function apiReadTransaction(pool2, task) {
  const snapshot = storage.getStore();
  if (snapshot && snapshot.pool === original(pool2)) {
    return submit(snapshot, async (client2) => {
      const savepoint = `api_read_${++snapshot.savepoint}`;
      await client2.query(`SAVEPOINT ${savepoint}`);
      try {
        return await task(client2);
      } finally {
        await client2.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await client2.query(`RELEASE SAVEPOINT ${savepoint}`);
      }
    });
  }
  const client = await pool2.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const result = await task(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => void 0);
    throw error;
  } finally {
    client.release();
  }
}
function withDatabaseReadSnapshot(pool2, task) {
  return withOwnershipRequest(
    pool2,
    async () => ({ fingerprint: "database-snapshot" }),
    task
  );
}
var storage, originals, original;
var init_read_snapshot = __esm({
  "lib/offchain/read-snapshot.ts"() {
    "use strict";
    storage = new AsyncLocalStorage();
    originals = /* @__PURE__ */ new WeakMap();
    original = (pool2) => originals.get(pool2) ?? pool2;
  }
});

// lib/ownership/request-snapshot.ts
var init_request_snapshot = __esm({
  "lib/ownership/request-snapshot.ts"() {
    "use strict";
    init_read_snapshot();
  }
});

// lib/offchain/db.ts
var db_exports = {};
__export(db_exports, {
  apiPool: () => apiPool,
  closePool: () => closePool,
  pool: () => pool
});
import pg from "pg";
async function closePool() {
  await pool.end();
}
var databaseUrl, offchainPoolMaximum, pool, positiveNumber, apiPool, previousWaiting, poolMonitor;
var init_db = __esm({
  "lib/offchain/db.ts"() {
    "use strict";
    init_request_snapshot();
    databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required");
    offchainPoolMaximum = (value) => {
      if (value === void 0) return 12;
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 12)
        throw new Error(
          "OFFCHAIN_DB_POOL_MAX must be a positive integer at most 12"
        );
      return parsed;
    };
    pool = new pg.Pool({
      connectionString: databaseUrl,
      max: offchainPoolMaximum(process.env.OFFCHAIN_DB_POOL_MAX)
    });
    positiveNumber = (value, fallback) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    };
    apiPool = requestSnapshotPool(
      new pg.Pool({
        connectionString: databaseUrl,
        application_name: "yunipals_api",
        max: positiveNumber(process.env.API_DB_POOL_MAX, 12),
        connectionTimeoutMillis: positiveNumber(
          process.env.API_DB_ACQUIRE_TIMEOUT_MS,
          1e3
        ),
        statement_timeout: positiveNumber(
          process.env.API_DB_STATEMENT_TIMEOUT_MS,
          1e4
        ),
        lock_timeout: positiveNumber(process.env.API_DB_LOCK_TIMEOUT_MS, 2e3),
        idle_in_transaction_session_timeout: positiveNumber(
          process.env.API_DB_IDLE_TRANSACTION_TIMEOUT_MS,
          1e4
        )
      })
    );
    apiPool.on("error", (error) => console.error("API database pool error", error));
    previousWaiting = 0;
    poolMonitor = setInterval(() => {
      if (apiPool.waitingCount > 0 || previousWaiting > 0) {
        console.warn("API database pool pressure", {
          total: apiPool.totalCount,
          idle: apiPool.idleCount,
          waiting: apiPool.waitingCount
        });
      }
      previousWaiting = apiPool.waitingCount;
    }, 1e3);
    poolMonitor.unref();
  }
});

// lib/metadata/render/legacy.cjs
var require_legacy = __commonJS({
  "lib/metadata/render/legacy.cjs"(exports, module) {
    "use strict";
    var { rarityFor: rarityFor3 } = __require("@polkamon/web3-util-pmons/src/lib/rarity/rarity.js");
    var { AttributeTransformingUtils: AttributeTransformingUtils4 } = __require("@polkamon/web3-util-pmons/src/lib/attributeRepository/transforming/AttributeTransforming.js");
    var { PublicAttributeTransformingUtils: PublicAttributeTransformingUtils2 } = __require("@polkamon/web3-util-pmons/src/lib/attributeRepository/transforming/PublicAttributeTransforming.js");
    var { getLegacyChain: getLegacyChain2 } = __require("@polkamon/web3-util-pmons/src/lib/legacy/chain.js");
    var { isRainbowByAttrs: isRainbowByAttrs4 } = __require("@polkamon/web3-util-pmons/src/lib/type/rainbowType.js");
    var { NFBOrigins: NFBOrigins2 } = __require("@polkamon/web3-util-core/src/lib/ids/nfb.js");
    module.exports = { AttributeTransformingUtils: AttributeTransformingUtils4, PublicAttributeTransformingUtils: PublicAttributeTransformingUtils2, getLegacyChain: getLegacyChain2, isRainbowByAttrs: isRainbowByAttrs4, rarityFor: rarityFor3, NFBOrigins: NFBOrigins2 };
  }
});

// lib/rarity/legacy.cjs
var require_legacy2 = __commonJS({
  "lib/rarity/legacy.cjs"(exports, module) {
    "use strict";
    var {
      rarityFor: rarityFor3
    } = __require("@polkamon/web3-util-pmons/src/lib/rarity/rarity.js");
    var {
      AttributeTransformingUtils: AttributeTransformingUtils4
    } = __require("@polkamon/web3-util-pmons/src/lib/attributeRepository/transforming/AttributeTransforming.js");
    var {
      isRainbowByAttrs: isRainbowByAttrs4
    } = __require("@polkamon/web3-util-pmons/src/lib/type/rainbowType.js");
    module.exports = { AttributeTransformingUtils: AttributeTransformingUtils4, isRainbowByAttrs: isRainbowByAttrs4, rarityFor: rarityFor3 };
  }
});

// lib/ownership/read-mode.ts
function ownershipReadConfiguration(env = process.env) {
  const mode = env.OWNERSHIP_READ_MODE ?? "legacy";
  const bnbConfirmations = Number(env.BNB_CONFIRMATIONS ?? 20);
  if (!Number.isSafeInteger(bnbConfirmations) || bnbConfirmations < 1 || bnbConfirmations > 1e3)
    throw new Error("Invalid BNB ownership confirmation policy.");
  if (mode !== "legacy" && mode !== "unified")
    throw new Error("Invalid ownership read mode.");
  if (mode === "legacy") {
    if (env.OWNERSHIP_READ_SCHEMA !== void 0 || env.OWNERSHIP_RELEASE_ID !== void 0)
      throw new Error("Unified ownership selectors require unified read mode.");
    return {
      mode,
      readSchema: env.READ_DATABASE_SCHEMA ?? env.DATABASE_SCHEMA ?? "public",
      releaseId: null,
      bnbConfirmations
    };
  }
  const readSchema = env.OWNERSHIP_READ_SCHEMA, releaseId = env.OWNERSHIP_RELEASE_ID;
  if (!readSchema || !/^[a-z_][a-z0-9_]{0,62}$/i.test(readSchema) || !releaseId || !/^0x[0-9a-f]{64}$/.test(releaseId) || !env.DATABASE_SCHEMA || env.YUNIPALS_PROJECTION_MODE !== "generation" || readSchema === env.DATABASE_SCHEMA || env.READ_DATABASE_SCHEMA !== void 0 && env.READ_DATABASE_SCHEMA !== readSchema)
    throw new Error(
      "Configure one registered ownership release, its candidate read schema and the physical Ponder schema."
    );
  return { mode, readSchema, releaseId, bnbConfirmations };
}

// lib/offchain/sql.ts
function sqlIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value))
    throw new Error(`Invalid SQL identifier: ${value}`);
  return `"${value}"`;
}
var physicalPonderSchemaName = process.env.DATABASE_SCHEMA ?? "public";
var ownershipReadConfig = ownershipReadConfiguration();
var unifiedOwnershipReads = ownershipReadConfig.mode === "unified";
var readSchemaName = ownershipReadConfig.readSchema;
var bnbSchemaName = process.env.BNB_DATABASE_SCHEMA ?? "bnb_indexer";
var physicalPonderSchema = sqlIdentifier(physicalPonderSchemaName);
var ponderSchema = sqlIdentifier(readSchemaName);
var bnbSchema = sqlIdentifier(bnbSchemaName);
var ownershipPonderSchema = unifiedOwnershipReads ? ponderSchema : physicalPonderSchema;
var ownershipBnbSchema = unifiedOwnershipReads ? ponderSchema : bnbSchema;
var ownershipIslandsSchemaName = unifiedOwnershipReads ? readSchemaName : physicalPonderSchemaName;
function ownershipCollectionsFor(schema, chains2) {
  if (unifiedOwnershipReads) {
    if (schema !== ponderSchema)
      throw new Error(
        "Unified ownership reads require the selected logical schema."
      );
    return [...chains2];
  }
  return chains2.filter(
    (chain2) => schema === bnbSchema ? chain2 === "bnb" : schema === physicalPonderSchema ? chain2 !== "bnb" : true
  );
}
function ownershipBnbOnlySchema(schema) {
  return !unifiedOwnershipReads && schema === bnbSchema;
}

// lib/ownership/readiness.ts
import { createHash } from "node:crypto";

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
var ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
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

// lib/ownership/readiness.ts
var OwnershipSourceUnavailable = class extends Error {
  constructor(reason) {
    super("Ownership source unavailable.");
    this.reason = reason;
  }
  code = "YI001";
};
async function sourceQuery(task) {
  try {
    return await task();
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (["42P01", "42883", "42501", "3F000"].includes(code))
      throw new OwnershipSourceUnavailable("read_configuration_unavailable");
    throw error;
  }
}
async function assertLegacyOwnershipSelection(db, selection2) {
  const row = (await db.query(
    "SELECT to_regclass($1) AS physical_source,to_regclass($2) AS read_source,to_regclass($3) AS marker",
    [
      `${sqlIdentifier(selection2.physicalSchema)}.indexer_source`,
      `${sqlIdentifier(selection2.readSchema)}.indexer_source`,
      `${sqlIdentifier(selection2.readSchema)}._unified_read_release`
    ]
  )).rows[0];
  if (row?.physical_source || row?.read_source || row?.marker)
    throw new OwnershipSourceUnavailable("mixed_read_configuration");
}
async function assertOwnershipSourceSelection(db) {
  if (ownershipReadConfig.mode === "legacy")
    await assertLegacyOwnershipSelection(db, {
      physicalSchema: physicalPonderSchemaName,
      readSchema: ownershipReadConfig.readSchema
    });
}
async function ownershipReadIdentity(db) {
  if (ownershipReadConfig.mode !== "unified") return null;
  const row = (await sourceQuery(
    () => db.query(
      `SELECT v.identity,v.release_id,v.manifest_hash,r.physical_schema FROM ${ponderSchema}._unified_read_release v
    JOIN yunipals_indexer_control.release r ON r.id=v.release_id WHERE v.singleton`
    )
  )).rows[0];
  if (!row || row.release_id !== ownershipReadConfig.releaseId || row.physical_schema !== physicalPonderSchemaName || !/^0x[0-9a-f]{64}$/.test(row.identity) || !/^0x[0-9a-f]{64}$/.test(row.manifest_hash))
    throw new OwnershipSourceUnavailable("release_mismatch");
  return row;
}
async function unifiedOwnershipStatus(db, collections2) {
  if (collections2.some((collection) => !indexedCollections[collection]))
    throw new Error("Invalid ownership collections.");
  const identity = await ownershipReadIdentity(db);
  if (!identity) return null;
  const statuses = [];
  for (const collection of [...new Set(collections2)]) {
    const value = (await sourceQuery(
      () => db.query(
        `SELECT ${ponderSchema}.source_probe($1) AS status`,
        [collection]
      )
    )).rows[0]?.status;
    if (!value || value.collection !== collection || typeof value.available !== "boolean" || typeof value.ready !== "boolean")
      throw new OwnershipSourceUnavailable("source_status_invalid");
    const status = Object.fromEntries(
      Object.entries(value).map(([key, value2]) => [
        key,
        ["block_number", "block_timestamp", "heartbeat_at"].includes(key) ? String(value2) : value2
      ])
    );
    if (status.available && (status.release_id !== identity.release_id || status.manifest_hash !== identity.manifest_hash || status.chain_id !== indexedCollections[collection].chainId || status.contract_address !== indexedCollections[collection].address || status.policy !== (collection === "bnb" ? `depth:${ownershipReadConfig.bnbConfirmations}` : "latest") || !/^(0|[1-9][0-9]*)$/.test(status.block_number ?? "") || !/^0x[0-9a-f]{64}$/.test(status.block_hash ?? "")))
      throw new OwnershipSourceUnavailable("source_mismatch");
    statuses.push(status);
  }
  const blocked = statuses.filter((status) => !status.available).map((status) => status.collection);
  const fingerprint = createHash("sha256").update(
    JSON.stringify([
      identity.identity,
      ...statuses.map((status) => [
        status.collection,
        status.block_number,
        status.block_hash,
        status.policy,
        status.available
      ])
    ])
  ).digest("hex");
  return {
    mode: "unified",
    ready: blocked.length === 0,
    caughtUp: statuses.every((status) => status.ready),
    blocked,
    collections: statuses,
    identity,
    fingerprint
  };
}
async function assertOwnershipAvailable(db, collections2) {
  if (ownershipReadConfig.mode === "legacy")
    await assertOwnershipSourceSelection(db);
  const status = await unifiedOwnershipStatus(db, collections2);
  if (status && !status.ready)
    throw new OwnershipSourceUnavailable(
      status.collections.find((source) => !source.available)?.reason ?? "source_unavailable"
    );
  return { fingerprint: status?.fingerprint ?? "legacy" };
}

// lib/ownership/projection-proof.ts
function generationOwnershipProof(alias) {
  if (!/^[a-z_]+$/.test(alias))
    throw new Error("Invalid projection proof alias.");
  return unifiedOwnershipReads ? `EXISTS(SELECT 1 FROM ${ponderSchema}._unified_read_release ownership_release WHERE ownership_release.singleton
      AND ownership_release.release_id='${ownershipReadConfig.releaseId}'
      AND ${alias}.ownership_release_id=ownership_release.release_id AND ${alias}.ownership_read_identity=ownership_release.identity)` : `COALESCE(to_jsonb(${alias})->>'ownership_release_id','')=''`;
}

// lib/metadata/publication.ts
import { z } from "zod";

// lib/metadata/source/canonical.ts
import { createHash as createHash2 } from "node:crypto";
function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new Error("Non-finite or imprecise source number; encode it as a string or canonical EJSON");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("Source must contain only explicit JSON values");
}
function contentHash(value) {
  return createHash2("sha256").update(canonicalJson(value)).digest("hex");
}
function assetKey(family, id) {
  if (!family || !id) throw new Error("Missing asset family or ID");
  return contentHash(["legacy-nft", family, id]);
}

// lib/metadata/publication.ts
var MetadataUnavailable = class extends Error {
  constructor(reason, status = "unavailable") {
    super(reason);
    this.reason = reason;
    this.status = status;
    this.name = "MetadataUnavailable";
  }
};
function metadataSourceMode(env = process.env) {
  const mode = env.METADATA_SOURCE_MODE ?? "legacy-http";
  if (mode !== "legacy-http" && mode !== "archive") throw new Error("Invalid METADATA_SOURCE_MODE");
  return mode;
}
var documentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  attributes: z.array(z.object({ trait_type: z.string(), value: z.unknown() }).passthrough()),
  image: z.string().optional(),
  animation_url: z.string().optional()
}).passthrough();
function validateMetadata(value) {
  const result = documentSchema.safeParse(value);
  if (!result.success) throw new MetadataUnavailable("invalid_metadata_document");
  return result.data;
}
function immutableMetadata(document) {
  const { address: _address, ownerSince: _since, minted: _minted, ...stable } = document;
  return stable;
}
function metadataError(error) {
  if (error instanceof MetadataUnavailable) return error;
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (["source_missing", "parent_missing", "source_invalid", "alias_ambiguous"].includes(code)) return new MetadataUnavailable(code);
  if (code === "archive_unavailable") return new MetadataUnavailable(code, "retry");
  if (error instanceof Error && [
    "existing_asset_binding_conflict",
    "existing_lifecycle_binding_conflict",
    "unverified_source",
    "conflicting_batch_binding",
    "unsupported_metadata_uri",
    "unsupported_metadata_id",
    "collection_mismatch"
  ].includes(error.message)) {
    return new MetadataUnavailable(error.message, "reconciliation_required");
  }
  if (error instanceof z.ZodError) return new MetadataUnavailable("source_invalid");
  return new MetadataUnavailable("publication_failed", "retry");
}
function publicationAvailableSql(alias = "m", mode = metadataSourceMode()) {
  if (!/^[a-z_]+$/.test(alias)) throw new Error("Invalid SQL alias");
  const shape = `(jsonb_typeof(${alias}.document)='object' AND length(${alias}.document->>'name')>0
    AND length(${alias}.document->>'id')>0 AND jsonb_typeof(${alias}.document->'attributes')='array')`;
  return mode === "archive" ? `(${alias}.source_kind='archive' AND ${alias}.publication_status='published'
    AND CASE WHEN ${shape} THEN true ELSE false END
    AND CASE WHEN ${alias}.publication_content_hash=${alias}.content_hash THEN true ELSE false END
    AND EXISTS(SELECT 1 FROM metadata_source.archive_release active_release
      WHERE active_release.release_id=${alias}.release_id AND active_release.state='active'))` : `(${alias}.fetch_status='success' AND ${shape})`;
}

// lib/ownership/derived-snapshot.ts
async function assertDerivedOwnership(db, name) {
  if (!unifiedOwnershipReads) return;
  if (!(await db.query(
    `SELECT 1 FROM metadata.derived_snapshot snapshot WHERE snapshot.name=$1
    AND ${generationOwnershipProof("snapshot")}
    ${metadataSourceMode() === "archive" ? `AND EXISTS(SELECT 1 FROM metadata_source.archive_release active WHERE active.state='active'
      AND active.release_id=snapshot.metadata_release_id)` : ""}`,
    [name]
  )).rowCount)
    throw new Error("derived_snapshot_pending");
}

// lib/metadata/projection-mode.ts
function projectionMode() {
  const value = process.env.YUNIPALS_PROJECTION_MODE ?? "legacy";
  if (value !== "legacy" && value !== "generation") {
    throw new Error(`Invalid YUNIPALS_PROJECTION_MODE: ${value}`);
  }
  return value;
}

// lib/metadata/base-mode.ts
function baseMetadataIngestionMode(env = process.env) {
  const mode = env.BASE_METADATA_INGESTION ?? "rpc";
  if (!["rpc", "unified", "native"].includes(mode))
    throw new Error("Invalid Base metadata ingestion mode.");
  if (mode === "native" && (env.OWNERSHIP_READ_MODE !== "unified" || env.METADATA_SOURCE_MODE !== "archive"))
    throw new Error(
      "Native Base metadata requires unified ownership and archived metadata."
    );
  return mode;
}
function nativeBaseMetadataReads() {
  const native = baseMetadataIngestionMode() === "native";
  if (native && !unifiedOwnershipReads)
    throw new Error(
      "Native Base metadata requires its registered read schema."
    );
  return native;
}
var baseMetadataEventsRelation = () => nativeBaseMetadataReads() ? `${ponderSchema}.base_metadata_event` : "metadata_source.chain_metadata_event";
var baseMetadataScanRelation = () => nativeBaseMetadataReads() ? `${ponderSchema}.base_metadata_scan` : "metadata_source.chain_metadata_scan";

// lib/metadata/read-source.ts
var projectionGenerationMode = projectionMode() === "generation";
var activeProjectionId = `(SELECT a.current_id FROM metadata_projection.active a JOIN metadata_projection.generation g
  ON g.id=a.current_id WHERE a.singleton AND g.state='ready' AND g.format_version=1 AND ${generationOwnershipProof("g")})`;
function projectionIdSql(id) {
  if (id === void 0) return activeProjectionId;
  if (!/^[1-9][0-9]*$/.test(id))
    throw new Error("Invalid projection generation ID");
  return `${id}::bigint`;
}
async function readActiveProjectionId(db) {
  if (!projectionGenerationMode) return null;
  const apiPool2 = db ?? (await Promise.resolve().then(() => (init_db(), db_exports))).apiPool;
  const sourceMode = metadataSourceMode();
  const result = await apiPool2.query(
    `SELECT a.current_id FROM metadata_projection.active a
      JOIN metadata_projection.generation g ON g.id=a.current_id
      WHERE a.singleton AND g.state='ready' AND g.format_version=1
        AND ${generationOwnershipProof("g")}
        ${sourceMode === "archive" ? `AND EXISTS(SELECT 1 FROM metadata_source.archive_release r
          WHERE r.state='active' AND r.release_id=g.metadata_release_id)` : ""}`
  );
  const id = result.rows[0]?.current_id;
  if (!id) throw new Error("projection_generation_unavailable");
  return id;
}
function canonicalPublicationSql(alias = "m", schema = ponderSchema) {
  if (!/^[a-z_]+$/.test(alias)) throw new Error("Invalid SQL alias");
  return `EXISTS(SELECT 1 FROM ${schema}.token_lifecycle publication_lifecycle
    JOIN ${schema}.transfer_event publication_mint
      ON publication_mint.collection=publication_lifecycle.collection
      AND publication_mint.token_id=publication_lifecycle.token_id
      AND publication_mint.lifecycle=publication_lifecycle.lifecycle
    WHERE publication_lifecycle.collection=${alias}.collection
      AND publication_lifecycle.token_id=${alias}.token_id::text AND publication_lifecycle.lifecycle=${alias}.lifecycle
      AND publication_mint."from"='0x0000000000000000000000000000000000000000'
      AND CASE WHEN publication_mint.transaction_hash=publication_lifecycle.mint_transaction_hash
        AND publication_mint.block_number=publication_lifecycle.mint_block
        AND publication_mint.transaction_hash=${alias}.mint_transaction_hash
        AND publication_mint.log_index=${alias}.mint_log_index THEN true ELSE false END
      OFFSET 0)
    AND ${basePublicationSql(alias)}`;
}
function basePublicationSql(alias) {
  return `(CASE WHEN ${alias}.collection='base' THEN EXISTS(SELECT 1 FROM (
      SELECT event.transaction_hash||':'||event.log_index::text AS event_key,event.block_hash
      FROM ${baseMetadataEventsRelation()} event JOIN ${baseMetadataScanRelation()} scan
      ON scan.name='base_metadata_v1' AND scan.chain_id=event.chain_id AND scan.contract_address=event.contract_address
      WHERE event.token_id=${alias}.token_id::text AND event.block_number<scan.next_block
      ORDER BY event.block_number DESC,event.transaction_index DESC,event.log_index DESC LIMIT 1) latest
      WHERE ${alias}.chain_event_key=latest.event_key
        ${nativeBaseMetadataReads() ? `AND ${alias}.chain_event_block_hash=latest.block_hash` : ""})
      AND NOT EXISTS(SELECT 1 FROM metadata.publication_runtime WHERE singleton AND base_error IS NOT NULL) ELSE true END)`;
}
var publicationRows = `(SELECT document_row.*,provenance.source_kind,provenance.release_id,provenance.asset_key,
      provenance.renderer_version,provenance.input_hash,provenance.publication_content_hash,provenance.publication_status,provenance.publication_error,provenance.published_at,
      provenance.mint_transaction_hash,provenance.mint_log_index,provenance.chain_event_key,provenance.chain_event_block_hash
      FROM metadata.token_metadata document_row JOIN metadata.token_publication provenance USING(collection,token_id,lifecycle))`;
function archiveRead(schema, collectionPredicate = "true", includeBase = !ownershipBnbOnlySchema(schema)) {
  return `SELECT published.* FROM ${publicationRows} published
      JOIN ${schema}.token_lifecycle publication_lifecycle
        ON publication_lifecycle.collection=published.collection AND publication_lifecycle.token_id=published.token_id::text
        AND publication_lifecycle.lifecycle=published.lifecycle
      JOIN ${schema}.transfer_event publication_mint
        ON publication_mint.collection=publication_lifecycle.collection AND publication_mint.token_id=publication_lifecycle.token_id
        AND publication_mint.lifecycle=publication_lifecycle.lifecycle AND publication_mint."from"='0x0000000000000000000000000000000000000000'
      ${includeBase ? `LEFT JOIN (
        SELECT DISTINCT ON(event.token_id) event.token_id,event.transaction_hash||':'||event.log_index::text AS event_key,event.block_hash
        FROM ${baseMetadataEventsRelation()} event JOIN ${baseMetadataScanRelation()} scan
          ON scan.name='base_metadata_v1' AND scan.chain_id=event.chain_id AND scan.contract_address=event.contract_address
        WHERE event.block_number<scan.next_block
        ORDER BY event.token_id,event.block_number DESC,event.transaction_index DESC,event.log_index DESC
      ) base_latest ON published.collection='base' AND base_latest.token_id=published.token_id::text` : ""}
      WHERE ${publicationAvailableSql("published")}
      AND ${collectionPredicate}
      AND CASE WHEN publication_mint.transaction_hash=publication_lifecycle.mint_transaction_hash
        AND publication_mint.block_number=publication_lifecycle.mint_block
        AND publication_mint.transaction_hash=published.mint_transaction_hash
        AND publication_mint.log_index=published.mint_log_index THEN true ELSE false END
      AND ${includeBase ? `CASE WHEN published.collection<>'base' OR (published.chain_event_key=base_latest.event_key
        ${nativeBaseMetadataReads() ? "AND published.chain_event_block_hash=base_latest.block_hash" : ""}
        AND NOT EXISTS(SELECT 1 FROM metadata.publication_runtime WHERE singleton AND base_error IS NOT NULL)) THEN true ELSE false END` : "published.collection<>'base'"}`;
}
var metadataReadRelation = metadataSourceMode() === "archive" ? `(SELECT published.* FROM ${publicationRows} published WHERE ${publicationAvailableSql("published")}
      AND ${canonicalPublicationSql("published")})` : `(SELECT published.* FROM metadata.token_metadata published WHERE ${publicationAvailableSql("published")})`;
var metadataScanReadRelation = metadataSourceMode() === "archive" ? `(${ponderSchema === ownershipPonderSchema ? archiveRead(ponderSchema) : `${archiveRead(ownershipPonderSchema, "published.collection<>'bnb'")} UNION ALL ${archiveRead(ownershipBnbSchema, "published.collection='bnb'")}`})` : metadataReadRelation;
function metadataReadRelationFor(schema, includeBase = !ownershipBnbOnlySchema(schema), chains2 = collectionSlugs) {
  if (chains2.some((chain2) => !collectionSlugs.includes(chain2)))
    throw new Error("Invalid metadata collection");
  const selected2 = ownershipCollectionsFor(schema, chains2);
  const predicate = selected2.length ? `published.collection IN (${selected2.map((chain2) => `'${chain2}'`).join(",")})` : "false";
  return metadataSourceMode() === "archive" ? `(${archiveRead(schema, predicate, includeBase && selected2.includes("base"))})` : `(SELECT published.* FROM ${metadataReadRelation} published WHERE ${predicate})`;
}
function metadataSearchReadRelationFor(schema, includeBase = !ownershipBnbOnlySchema(schema), chains2 = collectionSlugs, id) {
  const relation = searchReadRelation(
    metadataReadRelationFor(schema, includeBase, chains2),
    id
  );
  if (metadataSourceMode() === "archive") return relation;
  const selected2 = ownershipCollectionsFor(schema, chains2);
  return `(SELECT scoped.* FROM ${relation} scoped WHERE ${selected2.length ? `scoped.collection IN (${selected2.map((chain2) => `'${chain2}'`).join(",")})` : "false"})`;
}
function searchReadRelation(publicationRelation, id) {
  const searchTable = projectionGenerationMode ? "metadata_projection.search" : "metadata.token_search";
  const revisionTable = projectionGenerationMode ? "metadata_projection.revision" : "metadata.projection_revision";
  const generationFilter = projectionGenerationMode ? `search.generation_id=${projectionIdSql(id)} AND revision.generation_id=search.generation_id AND` : "";
  return metadataSourceMode() === "archive" ? `(SELECT search.* FROM ${searchTable} search JOIN ${publicationRelation} publication
      ON publication.collection=search.collection AND publication.token_id=search.token_id AND publication.lifecycle=search.lifecycle
      JOIN ${revisionTable} revision ON revision.collection=search.collection AND revision.token_id=search.token_id
      AND revision.lifecycle=search.lifecycle
      AND CASE WHEN publication.content_hash=revision.metadata_content_hash THEN true ELSE false END
      WHERE ${generationFilter} true)` : projectionGenerationMode ? `(SELECT * FROM metadata_projection.search search WHERE search.generation_id=${projectionIdSql(id)})` : "metadata.token_search";
}
var metadataSearchReadRelation = searchReadRelation(metadataReadRelation);
function metadataSearchReadRelationAt(id) {
  return searchReadRelation(metadataReadRelation, id);
}
function metadataRawSearchReadRelationAt(id) {
  return projectionGenerationMode ? `(SELECT * FROM metadata_projection.search WHERE generation_id=${projectionIdSql(id)})` : "metadata.token_search";
}
function metadataRawTraitReadRelationAt(id) {
  return projectionGenerationMode ? `(SELECT * FROM metadata_projection.trait WHERE generation_id=${projectionIdSql(id)})` : "metadata.token_trait";
}
function traitReadRelation(id, publicationRelation = metadataReadRelation) {
  const traitTable = projectionGenerationMode ? "metadata_projection.trait" : "metadata.token_trait";
  const revisionTable = projectionGenerationMode ? "metadata_projection.revision" : "metadata.projection_revision";
  const generationFilter = projectionGenerationMode ? `trait.generation_id=${projectionIdSql(id)} AND revision.generation_id=trait.generation_id AND` : "";
  return metadataSourceMode() === "archive" ? `(SELECT trait.* FROM ${traitTable} trait JOIN ${publicationRelation} publication
      ON publication.collection=trait.collection AND publication.token_id=trait.token_id AND publication.lifecycle=trait.lifecycle
      JOIN ${revisionTable} revision ON revision.collection=trait.collection AND revision.token_id=trait.token_id
      AND revision.lifecycle=trait.lifecycle
      AND CASE WHEN publication.content_hash=revision.metadata_content_hash THEN true ELSE false END
      WHERE ${generationFilter} true)` : projectionGenerationMode ? `(SELECT * FROM metadata_projection.trait trait WHERE trait.generation_id=${projectionIdSql(id)})` : "metadata.token_trait";
}
var metadataTraitReadRelation = traitReadRelation();
function metadataTraitReadRelationAt(id) {
  return traitReadRelation(id);
}
function metadataTraitReadRelationFor(schema, chains2, id) {
  const relation = traitReadRelation(
    id,
    metadataReadRelationFor(schema, !ownershipBnbOnlySchema(schema), chains2)
  );
  if (metadataSourceMode() === "archive") return relation;
  const selected2 = ownershipCollectionsFor(schema, chains2);
  return `(SELECT scoped.* FROM ${relation} scoped WHERE ${selected2.length ? `scoped.collection IN (${selected2.map((chain2) => `'${chain2}'`).join(",")})` : "false"})`;
}
var leaderboardReadRelation = metadataSourceMode() === "archive" || unifiedOwnershipReads ? `(SELECT stats.* FROM leaderboard.wallet_stats stats WHERE EXISTS(SELECT 1 FROM metadata.derived_snapshot snapshot
      ${metadataSourceMode() === "archive" ? `JOIN metadata_source.archive_release release ON release.release_id=snapshot.metadata_release_id AND release.state='active'` : ""}
      WHERE snapshot.name='leaderboard' AND ${generationOwnershipProof("snapshot")}))` : "leaderboard.wallet_stats";

// lib/metadata/read-cache.ts
function idSql(id) {
  if (!/^[1-9][0-9]*$/.test(id))
    throw new Error("Invalid read cache generation");
  return `${id}::bigint`;
}
function selected(chains2, schema) {
  if (!chains2.length || chains2.some((chain2) => !collectionSlugs.includes(chain2)))
    throw new Error("Invalid cache collections");
  return schema ? ownershipCollectionsFor(schema, chains2) : [...chains2];
}
function chainsSql(chains2) {
  return `ARRAY[${chains2.map((chain2) => `'${chain2}'`).join(",")}]::text[]`;
}
function readCacheFreshSql(id, chains2) {
  const generation = idSql(id);
  const list = chainsSql(selected(chains2));
  const nativeMetadataProof = nativeBaseMetadataReads() && chains2.includes("base") ? `AND EXISTS(SELECT 1 FROM ${ponderSchema}.base_metadata_frame(true))` : "";
  const ownershipJoin = unifiedOwnershipReads ? `JOIN LATERAL ${ponderSchema}.source_boundary(s.collection) ownership_source ON true
    JOIN ${ponderSchema}._unified_read_release ownership_release ON ownership_release.singleton` : "";
  const ownershipProof = unifiedOwnershipReads ? `
    AND s.ownership_release_id=ownership_source.release_id AND s.ownership_release_id='${ownershipReadConfig.releaseId}'
    AND s.ownership_read_identity=ownership_release.identity AND s.ownership_policy=ownership_source.policy
    AND s.ownership_boundary<=ownership_source.block_number
    AND (EXISTS(SELECT 1 FROM ${physicalPonderSchema}.chain_block b WHERE b.chain_id=ownership_source.chain_id
        AND b.block_number=s.ownership_boundary AND b.block_hash=s.ownership_boundary_hash)
      OR EXISTS(SELECT 1 FROM yunipals_indexer_control.chain_anchor a JOIN ${physicalPonderSchema}.chain_block b
        ON b.chain_id=a.chain_id AND b.block_number=a.witness_number AND b.block_hash=a.witness_hash
        WHERE a.release_id=s.ownership_release_id AND a.chain_id=ownership_source.chain_id
          AND a.block_number=s.ownership_boundary AND a.block_hash=s.ownership_boundary_hash))
    AND NOT EXISTS(SELECT 1 FROM ${physicalPonderSchema}.transfer_event changed WHERE changed.collection=s.collection
      AND changed.block_number>s.ownership_boundary AND changed.block_number<=ownership_source.block_number)` : `AND COALESCE(to_jsonb(s)->>'ownership_release_id','')=''`;
  return `(SELECT count(*)=${chains2.length} FROM metadata_projection.read_set s
    JOIN metadata_projection.read_epoch e USING(collection)
    JOIN metadata_projection.generation g ON g.id=s.generation_id
    ${ownershipJoin}
    WHERE s.generation_id=${generation} AND s.collection=ANY(${list})
      AND s.revision=e.revision AND s.source_mode='${metadataSourceMode()}'
      AND ${generationOwnershipProof("g")} ${ownershipProof} ${nativeMetadataProof}
      AND g.state='ready' AND g.source_mode=CASE WHEN s.source_mode='legacy-http' THEN 'legacy' ELSE s.source_mode END
      AND EXISTS(SELECT 1 FROM metadata_projection.active a
        WHERE s.generation_id IN(a.current_id,a.previous_id))
      AND s.guard_count=(SELECT count(*) FROM metadata_projection.read_guard guard WHERE guard.collection=s.collection)
      AND NOT EXISTS(SELECT 1 FROM metadata_projection.read_guard guard
        LEFT JOIN pg_catalog.pg_trigger trigger ON trigger.tgrelid=guard.relation_oid
          AND trigger.tgname='read_cache_dirty'
        LEFT JOIN pg_catalog.pg_trigger truncate_trigger ON truncate_trigger.tgrelid=guard.relation_oid
          AND truncate_trigger.tgname='read_cache_truncate'
        WHERE guard.collection=s.collection AND (trigger.oid IS NULL OR trigger.tgenabled<>'A'
          OR truncate_trigger.oid IS NULL OR truncate_trigger.tgenabled<>'A'
          OR (guard.relation IN('metadata_projection.search','metadata_projection.revision')
            AND (SELECT count(*) FROM pg_catalog.pg_trigger extra
              WHERE extra.tgrelid=guard.relation_oid AND extra.tgenabled='A'
                AND extra.tgname IN('read_cache_dirty_update','read_cache_dirty_delete'))<>2)
          OR guard.relation_oid IS DISTINCT FROM to_regclass(guard.relation)::oid)))`;
}
function cachedSearchReadRelationFor(schema, chains2, id) {
  const chosen = selected(chains2, schema);
  const original2 = metadataSearchReadRelationFor(
    schema,
    !ownershipBnbOnlySchema(schema),
    chosen,
    id
  );
  if (!chosen.length) return original2;
  const fresh = readCacheFreshSql(id, chosen);
  return `(SELECT m.generation_id,m.collection,m.token_id,m.lifecycle,m.metadata_available,
      m.rarity_points,m.rarity_points_capped
    FROM metadata_projection.read_member m WHERE m.generation_id=${idSql(id)}
      AND m.collection=ANY(${chainsSql(chosen)}) AND m.has_search AND ${fresh}
    UNION ALL SELECT original.generation_id,original.collection,original.token_id,original.lifecycle,
        original.metadata_available,original.rarity_points,original.rarity_points_capped
      FROM ${original2} original WHERE NOT ${fresh})`;
}
function cachedTraitReadRelationFor(schema, chains2, id) {
  const rawTraits = metadataRawTraitReadRelationAt(id);
  const rawSearch = metadataRawSearchReadRelationAt(id);
  const canonical = metadataTraitReadRelationFor(schema, chains2, id);
  const search = cachedSearchReadRelationFor(schema, chains2, id);
  return `(SELECT trait.* FROM ${rawTraits} trait JOIN ${search} proof
      USING(generation_id,collection,token_id,lifecycle)
    UNION ALL SELECT missing.* FROM (
      SELECT candidate.* FROM ${rawTraits} candidate WHERE NOT EXISTS (
        SELECT 1 FROM ${rawSearch} search WHERE search.collection=candidate.collection
          AND search.token_id=candidate.token_id AND search.lifecycle=candidate.lifecycle)
    ) missing JOIN LATERAL (
      SELECT 1 FROM ${canonical} validated WHERE validated.collection=missing.collection
        AND validated.token_id=missing.token_id AND validated.lifecycle=missing.lifecycle
        AND validated.trait_type=missing.trait_type AND validated.value=missing.value OFFSET 0
    ) proof ON true)`;
}
function cachedMissingKeys(schema, chains2, id) {
  const chosen = selected(chains2, schema);
  return {
    fresh: chosen.length ? readCacheFreshSql(id, chosen) : "false",
    relation: `(SELECT * FROM metadata_projection.read_member WHERE generation_id=${idSql(id)}
      AND collection=ANY(${chainsSql(chosen)}) AND NOT has_search)`
  };
}

// lib/metadata/source/ejson.ts
function decodeSource(value) {
  if (Array.isArray(value)) return value.map(decodeSource);
  if (value === null || typeof value !== "object") return value;
  const object3 = value, keys2 = Object.keys(object3);
  if (keys2.length === 1) {
    if (typeof object3.$oid === "string") return object3.$oid;
    if (typeof object3.$numberInt === "string") {
      const number = Number(object3.$numberInt);
      if (!Number.isSafeInteger(number)) throw new Error("Invalid BSON integer");
      return number;
    }
    if (typeof object3.$numberLong === "string") {
      const number = Number(object3.$numberLong);
      return Number.isSafeInteger(number) ? number : object3.$numberLong;
    }
    if (typeof object3.$numberDouble === "string") {
      const number = Number(object3.$numberDouble);
      if (!Number.isFinite(number)) throw new Error("Non-finite BSON number cannot be rendered");
      return number;
    }
    if (typeof object3.$numberDecimal === "string") return object3.$numberDecimal;
    if (object3.$date !== void 0) {
      const decoded = decodeSource(object3.$date);
      if (typeof decoded !== "string" && typeof decoded !== "number") throw new Error("Invalid BSON date");
      const date = new Date(decoded);
      if (Number.isNaN(date.getTime())) throw new Error("Invalid BSON date");
      return date.toISOString();
    }
  }
  return Object.fromEntries(Object.entries(object3).map(([key, item]) => [key, decodeSource(item)]));
}

// lib/metadata/render/origins.ts
var import_legacy2 = __toESM(require_legacy(), 1);
import { z as z3 } from "zod";

// lib/metadata/render/snapshot.ts
var import_legacy = __toESM(require_legacy(), 1);
import { basename, extname } from "node:path";
import { z as z2 } from "zod";
var rendererVersion = "legacy-snapshot-v1";
var chain = z2.object({ id: z2.enum(["1", "56", "137", "42161", "42170", "mainnet-beta"]), type: z2.enum(["EVM", "SOLANA"]) });
var envelopeSchema = z2.object({
  chain,
  chainOrigin: chain,
  origin: z2.object({ type: z2.string() }).passthrough(),
  nft: z2.object({ id: z2.string(), name: z2.string(), description: z2.string(), attributes: z2.record(z2.unknown()) }).passthrough()
}).passthrough();
var MissingOriginData = class extends Error {
  constructor() {
    super("Historical rainbow origins are required before rendering");
    this.name = "MissingOriginData";
  }
};
function renderLegacySnapshot(value, options) {
  if (!Number.isSafeInteger(options.metadataUpdatedAt) || options.metadataUpdatedAt < 0) throw new Error("Invalid metadata timestamp");
  const envelope = envelopeSchema.parse(value), nft = envelope.nft;
  const legacyChain = (0, import_legacy.getLegacyChain)(envelope.chain, nft.id), originChain = (0, import_legacy.getLegacyChain)(envelope.chainOrigin, nft.id);
  const attrs = nft.attributes;
  const attributes = import_legacy.AttributeTransformingUtils.toTraits(attrs);
  const nfb = import_legacy.NFBOrigins.includes(envelope.origin.type);
  const meta = {
    address: envelope.delegateeAddress || envelope.ownerAddress,
    animation_url: nft.videoUrl,
    attributes,
    background_color: "FFFFFF",
    description: nft.description,
    external_url: `https://polkamon.com/polkamon/${nft.code}`,
    id: nft.id,
    type: nft.type,
    origin: envelope.origin.type,
    image: nft.imageUrl,
    code: nft.code,
    initialProbabilities: nft.initialProbabilities,
    name: nft.name,
    txHash: nft.hash,
    minted: envelope.minted,
    bridged: envelope.bridged,
    chain: legacyChain.chain,
    chainGroup: legacyChain.chainGroup,
    originChain: originChain.chain,
    originChainGroup: originChain.chainGroup,
    nftContract: legacyChain.nftContract,
    opening_network: legacyChain.openingNetwork,
    rarity: envelope.rarity,
    rarityCapped: envelope.rarityCapped,
    pfpUrl: nft.pfpUrl,
    ownerSince: envelope.ownerSince
  };
  if (nft.rafflePriceClaimed) meta.rafflePriceClaimed = nft.rafflePriceClaimed;
  if (nfb) meta.giftData = envelope.giftData;
  else {
    attributes.push({ trait_type: "Opening Network", value: originChain.openingNetwork });
    for (const field of ["boosterId", "adventureStatus", "axpCount", "adventureTitle", "gameData", "polyboostPosition"]) meta[field] = nft[field];
  }
  if ((0, import_legacy.isRainbowByAttrs)({ attributes: attrs })) {
    const origins = options.rainbow;
    if (!origins || !origins.originIds.length || origins.originIds.length !== origins.origins.length || !Number.isFinite(origins.originScore)) {
      throw new MissingOriginData();
    }
    Object.assign(meta, origins);
  }
  if (options.legacyFactoryOnly) return JSON.parse(JSON.stringify(meta));
  const transformed = import_legacy.AttributeTransformingUtils.toAttributes(attributes, meta);
  const transformer = options.publicFacing ? import_legacy.PublicAttributeTransformingUtils : import_legacy.AttributeTransformingUtils;
  meta.attributes = transformer.toTraits(transformed, meta).map((trait) => trait.trait_type === "Last metadata update" ? { ...trait, value: options.metadataUpdatedAt } : trait);
  if (typeof meta.image === "string") meta.image = meta.image.replace(".mp4", ".jpg").replace("/videos/", "/images/");
  if (!meta.code) {
    const fileName = (url) => basename(url, extname(url));
    meta.code = typeof meta.image === "string" ? fileName(fileName(meta.image)).replace(/(?:unimons|unimon|Unimons|Unimon|exomons|exomon|Exomons|Exomon)_/g, "") : null;
  }
  if (options.publicFacing && !nfb) {
    try {
      const rarityInput = {
        id: nft.id,
        originScore: meta.originScore,
        initialProbabilities: nft.initialProbabilities,
        attributes: import_legacy.AttributeTransformingUtils.toAttributes(meta.attributes)
      };
      if (!rarityInput.attributes.type) Object.assign(meta, { rarity: 0, rarityCapped: 0 });
      else Object.assign(meta, { rarity: (0, import_legacy.rarityFor)(rarityInput, {}), rarityCapped: (0, import_legacy.rarityFor)(rarityInput) });
    } catch {
      Object.assign(meta, { rarity: 0, rarityCapped: 0 });
    }
  }
  return JSON.parse(JSON.stringify(meta));
}

// lib/metadata/render/origins.ts
var parentSchema = z3.object({ nft: z3.object({
  id: z3.string(),
  code: z3.string(),
  birthday: z3.string(),
  initialRarityCapped: z3.number().finite(),
  name: z3.string(),
  description: z3.string(),
  attributes: z3.record(z3.unknown()),
  initialProbabilities: z3.unknown().optional()
}).passthrough() });
function historicalOriginIds(value) {
  const source = z3.object({
    origin: z3.object({ originIds: z3.array(z3.string()).optional() }).passthrough(),
    nft: z3.object({ originIds: z3.array(z3.string()).optional() }).passthrough()
  }).parse(value);
  const a = source.nft.originIds, b = source.origin.originIds;
  if (a && b && JSON.stringify(a) !== JSON.stringify(b)) throw new Error("Conflicting historical rainbow parents");
  if (!(a ?? b)?.length) throw new MissingOriginData();
  return [...a ?? b];
}
function renderRainbowOrigins(ids, parents) {
  if (!ids.length || ids.length !== parents.length) throw new MissingOriginData();
  const nfts = parents.map((parent) => parentSchema.parse(parent).nft);
  if (nfts.some((nft, index) => nft.id !== ids[index])) throw new Error("Historical parent order/identity mismatch");
  return {
    originIds: [...ids],
    originScore: nfts.reduce((total, nft) => total + nft.initialRarityCapped, 0),
    origins: nfts.map((nft) => ({
      id: nft.id,
      createdAt: nft.birthday,
      code: nft.code,
      initialProbabilities: nft.initialProbabilities,
      image: `https://assets.polkamon.com/images/Unimons_${nft.code}.jpg`,
      external_url: `https://polkamon.com/polkamon/${nft.code}`,
      description: nft.description,
      name: nft.name,
      attributes: import_legacy2.AttributeTransformingUtils.toTraits(nft.attributes),
      background_color: "FFFFFF",
      animation_url: `https://assets.polkamon.com/videos/Unimons_${nft.code}.mp4`
    }))
  };
}

// lib/metadata/source/read.ts
var import_legacy3 = __toESM(require_legacy(), 1);
var ArchiveLookupError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "ArchiveLookupError";
  }
};
var ArchiveReader = class {
  constructor(pool2, release, candidate = false) {
    this.pool = pool2;
    this.release = release;
    this.candidate = candidate;
  }
  async checkRelease() {
    const result = await this.pool.query("SELECT state FROM metadata_source.archive_release WHERE release_id=$1", [this.release]);
    if (!result.rowCount || (this.candidate ? !["candidate", "validated", "active", "superseded"].includes(result.rows[0].state) : result.rows[0].state !== "active")) throw new ArchiveLookupError("archive_unavailable");
  }
  async byAsset(key) {
    await this.checkRelease();
    const result = await this.pool.query(`SELECT r.asset_key AS "assetKey",r.content_hash AS hash,b.payload,
      r.source_burned AS burned,r.imported_at AS "importedAt",r.issue
      FROM metadata_source.source_record r JOIN metadata_source.source_blob b USING(content_hash)
      WHERE r.release_id=$1 AND r.asset_key=$2
      ORDER BY r.source_burned ASC, r.source_key ASC LIMIT 1`, [this.release, key]);
    if (!result.rowCount) throw new ArchiveLookupError("source_missing");
    if (result.rows[0].issue) throw new ArchiveLookupError("source_invalid");
    return result.rows[0];
  }
  async lookup(id, family, publicAliases = true) {
    await this.checkRelease();
    const aliases = await this.pool.query(`SELECT DISTINCT asset_key AS "assetKey"
      FROM metadata_source.lookup_alias WHERE release_id=$1 AND namespace=CASE WHEN $3::text IS NULL THEN 'legacy-meta' ELSE 'legacy-family' END AND alias=$2
      AND ($3::text IS NULL OR family=$3)
      AND ($4 OR $3::text IS NOT NULL OR NOT EXISTS(SELECT 1 FROM metadata_source.source_record exomon
        WHERE exomon.release_id=$1 AND exomon.namespace='legacy.exomon-aliases' AND exomon.source_key=$2)) LIMIT 2`, [this.release, id, family ?? null, publicAliases]);
    const matches = aliases.rowCount ? aliases : await this.pool.query(`SELECT DISTINCT asset_key AS "assetKey"
      FROM metadata_source.source_record WHERE release_id=$1 AND legacy_id=$2
      AND ($3::text IS NULL OR family=$3) AND asset_key IS NOT NULL LIMIT 2`, [this.release, id, family ?? null]);
    if (!matches.rowCount) throw new ArchiveLookupError("source_missing");
    if (matches.rows.length !== 1) throw new ArchiveLookupError("alias_ambiguous");
    return this.byAsset(matches.rows[0].assetKey);
  }
  async snapshot(id, family, publicFacing = true) {
    const source = await this.lookup(id, family);
    return this.renderSource(source, publicFacing);
  }
  async snapshotByAsset(key, publicFacing = true, legacyFactoryOnly = false) {
    return this.renderSource(await this.byAsset(key), publicFacing, legacyFactoryOnly);
  }
  async renderSource(source, publicFacing, legacyFactoryOnly = false) {
    if (source.issue || !source.assetKey) throw new ArchiveLookupError("source_invalid");
    const decoded = decodeSource(source.payload);
    const parentHashes = [];
    let rainbow;
    if ((0, import_legacy3.isRainbowByAttrs)(decoded.nft)) {
      const ids = historicalOriginIds(decoded);
      const parents = [];
      for (const id of ids) {
        const parent = await this.byAsset(assetKey("GEN1", id)).catch((error) => {
          if (error instanceof ArchiveLookupError && error.code === "source_missing") throw new ArchiveLookupError("parent_missing");
          throw error;
        });
        parentHashes.push(parent.hash);
        parents.push(decodeSource(parent.payload));
      }
      rainbow = renderRainbowOrigins(ids, parents);
    }
    return {
      assetKey: source.assetKey,
      sourceBurned: source.burned,
      rendererVersion,
      variant: legacyFactoryOnly ? "legacy-factory" : publicFacing ? "public" : "internal",
      inputHash: contentHash([source.hash, ...parentHashes]),
      document: renderLegacySnapshot(decoded, {
        publicFacing,
        legacyFactoryOnly,
        metadataUpdatedAt: Math.floor(source.importedAt.getTime() / 1e3),
        rainbow
      })
    };
  }
};

// lib/metadata/source/base-events.ts
import { z as z4 } from "zod";

// lib/metadata/base-abi.ts
import { parseAbi } from "viem";
var baseMetadataAbi = parseAbi([
  "event Mint(address indexed to,uint256 indexed tokenId,(uint16 monsterType,uint16 color,uint16 horn,uint8 background,uint8 glitter,uint40 rarityScore) yunipal)",
  "event Update(address indexed to,uint256 indexed tokenId,(uint16 monsterType,uint16 color,uint16 horn,uint8 background,uint8 glitter,uint40 rarityScore) yunipal)",
  "function yunipal(uint256 tokenId) view returns ((uint16 monsterType,uint16 color,uint16 horn,uint8 background,uint8 glitter,uint40 rarityScore))"
]);

// lib/metadata/source/base-events.ts
var baseTraitsSchema = z4.object({
  monsterType: z4.number().int().min(0).max(65535),
  color: z4.number().int().min(0).max(65535),
  horn: z4.number().int().min(0).max(65535),
  background: z4.number().int().min(0).max(255),
  glitter: z4.number().int().min(0).max(255),
  rarityScore: z4.string().regex(/^\d+$/).refine((v) => BigInt(v) < 2n ** 40n)
}).strict();
async function baseMetadataState(pool2, tokenId) {
  const scan = (await pool2.query(
    `SELECT s.next_block::text,s.target_block::text,s.target_hash,row_to_json(e) AS event
  FROM ${baseMetadataScanRelation()} s LEFT JOIN LATERAL(
   SELECT event_name AS "eventName",traits,block_number::text AS "blockNumber",block_hash AS "blockHash",transaction_hash AS "transactionHash",log_index AS "logIndex"
   FROM ${baseMetadataEventsRelation()} WHERE chain_id=s.chain_id AND contract_address=s.contract_address AND token_id=$2 AND block_number<s.next_block
   ORDER BY block_number DESC,transaction_index DESC,log_index DESC LIMIT 1) e ON true
  WHERE s.name='base_metadata_v1' AND s.chain_id=8453 AND s.contract_address=$1`,
    [collections.base.address, tokenId]
  )).rows[0];
  if (!scan) return { status: "unavailable", event: null };
  return {
    status: BigInt(scan.next_block) > BigInt(scan.target_block) ? "scanned" : "catching_up",
    asOfBlock: (BigInt(scan.next_block) - 1n).toString(),
    targetBlock: scan.target_block,
    targetHash: scan.target_hash,
    event: scan.event
  };
}

// lib/metadata/source/bindings.ts
var ArchiveOwnershipReader = class {
  constructor(pool2, release, readSchema, candidate = false) {
    this.pool = pool2;
    this.release = release;
    this.candidate = candidate;
    this.schema = sqlIdentifier(readSchema);
  }
  schema;
  async token(collection, tokenId) {
    if (!collections[collection] || !/^(0|[1-9]\d*)$/.test(tokenId))
      throw new Error("invalid_token_identity");
    const result = await this.pool.query(`SELECT t.collection,t.chain_id AS "chainId",t.contract_address AS "contractAddress",t.token_id AS "tokenId",
   CASE WHEN t.burned THEN NULL ELSE t.owner END AS owner,t.burned,t.lifecycle,
   t.last_transfer_block::text AS "ownerAtBlock",t.last_transfer_timestamp::text AS "ownerSince",t.last_transaction_hash AS "ownerTransactionHash",
   e.transaction_hash AS "mintTransactionHash",e.log_index AS "mintLogIndex",b.asset_key AS "assetKey",b.input_hash AS "sourceHash",r.release_id IS NOT NULL AS "archiveAvailable"
   FROM ${this.schema}.token t
   LEFT JOIN ${this.schema}.token_lifecycle l ON l.collection=t.collection AND l.token_id=t.token_id AND l.lifecycle=t.lifecycle
   LEFT JOIN ${this.schema}.transfer_event e ON e.collection=l.collection AND e.token_id=l.token_id AND e.lifecycle=l.lifecycle
     AND e.transaction_hash=l.mint_transaction_hash AND e.block_number=l.mint_block AND e."from"=$4
   LEFT JOIN metadata_source.archive_release r ON r.release_id=$1 AND (r.state='active' OR ($7 AND r.state IN ('candidate','validated','superseded')))
   LEFT JOIN metadata_source.lifecycle_binding b ON b.release_id=r.release_id AND b.chain_id=t.chain_id::text
     AND b.contract_address=lower(t.contract_address) AND b.token_id=t.token_id AND b.mint_transaction_hash=e.transaction_hash AND b.mint_log_index=e.log_index
   WHERE t.collection=$2 AND t.token_id=$3 AND t.chain_id=$5 AND lower(t.contract_address)=$6`, [this.release, collection, tokenId, ZERO_ADDRESS, collections[collection].chainId, collections[collection].address, this.candidate]);
    if (!result.rowCount)
      return null;
    if (result.rows.length !== 1)
      throw new Error("ambiguous_mint_anchor");
    const row = result.rows[0];
    return { ...row, metadataStatus: !row.archiveAvailable ? "archive_unavailable" : row.assetKey ? "bound" : "binding_unavailable", ownershipSource: "indexed_chain" };
  }
  /** A bound snapshot with chain ownership, including explicit metadata gaps. */
  async snapshot(collection, tokenId) {
    const ownership = await this.token(collection, tokenId);
    if (!ownership)
      return null;
    const chainMetadata = collection === "base" ? await baseMetadataState(this.pool, tokenId) : null;
    if (!ownership.assetKey)
      return { ownership, metadata: null, chainMetadata };
    const snapshot = await new ArchiveReader(this.pool, this.release, this.candidate).snapshotByAsset(ownership.assetKey);
    return { ownership, chainMetadata, metadata: {
      ...snapshot,
      document: {
        ...snapshot.document,
        address: ownership.owner,
        ownerSince: ownership.ownerSince === null ? null : new Date(Number(ownership.ownerSince) * 1e3).toISOString(),
        minted: !ownership.burned
      },
      provenance: { traits: "archived_source", ownership: "indexed_chain", legacyChainFields: "historical_source" }
    } };
  }
};

// lib/metadata/source/supplemental.ts
import { z as z5 } from "zod";
var staticNamespace = "legacy.static-island-metadata";
var aliasSchema = z5.object({
  alias: z5.string().regex(/^\d+$/),
  targetId: z5.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  family: z5.literal("GEN1")
}).strict();

// lib/metadata/chain-readiness.ts
async function chainReadiness(pool2, chains2 = collectionSlugs) {
  const rows = (await pool2.query(
    `SELECT collection,state,checkpoint_block::text,reason,updated_at,verified_at
    FROM metadata.chain_readiness WHERE collection=ANY($1::text[])`,
    [chains2]
  )).rows;
  const byCollection = new Map(rows.map((row) => [row.collection, row]));
  const source = unifiedOwnershipReads ? await unifiedOwnershipStatus(pool2, chains2) : null;
  const sourceByCollection = new Map(
    source?.collections.map((row) => [row.collection, row]) ?? []
  );
  let nativeMetadataReady = true;
  if (nativeBaseMetadataReads() && chains2.includes("base")) {
    nativeMetadataReady = (await pool2.query(
      `SELECT ${ponderSchema}.base_metadata_probe() AS ready`
    )).rows[0]?.ready === true;
  }
  const blocked = chains2.filter((collection) => {
    const row = byCollection.get(collection);
    return !row || row.state !== "ready" || row.checkpoint_block === null || row.verified_at === null || collection === "base" && !nativeMetadataReady || unifiedOwnershipReads && sourceByCollection.get(collection)?.available !== true;
  });
  return {
    ready: blocked.length === 0,
    blocked,
    collections: rows,
    ...source ? { source } : {}
  };
}
async function assertChainReady(pool2, chains2) {
  if (!(await chainReadiness(pool2, chains2)).ready)
    throw new MetadataUnavailable("ownership_rebuilding", "retry");
}

// lib/metadata/resolve.ts
async function selectedRelease(pool2, options = {}) {
  const result = options.candidate && options.releaseId ? await pool2.query(
    "SELECT release_id FROM metadata_source.archive_release WHERE release_id=$1 AND state IN ('candidate','validated')",
    [options.releaseId]
  ) : await pool2.query(
    "SELECT release_id FROM metadata_source.archive_release WHERE state='active'"
  );
  if (result.rowCount !== 1 || options.releaseId && result.rows[0].release_id !== options.releaseId)
    throw new MetadataUnavailable("archive_unavailable", "retry");
  return result.rows[0].release_id;
}
async function basePublicationState(pool2, tokenId, mintTransactionHash, candidate = false) {
  if (!candidate && (await pool2.query(
    "SELECT 1 FROM metadata.publication_runtime WHERE singleton AND base_error IS NOT NULL"
  )).rowCount)
    throw new MetadataUnavailable("base_replay_unavailable", "retry");
  const row = (await pool2.query(
    `SELECT s.next_block::text,s.target_block::text,s.updated_at,
    row_to_json(mint) AS mint,row_to_json(latest) AS latest
    FROM ${baseMetadataScanRelation()} s
    LEFT JOIN LATERAL(SELECT block_number,transaction_index,log_index,traits
      FROM ${baseMetadataEventsRelation()} WHERE chain_id=8453 AND contract_address=$1 AND token_id=$2
      AND event_name='Mint' AND transaction_hash=$3 AND block_number<s.next_block
      ORDER BY log_index DESC LIMIT 1) mint ON true
    LEFT JOIN LATERAL(SELECT event_name,transaction_hash,log_index,block_number::text AS block_number,block_hash,traits
      FROM ${baseMetadataEventsRelation()} WHERE chain_id=8453 AND contract_address=$1 AND token_id=$2
      AND block_number<s.next_block AND (block_number,transaction_index,log_index)>=(mint.block_number,mint.transaction_index,mint.log_index)
      ORDER BY block_number DESC,transaction_index DESC,log_index DESC LIMIT 1) latest ON true
    WHERE s.name='base_metadata_v1'`,
    [collections.base.address, tokenId, mintTransactionHash]
  )).rows[0];
  if (!row?.mint || !row.latest)
    throw new MetadataUnavailable("base_events_pending", "retry");
  const eventKey = `${row.latest.transaction_hash}:${row.latest.log_index}`;
  if (contentHash(row.mint.traits) !== contentHash(row.latest.traits))
    throw new MetadataUnavailable(
      "base_tuple_requires_mapping",
      "reconciliation_required"
    );
  return {
    eventKey,
    blockHash: row.latest.block_hash,
    asOfBlock: (BigInt(row.next_block) - 1n).toString(),
    catchingUp: BigInt(row.next_block) <= BigInt(row.target_block),
    traits: row.latest.traits
  };
}
var LocalMetadataReader = class {
  constructor(pool2, readSchema, options = {}) {
    this.pool = pool2;
    this.options = options;
    this.schema = sqlIdentifier(readSchema);
  }
  schema;
  release() {
    return selectedRelease(this.pool, this.options);
  }
  async asset(release, assetKey2, variant = "public") {
    const snapshot = await new ArchiveReader(
      this.pool,
      release,
      this.options.candidate
    ).snapshotByAsset(
      assetKey2,
      variant === "public",
      variant === "legacy-factory"
    );
    validateMetadata(snapshot.document);
    return {
      ...snapshot,
      document: immutableMetadata(snapshot.document),
      contentHash: contentHash(immutableMetadata(snapshot.document))
    };
  }
  async token(collection, tokenId, variant = "public") {
    const release = await this.release();
    if (!this.options.candidate)
      await assertChainReady(this.pool, [collection]);
    const ownership = await new ArchiveOwnershipReader(
      this.pool,
      release,
      this.schema.slice(1, -1),
      this.options.candidate
    ).token(collection, tokenId);
    if (!ownership) return null;
    if (!ownership.assetKey)
      return {
        release,
        ownership,
        metadata: null,
        status: "unavailable",
        reason: "binding_unavailable"
      };
    try {
      if (!this.options.candidate) {
        const quarantine = (await this.pool.query(
          `SELECT reason FROM metadata.publication_job WHERE release_id=$1 AND collection=$2 AND token_id=$3
          AND mint_transaction_hash=$4 AND mint_log_index=$5 AND reason='token_uri_changed'`,
          [
            release,
            collection,
            tokenId,
            ownership.mintTransactionHash,
            ownership.mintLogIndex
          ]
        )).rows[0];
        if (quarantine)
          throw new MetadataUnavailable(
            quarantine.reason,
            "reconciliation_required"
          );
      }
      const chain2 = collection === "base" ? await basePublicationState(
        this.pool,
        tokenId,
        ownership.mintTransactionHash,
        this.options.candidate
      ) : null;
      const snapshot = await this.asset(release, ownership.assetKey, variant);
      return {
        release,
        ownership,
        status: "published",
        reason: null,
        metadata: snapshot,
        chain: chain2,
        document: {
          ...snapshot.document,
          address: ownership.owner,
          ownerSince: ownership.ownerSince === null ? null : new Date(Number(ownership.ownerSince) * 1e3).toISOString(),
          minted: !ownership.burned
        }
      };
    } catch (error) {
      const unavailable2 = metadataError(error);
      return {
        release,
        ownership,
        metadata: null,
        status: unavailable2.status,
        reason: unavailable2.reason
      };
    }
  }
  async byId(id, family, variant = "public") {
    const release = await this.release(), archive = new ArchiveReader(this.pool, release, this.options.candidate);
    const source = await archive.lookup(
      id,
      family,
      variant !== "legacy-factory"
    );
    if (!this.options.candidate) {
      const bound = (await this.pool.query(
        "SELECT DISTINCT chain_id FROM metadata_source.asset_binding WHERE release_id=$1 AND asset_key=$2",
        [release, source.assetKey]
      )).rows;
      const affected = Object.entries(collections).filter(
        ([, definition]) => bound.some((row) => row.chain_id === String(definition.chainId))
      ).map(([slug]) => slug);
      await assertChainReady(this.pool, affected);
    }
    const bindings = (await this.pool.query(
      `SELECT DISTINCT t.collection,t.token_id,t.burned
      FROM metadata_source.asset_binding b JOIN LATERAL(SELECT collection,token_id,burned FROM ${this.schema}.token
        WHERE collection=CASE b.chain_id WHEN '1' THEN 'ethereum' WHEN '8453' THEN 'base' WHEN '137' THEN 'polygon' WHEN '56' THEN 'bnb' END
          AND token_id=b.token_id AND chain_id::text=b.chain_id AND lower(contract_address)=b.contract_address OFFSET 0) t ON true
      WHERE b.release_id=$1 AND b.asset_key=$2 ORDER BY t.burned,t.collection,t.token_id LIMIT 10`,
      [release, source.assetKey]
    )).rows;
    const live = bindings.filter((row) => !row.burned);
    if (live.length > 1) {
      for (const binding of live) {
        const current = await this.token(
          binding.collection,
          binding.token_id,
          variant
        );
        if (!current?.metadata)
          throw new MetadataUnavailable(
            current?.reason ?? "binding_unavailable",
            "reconciliation_required"
          );
      }
      const snapshot2 = await this.asset(release, source.assetKey, variant);
      const document = {
        ...snapshot2.document,
        address: null,
        ownerSince: null,
        minted: true
      };
      return {
        document,
        contentHash: contentHash(document),
        ownership: "chain_ambiguous",
        release
      };
    }
    if (live.length === 1) {
      const result = await this.token(
        live[0].collection,
        live[0].token_id,
        variant
      );
      if (!result?.metadata)
        throw new MetadataUnavailable(
          result?.reason ?? "binding_unavailable",
          "reconciliation_required"
        );
      return {
        document: result.document,
        contentHash: contentHash(result.document),
        ownership: "indexed_chain",
        release
      };
    }
    if (bindings.length || source.burned)
      throw new MetadataUnavailable("burned");
    const snapshot = await archive.snapshotByAsset(
      source.assetKey,
      variant === "public",
      variant === "legacy-factory"
    );
    validateMetadata(snapshot.document);
    return {
      document: snapshot.document,
      contentHash: contentHash(snapshot.document),
      ownership: "historical_source",
      release
    };
  }
  async island(type, id) {
    const release = await this.release();
    return (await this.pool.query(
      `SELECT b.payload->'document' AS document FROM metadata_source.source_record r
      JOIN metadata_source.source_blob b USING(content_hash) WHERE r.release_id=$1 AND r.namespace=$2 AND r.source_key=$3`,
      [release, staticNamespace, `${type}/${id}`]
    )).rows[0]?.document ?? null;
  }
  async owned(address3, chains2, limit = 1e3) {
    await this.release();
    if (!this.options.candidate) await assertChainReady(this.pool, chains2);
    const tokens = (await this.pool.query(
      `SELECT collection,token_id FROM ${this.schema}.token
      WHERE lower(owner)=lower($1) AND NOT burned AND collection=ANY($2::text[])
      ORDER BY collection,token_id LIMIT $3`,
      [address3, chains2, limit + 1]
    )).rows;
    if (tokens.length > limit)
      throw new MetadataUnavailable(
        "wallet_result_too_large",
        "reconciliation_required"
      );
    const items = [];
    for (let offset = 0; offset < tokens.length; offset += 8) {
      const batch = await Promise.all(
        tokens.slice(offset, offset + 8).map((row) => this.token(row.collection, row.token_id, "internal"))
      );
      for (const result of batch) {
        if (!result?.metadata)
          throw new MetadataUnavailable(
            result?.reason ?? "binding_unavailable",
            "reconciliation_required"
          );
        items.push(result.document);
      }
    }
    return items;
  }
};

// lib/metadata/status.ts
async function metadataReadiness(pool2) {
  if (projectionMode() === "generation") {
    const projection = await pool2.query(`SELECT EXISTS(
      SELECT 1 FROM metadata_projection.active a JOIN metadata_projection.generation g
        ON g.id=a.current_id
      WHERE a.singleton AND g.state='ready' AND g.format_version=1
        AND ${generationOwnershipProof("g")}
        ${metadataSourceMode() === "archive" ? `AND EXISTS(SELECT 1 FROM metadata_source.archive_release r
          WHERE r.state='active' AND r.release_id=g.metadata_release_id)` : ""}) AS ready`);
    if (!projection.rows[0]?.ready)
      return {
        ready: false,
        mode: "generation",
        reason: "projection_generation_unavailable"
      };
  }
  if (metadataSourceMode() !== "archive")
    return { ready: true, mode: "legacy-http" };
  if (!(await pool2.query(`SELECT bool_and(to_regclass(name) IS NOT NULL) AS installed FROM unnest(ARRAY[
    'metadata.publication_job','metadata.token_publication','metadata.publication_runtime','metadata.projection_revision',
    'metadata.derived_snapshot','metadata.chain_readiness','metadata_source.render_revision','metadata_source.lifecycle_binding','metadata_source.chain_metadata_scan']) name`)).rows[0].installed)
    return {
      ready: false,
      mode: "archive",
      reason: "publication_schema_pending"
    };
  const release = (await pool2.query(
    "SELECT release_id FROM metadata_source.archive_release WHERE state='active'"
  )).rows[0];
  if (!release)
    return { ready: false, mode: "archive", reason: "archive_unavailable" };
  const ownership = await chainReadiness(pool2);
  if (!ownership.ready)
    return {
      ready: false,
      mode: "archive",
      reason: "ownership_rebuilding",
      ownership
    };
  return { ready: true, mode: "archive", releaseId: release.release_id };
}
var cached;
async function publicationStatus(pool2) {
  if (metadataSourceMode() !== "archive") return { mode: "legacy-http" };
  if (cached && Date.now() - cached.at < 15e3) return cached.value;
  const [readiness, queue, runtime, base] = await Promise.all([
    metadataReadiness(pool2),
    pool2.query(`SELECT j.release_id,j.collection,j.status,j.reason,count(*)::text AS count,min(j.updated_at) AS oldest
      FROM metadata.publication_job j JOIN metadata_source.archive_release r USING(release_id)
      WHERE r.state='active' GROUP BY j.release_id,j.collection,j.status,j.reason`),
    pool2.query(
      "SELECT last_worker_at,base_error,base_checked_at FROM metadata.publication_runtime WHERE singleton"
    ),
    pool2.query(
      `SELECT next_block::text,target_block::text,updated_at FROM ${baseMetadataScanRelation()} WHERE name='base_metadata_v1'`
    ).catch(() => ({
      rows: [{ ready: false, reason: "base_metadata_unavailable" }]
    }))
  ]);
  const value = {
    ...readiness,
    rendererVersion,
    queue: queue.rows,
    runtime: runtime.rows[0] ?? null,
    base: base.rows[0] ?? null
  };
  cached = { at: Date.now(), value };
  return value;
}

// lib/api/legacy-metadata.ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
var retiredMetadataPaths = [
  "/v1/all-islands-by-address",
  "/v1/rainbow/preview",
  "/v1/rainbow/prepare",
  "/v1/rainbow/prepareStaking",
  "/v1/rainbow/portals",
  "/v1/getHatchingInfo",
  "/v1/crystalHatch/prepare",
  "/v1/cursedIngredientsFusion/prepare",
  "/landingpagestats",
  "/get-circulating",
  "/v1/postSwappedIdsByAddress",
  "/functions/all-meta-by-address",
  "/functions/meta-get-by-address",
  "/v1/all-meta-for-user",
  "/getIdsByType",
  "/v1/getMetasByType",
  "/functions/meta-get-by-tx",
  "/v1/get-metas-by-tx-hash",
  "/functions/meta-get-booster-openings-by-address",
  "/functions/get-booster-opening-amount-by-address",
  "/v1/get-booster-openings-by-period",
  "/functions/ids-get-changes-trough-transactions"
];
function validLegacyId(value) {
  return typeof value === "string" && (/^\d{1,78}$/.test(value) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value));
}
function legacyMetadataRouter(reader) {
  const app2 = new Hono();
  app2.use("*", cors({
    origin: "*",
    allowMethods: ["GET", "HEAD", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "If-None-Match"],
    exposeHeaders: ["ETag", "X-Metadata-Release", "X-Metadata-Ownership"]
  }));
  app2.use("*", bodyLimit({ maxSize: 65536, onError: (c) => c.json({ error: "body_too_large" }, 413) }));
  app2.onError((error, c) => {
    const unavailable2 = metadataError(error);
    return c.json({ error: unavailable2.reason }, unavailable2.status === "unavailable" ? 404 : 503);
  });
  app2.get("/meta", async (c) => {
    c.header("Cache-Control", "public, max-age=0, must-revalidate");
    const ids = c.req.queries("id");
    if (!ids?.length || !ids[0]) return c.json({ message: "Missing id" });
    if (ids.length !== 1 || !validLegacyId(ids[0])) return c.json({ message: "Invalid id" });
    try {
      const result = await reader.byId(ids[0]);
      c.header("X-Metadata-Release", result.release);
      c.header("X-Metadata-Ownership", result.ownership);
      c.header("Cache-Control", "public, max-age=0, must-revalidate");
      const etag = `"${result.contentHash}"`;
      c.header("ETag", etag);
      if (c.req.header("If-None-Match") === etag) return c.body(null, 304);
      return c.json(result.document);
    } catch (error) {
      const unavailable2 = metadataError(error);
      if (unavailable2.reason === "burned") return c.json({ message: "NFT is burned" });
      if (unavailable2.reason === "source_missing") return c.json({ status: 404, message: "No polkamon found" }, 404);
      if (unavailable2.reason === "source_invalid" || unavailable2.reason === "invalid_metadata_document") return c.json({ message: "An error occurred" }, 500);
      throw unavailable2;
    }
  });
  app2.post("/v1/getMetasById", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    if (!body || !Array.isArray(body.ids) || !body.ids.length) return c.json({ message: "Missing ids" }, 400);
    if (body.ids.length > 100) return c.json({ error: "too_many_ids", maximum: 100 }, 413);
    const ids = body.ids.map((id) => typeof id === "number" && Number.isSafeInteger(id) && id >= 0 ? String(id) : id);
    if (ids.some((id) => !validLegacyId(id))) return c.json({ message: "At least one Ids is invalid. Check your request!" }, 400);
    if (body.genIdType !== void 0 && (typeof body.genIdType !== "string" || !/^[A-Z0-9_]{1,64}$/.test(body.genIdType))) return c.json({ error: "invalid_family" }, 400);
    const documents = [];
    try {
      for (let i = 0; i < ids.length; i += 8) {
        const batch = await Promise.all(ids.slice(i, i + 8).map((id) => reader.byId(id, body.genIdType, "legacy-factory")));
        documents.push(...batch.map((result) => result.document));
      }
      return c.json(documents);
    } catch (error) {
      const unavailable2 = metadataError(error);
      if (unavailable2.reason === "burned") return c.text("Something went wrong while fetch Metadata. Reason: Error: NFT is burned", 500);
      if (unavailable2.reason === "source_missing") return c.text("Something went wrong while fetch Metadata. Reason: Error: No polkamon found", 500);
      throw unavailable2;
    }
  });
  app2.get("/v1/island-meta/:type/:id", async (c) => {
    const { type, id } = c.req.param();
    if (type !== "grassland") return c.json({ message: "No metadata found for the id & type" }, 404);
    const document = await reader.island(type, id);
    return document ? c.json(document) : c.json({ message: "No metadata found for the id" }, 404);
  });
  app2.get("/v1/all-meta-by-address", async (c) => {
    const address3 = c.req.query("address");
    if (!address3) return c.json({ message: "Missing id" });
    if (!/^0x[0-9a-fA-F]{40}$/.test(address3)) return c.json({ error: "invalid_address" }, 400);
    if (c.req.query("expandAddress") === "true") return c.json({ error: "linked_wallet_expansion_retired", message: "Supply an explicit wallet with expandAddress=false" }, 410);
    if (c.req.query("filter")) return c.json({ error: "legacy_filter_unsupported", message: "Use /v1/tokens for collection filtering" }, 400);
    const aliases = { eth: "ethereum", ETHEREUM: "ethereum", bsc: "bnb", BSC: "bnb", POLYGON: "polygon", BASE: "base" };
    const rawChains = c.req.queries("chains[]") ?? c.req.queries("chains");
    const chains2 = rawChains ? rawChains.map((value) => aliases[value] ?? value) : collectionSlugs;
    if (!chains2.length || chains2.some((value) => !collectionSlugs.includes(value))) return c.json({ error: "unsupported_ownership_chain", supported: collectionSlugs }, 400);
    let documents = await reader.owned(address3, chains2);
    const fields = c.req.query("fields");
    if (fields) {
      try {
        const value = JSON.parse(fields);
        const names = Array.isArray(value) ? value : value && typeof value === "object" ? Object.keys(value) : null;
        if (names?.every((name) => typeof name === "string")) documents = documents.map((doc) => Object.fromEntries(Object.entries(doc).filter(([key]) => names.includes(key))));
      } catch {
      }
    }
    c.header("X-Metadata-Ownership", "indexed_chain");
    return c.json({ wallets: [{ address: address3, chainType: "EVM" }], errors: [], resultCount: documents.length, metaData: documents, info: [] });
  });
  for (const path2 of retiredMetadataPaths) app2.on(["GET", "POST"], path2, (c) => c.json({ error: "retired_endpoint" }, 410));
  return app2;
}

// lib/api/server.ts
init_db();
import { serve } from "@hono/node-server";
import { createHash as createHash8 } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Hono as Hono5 } from "hono";
import { cors as cors2 } from "hono/cors";
import { z as z7 } from "zod";

// lib/api/islands-openapi.ts
var collectionRoot = "/v2/collections/ethereum-islands";
var holdingParameter = {
  name: "holding",
  in: "query",
  schema: {
    type: "string",
    enum: ["wallet", "all", "staked"],
    default: "wallet"
  },
  description: "staked returns verified legacy stakes, optionally filtered by owner (the staking wallet). all includes wallet holdings and verified stakes for an owner, or the full collection without an owner. Explicit wallet requires an owner. Omitting holding keeps direct-ownership semantics. owner in returned tokens remains the on-chain custody address. total is scoped to these filters. complete=false means required staking verification is unavailable or catching up; items then contain only currently verified matches. stakingStatus describes verification readiness."
};
var limitParameter = {
  name: "limit",
  in: "query",
  schema: { type: "integer", minimum: 1, maximum: 100, default: 50 }
};
var cursorParameter = {
  name: "cursor",
  in: "query",
  schema: { type: "string" },
  description: "Pass nextCursor unchanged with the same filters."
};
var tokenParameter = {
  name: "tokenId",
  in: "path",
  required: true,
  schema: { type: "string", pattern: "^(0|[1-9][0-9]*)$" }
};
var gatedResponses = {
  "200": {
    description: "Collection-scoped response. Token IDs and blocks are strings; chain is ethereum and collectionId is ethereum-islands. Metadata is normalized from immutable archived JSON and includes URI/block/hash provenance. Edition is derived from the contract's genesis boundary. Rarity is unscored (null)."
  },
  "400": { description: "Invalid filter, owner, or token ID" },
  "409": { description: "Invalid cursor or cursor from different filters" },
  "503": {
    description: "Reads disabled, ownership replay/verification pending, or database unavailable"
  }
};
var islandsOpenApiPaths = {
  [`${collectionRoot}/staking-status`]: {
    get: {
      tags: ["Operations"],
      summary: "Read legacy Island staking verification freshness",
      responses: gatedResponses
    }
  },
  [collectionRoot]: {
    get: {
      tags: ["Collection"],
      summary: "Describe the Ethereum Islands collection",
      responses: gatedResponses
    }
  },
  [`${collectionRoot}/indexing-status`]: {
    get: {
      tags: ["Operations"],
      summary: "Read Islands activation and indexing readiness",
      description: "Available while Islands reads are disabled or rebuilding. This collection has independent readiness; existing Yunipals chain scopes are unchanged.",
      responses: {
        "200": {
          description: "Collection identity, enabled flag, and readiness"
        },
        "503": { description: "Database unavailable" }
      }
    }
  },
  [`${collectionRoot}/stats`]: {
    get: {
      tags: ["Collection"],
      summary: "Read Islands supply, edition, holder and metadata counts",
      responses: gatedResponses
    }
  },
  [`${collectionRoot}/tokens`]: {
    get: {
      tags: ["Tokens"],
      summary: "List Ethereum Islands",
      parameters: [
        limitParameter,
        holdingParameter,
        cursorParameter,
        {
          name: "sort",
          in: "query",
          schema: {
            type: "string",
            enum: ["token-id-asc", "token-id-desc"],
            default: "token-id-asc"
          }
        },
        {
          name: "owner",
          in: "query",
          description: "Ethereum wallet address",
          schema: { type: "string" }
        },
        {
          name: "edition",
          in: "query",
          schema: { type: "string", enum: ["Genesis", "Personal"] }
        },
        {
          name: "burned",
          in: "query",
          schema: {
            type: "string",
            enum: ["false", "true", "all"],
            default: "false"
          }
        }
      ],
      responses: gatedResponses
    }
  },
  [`${collectionRoot}/owners/{address}/tokens`]: {
    get: {
      tags: ["Owners"],
      summary: "List one wallet's active Islands",
      parameters: [
        {
          name: "address",
          in: "path",
          required: true,
          schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" }
        },
        limitParameter,
        holdingParameter,
        cursorParameter,
        {
          name: "sort",
          in: "query",
          schema: { type: "string", enum: ["token-id-asc", "token-id-desc"] }
        },
        {
          name: "edition",
          in: "query",
          schema: { type: "string", enum: ["Genesis", "Personal"] }
        }
      ],
      responses: gatedResponses
    }
  },
  [`${collectionRoot}/tokens/{tokenId}`]: {
    get: {
      tags: ["Tokens"],
      summary: "Read an Island and its mint/burn lifecycle",
      parameters: [tokenParameter],
      responses: { ...gatedResponses, "404": { description: "Unknown Island" } }
    }
  },
  [`${collectionRoot}/tokens/{tokenId}/transfers`]: {
    get: {
      tags: ["Tokens"],
      summary: "Read paginated Island transfer history",
      description: "Events are ordered by block, transaction index, and log index. The cursor is tied to the collection and token.",
      parameters: [tokenParameter, limitParameter, cursorParameter],
      responses: gatedResponses
    }
  }
};

// lib/api/booster-openapi.ts
var response = {
  "200": {
    description: "Collection-qualified booster data, indexed checkpoint, and enabled/paused state. Integer token IDs, prices and timestamps are decimal strings."
  },
  "400": { description: "Invalid identity or pagination" },
  "404": { description: "Unknown token or request" },
  "503": { description: "Booster index unavailable" }
};
var pathParameter = (name) => ({
  name,
  in: "path",
  required: true,
  schema: { type: "string" }
});
var ownerParameters = [
  pathParameter("address"),
  {
    name: "after",
    in: "query",
    schema: { type: "string" },
    description: "Last numeric token or request ID from the preceding page"
  },
  {
    name: "limit",
    in: "query",
    schema: { type: "integer", minimum: 1, maximum: 100, default: 50 }
  }
];
var boosterOpenApiPaths = {
  "/v1/boosters/art/{catalog}/manifest.json": {
    get: {
      tags: ["Boosters"],
      summary: "Read frozen artwork recipe and exact OG reference commitments",
      parameters: [pathParameter("catalog")],
      responses: response
    }
  },
  "/v1/boosters/art/{catalog}/{variant}.json": {
    get: {
      tags: ["Boosters"],
      summary: "Read shared variant artwork and calibrated holo masks",
      parameters: [pathParameter("catalog"), pathParameter("variant")],
      responses: {
        ...response,
        "202": {
          description: "Artwork is queued, missing or awaiting review; retry after five seconds. No image generation is triggered by this GET."
        }
      }
    }
  },
  "/v1/boosters/art-assets/{asset}": {
    get: {
      tags: ["Boosters"],
      summary: "Read immutable SHA256-addressed PNG or SVG assets",
      parameters: [pathParameter("asset")],
      responses: response
    }
  },
  "/v1/boosters/types": {
    get: {
      tags: ["Boosters"],
      summary: "Read activated booster types",
      responses: response
    }
  },
  "/v1/boosters/originals/{collection}/{tokenId}": {
    get: {
      tags: ["Boosters"],
      summary: "Read original mint rights and frozen pack rules",
      parameters: [pathParameter("collection"), pathParameter("tokenId")],
      responses: response
    }
  },
  "/v1/boosters/monsters/{collection}/{tokenId}": {
    get: {
      tags: ["Boosters"],
      summary: "Read monster provenance and durable metadata URI",
      parameters: [pathParameter("collection"), pathParameter("tokenId")],
      responses: response
    }
  },
  "/v1/boosters/requests/{engine}/{requestId}": {
    get: {
      tags: ["Boosters"],
      summary: "Read VRF request and fulfillment status",
      parameters: [pathParameter("engine"), pathParameter("requestId")],
      responses: response
    }
  },
  ...Object.fromEntries(
    ["monsters", "originals", "requests"].map((resource) => [
      `/v1/owners/{address}/booster-${resource}`,
      {
        get: {
          tags: ["Boosters"],
          summary: `Read a wallet's booster ${resource}`,
          parameters: ownerParameters,
          responses: response
        }
      }
    ])
  ),
  "/v1/owners/{address}/booster-refunds": {
    get: {
      tags: ["Boosters"],
      summary: "Read request-time ETH refunds and withdrawable credit",
      parameters: [pathParameter("address")],
      responses: response
    }
  }
};

// lib/api/openapi.ts
var openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Yunipals Multi-chain Indexer API",
    version: "1.0.0",
    description: "Ownership, transfer history, lifecycle, metadata, and signed NFT visibility API for the Yunipals OG collections on Ethereum, Base, Polygon, and BNB. Endpoints include all chains by default and accept an optional chain filter. Token IDs and block numbers are strings because they can exceed JavaScript's safe integer range."
  },
  servers: [
    { url: "https://api.yunipals.com/yunipals-indexer", description: "Production" },
    { url: "http://127.0.0.1:9011", description: "Server-local" }
  ],
  tags: [
    { name: "Tokens" },
    { name: "Owners" },
    { name: "Collection" },
    { name: "Visibility" },
    { name: "Operations" },
    { name: "Legacy metadata" },
    { name: "Leaderboards" }
  ],
  paths: {
    ...boosterOpenApiPaths,
    ...islandsOpenApiPaths,
    "/v1/indexing-status": {
      get: {
        tags: ["Operations"],
        summary: "Read explicit chain recovery readiness",
        description: "Reports rebuilding/failed chains and verified recovery checkpoints. During recovery, affected ownership, visibility and derived-data routes return 503; unrelated chains and immutable archive reads remain available.",
        responses: { "200": { description: "Recovery readiness and per-chain state" } }
      }
    },
    "/legacy-meta/meta": {
      get: {
        tags: ["Legacy metadata"],
        summary: "Read archived NFT metadata by legacy ID",
        description: "Available in archive mode after activation. Current ownership is overlaid only when a single live chain binding exists. Multiple live bindings return a null address and X-Metadata-Ownership: chain_ambiguous; use the chain-qualified token API for each owner. Historical unindexed assets are labeled historical_source. The legacy burned-token response remains HTTP 200 with a message and is not valid published metadata.",
        parameters: [{ name: "id", in: "query", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "NFT document or legacy message-only response" }, "304": { description: "Unchanged response" }, "404": { description: "Unknown NFT" }, "503": { description: "Archive unavailable, ownership rebuilding, or binding/chain update requires reconciliation" } }
      }
    },
    "/legacy-meta/v1/getMetasById": {
      post: {
        tags: ["Legacy metadata"],
        summary: "Read ordered family-qualified legacy metadata",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["ids"], properties: { ids: { type: "array", minItems: 1, maxItems: 100, items: { type: "string" } }, genIdType: { type: "string" } } } } } },
        responses: { "200": { description: "Ordered metadata array, retaining duplicate IDs" }, "400": { description: "Invalid request" }, "413": { description: "Bulk or body limit exceeded" }, "500": { description: "Legacy bulk failure, including a burned NFT" }, "503": { description: "Metadata unavailable" } }
      }
    },
    "/legacy-meta/v1/all-meta-by-address": {
      get: {
        tags: ["Legacy metadata"],
        summary: "Read one explicitly supplied wallet's indexed collection",
        description: "Returns wallets, errors, resultCount, metaData and info. Supported ownership chains are Ethereum, Base, Polygon and BNB. Linked-account expansion is retired; expandAddress=true returns 410. Queries are bounded to 1000 tokens; larger wallets should use the paginated native owner API. Unavailable metadata is explicit rather than silently dropping owned tokens.",
        parameters: [
          { name: "address", in: "query", required: true, schema: { type: "string" } },
          { name: "expandAddress", in: "query", schema: { type: "boolean", default: false } },
          { name: "chains", in: "query", schema: { type: "array", items: { type: "string", enum: ["ethereum", "base", "polygon", "bnb"] } }, style: "form", explode: true }
        ],
        responses: { "200": { description: "Wallet collection" }, "400": { description: "Unsupported ownership scope/filter" }, "410": { description: "Linked-account expansion retired" }, "503": { description: "Incomplete collection or result limit exceeded" } }
      }
    },
    "/legacy-meta/v1/island-meta/{type}/{id}": {
      get: {
        tags: ["Legacy metadata"],
        summary: "Read preserved static island NFT metadata",
        parameters: [{ name: "type", in: "path", required: true, schema: { type: "string", enum: ["grassland"] } }, { name: "id", in: "path", required: true, schema: { type: "string", enum: ["10000000", "20000000"] } }],
        responses: { "200": { description: "Static NFT document" }, "404": { description: "Unknown static document" }, "503": { description: "No active archive" } }
      }
    },
    "/v1/tokens": {
      get: {
        tags: ["Tokens"],
        summary: "List and filter tokens",
        description: "Repeated traitType/traitValue pairs are positional. Values within the same trait type use OR; different trait types use AND. Pass nextCursor unchanged with the same filters and sort.",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
          { name: "cursor", in: "query", description: "Opaque pagination cursor. Pass nextCursor unchanged.", schema: { type: "string" } },
          { name: "chain", in: "query", description: "Repeat to select multiple chains. Duplicates and order are ignored; omit to include all.", schema: { type: "array", items: { type: "string", enum: ["ethereum", "base", "polygon", "bnb"] } }, style: "form", explode: true },
          { name: "owner", in: "query", description: "Wallet address or ENS name. Names resolve independently for each selected chain.", schema: { type: "string" } },
          { name: "burned", in: "query", schema: { type: "boolean" } },
          { name: "traitType", in: "query", description: "Repeat alongside traitValue", schema: { type: "array", items: { type: "string" } }, style: "form", explode: true, example: ["Type", "Type", "Glitter"] },
          { name: "traitValue", in: "query", description: "Positional value for each traitType", schema: { type: "array", items: { type: "string" } }, style: "form", explode: true, example: ["Unisheep", "Unidragon", "Gold"] },
          { name: "rarityMin", in: "query", description: "Minimum indexed Rarity Points", schema: { type: "number" } },
          { name: "rarityMax", in: "query", description: "Maximum indexed Rarity Points", schema: { type: "number" } },
          { name: "rarityCappedMin", in: "query", description: "Minimum capped rarity used for comparable scoring", schema: { type: "number" } },
          { name: "rarityCappedMax", in: "query", description: "Maximum capped rarity used for comparable scoring", schema: { type: "number" } },
          { name: "metadata", in: "query", schema: { type: "string", enum: ["all", "available", "missing"], default: "all" } },
          { name: "sort", in: "query", schema: { type: "string", enum: ["token-id-asc", "token-id-desc", "rarity-desc", "rarity-asc", "rarity-capped-desc", "rarity-capped-asc"], default: "token-id-asc" } }
        ],
        responses: { "200": { description: "Token page", content: { "application/json": { schema: { $ref: "#/components/schemas/TokenPage" } } } } }
      }
    },
    "/v1/traits": {
      get: {
        tags: ["Tokens"],
        summary: "Discover active collection trait facets",
        description: "Discovers trait categories dynamically. Categorical traits include collection-wide active-token counts; fully numeric traits include min/max ranges. Burned NFTs are excluded.",
        parameters: [{ name: "chain", in: "query", description: "Repeat to select multiple chains; omit for all.", schema: { type: "array", items: { type: "string", enum: ["ethereum", "base", "polygon", "bnb"] } }, style: "form", explode: true }],
        responses: { "200": { description: "Trait facets, metadata coverage, and snapshot time", content: { "application/json": { schema: { $ref: "#/components/schemas/TraitFacets" } } } } }
      }
    },
    "/v1/tokens/{tokenId}": {
      get: {
        tags: ["Tokens"],
        summary: "Get one token with all transfers and lifecycles",
        parameters: [{ name: "tokenId", in: "path", required: true, schema: { type: "string", pattern: "^[0-9]+$" }, example: "1000168114" }],
        responses: {
          "200": { description: "Token detail", content: { "application/json": { schema: { type: "object", properties: { token: { $ref: "#/components/schemas/TokenDetail" }, transfers: { type: "array", items: { $ref: "#/components/schemas/Transfer" } }, lifecycles: { type: "array", items: { type: "object", additionalProperties: true } } } } } } },
          "404": { description: "Token not found" }
        }
      }
    },
    "/v1/tokens/{chain}/{tokenId}": {
      get: {
        tags: ["Tokens"],
        summary: "Get one token from a specific chain",
        parameters: [
          { name: "chain", in: "path", required: true, schema: { type: "string", enum: ["ethereum", "base", "polygon", "bnb"] } },
          { name: "tokenId", in: "path", required: true, schema: { type: "string", pattern: "^[0-9]+$" } }
        ],
        responses: { "200": { description: "Token detail, transfers, and lifecycles" }, "404": { description: "Token not found" } }
      }
    },
    "/v1/tokens/{chain}/{tokenId}/visibility/signing-data": {
      get: {
        tags: ["Visibility"],
        summary: "Build typed data for hiding or unhiding an NFT",
        description: "Returns five-minute EIP-712 SetTokenVisibility typed data anchored to the token's current indexed ownership event. Only externally owned accounts are supported.",
        parameters: [
          { name: "chain", in: "path", required: true, schema: { type: "string", enum: ["ethereum", "base", "polygon", "bnb"] } },
          { name: "tokenId", in: "path", required: true, schema: { type: "string", pattern: "^[0-9]+$" } },
          { name: "hidden", in: "query", required: true, schema: { type: "boolean" } }
        ],
        responses: {
          "200": { description: "Typed data to pass unchanged to an EIP-712 wallet signer", content: { "application/json": { schema: { type: "object", properties: { typedData: { type: "object", additionalProperties: true } } } } } },
          "400": { description: "Invalid chain, token ID, or hidden value" },
          "404": { description: "Token not found" },
          "409": { description: "Token is burned or otherwise inactive" }
        }
      }
    },
    "/v1/tokens/{chain}/{tokenId}/visibility": {
      put: {
        tags: ["Visibility"],
        summary: "Apply a signed NFT visibility preference",
        description: "Verifies the exact typed-data message returned by the signing-data endpoint, current ownership, expiry, and the wallet's one-time nonce. Hiding affects token list views only and never affects scoring.",
        parameters: [
          { name: "chain", in: "path", required: true, schema: { type: "string", enum: ["ethereum", "base", "polygon", "bnb"] } },
          { name: "tokenId", in: "path", required: true, schema: { type: "string", pattern: "^[0-9]+$" } }
        ],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/VisibilityRequest" } } } },
        responses: {
          "200": { description: "Visibility updated", content: { "application/json": { schema: { $ref: "#/components/schemas/VisibilityResult" } } } },
          "400": { description: "Malformed request, mismatched token, or invalid deadline" },
          "401": { description: "Invalid EOA signature" },
          "404": { description: "Token not found" },
          "409": { description: "Nonce conflict, inactive token, or changed ownership" },
          "410": { description: "Signature expired" }
        }
      }
    },
    "/v1/collections": {
      get: { tags: ["Collection"], summary: "List indexed Yunipals collections", responses: { "200": { description: "Chain, contract, and supply details" } } }
    },
    "/v1/collector-capabilities": { get: { tags: ["Owners"], summary: "Collector read rollout capabilities", responses: { "200": { description: "version: 1 enables paginated collector filters; namePrefixSearch and rarityRange advertise independently gated support." } } } },
    "/v2/owners/{address}/tokens": {
      get: {
        tags: ["Owners"],
        summary: "Filter and sort one owner's complete collection using bounded keyset pages",
        parameters: [
          { name: "address", in: "path", required: true, schema: { type: "string" } },
          { name: "chain", in: "query", style: "form", explode: true, schema: { type: "array", items: { type: "string", enum: ["ethereum", "base", "polygon", "bnb"] } } },
          { name: "t.Type", in: "query", style: "form", explode: true, schema: { type: "array", maxItems: 20, items: { type: "string", maxLength: 80 } } },
          { name: "t.Color", in: "query", style: "form", explode: true, schema: { type: "array", maxItems: 20, items: { type: "string", maxLength: 80 } } },
          { name: "rarityMin", in: "query", description: "Inclusive minimum effective rarity score (capped score with raw fallback).", schema: { type: "string", pattern: "^[0-9]+(\\.[0-9]+)?$" } },
          { name: "rarityMax", in: "query", description: "Inclusive maximum effective rarity score (capped score with raw fallback).", schema: { type: "string", pattern: "^[0-9]+(\\.[0-9]+)?$" } },
          { name: "q", in: "query", description: "Exact numeric token ID (optional # prefix), or case-insensitive name prefix of at least two characters when enabled.", schema: { type: "string", maxLength: 80 } },
          { name: "sort", in: "query", schema: { type: "string", enum: ["rarity-capped-desc", "rarity-capped-asc"], default: "rarity-capped-desc" } },
          { name: "visibility", in: "query", schema: { type: "string", enum: ["visible", "hidden"], default: "visible" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 48, default: 24 } },
          { name: "cursor", in: "query", description: "Use nextCursor or previousCursor unchanged. Bound to owner, filters, page size and sort; expires after 15 minutes.", schema: { type: "string", maxLength: 2048 } }
        ],
        responses: { "200": { description: "version=1, canonical query, owner resolution, visibility, token items, nextCursor and previousCursor; no total count." }, "400": { description: "Invalid or unsupported filters" }, "409": { description: "Restart from page one: cursor invalid, expired or incompatible" }, "503": { description: "Feature disabled or database unavailable" } }
      }
    },
    "/v1/owners/{address}/tokens": {
      get: {
        tags: ["Owners"],
        summary: "List active tokens owned by an address or ENS name",
        parameters: [
          { name: "address", in: "path", required: true, description: "Wallet address or ENS name", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
          { name: "chain", in: "query", description: "Repeat to select multiple chains; omit for all.", schema: { type: "array", items: { type: "string", enum: ["ethereum", "base", "polygon", "bnb"] } }, style: "form", explode: true },
          { name: "visibility", in: "query", description: "Show normal collection items, hidden items, or both. This is public curation data.", schema: { type: "string", enum: ["visible", "hidden", "all"], default: "visible" } },
          { name: "cursor", in: "query", description: "Opaque cursor bound to the chain and visibility filters.", schema: { type: "string" } }
        ],
        responses: { "200": { description: "Owner token page" } }
      }
    },
    "/v1/leaderboards": { get: { tags: ["Leaderboards"], summary: "List leaderboard definitions and snapshot status", parameters: [{ name: "chain", in: "query", description: "Repeat to select multiple chains; omit for all.", schema: { type: "array", items: { type: "string", enum: ["ethereum", "base", "polygon", "bnb"] } }, style: "form", explode: true }], responses: { "200": { description: "Available rankings and collector-score formula" } } } },
    "/v1/leaderboards/{metric}": {
      get: {
        tags: ["Leaderboards"],
        summary: "Get a wallet leaderboard",
        description: "Ranks current holders only. Equal metric values share a dense rank. Use nextCursor unchanged for the next page.",
        parameters: [
          { name: "metric", in: "path", required: true, schema: { type: "string", enum: ["total-rarity", "monster-count", "unique-types", "special-count", "glitter-count", "collector-score"] } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
          { name: "chain", in: "query", description: "Repeat to select multiple chains; omit for all.", schema: { type: "array", items: { type: "string", enum: ["ethereum", "base", "polygon", "bnb"] } }, style: "form", explode: true },
          { name: "cursor", in: "query", schema: { type: "string" } }
        ],
        responses: { "200": { description: "Ranked wallet page", content: { "application/json": { schema: { $ref: "#/components/schemas/LeaderboardPage" } } } }, "400": { description: "Invalid cursor" }, "404": { description: "Unknown leaderboard" } }
      }
    },
    "/v1/owners/{address}/leaderboard": {
      get: {
        tags: ["Leaderboards", "Owners"],
        summary: "Get one wallet's metrics and ranks",
        parameters: [{ name: "address", in: "path", required: true, description: "Wallet address or ENS name", schema: { type: "string" } }, { name: "chain", in: "query", description: "Repeat to select multiple chains; omit for all.", schema: { type: "array", items: { type: "string", enum: ["ethereum", "base", "polygon", "bnb"] } }, style: "form", explode: true }],
        responses: { "200": { description: "Wallet metrics and ranks" }, "404": { description: "Wallet owns no active Yunipals" } }
      }
    },
    "/v1/collection": { get: { tags: ["Collection"], summary: "Get collection supply counts", parameters: [{ name: "chain", in: "query", description: "Repeat to select multiple chains; omit for all.", schema: { type: "array", items: { type: "string", enum: ["ethereum", "base", "polygon", "bnb"] } }, style: "form", explode: true }], responses: { "200": { description: "Collection totals" } } } },
    "/v1/status": { get: { tags: ["Operations"], summary: "Get metadata ingestion status", responses: { "200": { description: "Worker status" } } } },
    "/health": { get: { tags: ["Operations"], summary: "Process liveness", responses: { "200": { description: "Process is running" } } } },
    "/ready": { get: { tags: ["Operations"], summary: "Database readiness", responses: { "200": { description: "API and database are ready" }, "503": { description: "Database unavailable" } } } }
  },
  components: {
    schemas: {
      Attribute: { type: "object", required: ["trait_type", "value"], properties: { trait_type: { type: "string" }, value: {}, display_type: { type: "string" } }, additionalProperties: true },
      TokenSummary: { type: "object", properties: { chain: { type: "string", enum: ["ethereum", "base", "polygon", "bnb"] }, chainId: { type: "integer" }, contractAddress: { type: "string" }, tokenId: { type: "string" }, owner: { type: "string" }, burned: { type: "boolean" }, lifecycle: { type: "integer" }, mintBlock: { type: "string" }, lastTransferBlock: { type: "string" }, name: { type: ["string", "null"] }, image: { type: ["string", "null"], format: "uri" }, attributes: { type: ["array", "null"], items: { $ref: "#/components/schemas/Attribute" } }, tokenUri: { type: ["string", "null"], format: "uri" }, rarityPoints: { type: ["string", "null"], description: "Uncapped upstream rarity score." }, rarityPointsCapped: { type: ["string", "null"], description: "Capped rarity used by leaderboard scoring; falls back to raw rarity when the upstream document has no cap." } } },
      TokenPage: { type: "object", required: ["items", "nextCursor", "total"], properties: { items: { type: "array", items: { $ref: "#/components/schemas/TokenSummary" } }, nextCursor: { type: ["string", "null"], description: "Opaque pagination cursor. Pass unchanged as cursor to retrieve the next page." }, total: { type: "integer" } } },
      TraitFacets: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: { oneOf: [
              { type: "object", properties: { traitType: { type: "string" }, kind: { const: "categorical" }, values: { type: "array", items: { type: "object", properties: { value: { type: "string" }, count: { type: "integer" } } } } } },
              { type: "object", properties: { traitType: { type: "string" }, kind: { const: "numeric" }, min: { type: "string" }, max: { type: "string" } } }
            ] }
          },
          metadata: { type: "object", properties: { available: { type: "integer" }, missing: { type: "integer" } } },
          updatedAt: { type: "string", format: "date-time" }
        }
      },
      TokenDetail: { type: "object", description: "Current on-chain token state joined with cached metadata. The document field contains the complete upstream metadata JSON.", additionalProperties: true },
      VisibilityMessage: {
        type: "object",
        required: ["owner", "tokenId", "lifecycle", "ownershipTransactionHash", "ownershipLogIndex", "hidden", "nonce", "deadline"],
        properties: {
          owner: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
          tokenId: { type: "string", pattern: "^[0-9]+$" },
          lifecycle: { type: "integer", minimum: 1 },
          ownershipTransactionHash: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
          ownershipLogIndex: { type: "integer", minimum: 0 },
          hidden: { type: "boolean" },
          nonce: { type: "string", pattern: "^[0-9]+$" },
          deadline: { type: "integer", description: "Unix timestamp in seconds" }
        }
      },
      VisibilityRequest: { type: "object", required: ["message", "signature"], properties: { message: { $ref: "#/components/schemas/VisibilityMessage" }, signature: { type: "string" } } },
      VisibilityResult: { type: "object", required: ["chain", "tokenId", "owner", "hidden"], properties: { chain: { type: "string", enum: ["ethereum", "base", "polygon", "bnb"] }, tokenId: { type: "string" }, owner: { type: "string" }, hidden: { type: "boolean" } } },
      LeaderboardEntry: { type: "object", properties: { rank: { type: "integer" }, owner: { type: "string" }, ensName: { type: ["string", "null"], description: "Verified primary ENS name when available from daily enrichment." }, score: { type: "string" }, monsterCount: { type: "integer" }, totalRarity: { type: "string" }, uniqueTypes: { type: "integer" }, specialCount: { type: "integer" }, glitterCount: { type: "integer" }, collectorScore: { type: "string" }, updatedAt: { type: "string", format: "date-time" } } },
      LeaderboardPage: { type: "object", properties: { metric: { type: "string" }, label: { type: "string" }, scoreVersion: { type: ["string", "null"] }, items: { type: "array", items: { $ref: "#/components/schemas/LeaderboardEntry" } }, nextCursor: { type: ["string", "null"] }, updatedAt: { type: ["string", "null"], format: "date-time" } } },
      Transfer: { type: "object", properties: { id: { type: "string" }, token_id: { type: "string" }, lifecycle: { type: "integer" }, from: { type: "string" }, to: { type: "string" }, block_number: { type: "string" }, block_timestamp: { type: "string" }, transaction_hash: { type: "string" }, transaction_index: { type: "integer" }, log_index: { type: "integer" } } }
    }
  }
};
var docsHtml = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Yunipals Indexer API</title><link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"></head>
<body><div id="swagger-ui"></div><script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({url:"./openapi.json",dom_id:"#swagger-ui",deepLinking:true,displayRequestDuration:true});</script></body></html>`;

// lib/leaderboard/refresh.ts
init_db();

// lib/rarity/calculate.ts
var import_legacy4 = __toESM(require_legacy2(), 1);
var rarityFormulaVersion = "web3-util-pmons-31.15.1-v1";

// lib/rarity/read-source.ts
var rarityReadSource = process.env.RARITY_READ_SOURCE ?? "metadata";
if (rarityReadSource !== "metadata" && rarityReadSource !== "local") {
  throw new Error("RARITY_READ_SOURCE must be metadata or local");
}
var localRarityJoin = rarityReadSource === "local" ? `LEFT JOIN metadata.token_rarity local_rarity
        ON local_rarity.collection=m.collection
        AND local_rarity.token_id=m.token_id
        AND local_rarity.lifecycle=m.lifecycle
        AND local_rarity.formula_version='${rarityFormulaVersion}'` : "";
var upstreamRaw = `CASE
  WHEN m.document->>'rarity' ~ '^-?[0-9]+(\\.[0-9]+)?$'
    THEN (m.document->>'rarity')::numeric
  WHEN rp.value ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN rp.value::numeric
END`;
var upstreamCapped = `COALESCE(
  CASE WHEN m.document->>'rarityCapped' ~ '^-?[0-9]+(\\.[0-9]+)?$'
    THEN (m.document->>'rarityCapped')::numeric END,
  ${upstreamRaw}
)`;
var rarityPointsSql = rarityReadSource === "local" ? `COALESCE(CASE WHEN local_rarity.status='valid'
        THEN local_rarity.rarity_points END, ${upstreamRaw})` : upstreamRaw;
var rarityPointsCappedSql = rarityReadSource === "local" ? `COALESCE(CASE WHEN local_rarity.status='valid'
        THEN local_rarity.rarity_points_capped END, ${upstreamCapped})` : upstreamCapped;

// lib/metadata/projection-refresh.ts
init_db();
var scopes = Array.from(
  { length: (1 << collectionSlugs.length) - 1 },
  (_, index) => {
    const chains2 = collectionSlugs.filter((_2, bit) => index + 1 & 1 << bit);
    return chains2.length === collectionSlugs.length ? "all" : chains2.join("+");
  }
);
var archiveMode = metadataSourceMode() === "archive";

// lib/leaderboard/refresh.ts
var scoreVersion = "collector-score-v1";
var archiveMode2 = metadataSourceMode() === "archive";
var scoreFormula = "1000*ln(1+totalRarity) + 50*monsterCount + 500*uniqueTypes + 750*specialCount + 250*glitterCount";
var collectionScopes = Array.from(
  { length: (1 << collectionSlugs.length) - 1 },
  (_, index) => {
    const chains2 = collectionSlugs.filter((_2, bit) => index + 1 & 1 << bit);
    return chains2.length === collectionSlugs.length ? "all" : chains2.join("+");
  }
);

// lib/ens/resolver.ts
import { createPublicClient, getAddress, http, isAddress } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";
var InvalidOwnerError = class extends Error {
};
var EnsUnavailableError = class extends Error {
};
var OwnerNameUnresolvedError = class extends Error {
};
var successTtlMs = Number(process.env.ENS_FORWARD_CACHE_MS ?? 15 * 6e4);
var negativeTtlMs = Number(process.env.ENS_NEGATIVE_CACHE_MS ?? 2 * 6e4);
var forwardCache = /* @__PURE__ */ new Map();
var defaultClient;
function clientOf() {
  if (defaultClient) return defaultClient;
  const rpc = process.env.PONDER_RPC_URL_1;
  if (!rpc) throw new EnsUnavailableError("PONDER_RPC_URL_1 is required for ENS resolution");
  defaultClient = createPublicClient({ chain: mainnet, transport: http(rpc, { timeout: Number(process.env.ENS_RPC_TIMEOUT_MS ?? 4e3) }) });
  return defaultClient;
}
function normalizeOwnerName(input) {
  const candidate = input.trim();
  if (!candidate.includes(".") || candidate.length > 255) throw new InvalidOwnerError("Invalid owner address or ENS name");
  try {
    return normalize(candidate);
  } catch {
    throw new InvalidOwnerError("Invalid owner address or ENS name");
  }
}
async function resolveEnsAddress(name, chain2, client = clientOf()) {
  const key = `${name}:${collections[chain2].chainId}`;
  const cached2 = forwardCache.get(key);
  if (cached2 && cached2.expiresAt > Date.now()) return cached2.address;
  try {
    const address3 = await client.getEnsAddress({ name, coinType: BigInt(collections[chain2].ensCoinType) });
    const normalized = address3 ? getAddress(address3) : null;
    forwardCache.set(key, { address: normalized, expiresAt: Date.now() + (normalized ? successTtlMs : negativeTtlMs) });
    return normalized;
  } catch (error) {
    throw new EnsUnavailableError(error instanceof Error ? error.message : String(error));
  }
}
async function resolveOwner(input, chains2, client) {
  const candidate = input.trim();
  if (isAddress(candidate)) {
    const address3 = getAddress(candidate);
    return { input, normalizedName: null, addresses: Object.fromEntries(chains2.map((chain2) => [chain2, address3])) };
  }
  const name = normalizeOwnerName(candidate);
  const values = await Promise.all(chains2.map(async (chain2) => [chain2, await resolveEnsAddress(name, chain2, client)]));
  return { input, normalizedName: name, addresses: Object.fromEntries(values.filter((entry) => entry[1] !== null)) };
}

// lib/api/visibility.ts
import { getAddress as getAddress2, verifyTypedData } from "viem";
var visibilitySignatureTtlSeconds = 300;
var visibilityDomainName = "Yunipals NFT Visibility";
var visibilityDomainVersion = "1";
var visibilityTypes = {
  SetTokenVisibility: [
    { name: "owner", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "lifecycle", type: "uint256" },
    { name: "ownershipTransactionHash", type: "bytes32" },
    { name: "ownershipLogIndex", type: "uint256" },
    { name: "hidden", type: "bool" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" }
  ]
};
function visibilityTypedData(collection, message) {
  const definition = collections[collection];
  return {
    domain: {
      name: visibilityDomainName,
      version: visibilityDomainVersion,
      chainId: definition.chainId,
      verifyingContract: getAddress2(definition.address)
    },
    types: visibilityTypes,
    primaryType: "SetTokenVisibility",
    message: {
      owner: getAddress2(message.owner),
      tokenId: BigInt(message.tokenId),
      lifecycle: BigInt(message.lifecycle),
      ownershipTransactionHash: message.ownershipTransactionHash,
      ownershipLogIndex: BigInt(message.ownershipLogIndex),
      hidden: message.hidden,
      nonce: BigInt(message.nonce),
      deadline: BigInt(message.deadline)
    }
  };
}
async function verifyVisibilitySignature(collection, message, signature) {
  return verifyTypedData({ address: getAddress2(message.owner), ...visibilityTypedData(collection, message), signature });
}
function visibilitySigningDataJson(collection, message) {
  const typedData = visibilityTypedData(collection, message);
  return {
    ...typedData,
    message: {
      ...message,
      owner: getAddress2(message.owner)
    }
  };
}

// lib/api/server.ts
init_request_snapshot();

// lib/api/visibility-query.ts
var activeVisibilityRowPredicate = (tokenAlias = "t", visibilityAlias = "visibility") => `(
  ${visibilityAlias}.owner=lower(${tokenAlias}.owner)
  AND ${visibilityAlias}.lifecycle=${tokenAlias}.lifecycle
  AND EXISTS (
    SELECT 1 FROM ${ponderSchema}.transfer_event visibility_anchor
    WHERE visibility_anchor.id=${visibilityAlias}.anchor_event_id
      AND visibility_anchor.collection=${tokenAlias}.collection
      AND visibility_anchor.token_id=${tokenAlias}.token_id
      AND visibility_anchor.lifecycle=${tokenAlias}.lifecycle
  )
  AND NOT EXISTS (
    SELECT 1 FROM ${ponderSchema}.transfer_event visibility_change
    WHERE visibility_change.collection=${tokenAlias}.collection
      AND visibility_change.token_id=${tokenAlias}.token_id
      AND visibility_change.lifecycle=${tokenAlias}.lifecycle
      AND visibility_change.from<>visibility_change.to
      AND (visibility_change.block_number, visibility_change.transaction_index, visibility_change.log_index)
        > (${visibilityAlias}.anchor_block, ${visibilityAlias}.anchor_transaction_index, ${visibilityAlias}.anchor_log_index)
  )
)`;
var activeVisibilityPredicate = (tokenAlias = "t", bounded = false) => `EXISTS (
  SELECT 1 FROM metadata.token_visibility visibility
  WHERE visibility.collection=${tokenAlias}.collection
  AND visibility.token_id=${tokenAlias}.token_id::numeric
  AND ${activeVisibilityRowPredicate(tokenAlias)}
  ${bounded ? "OFFSET 0" : ""}
)`;

// lib/api/cached-exact-count.ts
function cachedExactCountSql(input) {
  const fresh = readCacheFreshSql(input.generation, input.chains);
  const generation = `${input.generation}::bigint`;
  const memberFilters = input.filters.map(
    (filter) => filter.replaceAll("t.collection", "s.collection").replace(
      /COALESCE\(s\.metadata_available,\s*false\)/g,
      "s.metadata_available"
    )
  );
  const total = `(SELECT count(*) FROM metadata_projection.read_member s
    WHERE s.generation_id=${generation} AND ${memberFilters.join(" AND ")})`;
  const hidden = input.relations.map(
    (relation) => `EXISTS(SELECT 1 FROM ${relation} t
    JOIN LATERAL (SELECT * FROM metadata_projection.read_member member
      WHERE member.generation_id=${generation} AND member.collection=t.collection
        AND member.token_id=t.token_id::numeric AND member.lifecycle=t.lifecycle OFFSET 0) s ON true
    WHERE t.collection=visibility.collection AND t.token_id::numeric=visibility.token_id
      AND ${activeVisibilityRowPredicate("t")} AND ${input.filters.join(" AND ")} OFFSET 0)`
  );
  return `SELECT CASE WHEN ${fresh} THEN (${total} -
    (SELECT count(*) FROM metadata.token_visibility visibility WHERE ${hidden.join(" OR ")}))::int
    ELSE (SELECT total FROM (${input.fallback}) original_count) END AS total`;
}

// lib/api/exact-count-cache.ts
var ExactCountCache = class {
  constructor(ttlMs = 15e3, maxEntries = 1e3, maxPending = 4) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.maxPending = maxPending;
  }
  values = /* @__PURE__ */ new Map();
  pending = /* @__PURE__ */ new Map();
  async get(key, load) {
    const now = Date.now();
    const cached2 = this.values.get(key);
    if (cached2 && cached2.expiresAt > now) {
      this.values.delete(key);
      this.values.set(key, cached2);
      return { value: cached2.value, hit: true };
    }
    if (cached2) this.values.delete(key);
    const existing = this.pending.get(key);
    if (existing) return { value: await existing, hit: true };
    if (this.pending.size >= this.maxPending)
      throw Object.assign(new Error("exact_count_capacity"), { code: "53300" });
    const promise = load();
    this.pending.set(key, promise);
    try {
      const value = await promise;
      this.values.set(key, { value, expiresAt: Date.now() + this.ttlMs });
      while (this.values.size > this.maxEntries)
        this.values.delete(this.values.keys().next().value);
      return { value, hit: false };
    } finally {
      this.pending.delete(key);
    }
  }
};

// lib/api/rarity-page-query.ts
function rarityPageQueries(query) {
  const score = query.sort.startsWith("rarity-capped") ? "rarity_points_capped" : "rarity_points";
  const direction = query.sort.endsWith("desc") ? "DESC" : "ASC";
  const limit = `$${query.values.length}`;
  const rankedSource = (relation) => `${query.rawSearch} s
    JOIN LATERAL (SELECT current.* FROM ${relation} current
      WHERE current.collection=s.collection AND current.token_id=s.token_id::text
        AND current.lifecycle=s.lifecycle OFFSET 0) t ON true
    JOIN LATERAL (SELECT 1 FROM ${query.validatedSearch} validated
      WHERE validated.collection=s.collection AND validated.token_id=s.token_id
        AND validated.lifecycle=s.lifecycle OFFSET 0) proof ON true`;
  const pointSource = (relation) => `${query.selectiveTokens?.(relation) ?? relation} t
    LEFT JOIN LATERAL (SELECT * FROM ${query.validatedSearch} validated
      WHERE validated.collection=t.collection AND validated.token_id=t.token_id::numeric
        AND validated.lifecycle=t.lifecycle OFFSET 0) s ON true`;
  const rankedOrder = `s.${score} ${direction} NULLS LAST, s.token_id ASC, s.collection ASC`;
  const tokenOrder = "t.token_id::numeric ASC, t.collection ASC";
  const rawFilters = (filters) => filters.map(
    (filter) => filter.replace(
      /COALESCE\(s\.metadata_available,\s*false\)\s*=\s*(\$\d+)/g,
      "(s.metadata_available=$1 OR (s.metadata_available IS NULL AND NOT $1))"
    )
  );
  const cursorTypes = query.cursor ? `WITH page_cursor AS (SELECT
    ${query.cursor.rarity === null ? "" : `$${query.values.length - 3}::numeric AS rarity,`}
    $${query.values.length - 2}::numeric AS token_id,$${query.values.length - 1}::text AS collection) ` : "";
  const merge = (branches, ranked) => `${cursorTypes}SELECT * FROM (
    ${branches.map((branch) => `(${branch})`).join(" UNION ALL ")}
  ) merged ORDER BY ${ranked ? `${score} ${direction} NULLS LAST,` : ""}
    token_id::numeric ASC, collection ASC LIMIT ${limit}`;
  const nonnull = query.relations.map((relation) => {
    const filters = query.cursorFilters.map(
      (filter) => filter.replace(`OR s.${score} IS NULL OR`, "OR")
    );
    filters.push(`s.${score} IS NOT NULL`);
    if (!query.selective) {
      for (let i = 0; i < filters.length; i++)
        filters[i] = filters[i].replaceAll(
          /\bt\.token_id::numeric\b/g,
          "s.token_id"
        ).replaceAll(/\bt\.collection\b/g, "s.collection");
      filters.push("s.collection=ANY($1::text[])");
      if (query.cursor?.rarity !== void 0 && query.cursor.rarity !== null)
        filters.push(
          `s.${score}${direction === "DESC" ? "<=" : ">="}$${query.values.length - 3}::numeric`
        );
    }
    const order = query.selective ? `s.${score} ${direction} NULLS LAST, ${tokenOrder}` : rankedOrder;
    return `SELECT ${query.columns} FROM ${query.selective ? pointSource(relation) : rankedSource(relation)}
      WHERE ${(query.selective ? filters : rawFilters(filters)).join(" AND ")} ORDER BY ${order} LIMIT ${limit}`;
  });
  const nullFilters = [...query.filters];
  if (query.cursor?.rarity === null) {
    nullFilters.push(`(t.token_id::numeric>$${query.values.length - 2}::numeric OR
      (t.token_id::numeric=$${query.values.length - 2}::numeric AND t.collection>$${query.values.length - 1}))`);
  }
  const nulls = query.relations.flatMap((relation) => {
    if (query.selective)
      return [
        `SELECT ${query.columns} FROM ${pointSource(relation)}
      WHERE ${[...nullFilters, `s.${score} IS NULL`].join(" AND ")}
      ORDER BY ${tokenOrder} LIMIT ${limit}`
      ];
    const known = `SELECT ${query.columns} FROM ${rankedSource(relation)}
      WHERE ${rawFilters([...nullFilters, "s.collection=ANY($1::text[])", `s.${score} IS NULL`]).join(" AND ")}
      ORDER BY s.token_id ASC,s.collection ASC LIMIT ${limit}`;
    const cached2 = query.missingKeys?.(relation);
    const missing2 = `WITH validated_keys AS MATERIALIZED (SELECT collection,token_id,lifecycle FROM ${query.bulkSearch(relation)})
      SELECT ${query.columns} FROM ${relation} t CROSS JOIN
        (SELECT false AS metadata_available,NULL::numeric AS rarity_points,NULL::numeric AS rarity_points_capped) s
      WHERE ${cached2 ? `NOT ${cached2.fresh} AND ` : ""}${nullFilters.join(" AND ")} AND NOT EXISTS(SELECT 1 FROM validated_keys valid
        WHERE valid.collection=t.collection AND valid.token_id=t.token_id::numeric AND valid.lifecycle=t.lifecycle)
      ORDER BY ${tokenOrder} LIMIT ${limit}`;
    const indexedMissing = cached2 ? `SELECT ${query.columns} FROM ${cached2.relation} cache_key
      JOIN LATERAL (SELECT current.* FROM ${relation} current
        WHERE current.collection=cache_key.collection AND current.token_id=cache_key.token_id::text
          AND current.lifecycle=cache_key.lifecycle OFFSET 0) t ON true
      CROSS JOIN (SELECT false AS metadata_available,NULL::numeric AS rarity_points,NULL::numeric AS rarity_points_capped) s
      WHERE ${cached2.fresh} AND ${nullFilters.join(" AND ")}
      ORDER BY cache_key.token_id ASC,cache_key.collection ASC LIMIT ${limit}` : void 0;
    return query.missingExcluded ? [known] : [known, ...indexedMissing ? [indexedMissing] : [], missing2];
  });
  return {
    nonnull: query.cursor?.rarity === null ? null : merge(nonnull, true),
    nulls: query.nullsExcluded ? null : merge(nulls, false)
  };
}

// lib/api/trait-count-query.ts
function traitCountQuery(input) {
  const rawMatches = input.traitFilters.slice(1).map(
    (filter) => `EXISTS(SELECT 1 FROM ${input.rawTraits} other
      WHERE other.collection=f.collection AND other.token_id=f.token_id
        AND other.lifecycle=f.lifecycle AND other.trait_type=$${filter.type}
        AND other.value=ANY($${filter.values}::text[]))`
  );
  const first = input.traitFilters[0];
  const rawKeys = `raw_trait_keys AS MATERIALIZED (
    SELECT DISTINCT f.collection,f.token_id,f.lifecycle FROM ${input.rawTraits} f
    WHERE f.collection='${input.chain}' AND f.trait_type=$${first.type}
      AND f.value=ANY($${first.values}::text[]) AND ${rawMatches.join(" AND ")})`;
  const keys2 = input.traitFilters.slice(0, 1).map(
    (filter, index) => `trait_keys_${index} AS MATERIALIZED (
      SELECT DISTINCT f.collection,f.token_id,f.lifecycle FROM ${input.traits} f
      WHERE f.collection='${input.chain}' AND f.trait_type=$${filter.type}
        AND f.value=ANY($${filter.values}::text[])
        ${rawMatches.length ? `AND EXISTS(SELECT 1 FROM raw_trait_keys raw WHERE raw.collection=f.collection AND raw.token_id=f.token_id AND raw.lifecycle=f.lifecycle)` : ""})`
  );
  const matches = input.traitFilters.slice(0, 1).map(
    (_, index) => `EXISTS(SELECT 1 FROM trait_keys_${index} f
      WHERE f.collection=t.collection AND f.token_id=t.token_id::numeric
        AND f.lifecycle=t.lifecycle)`
  );
  return `WITH ${[...rawMatches.length ? [rawKeys] : [], ...keys2].join(", ")}
    SELECT count(*)::bigint AS total FROM ${input.source}
    WHERE ${[`t.collection='${input.chain}'`, ...input.filters, ...matches].join(" AND ")}`;
}

// lib/api/chains.ts
function chainSelection(url) {
  const values = new URL(url).searchParams.getAll("chain");
  if (values.some((value) => !collectionSlugs.includes(value))) return void 0;
  const chains2 = values.length ? collectionSlugs.filter((slug) => values.includes(slug)) : [...collectionSlugs];
  return {
    chains: chains2,
    chain: chains2.length === 1 ? chains2[0] : null,
    scope: chains2.length === collectionSlugs.length ? "all" : chains2.join("+")
  };
}
var chainSelectionJson = ({ chain: chain2, chains: chains2 }) => ({ chain: chain2, chains: chains2 });

// lib/api/collector-routes.ts
init_request_snapshot();

// lib/api/collector-query.ts
import { createHash as createHash3 } from "node:crypto";

// lib/api/collector-filters.ts
var isIndexedChain = (value) => collectionSlugs.some((chain2) => chain2 === value);
var collectorSorts = [
  "rarity-capped-desc",
  "rarity-capped-asc"
];
var defaultCollectorFilters = {
  chains: [],
  types: [],
  colors: [],
  rarityMin: "",
  rarityMax: "",
  search: "",
  sort: "rarity-capped-desc"
};
function normalizeRarityBound(value) {
  const bound = value.trim();
  if (!bound) return "";
  if (!/^\d{1,80}(?:\.\d{1,30})?$/.test(bound)) {
    throw new Error(
      "Rarity scores must be non-negative numbers with up to 30 decimal places."
    );
  }
  const [rawInteger, rawFraction = ""] = bound.split(".");
  const integer = rawInteger.replace(/^0+(?=\d)/, "");
  const fraction = rawFraction.replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : integer;
}
function compareDecimalStrings(left, right) {
  const [leftInteger, leftFraction = ""] = left.split(".");
  const [rightInteger, rightFraction = ""] = right.split(".");
  if (leftInteger.length !== rightInteger.length)
    return leftInteger.length - rightInteger.length;
  const integerOrder = leftInteger.localeCompare(rightInteger);
  if (integerOrder) return integerOrder;
  const width = Math.max(leftFraction.length, rightFraction.length);
  return leftFraction.padEnd(width, "0").localeCompare(rightFraction.padEnd(width, "0"));
}
function normalizeCollectorRarityRange(minimum, maximum) {
  const rarityMin = normalizeRarityBound(minimum);
  const rarityMax = normalizeRarityBound(maximum);
  if (rarityMin && rarityMax && compareDecimalStrings(rarityMin, rarityMax) > 0)
    throw new Error("Minimum rarity cannot be greater than maximum rarity.");
  return { rarityMin, rarityMax };
}
function traitValues(params, name) {
  const values = [...new Set(params.getAll(name).map((value) => value.trim()))];
  if (values.length > 20 || values.some((value) => !value || value.length > 80)) {
    throw new Error("Choose up to 20 values for each trait.");
  }
  return values.sort();
}
function normalizeCollectorSearch(value) {
  const search = value.trim();
  if (search.length > 80)
    throw new Error("Search must be 80 characters or fewer.");
  if (/^#?\d+$/.test(search)) {
    const tokenId = BigInt(search.replace(/^#/, ""));
    if (tokenId >= 2n ** 256n) throw new Error("Enter a valid token ID.");
    return tokenId.toString();
  }
  if (search.startsWith("#"))
    throw new Error("Enter a numeric token ID after #.");
  if (search.length === 1)
    throw new Error("Enter at least two letters for a name.");
  return search.toLowerCase();
}
function parseCollectorFilters(params) {
  const selected2 = [...new Set(params.getAll("chain"))];
  if (selected2.some((chain2) => !isIndexedChain(chain2))) {
    throw new Error("Choose a supported chain.");
  }
  const chains2 = collectionSlugs.filter((chain2) => selected2.includes(chain2));
  const sorts2 = params.getAll("sort");
  const searches = params.getAll("q");
  const rarityMins = params.getAll("rarityMin");
  const rarityMaxes = params.getAll("rarityMax");
  const sort = sorts2[0] ?? defaultCollectorFilters.sort;
  if (sorts2.length > 1 || !collectorSorts.some((option) => option === sort)) {
    throw new Error("Choose a supported rarity sort.");
  }
  if (searches.length > 1) throw new Error("Enter one search term.");
  if (rarityMins.length > 1 || rarityMaxes.length > 1)
    throw new Error("Enter one minimum and maximum rarity score.");
  const rarityRange = normalizeCollectorRarityRange(
    rarityMins[0] ?? "",
    rarityMaxes[0] ?? ""
  );
  return {
    chains: chains2.length === collectionSlugs.length ? [] : chains2,
    types: traitValues(params, "t.Type"),
    colors: traitValues(params, "t.Color"),
    ...rarityRange,
    search: normalizeCollectorSearch(searches[0] ?? ""),
    sort
  };
}
function serializeCollectorFilters(filters) {
  const params = new URLSearchParams();
  filters.chains.forEach((chain2) => params.append("chain", chain2));
  filters.types.forEach((value) => params.append("t.Type", value));
  filters.colors.forEach((value) => params.append("t.Color", value));
  if (filters.rarityMin) params.set("rarityMin", filters.rarityMin);
  if (filters.rarityMax) params.set("rarityMax", filters.rarityMax);
  if (filters.search) params.set("q", filters.search);
  params.set("sort", filters.sort);
  return params;
}
function collectorFiltersKey(filters) {
  return serializeCollectorFilters(
    parseCollectorFilters(serializeCollectorFilters(filters))
  ).toString();
}

// lib/api/collector-query.ts
var CollectorQueryError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
function parseCollectorRequest(params) {
  try {
    const allowed = /* @__PURE__ */ new Set([
      "chain",
      "t.Type",
      "t.Color",
      "rarityMin",
      "rarityMax",
      "sort",
      "q",
      "visibility",
      "limit",
      "cursor"
    ]);
    for (const key of params.keys())
      if (!allowed.has(key)) throw new Error(`Unsupported filter: ${key}`);
    for (const key of ["visibility", "limit", "cursor"]) {
      if (params.getAll(key).length > 1)
        throw new Error(`Use one ${key} value.`);
    }
    const filters = parseCollectorFilters(params);
    const visibility = params.get("visibility") ?? "visible";
    if (visibility !== "visible" && visibility !== "hidden")
      throw new Error("Invalid visibility.");
    const rawLimit = params.get("limit") ?? "24";
    if (!/^\d+$/.test(rawLimit)) throw new Error("Invalid page size.");
    const limit = Number(rawLimit);
    if (limit < 1 || limit > 48)
      throw new Error("Page size must be between 1 and 48.");
    return {
      filters,
      chains: filters.chains.length ? filters.chains : [...collectionSlugs],
      visibility,
      limit,
      rawCursor: params.get("cursor")
    };
  } catch (error) {
    throw new CollectorQueryError(
      "invalid_collector_query",
      error instanceof Error ? error.message : "Invalid filters."
    );
  }
}
function collectorQuery(request, owner, now = Date.now()) {
  const { filters, chains: chains2, visibility, limit } = request;
  const query = collectorFiltersKey(filters);
  const owners = chains2.flatMap(
    (chain2) => owner.addresses[chain2] ? [[chain2, owner.addresses[chain2].toLowerCase()]] : []
  );
  const config = createHash3("sha256").update(JSON.stringify(ownershipReadConfig.releaseId ? [1, owners, visibility, query, limit, ownershipReadConfig.releaseId] : [1, owners, visibility, query, limit])).digest("hex");
  let cursor;
  if (request.rawCursor !== null) {
    try {
      if (!request.rawCursor || request.rawCursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(request.rawCursor))
        throw new Error();
      const value = JSON.parse(
        Buffer.from(request.rawCursor, "base64url").toString()
      );
      if (value.v !== 1 || value.config !== config || !chains2.includes(value.chain) || typeof value.tokenId !== "string" || !/^\d{1,78}$/.test(value.tokenId) || BigInt(value.tokenId) >= 2n ** 256n || value.rarity !== null && (typeof value.rarity !== "string" || !/^\d{1,80}(\.\d{1,30})?$/.test(value.rarity)) || !["next", "previous"].includes(value.direction) || !Number.isSafeInteger(value.expires) || value.expires <= now || value.expires > now + 15 * 6e4)
        throw new Error();
      cursor = value;
    } catch {
      throw new CollectorQueryError(
        "invalid_collector_cursor",
        "This page has expired or belongs to different filters. Start from the first page."
      );
    }
  }
  const previous = cursor?.direction === "previous";
  const values = [];
  const bind = (value) => {
    values.push(value);
    return `$${values.length}`;
  };
  const branches = owners.map(([chain2, address3]) => {
    const relation = chain2 === "bnb" ? ownershipBnbSchema : ownershipPonderSchema;
    const ownerParam = bind(address3);
    const chainParam = bind(chain2);
    const tokenParam = /^\d+$/.test(filters.search) ? ` AND t.token_id=${bind(filters.search)}` : "";
    return `SELECT t.collection,t.chain_id,t.contract_address,t.token_id,t.owner,t.burned,t.lifecycle,t.mint_block,t.last_transfer_block
      FROM ${relation}.token t WHERE t.owner=${ownerParam} AND t.collection=${chainParam} AND NOT t.burned${tokenParam}${visibility === "hidden" ? ` AND t.token_id IN (SELECT token_id::text FROM metadata.token_visibility WHERE collection=${chainParam} AND owner=${ownerParam})` : ""}`;
  });
  if (!branches.length)
    throw new CollectorQueryError(
      "invalid_collector_query",
      "No resolved owner on the selected chains."
    );
  const rarity = "COALESCE(s.rarity_points_capped,s.rarity_points)";
  const hidden = activeVisibilityPredicate("t", true);
  const where = [];
  const visibleWhere = visibility === "visible" ? `NOT ${hidden}` : hidden;
  for (const [trait, selected2] of [
    ["Type", filters.types],
    ["Color", filters.colors]
  ]) {
    if (selected2.length)
      where.push(
        `EXISTS (SELECT 1 FROM ${metadataTraitReadRelation} f WHERE f.collection=t.collection AND f.token_id=t.token_id::numeric AND f.lifecycle=t.lifecycle AND f.trait_type=${bind(trait)} AND f.value=ANY(${bind(selected2)}::text[]) AND f.collection=ANY(${bind(chains2)}::text[]))`
      );
  }
  if (filters.search && !/^\d+$/.test(filters.search)) {
    const prefix = filters.search.replace(/[\\%_]/g, "\\$&") + "%";
    where.push(
      `EXISTS (SELECT 1 FROM ${metadataReadRelation} n WHERE n.collection=t.collection AND n.token_id=t.token_id::numeric AND n.lifecycle=t.lifecycle AND lower(n.name) LIKE ${bind(prefix)} ESCAPE E'\\\\' AND n.collection=ANY(${bind(chains2)}::text[]))`
    );
  }
  if (filters.rarityMin)
    where.push(`${rarity} >= ${bind(filters.rarityMin)}::numeric`);
  if (filters.rarityMax)
    where.push(`${rarity} <= ${bind(filters.rarityMax)}::numeric`);
  const ascending = filters.sort.endsWith("-asc");
  if (cursor) {
    const id = bind(cursor.tokenId);
    const chain2 = bind(cursor.chain);
    const tie = `(t.token_id::numeric,t.collection) ${previous ? "<" : ">"} (${id}::numeric,${chain2}::text)`;
    if (cursor.rarity === null) {
      where.push(
        previous ? `(${rarity} IS NOT NULL OR (${rarity} IS NULL AND ${tie}))` : `(${rarity} IS NULL AND ${tie})`
      );
    } else {
      const score = bind(cursor.rarity);
      const op = ascending !== previous ? ">" : "<";
      where.push(
        `(${rarity} ${op} ${score}::numeric OR (${rarity}=${score}::numeric AND ${tie})${previous ? "" : ` OR ${rarity} IS NULL`})`
      );
    }
  }
  const rarityDirection = ascending !== previous ? "ASC" : "DESC";
  const tieDirection = previous ? "DESC" : "ASC";
  const nulls = previous ? "FIRST" : "LAST";
  const candidateLimit = bind(limit + 1);
  const overfetch = visibility === "visible" ? `${candidateLimit} + (SELECT count(*) FROM metadata.token_visibility WHERE owner=ANY(${bind(owners.map(([, address3]) => address3))}::text[]))` : candidateLimit;
  const text = `WITH owned AS MATERIALIZED (${branches.join(" UNION ALL ")}), ranked AS (
    SELECT t.*,s.metadata_available,s.rarity_points,s.rarity_points_capped,${rarity} AS effective_rarity
    FROM owned t LEFT JOIN LATERAL (SELECT s.metadata_available,s.rarity_points,s.rarity_points_capped FROM ${metadataSearchReadRelation} s WHERE s.collection=t.collection AND s.token_id=t.token_id::numeric AND s.lifecycle=t.lifecycle OFFSET 0) s ON true
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
  ), candidates AS MATERIALIZED (
    SELECT t.* FROM (SELECT * FROM ranked ORDER BY effective_rarity ${rarityDirection} NULLS ${nulls},token_id::numeric ${tieDirection},collection ${tieDirection} LIMIT ${visibility === "visible" ? overfetch : "ALL"} OFFSET 0) t WHERE ${visibleWhere} LIMIT ${candidateLimit}
  ) SELECT c.collection AS chain,c.chain_id AS "chainId",c.contract_address AS "contractAddress",c.token_id AS "tokenId",
    c.owner,c.burned,c.lifecycle,c.mint_block::text AS "mintBlock",c.last_transfer_block::text AS "lastTransferBlock",
    m.name,m.image,m.attributes,m.token_uri AS "tokenUri",COALESCE(c.metadata_available,false) AS "metadataAvailable",
    c.rarity_points::text AS "rarityPoints",c.rarity_points_capped::text AS "rarityPointsCapped",${visibility === "hidden"} AS hidden
    FROM candidates c LEFT JOIN LATERAL (SELECT * FROM ${metadataReadRelation} page_metadata WHERE page_metadata.collection=c.collection AND page_metadata.token_id=c.token_id::numeric AND page_metadata.lifecycle=c.lifecycle OFFSET 0) m ON true
    ORDER BY c.effective_rarity ${rarityDirection} NULLS ${nulls},c.token_id::numeric ${tieDirection},c.collection ${tieDirection}`;
  const encode2 = (row, direction) => Buffer.from(
    JSON.stringify({
      v: 1,
      config,
      direction,
      expires: cursor?.expires ?? now + 15 * 6e4,
      chain: row.chain,
      tokenId: row.tokenId,
      rarity: row.rarityPointsCapped ?? row.rarityPoints
    })
  ).toString("base64url");
  return {
    text,
    values,
    page(rows) {
      const more = rows.length > limit;
      const items = rows.slice(0, limit);
      if (previous) items.reverse();
      return {
        version: 1,
        query,
        items,
        nextCursor: items.length && (previous ? Boolean(cursor) : more) ? encode2(items[items.length - 1], "next") : null,
        previousCursor: items.length && (previous ? more : Boolean(cursor)) ? encode2(items[0], "previous") : null
      };
    }
  };
}

// lib/api/collector-routes.ts
function registerCollectorRoutes(app2, dependencies) {
  const enabled = dependencies.enabled ?? (() => process.env.API_COLLECTOR_FILTERS_ENABLED === "true");
  const nameSearchEnabled = dependencies.nameSearchEnabled ?? (() => process.env.API_COLLECTOR_NAME_SEARCH_ENABLED === "true");
  const rarityRangeEnabled = dependencies.rarityRangeEnabled ?? (() => process.env.API_COLLECTOR_RARITY_RANGE_ENABLED === "true");
  app2.get(
    "/v1/collector-capabilities",
    (c) => c.json({
      version: enabled() ? 1 : 0,
      namePrefixSearch: enabled() && nameSearchEnabled(),
      rarityRange: enabled() && rarityRangeEnabled()
    })
  );
  app2.get("/v2/owners/:address/tokens", async (c) => {
    if (!enabled())
      return c.json({ error: "collector_filters_unavailable" }, 503);
    try {
      const request = parseCollectorRequest(new URL(c.req.url).searchParams);
      if (request.filters.search && !/^\d+$/.test(request.filters.search) && !nameSearchEnabled()) {
        throw new CollectorQueryError(
          "invalid_collector_query",
          "Name search is not available. Search by token ID instead."
        );
      }
      if ((request.filters.rarityMin || request.filters.rarityMax) && !rarityRangeEnabled()) {
        throw new CollectorQueryError(
          "invalid_collector_query",
          "Rarity range filtering is not available."
        );
      }
      const owner = await dependencies.resolveOwner(
        c.req.param("address"),
        request.chains
      );
      const readiness = await dependencies.checkReadiness(request.chains);
      if (!readiness.ready)
        return c.json(
          { error: "ownership_rebuilding", ownership: readiness },
          503
        );
      const statement = collectorQuery(request, owner);
      const started = performance.now();
      const rows = await apiReadTransaction(
        dependencies.pool,
        async (client) => {
          await client.query("SET LOCAL statement_timeout = '1000ms'");
          await client.query("SET LOCAL jit = off");
          await client.query("SET LOCAL work_mem = '16MB'");
          await assertOwnershipAvailable(client, request.chains);
          return (await client.query(statement.text, statement.values)).rows;
        }
      );
      c.header(
        "Server-Timing",
        `page;dur=${(performance.now() - started).toFixed(1)}`
      );
      c.header("Cache-Control", "no-store");
      return c.json({
        owner: request.chains.map((chain2) => owner.addresses[chain2]).find(Boolean)?.toLowerCase(),
        ownerInput: owner.input,
        ownerName: owner.normalizedName,
        resolvedAddresses: owner.addresses,
        chains: request.chains,
        chain: request.chains.length === 1 ? request.chains[0] : null,
        visibility: request.visibility,
        ...statement.page(rows)
      });
    } catch (error) {
      if (error instanceof CollectorQueryError)
        return c.json(
          { error: error.code, message: error.message },
          error.code === "invalid_collector_cursor" ? 409 : 400
        );
      throw error;
    }
  });
}

// lib/api/islands-routes.ts
import { createHash as createHash4 } from "node:crypto";
import { Hono as Hono2 } from "hono";
import { isAddress as isAddress2 } from "viem";

// lib/islands/collections.ts
var legacyBaseIslandCollection = {
  slug: "base-islands",
  chain: "base",
  chainId: 8453,
  address: "0x1058f1a6fedcaec94e488d6ec3c639e541faf066",
  deploymentBlock: 49650128,
  name: "Grassland Archipelago",
  genesisLimit: 1e3,
  origin: "airdrop",
  metadataMode: "fixed",
  schemaName: "yunipals_base_islands_v1"
};
var baseIslandCollection2 = {
  ...legacyBaseIslandCollection,
  ...baseIslandCollection,
  metadataMode: "token",
  schemaName: "yunipals_base_islands_v2"
};
var baseIslandReadSchema = () => unifiedOwnershipReads ? ownershipReadConfig.readSchema : baseIslandCollection2.schemaName;
var ethereumIslandCollection = {
  ...islandCollection,
  origin: "original",
  metadataMode: "storage"
};

// lib/islands/base-readiness.ts
async function baseIslandsReadiness(pool2) {
  if (unifiedOwnershipReads) {
    const source = await unifiedOwnershipStatus(pool2, [
      baseIslandCollection2.slug
    ]);
    const status = source.collections[0];
    return {
      ready: status.available,
      indexedBlock: status.block_number ?? null,
      verifiedBlock: status.block_number ?? null,
      reason: status.reason,
      source
    };
  }
  const schema = sqlIdentifier(baseIslandCollection2.schemaName);
  const result = await pool2.query(`SELECT ready AND verified_block IS NOT NULL AND
    last_scanned_block>=verified_block AND completed_at>now()-interval '15 minutes'
    AND completed_at<=now() AS ready,
    last_scanned_block::text AS "indexedBlock",verified_block::text AS "verifiedBlock",
    finalized_block::text AS "finalizedBlock",updated_at AS "updatedAt",completed_at AS "completedAt",last_error AS reason,
    airdrop_finalized AS "airdropFinalized",contract_owner AS "contractOwner"
    FROM ${schema}.sync_state WHERE singleton`);
  return { ...result.rows[0], ready: result.rows[0]?.ready === true };
}

// lib/islands/queries.ts
function islandTokenRelation(schemaName) {
  const schema = sqlIdentifier(schemaName);
  return `${schema}.token t
    LEFT JOIN ${schema}.token_lifecycle l ON l.collection=t.collection
      AND l.token_id=t.token_id AND l.lifecycle=t.lifecycle
      AND l.mint_block=t.mint_block AND l.mint_timestamp=t.mint_timestamp
    LEFT JOIN ${schema}.transfer_event mint ON mint.collection=l.collection
      AND mint.token_id=l.token_id AND mint.lifecycle=l.lifecycle
      AND mint.transaction_hash=l.mint_transaction_hash AND mint.block_number=l.mint_block
      AND mint.chain_id=t.chain_id AND mint.contract_address=t.contract_address
      AND mint."to"=l.minted_to
      AND mint."from"='${ZERO_ADDRESS}'
    LEFT JOIN metadata.island_publication p ON p.collection=t.collection
      AND p.token_id=t.token_id::numeric AND p.lifecycle=t.lifecycle
      AND p.mint_transaction_hash=mint.transaction_hash AND p.mint_log_index=mint.log_index
    LEFT JOIN metadata_source.island_revision r ON r.revision_hash=p.revision_hash
      AND r.collection=t.collection AND r.token_id=t.token_id::numeric AND r.lifecycle=t.lifecycle
      AND r.mint_transaction_hash=mint.transaction_hash AND r.mint_log_index=mint.log_index`;
}
function islandColumns(collection = ethereumIslandCollection) {
  return `t.collection AS "collectionId",'${collection.chain}' AS chain,
  t.chain_id AS "chainId",t.contract_address AS "contractAddress",t.token_id AS "tokenId",
  CASE WHEN t.burned THEN NULL ELSE t.owner END AS owner,t.burned,t.lifecycle,
  t.mint_block::text AS "mintBlock",t.mint_timestamp::text AS "mintTimestamp",
  t.last_transfer_block::text AS "lastTransferBlock",
  t.last_transfer_timestamp::text AS "lastTransferTimestamp",
  t.last_transaction_hash AS "lastTransactionHash",
  CASE WHEN t.token_id::numeric<=${collection.genesisLimit} THEN 'Genesis' ELSE 'Personal' END AS edition,
  CASE WHEN p.status='published' THEN r.document END AS metadata,
  CASE WHEN p.status='retry' THEN 'retry' WHEN r.revision_hash IS NOT NULL THEN p.status ELSE 'pending' END AS "metadataStatus",
  NULL::numeric AS "rarityPoints",NULL::numeric AS "rarityPointsCapped",
  CASE WHEN p.status='published' AND r.revision_hash IS NOT NULL THEN
    jsonb_build_object('sourceKind','archive','tokenUri',r.token_uri,'sourceHash',r.source_hash,
      'contentHash',r.document_hash,'revisionHash',r.revision_hash,'rendererVersion',r.renderer_version,
      'uriBlock',r.uri_block::text,'uriBlockHash',r.uri_block_hash,'metadataStorage',r.metadata_storage,
      'checkedAt',p.uri_checked_at,'checkedBlock',p.uri_checked_block::text) END AS "metadataProvenance"`;
}
function islandIdentity(collection = ethereumIslandCollection) {
  return `t.collection='${collection.slug}'
  AND t.chain_id=${collection.chainId} AND t.contract_address='${collection.address}'`;
}
var islandTokenColumns = islandColumns();
var islandIdentityPredicate = islandIdentity();

// lib/islands/staking-read.ts
var islandStakingAddress = "0x6baad25b4807860e9fc3a0d2b6d1da4c895cfca8";
function stakingRelation(schemaName) {
  const schema = sqlIdentifier(schemaName);
  return `LEFT JOIN metadata.island_staking_scan ss ON ${stakingScanProof(schemaName, "ss")}
    LEFT JOIN metadata.island_staking_position sp ON sp.schema_name=ss.schema_name AND sp.build_id=ss.build_id
    AND sp.token_id=t.token_id AND sp.lifecycle=t.lifecycle AND NOT t.burned AND t.owner='${islandStakingAddress}'
    AND sp.deposit_event_id=(SELECT e.id FROM ${schema}.transfer_event e
      WHERE e.collection=t.collection AND e.token_id=t.token_id AND e.lifecycle=t.lifecycle
      AND e.chain_id=t.chain_id AND e.contract_address=t.contract_address
      ORDER BY e.block_number DESC,e.transaction_index DESC,e.log_index DESC LIMIT 1)`;
}
function stakingScanProof(schemaName, alias) {
  const schema = sqlIdentifier(schemaName);
  return unifiedOwnershipReads ? `${alias}.schema_name='${physicalPonderSchemaName}'
      AND to_jsonb(${alias})->>'ownership_release_id'='${ownershipReadConfig.releaseId}'
      AND to_jsonb(${alias})->>'ownership_read_identity'=(SELECT identity FROM ${schema}._unified_read_release WHERE singleton)
      AND ${alias}.build_id=(SELECT r.build_id FROM yunipals_indexer_control.release r
        JOIN ${schema}._unified_read_release marker ON marker.release_id=r.id AND marker.singleton
        WHERE r.id='${ownershipReadConfig.releaseId}' AND r.physical_schema='${physicalPonderSchemaName}')
      AND ${alias}.state='ready' AND ${alias}.verified_at>statement_timestamp()-interval '15 minutes'
      AND ${alias}.verified_at<=statement_timestamp()
      AND EXISTS(SELECT 1 FROM ${schema}.source_boundary('ethereum-islands') boundary
        JOIN ${sqlIdentifier(physicalPonderSchemaName)}.chain_block anchor
          ON anchor.chain_id=boundary.chain_id AND anchor.block_number=${alias}.block_number
          AND anchor.block_hash=${alias}.block_hash
        WHERE ${alias}.block_number<=boundary.block_number)` : `${alias}.schema_name='${schemaName}'
      AND ${alias}.build_id=(SELECT value->>'build_id' FROM ${schema}._ponder_meta WHERE key='app')
      AND ${alias}.state='ready' AND ${alias}.verified_at>now()-interval '15 minutes'
      AND ${alias}.verified_at<=now()`;
}
var stakingColumns = `jsonb_build_object(
  'status',CASE WHEN t.burned OR t.owner<>'${islandStakingAddress}' THEN 'none'
    WHEN sp.staker IS NOT NULL THEN 'staked' ELSE 'unverified' END,
  'staker',sp.staker,'contractAddress','${islandStakingAddress}',
  'checkedBlock',ss.block_number::text) AS staking`;
async function stakingReadiness(pool2, schemaName, enabled) {
  if (!enabled)
    return {
      enabled: false,
      ready: false,
      checkedBlock: null,
      reason: "disabled"
    };
  const schema = sqlIdentifier(schemaName);
  const scan = (await pool2.query(
    `SELECT ${stakingScanProof(schemaName, "s")}
    AND NOT EXISTS(SELECT 1 FROM ${schema}.token t ${stakingRelation(schemaName)}
      WHERE t.collection='${islandCollection.slug}' AND t.chain_id=1 AND t.contract_address='${islandCollection.address}'
      AND t.owner='${islandStakingAddress}' AND NOT t.burned AND (sp.token_id IS NULL OR sp.staker IS NULL))
    AS ready,s.block_number::text AS block
    FROM metadata.island_staking_scan s WHERE s.schema_name=$1`,
    [unifiedOwnershipReads ? physicalPonderSchemaName : schemaName]
  )).rows[0];
  return {
    enabled: true,
    ready: scan?.ready === true,
    checkedBlock: scan?.block ?? null,
    reason: scan?.ready ? null : "verification_unavailable"
  };
}

// lib/islands/read-model.ts
function islandReadModel(schemaName, collection, staking, airdrop) {
  const staked = staking && collection.slug === "ethereum-islands";
  let relation = `${islandTokenRelation(schemaName)} ${staked ? stakingRelation(schemaName) : ""}`;
  const counterpart = collection.slug === "base-islands-v2" ? ethereumIslandCollection : baseIslandCollection2;
  if (airdrop)
    relation += ` LEFT JOIN metadata.island_airdrop_origin origin ON origin.token_id=t.token_id
    LEFT JOIN LATERAL (SELECT mint.* FROM ${sqlIdentifier(legacyBaseIslandCollection.schemaName)}.transfer_event mint
      WHERE mint.collection='${legacyBaseIslandCollection.slug}' AND mint.chain_id=${legacyBaseIslandCollection.chainId}
      AND mint.contract_address='${legacyBaseIslandCollection.address}'
      AND mint.token_id=origin.token_id AND mint."to"=origin.recipient
      AND mint."from"='0x0000000000000000000000000000000000000000'
      ORDER BY mint.block_number,mint.transaction_index,mint.log_index LIMIT 1) base_mint ON true
    LEFT JOIN metadata.island_replacement_origin replacement ON replacement.token_id=t.token_id
    LEFT JOIN LATERAL (SELECT mint.* FROM ${sqlIdentifier(baseIslandReadSchema())}.transfer_event mint
      WHERE mint.collection='${baseIslandCollection2.slug}' AND mint.chain_id=${baseIslandCollection2.chainId}
      AND mint.contract_address='${baseIslandCollection2.address}'
      AND mint.token_id=replacement.token_id AND mint."to"=replacement.recipient
      AND mint."from"='0x0000000000000000000000000000000000000000'
      ORDER BY mint.block_number,mint.transaction_index,mint.log_index LIMIT 1) replacement_mint ON true`;
  const counterpartSql = airdrop ? `CASE WHEN base_mint.id IS NOT NULL AND replacement_mint.id IS NOT NULL THEN jsonb_build_object(
    'collectionId','${counterpart.slug}','chain','${counterpart.chain}','chainId',${counterpart.chainId},
    'contractAddress','${counterpart.address}','tokenId',t.token_id,
    'href','/collection/${counterpart.slug}/'||t.token_id) END` : "NULL::jsonb";
  const replacement = airdrop ? `CASE WHEN replacement_mint.id IS NOT NULL THEN jsonb_build_object(
    'sourceContract',replacement.source_contract,'snapshotBlock',replacement.snapshot_block::text,
    'snapshotBlockHash',replacement.snapshot_block_hash,'snapshotSha256',replacement.snapshot_sha256,
    'recipient',replacement.recipient,'distributionRoot',replacement.distribution_root,
    'mintTransactionHash',replacement_mint.transaction_hash,'mintBlock',replacement_mint.block_number::text) END` : "NULL::jsonb";
  const provenance = airdrop ? `CASE WHEN base_mint.id IS NOT NULL THEN jsonb_build_object(
    'snapshotBlock',origin.snapshot_block::text,'snapshotBlockHash',origin.snapshot_block_hash,
    'snapshotSha256',origin.snapshot_sha256,'sourceOwner',origin.source_owner,
    'recipient',origin.recipient,'mintTransactionHash',base_mint.transaction_hash,
    'mintBlock',base_mint.block_number::text) END` : "NULL::jsonb";
  return {
    relation,
    columns: `${islandColumns(collection)},
    ${staked ? stakingColumns : "NULL::jsonb AS staking"},'${collection.origin}' AS origin,
    ${counterpartSql} AS counterpart,${provenance} AS airdrop,${replacement} AS replacement`
  };
}

// lib/islands/metadata.ts
import { z as z6 } from "zod";
var rawDocumentSchema = z6.object({
  name: z6.string().trim().min(1),
  description: z6.string().optional(),
  image: z6.string().optional(),
  animation_url: z6.string().optional(),
  attributes: z6.array(
    z6.object({ trait_type: z6.string(), value: z6.unknown() }).passthrough()
  ).optional()
}).passthrough();
function canonicalTokenId(value) {
  return /^(0|[1-9]\d*)$/.test(value) && BigInt(value) < 2n ** 256n;
}

// lib/islands/readiness.ts
function ethereumCheckpointBlock(checkpoint) {
  if (typeof checkpoint !== "string" || !/^\d{75}$/.test(checkpoint) || BigInt(checkpoint.slice(10, 26)) !== 1n)
    return null;
  return BigInt(checkpoint.slice(26, 42));
}
async function islandsReadiness(pool2, schemaName) {
  const ownership = await chainReadiness(pool2, [islandCollection.slug]);
  if (unifiedOwnershipReads) {
    const source = await unifiedOwnershipStatus(pool2, [
      islandCollection.slug
    ]);
    const checkpoint2 = source.collections[0];
    const verified = (await pool2.query(
      `SELECT r.build_id,v.checkpoint_block::text AS verified_block FROM yunipals_indexer_control.release r
      LEFT JOIN metadata.island_verification v ON v.collection=$1 AND v.schema_name=$2 AND v.build_id=r.build_id WHERE r.id=$3`,
      [
        islandCollection.slug,
        physicalPonderSchemaName,
        ownershipReadConfig.releaseId
      ]
    )).rows[0];
    return {
      ready: ownership.ready && checkpoint2.available && verified?.verified_block !== null && verified?.verified_block !== void 0 && BigInt(checkpoint2.block_number) >= BigInt(verified.verified_block),
      indexedBlock: checkpoint2.block_number ?? null,
      verifiedBlock: verified?.verified_block ?? null,
      indexing: checkpoint2.available,
      buildId: verified?.build_id ?? null,
      ownership,
      source
    };
  }
  const schema = sqlIdentifier(schemaName);
  const checkpoint = (await pool2.query(
    `SELECT latest_checkpoint FROM ${schema}._ponder_checkpoint WHERE chain_id=1`
  )).rows[0]?.latest_checkpoint;
  const block = ethereumCheckpointBlock(checkpoint);
  const proof = (await pool2.query(
    `SELECT app.value->>'is_ready' AS ready,app.value->>'build_id' AS build_id,
      v.checkpoint_block::text AS verified_block FROM ${schema}._ponder_meta app
      LEFT JOIN metadata.island_verification v ON v.collection=$1 AND v.schema_name=$2
        AND v.build_id=app.value->>'build_id' WHERE app.key='app'`,
    [islandCollection.slug, schemaName]
  )).rows[0];
  const verifiedBlock = proof?.verified_block;
  const indexing = proof?.ready === "1";
  return {
    ready: ownership.ready && indexing && block !== null && verifiedBlock !== void 0 && verifiedBlock !== null && block >= BigInt(verifiedBlock),
    indexedBlock: block?.toString() ?? null,
    verifiedBlock: verifiedBlock ?? null,
    indexing,
    buildId: proof?.build_id ?? null,
    ownership
  };
}

// lib/api/islands-routes.ts
var encodeCursor = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
function decodeCursor(raw) {
  if (raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) return;
  try {
    const value = JSON.parse(
      Buffer.from(raw, "base64url").toString()
    );
    if (value.v === 1 && typeof value.scope === "string" && typeof value.tokenId === "string" && canonicalTokenId(value.tokenId))
      return value;
  } catch {
  }
}
function registerIslandsRoutes(app2, dependencies) {
  const { pool: pool2, schemaName } = dependencies;
  const collection = dependencies.collection ?? ethereumIslandCollection;
  const descriptor = {
    collectionId: collection.slug,
    chain: collection.chain,
    chainId: collection.chainId,
    contractAddress: collection.address,
    name: collection.name,
    deploymentBlock: String(collection.deploymentBlock),
    origin: collection.origin
  };
  const schema = sqlIdentifier(schemaName);
  if (unifiedOwnershipReads && schemaName !== ownershipReadConfig.readSchema)
    throw new Error(
      "Unified Islands routes require the selected logical schema."
    );
  const enabled = dependencies.enabled ?? (() => process.env.API_ISLANDS_ENABLED === "true");
  const checkReadiness = dependencies.checkReadiness ?? (() => collection.slug === "base-islands-v2" ? baseIslandsReadiness(pool2) : islandsReadiness(pool2, schemaName));
  const root = `/v2/collections/${collection.slug}`;
  const stakingEnabled = dependencies.stakingEnabled ?? (() => collection.slug === "ethereum-islands" && process.env.API_ISLAND_STAKING_ENABLED === "true");
  const model = async () => {
    let airdrop = dependencies.airdropEnabled?.() ?? process.env.API_BASE_ISLANDS_ENABLED === "true";
    if (airdrop && unifiedOwnershipReads) {
      const source = await unifiedOwnershipStatus(pool2, ["base-islands-v2"]);
      airdrop = source?.ready === true;
    }
    return islandReadModel(schemaName, collection, stakingEnabled(), airdrop);
  };
  const stakingStatus = () => collection.slug === "base-islands-v2" ? Promise.resolve({
    enabled: false,
    ready: true,
    checkedBlock: null,
    reason: null
  }) : stakingReadiness(pool2, schemaName, stakingEnabled());
  const router = new Hono2();
  router.onError(
    (_error, c) => c.json({ error: "islands_database_unavailable" }, 503)
  );
  router.get(
    "/indexing-status",
    async (c) => c.json({
      ...descriptor,
      enabled: enabled(),
      ...enabled() ? await checkReadiness() : { ready: false }
    })
  );
  router.use("*", async (c, next) => {
    if (unifiedOwnershipReads)
      c.header("X-Indexer-Release", ownershipReadConfig.releaseId);
    if (!enabled())
      return c.json(
        {
          error: "islands_reads_disabled",
          collectionId: collection.slug
        },
        503
      );
    if (unifiedOwnershipReads)
      await assertOwnershipAvailable(pool2, [collection.slug]);
    const readiness = await checkReadiness();
    if (!readiness.ready)
      return c.json(
        { error: "ownership_rebuilding", ...descriptor, readiness },
        503
      );
    await next();
  });
  router.get("/", (c) => c.json(descriptor));
  router.get("/staking-status", async (c) => c.json(await stakingStatus()));
  async function listTokens(url, pathOwner) {
    const allowed = /* @__PURE__ */ new Set([
      "limit",
      "cursor",
      "sort",
      "owner",
      "burned",
      "edition",
      "holding"
    ]);
    for (const key of url.searchParams.keys()) {
      if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1)
        return { error: "invalid_query", status: 400 };
    }
    const rawLimit = url.searchParams.get("limit") ?? "50";
    if (!/^[1-9]\d*$/.test(rawLimit) || Number(rawLimit) > 100)
      return { error: "invalid_limit", status: 400 };
    const limit = Number(rawLimit);
    const sort = url.searchParams.get("sort") ?? "token-id-asc";
    if (!["token-id-asc", "token-id-desc"].includes(sort))
      return { error: "invalid_sort", status: 400 };
    const burned = url.searchParams.get("burned") ?? "false";
    if (!["false", "true", "all"].includes(burned))
      return { error: "invalid_burned", status: 400 };
    const edition = url.searchParams.get("edition");
    if (edition !== null && !["Genesis", "Personal"].includes(edition))
      return { error: "invalid_edition", status: 400 };
    const queryOwner = url.searchParams.get("owner");
    const owner = (pathOwner ?? queryOwner)?.toLowerCase();
    const holding = url.searchParams.get("holding") ?? "wallet";
    if (!["wallet", "all", "staked"].includes(holding) || !owner && holding === "wallet" && url.searchParams.has("holding"))
      return { error: "invalid_holding", status: 400 };
    if ((pathOwner !== void 0 || queryOwner !== null) && (!owner || !isAddress2(owner) || /^0x0{40}$/.test(owner)))
      return { error: "invalid_owner", status: 400 };
    if (pathOwner && queryOwner && queryOwner.toLowerCase() !== owner)
      return { error: "owner_scope_mismatch", status: 400 };
    if (pathOwner && burned !== "false")
      return { error: "owner_requires_active_tokens", status: 400 };
    const scope = createHash4("sha256").update(
      JSON.stringify({
        collectionId: collection.slug,
        ...ownershipReadConfig.releaseId ? { ownershipRelease: ownershipReadConfig.releaseId } : {},
        sort,
        burned,
        edition,
        owner: owner ?? null,
        holding
      })
    ).digest("hex");
    const rawCursor = url.searchParams.get("cursor");
    const cursor = rawCursor ? decodeCursor(rawCursor) : void 0;
    if (rawCursor !== null && (!cursor || cursor.scope !== scope))
      return { error: "invalid_cursor", status: 409 };
    const params = [];
    const conditions = [islandIdentity(collection)];
    if (burned !== "all") {
      params.push(burned === "true");
      conditions.push(`t.burned=$${params.length}`);
    }
    if (owner) {
      params.push(owner);
      const walletMatch = `t.owner=$${params.length}`;
      const stakeMatch = stakingEnabled() ? `sp.staker=$${params.length}` : "false";
      conditions.push(
        `(${holding === "wallet" ? walletMatch : holding === "staked" ? stakeMatch : `${walletMatch} OR ${stakeMatch}`}) AND NOT t.burned`
      );
    } else if (holding === "staked") {
      conditions.push(stakingEnabled() ? "sp.staker IS NOT NULL" : "false");
      conditions.push("NOT t.burned");
    }
    if (edition)
      conditions.push(
        `t.token_id::numeric${edition === "Genesis" ? "<=" : ">"}${collection.genesisLimit}`
      );
    const ascending = sort === "token-id-asc";
    const countParams = [...params];
    const countConditions = [...conditions];
    if (cursor) {
      params.push(cursor.tokenId);
      conditions.push(
        `t.token_id::numeric${ascending ? ">" : "<"}$${params.length}::numeric`
      );
    }
    params.push(limit + 1);
    const selectedModel = await model();
    const result = await pool2.query(
      `SELECT ${selectedModel.columns} FROM ${selectedModel.relation}
        WHERE ${conditions.join(" AND ")} ORDER BY t.token_id::numeric ${ascending ? "ASC" : "DESC"} LIMIT $${params.length}`,
      params
    );
    const items = result.rows.slice(0, limit);
    const staking = await stakingStatus();
    const total = (await pool2.query(
      `SELECT count(*)::int AS total FROM ${selectedModel.relation} WHERE ${countConditions.join(" AND ")}`,
      countParams
    )).rows[0].total;
    return {
      body: {
        ...descriptor,
        total,
        stakingStatus: staking,
        complete: holding === "wallet" || !owner && holding === "all" || staking.ready,
        items,
        limit,
        nextCursor: result.rows.length > limit && items.length ? encodeCursor({ v: 1, scope, tokenId: items.at(-1).tokenId }) : null
      }
    };
  }
  router.get("/tokens", async (c) => {
    const result = await listTokens(new URL(c.req.url));
    return "error" in result ? c.json({ error: result.error }, result.status) : c.json(result.body);
  });
  router.get("/owners/:address/tokens", async (c) => {
    const address3 = c.req.param("address");
    if (!isAddress2(address3.toLowerCase()))
      return c.json({ error: "invalid_owner" }, 400);
    const result = await listTokens(new URL(c.req.url), address3);
    return "error" in result ? c.json({ error: result.error }, result.status) : c.json(result.body);
  });
  router.get("/tokens/:tokenId", async (c) => {
    const tokenId = c.req.param("tokenId");
    if (!canonicalTokenId(tokenId))
      return c.json({ error: "invalid_token_id" }, 400);
    const selectedModel = await model();
    const result = await pool2.query(
      `SELECT ${selectedModel.columns} FROM ${selectedModel.relation}
      WHERE ${islandIdentity(collection)} AND t.token_id=$1`,
      [tokenId]
    );
    if (!result.rows.length) return c.json({ error: "token_not_found" }, 404);
    const lifecycles = await pool2.query(
      `SELECT lifecycle,minted_to AS "mintedTo",mint_block::text AS "mintBlock",
      mint_timestamp::text AS "mintTimestamp",mint_transaction_hash AS "mintTransactionHash",
      burned_at_block::text AS "burnedAtBlock",burned_at_timestamp::text AS "burnedAtTimestamp",
      burn_transaction_hash AS "burnTransactionHash" FROM ${schema}.token_lifecycle
      WHERE collection=$1 AND token_id=$2 ORDER BY lifecycle LIMIT 100`,
      [collection.slug, tokenId]
    );
    return c.json({
      token: result.rows[0],
      indexingStatus: await checkReadiness(),
      lifecycles: lifecycles.rows,
      stakingStatus: await stakingStatus()
    });
  });
  router.get("/tokens/:tokenId/transfers", async (c) => {
    const tokenId = c.req.param("tokenId");
    if (!canonicalTokenId(tokenId))
      return c.json({ error: "invalid_token_id" }, 400);
    const url = new URL(c.req.url);
    if ([...url.searchParams.keys()].some(
      (key) => !["limit", "cursor"].includes(key) || url.searchParams.getAll(key).length !== 1
    )) {
      return c.json({ error: "invalid_query" }, 400);
    }
    const rawLimit = url.searchParams.get("limit") ?? "50";
    if (!/^[1-9]\d*$/.test(rawLimit) || Number(rawLimit) > 100)
      return c.json({ error: "invalid_limit" }, 400);
    const limit = Number(rawLimit);
    const params = [collection.slug, tokenId];
    let after = "";
    const rawCursor = url.searchParams.get("cursor");
    if (rawCursor !== null) {
      try {
        if (rawCursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(rawCursor))
          throw new Error();
        const value = JSON.parse(
          Buffer.from(rawCursor, "base64url").toString()
        );
        if (value.collectionId !== collection.slug || (value.ownershipRelease ?? null) !== ownershipReadConfig.releaseId || value.tokenId !== tokenId || !canonicalTokenId(value.blockNumber) || !Number.isInteger(value.transactionIndex) || value.transactionIndex < 0 || value.transactionIndex > 2147483647 || !Number.isInteger(value.logIndex) || value.logIndex < 0 || value.logIndex > 2147483647)
          throw new Error();
        params.push(value.blockNumber, value.transactionIndex, value.logIndex);
        after = "AND (block_number,transaction_index,log_index)>($3::numeric,$4::integer,$5::integer)";
      } catch {
        return c.json({ error: "invalid_cursor" }, 409);
      }
    }
    params.push(limit + 1);
    const result = await pool2.query(
      `SELECT id,collection AS "collectionId",chain_id AS "chainId",contract_address AS "contractAddress",
        token_id AS "tokenId",lifecycle,"from","to",block_number::text AS "blockNumber",
        block_timestamp::text AS "blockTimestamp",transaction_hash AS "transactionHash",
        transaction_index AS "transactionIndex",log_index AS "logIndex"
        FROM ${schema}.transfer_event WHERE collection=$1 AND token_id=$2
        AND chain_id=${collection.chainId} AND contract_address='${collection.address}' ${after}
        ORDER BY block_number,transaction_index,log_index LIMIT $${params.length}`,
      params
    );
    const items = result.rows.slice(0, limit);
    const last = items.at(-1);
    return c.json({
      ...descriptor,
      items,
      nextCursor: result.rows.length > limit && last ? encodeCursor({
        collectionId: collection.slug,
        ...ownershipReadConfig.releaseId ? { ownershipRelease: ownershipReadConfig.releaseId } : {},
        tokenId,
        blockNumber: last.blockNumber,
        transactionIndex: last.transactionIndex,
        logIndex: last.logIndex
      }) : null
    });
  });
  router.get("/stats", async (c) => {
    const selectedModel = await model();
    const result = await pool2.query(`SELECT count(*)::int AS "knownTokens",
      count(*) FILTER(WHERE NOT t.burned)::int AS "activeSupply",
      count(*) FILTER(WHERE t.burned)::int AS "burnedTokens",
      count(DISTINCT t.owner) FILTER(WHERE NOT t.burned)::int AS holders,
      count(*) FILTER(WHERE NOT t.burned AND t.token_id::numeric<=${collection.genesisLimit})::int AS genesis,
      count(*) FILTER(WHERE NOT t.burned AND t.token_id::numeric>${collection.genesisLimit})::int AS personal,
      count(*) FILTER(WHERE NOT t.burned AND p.status='published' AND r.revision_hash IS NOT NULL)::int AS "metadataAvailable"
      FROM ${selectedModel.relation} WHERE ${islandIdentity(collection)}`);
    return c.json({ ...descriptor, ...result.rows[0] });
  });
  app2.route(root, router);
}

// lib/api/booster-routes.ts
import { Hono as Hono3 } from "hono";
import { isAddress as isAddress4 } from "viem";

// lib/boosters/config.ts
import { isAddress as isAddress3, zeroAddress } from "viem";

// ../../packages/yunipals-market-core/src/boosterAbi.ts
var boosterPacksAbi = [{ "type": "function", "name": "CALLBACK_RESERVE", "inputs": [], "outputs": [{ "name": "", "type": "uint32", "internalType": "uint32" }], "stateMutability": "view" }, { "type": "function", "name": "CONFIG_ROLE", "inputs": [], "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }], "stateMutability": "view" }, { "type": "function", "name": "DEFAULT_ADMIN_ROLE", "inputs": [], "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }], "stateMutability": "view" }, { "type": "function", "name": "MAX_OPEN_PACKS", "inputs": [], "outputs": [{ "name": "", "type": "uint32", "internalType": "uint32" }], "stateMutability": "view" }, { "type": "function", "name": "PAUSER_ROLE", "inputs": [], "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }], "stateMutability": "view" }, { "type": "function", "name": "UPGRADER_ROLE", "inputs": [], "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }], "stateMutability": "view" }, { "type": "function", "name": "UPGRADE_INTERFACE_VERSION", "inputs": [], "outputs": [{ "name": "", "type": "string", "internalType": "string" }], "stateMutability": "view" }, { "type": "function", "name": "checkpointBlockHeaders", "inputs": [{ "name": "childBlock", "type": "uint256", "internalType": "uint256" }, { "name": "headers", "type": "bytes[]", "internalType": "bytes[]" }], "outputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "checkpointRequestBlock", "inputs": [{ "name": "id", "type": "uint256", "internalType": "uint256" }], "outputs": [{ "name": "hash", "type": "bytes32", "internalType": "bytes32" }], "stateMutability": "nonpayable" }, { "type": "function", "name": "checkpointedBlockhash", "inputs": [{ "name": "number", "type": "uint256", "internalType": "uint256" }], "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }], "stateMutability": "view" }, { "type": "function", "name": "claim", "inputs": [{ "name": "originalId", "type": "uint256", "internalType": "uint256" }, { "name": "quantity", "type": "uint32", "internalType": "uint32" }, { "name": "maxVrfPrice", "type": "uint256", "internalType": "uint256" }, { "name": "deadline", "type": "uint256", "internalType": "uint256" }], "outputs": [{ "name": "requestId", "type": "uint256", "internalType": "uint256" }], "stateMutability": "payable" }, { "type": "function", "name": "claimable", "inputs": [{ "name": "originalId", "type": "uint256", "internalType": "uint256" }], "outputs": [{ "name": "", "type": "uint32", "internalType": "uint32" }], "stateMutability": "view" }, { "type": "function", "name": "execute", "inputs": [{ "name": "id", "type": "uint256", "internalType": "uint256" }], "outputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "getOriginal", "inputs": [{ "name": "id", "type": "uint256", "internalType": "uint256" }], "outputs": [{ "name": "", "type": "tuple", "internalType": "struct BoosterPacks.Original", "components": [{ "name": "packTypeId", "type": "uint256", "internalType": "uint256" }, { "name": "pendingRequest", "type": "uint256", "internalType": "uint256" }, { "name": "revealedAt", "type": "uint64", "internalType": "uint64" }, { "name": "remaining", "type": "uint32", "internalType": "uint32" }, { "name": "minted", "type": "uint32", "internalType": "uint32" }, { "name": "dailyCommitted", "type": "uint32", "internalType": "uint32" }, { "name": "burned", "type": "bool", "internalType": "bool" }] }], "stateMutability": "view" }, { "type": "function", "name": "getRequest", "inputs": [{ "name": "id", "type": "uint256", "internalType": "uint256" }], "outputs": [{ "name": "", "type": "tuple", "internalType": "struct BoosterPacks.Request", "components": [{ "name": "originalId", "type": "uint256", "internalType": "uint256" }, { "name": "payer", "type": "address", "internalType": "address" }, { "name": "paid", "type": "uint256", "internalType": "uint256" }, { "name": "seed", "type": "uint256", "internalType": "uint256" }, { "name": "ruleHash", "type": "bytes32", "internalType": "bytes32" }, { "name": "receivedAt", "type": "uint64", "internalType": "uint64" }, { "name": "quantity", "type": "uint32", "internalType": "uint32" }, { "name": "executionGas", "type": "uint32", "internalType": "uint32" }, { "name": "status", "type": "uint8", "internalType": "enum BoosterPacks.Status" }, { "name": "opening", "type": "bool", "internalType": "bool" }, { "name": "received", "type": "bool", "internalType": "bool" }] }], "stateMutability": "view" }, { "type": "function", "name": "getRoleAdmin", "inputs": [{ "name": "role", "type": "bytes32", "internalType": "bytes32" }], "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }], "stateMutability": "view" }, { "type": "function", "name": "grantRole", "inputs": [{ "name": "role", "type": "bytes32", "internalType": "bytes32" }, { "name": "account", "type": "address", "internalType": "address" }], "outputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "hasRole", "inputs": [{ "name": "role", "type": "bytes32", "internalType": "bytes32" }, { "name": "account", "type": "address", "internalType": "address" }], "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }], "stateMutability": "view" }, { "type": "function", "name": "initialize", "inputs": [{ "name": "admin", "type": "address", "internalType": "address" }, { "name": "registry_", "type": "address", "internalType": "contract PackRegistry" }, { "name": "monsters_", "type": "address", "internalType": "contract YunipalMonsters" }, { "name": "wrapper_", "type": "address", "internalType": "contract IVRFV2PlusWrapper" }], "outputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "monsters", "inputs": [], "outputs": [{ "name": "", "type": "address", "internalType": "contract YunipalMonsters" }], "stateMutability": "view" }, { "type": "function", "name": "onOriginalBurned", "inputs": [{ "name": "originalId", "type": "uint256", "internalType": "uint256" }], "outputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "openPack", "inputs": [{ "name": "packTypeId", "type": "uint256", "internalType": "uint256" }, { "name": "maxVrfPrice", "type": "uint256", "internalType": "uint256" }, { "name": "deadline", "type": "uint256", "internalType": "uint256" }], "outputs": [{ "name": "requestId", "type": "uint256", "internalType": "uint256" }, { "name": "originalId", "type": "uint256", "internalType": "uint256" }], "stateMutability": "payable" }, { "type": "function", "name": "openPacks", "inputs": [{ "name": "packTypeId", "type": "uint256", "internalType": "uint256" }, { "name": "count", "type": "uint32", "internalType": "uint32" }, { "name": "maxTotalVrfPrice", "type": "uint256", "internalType": "uint256" }, { "name": "deadline", "type": "uint256", "internalType": "uint256" }], "outputs": [{ "name": "requestIds", "type": "uint256[]", "internalType": "uint256[]" }, { "name": "originalIds", "type": "uint256[]", "internalType": "uint256[]" }], "stateMutability": "payable" }, { "type": "function", "name": "originals", "inputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }], "outputs": [{ "name": "packTypeId", "type": "uint256", "internalType": "uint256" }, { "name": "pendingRequest", "type": "uint256", "internalType": "uint256" }, { "name": "revealedAt", "type": "uint64", "internalType": "uint64" }, { "name": "remaining", "type": "uint32", "internalType": "uint32" }, { "name": "minted", "type": "uint32", "internalType": "uint32" }, { "name": "dailyCommitted", "type": "uint32", "internalType": "uint32" }, { "name": "burned", "type": "bool", "internalType": "bool" }], "stateMutability": "view" }, { "type": "function", "name": "pauseRequests", "inputs": [{ "name": "paused", "type": "bool", "internalType": "bool" }], "outputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "proofContext", "inputs": [{ "name": "id", "type": "uint256", "internalType": "uint256" }], "outputs": [{ "name": "", "type": "tuple", "internalType": "struct BoosterProofRecovery.ProofContext", "components": [{ "name": "coordinator", "type": "address", "internalType": "address" }, { "name": "requestBlock", "type": "uint64", "internalType": "uint64" }, { "name": "confirmations", "type": "uint16", "internalType": "uint16" }, { "name": "blockhashStore", "type": "address", "internalType": "address" }, { "name": "chainId", "type": "uint256", "internalType": "uint256" }] }], "stateMutability": "view" }, { "type": "function", "name": "proxiableUUID", "inputs": [], "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }], "stateMutability": "view" }, { "type": "function", "name": "quote", "inputs": [{ "name": "packTypeId", "type": "uint256", "internalType": "uint256" }, { "name": "quantity", "type": "uint32", "internalType": "uint32" }, { "name": "gasPrice", "type": "uint256", "internalType": "uint256" }], "outputs": [{ "name": "price", "type": "uint256", "internalType": "uint256" }, { "name": "callbackGas", "type": "uint32", "internalType": "uint32" }], "stateMutability": "view" }, { "type": "function", "name": "quoteOpenPacks", "inputs": [{ "name": "packTypeId", "type": "uint256", "internalType": "uint256" }, { "name": "count", "type": "uint32", "internalType": "uint32" }, { "name": "gasPrice", "type": "uint256", "internalType": "uint256" }], "outputs": [{ "name": "price", "type": "uint256", "internalType": "uint256" }, { "name": "callbackGas", "type": "uint32", "internalType": "uint32" }], "stateMutability": "view" }, { "type": "function", "name": "rawFulfillRandomWords", "inputs": [{ "name": "id", "type": "uint256", "internalType": "uint256" }, { "name": "words", "type": "uint256[]", "internalType": "uint256[]" }], "outputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "recover", "inputs": [{ "name": "id", "type": "uint256", "internalType": "uint256" }], "outputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "refundCredits", "inputs": [{ "name": "", "type": "address", "internalType": "address" }], "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }], "stateMutability": "view" }, { "type": "function", "name": "registry", "inputs": [], "outputs": [{ "name": "", "type": "address", "internalType": "contract PackRegistry" }], "stateMutability": "view" }, { "type": "function", "name": "renounceRole", "inputs": [{ "name": "role", "type": "bytes32", "internalType": "bytes32" }, { "name": "callerConfirmation", "type": "address", "internalType": "address" }], "outputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "requests", "inputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }], "outputs": [{ "name": "originalId", "type": "uint256", "internalType": "uint256" }, { "name": "payer", "type": "address", "internalType": "address" }, { "name": "paid", "type": "uint256", "internalType": "uint256" }, { "name": "seed", "type": "uint256", "internalType": "uint256" }, { "name": "ruleHash", "type": "bytes32", "internalType": "bytes32" }, { "name": "receivedAt", "type": "uint64", "internalType": "uint64" }, { "name": "quantity", "type": "uint32", "internalType": "uint32" }, { "name": "executionGas", "type": "uint32", "internalType": "uint32" }, { "name": "status", "type": "uint8", "internalType": "enum BoosterPacks.Status" }, { "name": "opening", "type": "bool", "internalType": "bool" }, { "name": "received", "type": "bool", "internalType": "bool" }], "stateMutability": "view" }, { "type": "function", "name": "requestsPaused", "inputs": [], "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }], "stateMutability": "view" }, { "type": "function", "name": "restoreRandomness", "inputs": [{ "name": "id", "type": "uint256", "internalType": "uint256" }, { "name": "proof", "type": "tuple", "internalType": "struct VRF.Proof", "components": [{ "name": "pk", "type": "uint256[2]", "internalType": "uint256[2]" }, { "name": "gamma", "type": "uint256[2]", "internalType": "uint256[2]" }, { "name": "c", "type": "uint256", "internalType": "uint256" }, { "name": "s", "type": "uint256", "internalType": "uint256" }, { "name": "seed", "type": "uint256", "internalType": "uint256" }, { "name": "uWitness", "type": "address", "internalType": "address" }, { "name": "cGammaWitness", "type": "uint256[2]", "internalType": "uint256[2]" }, { "name": "sHashWitness", "type": "uint256[2]", "internalType": "uint256[2]" }, { "name": "zInv", "type": "uint256", "internalType": "uint256" }] }], "outputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "revokeRole", "inputs": [{ "name": "role", "type": "bytes32", "internalType": "bytes32" }, { "name": "account", "type": "address", "internalType": "address" }], "outputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "supportsInterface", "inputs": [{ "name": "interfaceId", "type": "bytes4", "internalType": "bytes4" }], "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }], "stateMutability": "view" }, { "type": "function", "name": "totalRefundLiability", "inputs": [], "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }], "stateMutability": "view" }, { "type": "function", "name": "upgradeToAndCall", "inputs": [{ "name": "newImplementation", "type": "address", "internalType": "address" }, { "name": "data", "type": "bytes", "internalType": "bytes" }], "outputs": [], "stateMutability": "payable" }, { "type": "function", "name": "withdrawRefund", "inputs": [{ "name": "recipient", "type": "address", "internalType": "address payable" }], "outputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "wrapper", "inputs": [], "outputs": [{ "name": "", "type": "address", "internalType": "contract IVRFV2PlusWrapper" }], "stateMutability": "view" }, { "type": "event", "name": "BlockhashCheckpointed", "inputs": [{ "name": "blockNumber", "type": "uint256", "indexed": true, "internalType": "uint256" }, { "name": "blockHash", "type": "bytes32", "indexed": false, "internalType": "bytes32" }], "anonymous": false }, { "type": "event", "name": "Initialized", "inputs": [{ "name": "version", "type": "uint64", "indexed": false, "internalType": "uint64" }], "anonymous": false }, { "type": "event", "name": "OriginalRevealed", "inputs": [{ "name": "originalId", "type": "uint256", "indexed": true, "internalType": "uint256" }, { "name": "packTypeId", "type": "uint256", "indexed": true, "internalType": "uint256" }, { "name": "revealedAt", "type": "uint64", "indexed": false, "internalType": "uint64" }, { "name": "totalVariants", "type": "uint32", "indexed": false, "internalType": "uint32" }], "anonymous": false }, { "type": "event", "name": "PaymentBurned", "inputs": [{ "name": "requestId", "type": "uint256", "indexed": true, "internalType": "uint256" }, { "name": "payer", "type": "address", "indexed": true, "internalType": "address" }, { "name": "token", "type": "address", "indexed": false, "internalType": "address" }, { "name": "amount", "type": "uint256", "indexed": false, "internalType": "uint256" }], "anonymous": false }, { "type": "event", "name": "ProofContextRecorded", "inputs": [{ "name": "requestId", "type": "uint256", "indexed": true, "internalType": "uint256" }, { "name": "coordinator", "type": "address", "indexed": true, "internalType": "address" }, { "name": "blockhashStore", "type": "address", "indexed": false, "internalType": "address" }, { "name": "requestBlock", "type": "uint64", "indexed": false, "internalType": "uint64" }, { "name": "confirmations", "type": "uint16", "indexed": false, "internalType": "uint16" }], "anonymous": false }, { "type": "event", "name": "RandomnessReceived", "inputs": [{ "name": "requestId", "type": "uint256", "indexed": true, "internalType": "uint256" }, { "name": "seed", "type": "uint256", "indexed": false, "internalType": "uint256" }, { "name": "receivedAt", "type": "uint64", "indexed": false, "internalType": "uint64" }], "anonymous": false }, { "type": "event", "name": "RandomnessRestored", "inputs": [{ "name": "requestId", "type": "uint256", "indexed": true, "internalType": "uint256" }, { "name": "submitter", "type": "address", "indexed": true, "internalType": "address" }], "anonymous": false }, { "type": "event", "name": "RecoveryRequired", "inputs": [{ "name": "requestId", "type": "uint256", "indexed": true, "internalType": "uint256" }], "anonymous": false }, { "type": "event", "name": "RefundCredited", "inputs": [{ "name": "requester", "type": "address", "indexed": true, "internalType": "address" }, { "name": "amount", "type": "uint256", "indexed": false, "internalType": "uint256" }], "anonymous": false }, { "type": "event", "name": "RefundReturned", "inputs": [{ "name": "requester", "type": "address", "indexed": true, "internalType": "address" }, { "name": "amount", "type": "uint256", "indexed": false, "internalType": "uint256" }], "anonymous": false }, { "type": "event", "name": "RefundWithdrawn", "inputs": [{ "name": "requester", "type": "address", "indexed": true, "internalType": "address" }, { "name": "recipient", "type": "address", "indexed": true, "internalType": "address" }, { "name": "amount", "type": "uint256", "indexed": false, "internalType": "uint256" }], "anonymous": false }, { "type": "event", "name": "RequestCompleted", "inputs": [{ "name": "requestId", "type": "uint256", "indexed": true, "internalType": "uint256" }, { "name": "originalId", "type": "uint256", "indexed": true, "internalType": "uint256" }, { "name": "recipient", "type": "address", "indexed": false, "internalType": "address" }, { "name": "quantity", "type": "uint32", "indexed": false, "internalType": "uint32" }, { "name": "minted", "type": "uint32", "indexed": false, "internalType": "uint32" }, { "name": "remaining", "type": "uint32", "indexed": false, "internalType": "uint32" }], "anonymous": false }, { "type": "event", "name": "RequestCreated", "inputs": [{ "name": "requestId", "type": "uint256", "indexed": true, "internalType": "uint256" }, { "name": "originalId", "type": "uint256", "indexed": true, "internalType": "uint256" }, { "name": "packTypeId", "type": "uint256", "indexed": true, "internalType": "uint256" }, { "name": "payer", "type": "address", "indexed": false, "internalType": "address" }, { "name": "quantity", "type": "uint32", "indexed": false, "internalType": "uint32" }, { "name": "opening", "type": "bool", "indexed": false, "internalType": "bool" }, { "name": "paid", "type": "uint256", "indexed": false, "internalType": "uint256" }, { "name": "ruleHash", "type": "bytes32", "indexed": false, "internalType": "bytes32" }, { "name": "callbackGas", "type": "uint32", "indexed": false, "internalType": "uint32" }], "anonymous": false }, { "type": "event", "name": "RequestForfeited", "inputs": [{ "name": "requestId", "type": "uint256", "indexed": true, "internalType": "uint256" }, { "name": "originalId", "type": "uint256", "indexed": true, "internalType": "uint256" }], "anonymous": false }, { "type": "event", "name": "RequestsPaused", "inputs": [{ "name": "paused", "type": "bool", "indexed": false, "internalType": "bool" }], "anonymous": false }, { "type": "event", "name": "RoleAdminChanged", "inputs": [{ "name": "role", "type": "bytes32", "indexed": true, "internalType": "bytes32" }, { "name": "previousAdminRole", "type": "bytes32", "indexed": true, "internalType": "bytes32" }, { "name": "newAdminRole", "type": "bytes32", "indexed": true, "internalType": "bytes32" }], "anonymous": false }, { "type": "event", "name": "RoleGranted", "inputs": [{ "name": "role", "type": "bytes32", "indexed": true, "internalType": "bytes32" }, { "name": "account", "type": "address", "indexed": true, "internalType": "address" }, { "name": "sender", "type": "address", "indexed": true, "internalType": "address" }], "anonymous": false }, { "type": "event", "name": "RoleRevoked", "inputs": [{ "name": "role", "type": "bytes32", "indexed": true, "internalType": "bytes32" }, { "name": "account", "type": "address", "indexed": true, "internalType": "address" }, { "name": "sender", "type": "address", "indexed": true, "internalType": "address" }], "anonymous": false }, { "type": "event", "name": "Upgraded", "inputs": [{ "name": "implementation", "type": "address", "indexed": true, "internalType": "address" }], "anonymous": false }, { "type": "error", "name": "AccessControlBadConfirmation", "inputs": [] }, { "type": "error", "name": "AccessControlUnauthorizedAccount", "inputs": [{ "name": "account", "type": "address", "internalType": "address" }, { "name": "neededRole", "type": "bytes32", "internalType": "bytes32" }] }, { "type": "error", "name": "AddressEmptyCode", "inputs": [{ "name": "target", "type": "address", "internalType": "address" }] }, { "type": "error", "name": "ERC1967InvalidImplementation", "inputs": [{ "name": "implementation", "type": "address", "internalType": "address" }] }, { "type": "error", "name": "ERC1967NonPayable", "inputs": [] }, { "type": "error", "name": "FailedCall", "inputs": [] }, { "type": "error", "name": "InvalidInitialization", "inputs": [] }, { "type": "error", "name": "NotInitializing", "inputs": [] }, { "type": "error", "name": "ReentrancyGuardReentrantCall", "inputs": [] }, { "type": "error", "name": "SafeERC20FailedOperation", "inputs": [{ "name": "token", "type": "address", "internalType": "address" }] }, { "type": "error", "name": "UUPSUnauthorizedCallContext", "inputs": [] }, { "type": "error", "name": "UUPSUnsupportedProxiableUUID", "inputs": [{ "name": "slot", "type": "bytes32", "internalType": "bytes32" }] }];
var yunipalMonstersAbi = [{ "type": "function", "name": "CONFIG_ROLE", "inputs": [], "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }], "stateMutability": "view" }, { "type": "function", "name": "DEFAULT_ADMIN_ROLE", "inputs": [], "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }], "stateMutability": "view" }, { "type": "function", "name": "PAUSER_ROLE", "inputs": [], "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }], "stateMutability": "view" }, { "type": "function", "name": "UPGRADER_ROLE", "inputs": [], "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }], "stateMutability": "view" }, { "type": "function", "name": "UPGRADE_INTERFACE_VERSION", "inputs": [], "outputs": [{ "name": "", "type": "string", "internalType": "string" }], "stateMutability": "view" }, { "type": "function", "name": "approve", "inputs": [{ "name": "to", "type": "address", "internalType": "address" }, { "name": "tokenId", "type": "uint256", "internalType": "uint256" }], "outputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "balanceOf", "inputs": [{ "name": "owner", "type": "address", "internalType": "address" }], "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }], "stateMutability": "view" }, { "type": "function", "name": "burn", "inputs": [{ "name": "tokenId", "type": "uint256", "internalType": "uint256" }], "outputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "getApproved", "inputs": [{ "name": "tokenId", "type": "uint256", "internalType": "uint256" }], "outputs": [{ "name": "", "type": "address", "internalType": "address" }], "stateMutability": "view" }, { "type": "function", "name": "getRoleAdmin", "inputs": [{ "name": "role", "type": "bytes32", "internalType": "bytes32" }], "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }], "stateMutability": "view" }, { "type": "function", "name": "grantRole", "inputs": [{ "name": "role", "type": "bytes32", "internalType": "bytes32" }, { "name": "account", "type": "address", "internalType": "address" }], "outputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "hasRole", "inputs": [{ "name": "role", "type": "bytes32", "internalType": "bytes32" }, { "name": "account", "type": "address", "internalType": "address" }], "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }], "stateMutability": "view" }, { "type": "function", "name": "initialize", "inputs": [{ "name": "admin", "type": "address", "internalType": "address" }, { "name": "registry_", "type": "address", "internalType": "contract PackRegistry" }], "outputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "isApprovedForAll", "inputs": [{ "name": "owner", "type": "address", "internalType": "address" }, { "name": "operator", "type": "address", "internalType": "address" }], "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }], "stateMutability": "view" }, { "type": "function", "name": "mintOffspring", "inputs": [{ "name": "originalId", "type": "uint256", "internalType": "uint256" }, { "name": "recipient", "type": "address", "internalType": "address" }, { "name": "variantId", "type": "uint32", "internalType": "uint32" }], "outputs": [{ "name": "id", "type": "uint256", "internalType": "uint256" }], "stateMutability": "nonpayable" }, { "type": "function", "name": "mintOriginal", "inputs": [{ "name": "tokenId", "type": "uint256", "internalType": "uint256" }, { "name": "recipient", "type": "address", "internalType": "address" }, { "name": "variantId", "type": "uint32", "internalType": "uint32" }], "outputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "name", "inputs": [], "outputs": [{ "name": "", "type": "string", "internalType": "string" }], "stateMutability": "view" }, { "type": "function", "name": "nextTokenId", "inputs": [], "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }], "stateMutability": "view" }, { "type": "function", "name": "ownerOf", "inputs": [{ "name": "tokenId", "type": "uint256", "internalType": "uint256" }], "outputs": [{ "name": "", "type": "address", "internalType": "address" }], "stateMutability": "view" }, { "type": "function", "name": "provenance", "inputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }], "outputs": [{ "name": "packTypeId", "type": "uint256", "internalType": "uint256" }, { "name": "originalTokenId", "type": "uint256", "internalType": "uint256" }, { "name": "variantId", "type": "uint32", "internalType": "uint32" }, { "name": "traits", "type": "tuple", "internalType": "struct PackRegistry.Traits", "components": [{ "name": "monsterType", "type": "uint32", "internalType": "uint32" }, { "name": "color", "type": "uint32", "internalType": "uint32" }, { "name": "horn", "type": "uint32", "internalType": "uint32" }, { "name": "glitter", "type": "uint32", "internalType": "uint32" }] }, { "name": "isOriginal", "type": "bool", "internalType": "bool" }], "stateMutability": "view" }, { "type": "function", "name": "proxiableUUID", "inputs": [], "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }], "stateMutability": "view" }, { "type": "function", "name": "registry", "inputs": [], "outputs": [{ "name": "", "type": "address", "internalType": "contract PackRegistry" }], "stateMutability": "view" }, { "type": "function", "name": "renounceRole", "inputs": [{ "name": "role", "type": "bytes32", "internalType": "bytes32" }, { "name": "callerConfirmation", "type": "address", "internalType": "address" }], "outputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "reserveOriginal", "inputs": [{ "name": "packTypeId", "type": "uint256", "internalType": "uint256" }], "outputs": [{ "name": "tokenId", "type": "uint256", "internalType": "uint256" }], "stateMutability": "nonpayable" }, { "type": "function", "name": "reservedType", "inputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }], "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }], "stateMutability": "view" }, { "type": "function", "name": "revokeRole", "inputs": [{ "name": "role", "type": "bytes32", "internalType": "bytes32" }, { "name": "account", "type": "address", "internalType": "address" }], "outputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "safeTransferFrom", "inputs": [{ "name": "from", "type": "address", "internalType": "address" }, { "name": "to", "type": "address", "internalType": "address" }, { "name": "tokenId", "type": "uint256", "internalType": "uint256" }], "outputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "safeTransferFrom", "inputs": [{ "name": "from", "type": "address", "internalType": "address" }, { "name": "to", "type": "address", "internalType": "address" }, { "name": "tokenId", "type": "uint256", "internalType": "uint256" }, { "name": "data", "type": "bytes", "internalType": "bytes" }], "outputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "setApprovalForAll", "inputs": [{ "name": "operator", "type": "address", "internalType": "address" }, { "name": "approved", "type": "bool", "internalType": "bool" }], "outputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "setTokenMetadataBaseURI", "inputs": [{ "name": "baseURI", "type": "string", "internalType": "string" }], "outputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "supportsInterface", "inputs": [{ "name": "interfaceId", "type": "bytes4", "internalType": "bytes4" }], "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }], "stateMutability": "view" }, { "type": "function", "name": "symbol", "inputs": [], "outputs": [{ "name": "", "type": "string", "internalType": "string" }], "stateMutability": "view" }, { "type": "function", "name": "tokenMetadataBaseURI", "inputs": [], "outputs": [{ "name": "", "type": "string", "internalType": "string" }], "stateMutability": "view" }, { "type": "function", "name": "tokenURI", "inputs": [{ "name": "tokenId", "type": "uint256", "internalType": "uint256" }], "outputs": [{ "name": "", "type": "string", "internalType": "string" }], "stateMutability": "view" }, { "type": "function", "name": "transferFrom", "inputs": [{ "name": "from", "type": "address", "internalType": "address" }, { "name": "to", "type": "address", "internalType": "address" }, { "name": "tokenId", "type": "uint256", "internalType": "uint256" }], "outputs": [], "stateMutability": "nonpayable" }, { "type": "function", "name": "upgradeToAndCall", "inputs": [{ "name": "newImplementation", "type": "address", "internalType": "address" }, { "name": "data", "type": "bytes", "internalType": "bytes" }], "outputs": [], "stateMutability": "payable" }, { "type": "event", "name": "Approval", "inputs": [{ "name": "owner", "type": "address", "indexed": true, "internalType": "address" }, { "name": "approved", "type": "address", "indexed": true, "internalType": "address" }, { "name": "tokenId", "type": "uint256", "indexed": true, "internalType": "uint256" }], "anonymous": false }, { "type": "event", "name": "ApprovalForAll", "inputs": [{ "name": "owner", "type": "address", "indexed": true, "internalType": "address" }, { "name": "operator", "type": "address", "indexed": true, "internalType": "address" }, { "name": "approved", "type": "bool", "indexed": false, "internalType": "bool" }], "anonymous": false }, { "type": "event", "name": "BatchMetadataUpdate", "inputs": [{ "name": "_fromTokenId", "type": "uint256", "indexed": false, "internalType": "uint256" }, { "name": "_toTokenId", "type": "uint256", "indexed": false, "internalType": "uint256" }], "anonymous": false }, { "type": "event", "name": "Initialized", "inputs": [{ "name": "version", "type": "uint64", "indexed": false, "internalType": "uint64" }], "anonymous": false }, { "type": "event", "name": "MetadataUpdate", "inputs": [{ "name": "_tokenId", "type": "uint256", "indexed": false, "internalType": "uint256" }], "anonymous": false }, { "type": "event", "name": "MonsterMinted", "inputs": [{ "name": "tokenId", "type": "uint256", "indexed": true, "internalType": "uint256" }, { "name": "originalTokenId", "type": "uint256", "indexed": true, "internalType": "uint256" }, { "name": "packTypeId", "type": "uint256", "indexed": true, "internalType": "uint256" }, { "name": "recipient", "type": "address", "indexed": false, "internalType": "address" }, { "name": "variantId", "type": "uint32", "indexed": false, "internalType": "uint32" }, { "name": "monsterType", "type": "uint32", "indexed": false, "internalType": "uint32" }, { "name": "color", "type": "uint32", "indexed": false, "internalType": "uint32" }, { "name": "horn", "type": "uint32", "indexed": false, "internalType": "uint32" }, { "name": "glitter", "type": "uint32", "indexed": false, "internalType": "uint32" }, { "name": "isOriginal", "type": "bool", "indexed": false, "internalType": "bool" }], "anonymous": false }, { "type": "event", "name": "OriginalBurned", "inputs": [{ "name": "tokenId", "type": "uint256", "indexed": true, "internalType": "uint256" }, { "name": "packTypeId", "type": "uint256", "indexed": true, "internalType": "uint256" }], "anonymous": false }, { "type": "event", "name": "RoleAdminChanged", "inputs": [{ "name": "role", "type": "bytes32", "indexed": true, "internalType": "bytes32" }, { "name": "previousAdminRole", "type": "bytes32", "indexed": true, "internalType": "bytes32" }, { "name": "newAdminRole", "type": "bytes32", "indexed": true, "internalType": "bytes32" }], "anonymous": false }, { "type": "event", "name": "RoleGranted", "inputs": [{ "name": "role", "type": "bytes32", "indexed": true, "internalType": "bytes32" }, { "name": "account", "type": "address", "indexed": true, "internalType": "address" }, { "name": "sender", "type": "address", "indexed": true, "internalType": "address" }], "anonymous": false }, { "type": "event", "name": "RoleRevoked", "inputs": [{ "name": "role", "type": "bytes32", "indexed": true, "internalType": "bytes32" }, { "name": "account", "type": "address", "indexed": true, "internalType": "address" }, { "name": "sender", "type": "address", "indexed": true, "internalType": "address" }], "anonymous": false }, { "type": "event", "name": "TokenMetadataBaseURISet", "inputs": [{ "name": "previousURI", "type": "string", "indexed": false, "internalType": "string" }, { "name": "newURI", "type": "string", "indexed": false, "internalType": "string" }], "anonymous": false }, { "type": "event", "name": "Transfer", "inputs": [{ "name": "from", "type": "address", "indexed": true, "internalType": "address" }, { "name": "to", "type": "address", "indexed": true, "internalType": "address" }, { "name": "tokenId", "type": "uint256", "indexed": true, "internalType": "uint256" }], "anonymous": false }, { "type": "event", "name": "Upgraded", "inputs": [{ "name": "implementation", "type": "address", "indexed": true, "internalType": "address" }], "anonymous": false }, { "type": "error", "name": "AccessControlBadConfirmation", "inputs": [] }, { "type": "error", "name": "AccessControlUnauthorizedAccount", "inputs": [{ "name": "account", "type": "address", "internalType": "address" }, { "name": "neededRole", "type": "bytes32", "internalType": "bytes32" }] }, { "type": "error", "name": "AddressEmptyCode", "inputs": [{ "name": "target", "type": "address", "internalType": "address" }] }, { "type": "error", "name": "ERC1967InvalidImplementation", "inputs": [{ "name": "implementation", "type": "address", "internalType": "address" }] }, { "type": "error", "name": "ERC1967NonPayable", "inputs": [] }, { "type": "error", "name": "ERC721IncorrectOwner", "inputs": [{ "name": "sender", "type": "address", "internalType": "address" }, { "name": "tokenId", "type": "uint256", "internalType": "uint256" }, { "name": "owner", "type": "address", "internalType": "address" }] }, { "type": "error", "name": "ERC721InsufficientApproval", "inputs": [{ "name": "operator", "type": "address", "internalType": "address" }, { "name": "tokenId", "type": "uint256", "internalType": "uint256" }] }, { "type": "error", "name": "ERC721InvalidApprover", "inputs": [{ "name": "approver", "type": "address", "internalType": "address" }] }, { "type": "error", "name": "ERC721InvalidOperator", "inputs": [{ "name": "operator", "type": "address", "internalType": "address" }] }, { "type": "error", "name": "ERC721InvalidOwner", "inputs": [{ "name": "owner", "type": "address", "internalType": "address" }] }, { "type": "error", "name": "ERC721InvalidReceiver", "inputs": [{ "name": "receiver", "type": "address", "internalType": "address" }] }, { "type": "error", "name": "ERC721InvalidSender", "inputs": [{ "name": "sender", "type": "address", "internalType": "address" }] }, { "type": "error", "name": "ERC721NonexistentToken", "inputs": [{ "name": "tokenId", "type": "uint256", "internalType": "uint256" }] }, { "type": "error", "name": "FailedCall", "inputs": [] }, { "type": "error", "name": "InvalidInitialization", "inputs": [] }, { "type": "error", "name": "NotInitializing", "inputs": [] }, { "type": "error", "name": "UUPSUnauthorizedCallContext", "inputs": [] }, { "type": "error", "name": "UUPSUnsupportedProxiableUUID", "inputs": [{ "name": "slot", "type": "bytes32", "internalType": "bytes32" }] }];

// lib/boosters/config.ts
function boosterDeployment(env = process.env) {
  const names = [
    "BOOSTER_REGISTRY",
    "BOOSTER_ENGINE",
    "BOOSTER_MONSTERS",
    "BOOSTER_WRAPPER"
  ];
  if (!names.some((name) => env[name])) return null;
  for (const name of names) {
    if (!isAddress3(env[name] ?? "") || env[name]?.toLowerCase() === zeroAddress)
      throw new Error(`${name} must be a nonzero deployed contract address`);
  }
  const startBlock = Number(env.BOOSTER_DEPLOYMENT_BLOCK);
  if (!Number.isSafeInteger(startBlock) || startBlock <= 0)
    throw new Error(
      "BOOSTER_DEPLOYMENT_BLOCK must be the exact positive deployment block"
    );
  return {
    registry: env.BOOSTER_REGISTRY.toLowerCase(),
    engine: env.BOOSTER_ENGINE.toLowerCase(),
    monsters: env.BOOSTER_MONSTERS.toLowerCase(),
    wrapper: env.BOOSTER_WRAPPER.toLowerCase(),
    startBlock
  };
}

// ../../packages/yunipals-market-core/src/boosters.ts
var boosterIdentity = (collection, tokenId) => `8453:${collection.toLowerCase()}:${tokenId}`;

// lib/api/booster-routes.ts
var typeColumns = `id, pack_type_id AS "packTypeId", registry, engine,
  payment_token AS "paymentToken", price, interval_seconds::text AS "intervalSeconds",
  mints_per_interval::float8 AS "mintsPerInterval", total_variants::text AS "totalVariants",
  max_batch AS "maxBatch", catalog_hash AS "catalogHash", rule_hash AS "ruleHash",
  manifest_uri AS "manifestUri", metadata_base_uri AS "metadataBaseUri",
  sales_paused AS "salesPaused", openings::text`;
var originalColumns = `id, collection, token_id AS "tokenId", type_key AS "typeKey", engine, owner,
  revealed_at::text AS "revealedAt", daily_committed::text AS "dailyCommitted", minted::text,
  remaining::text, pending_request AS "pendingRequest", burned`;
var requestColumns = `id, engine, wrapper, request_id AS "requestId", original_key AS "originalKey",
  payer, quantity, opening, paid, rule_hash AS "ruleHash", callback_gas AS "callbackGas", status,
  seed, requested_at::text AS "requestedAt", received_at::text AS "receivedAt",
  transaction_hash AS "transactionHash", recipient`;
var monsterColumns = `m.id, m.collection, m.token_id AS "tokenId", m.original_key AS "originalKey",
  m.request_key AS "requestKey", m.type_key AS "typeKey", m.owner, m.minted_to AS "mintedTo", m.variant_id::text AS "variantId",
  m.monster_type::text AS "monsterType", m.color::text, m.horn::text, m.glitter::text,
  m.is_original AS "isOriginal", m.burned, m.mint_block::text AS "mintBlock",
  p.metadata_base_uri || m.variant_id::text || '.json' AS "metadataUri"`;
var validId = (id) => /^(0|[1-9][0-9]{0,77})$/.test(id) && BigInt(id) < 2n ** 256n;
function registerBoosterRoutes(app2, dependencies) {
  const { pool: pool2 } = dependencies;
  const schema = sqlIdentifier(dependencies.schemaName);
  const router = new Hono3();
  router.onError(
    () => new Response(JSON.stringify({ error: "booster_index_unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" }
    })
  );
  const snapshot = async () => {
    const deployment = boosterDeployment();
    const base = {
      chainId: 8453,
      collection: deployment?.monsters ?? null,
      engine: deployment?.engine ?? null,
      enabled: deployment !== null,
      requestsPaused: false,
      indexedBlock: null,
      indexedBlockHash: null,
      indexedTimestamp: null
    };
    if (!deployment) return base;
    const [checkpoint, state] = await Promise.all([
      pool2.query(`SELECT block_number::text AS "indexedBlock", block_hash AS "indexedBlockHash",
        timestamp::text AS "indexedTimestamp" FROM ${schema}.booster_checkpoint WHERE id='8453'`),
      pool2.query(
        `SELECT paused FROM ${schema}.booster_engine_state WHERE id=$1`,
        [deployment.engine]
      )
    ]);
    return {
      ...base,
      ...checkpoint.rows[0],
      requestsPaused: state.rows[0]?.paused ?? false
    };
  };
  router.get("/boosters/types", async (c) => {
    const state = await snapshot();
    const result = state.enabled ? await pool2.query(
      `SELECT ${typeColumns} FROM ${schema}.booster_type ORDER BY pack_type_id::numeric`
    ) : { rows: [] };
    return c.json({ ...state, items: result.rows });
  });
  router.get("/boosters/originals/:collection/:tokenId", async (c) => {
    const { collection, tokenId } = c.req.param();
    if (!isAddress4(collection) || !validId(tokenId))
      return c.json({ error: "invalid_monster_identity" }, 400);
    const state = await snapshot();
    if (!state.enabled)
      return c.json({ error: "boosters_not_configured" }, 503);
    const result = await pool2.query(
      `SELECT ${originalColumns} FROM ${schema}.booster_original WHERE id=$1`,
      [boosterIdentity(collection, tokenId)]
    );
    const original2 = result.rows[0];
    if (!original2) return c.json({ error: "original_not_found" }, 404);
    const pack = await pool2.query(
      `SELECT ${typeColumns} FROM ${schema}.booster_type WHERE id=$1`,
      [original2.typeKey]
    );
    return c.json({ ...state, item: { ...original2, pack: pack.rows[0] } });
  });
  router.get("/boosters/requests/:engine/:requestId", async (c) => {
    const { engine, requestId } = c.req.param();
    if (!isAddress4(engine) || !validId(requestId))
      return c.json({ error: "invalid_request_identity" }, 400);
    const state = await snapshot();
    if (!state.enabled)
      return c.json({ error: "boosters_not_configured" }, 503);
    const result = await pool2.query(
      `SELECT ${requestColumns} FROM ${schema}.booster_request WHERE id=$1`,
      [boosterIdentity(engine, requestId)]
    );
    return result.rows[0] ? c.json({ ...state, item: result.rows[0] }) : c.json({ error: "request_not_indexed" }, 404);
  });
  router.get("/boosters/monsters/:collection/:tokenId", async (c) => {
    const { collection, tokenId } = c.req.param();
    if (!isAddress4(collection) || !validId(tokenId))
      return c.json({ error: "invalid_monster_identity" }, 400);
    const state = await snapshot();
    if (!state.enabled)
      return c.json({ error: "boosters_not_configured" }, 503);
    const result = await pool2.query(
      `SELECT ${monsterColumns} FROM ${schema}.booster_monster m
      JOIN ${schema}.booster_type p ON p.id=m.type_key WHERE m.id=$1`,
      [boosterIdentity(collection, tokenId)]
    );
    return result.rows[0] ? c.json({ ...state, item: result.rows[0] }) : c.json({ error: "monster_not_found" }, 404);
  });
  for (const resource of ["originals", "monsters", "requests"]) {
    router.get(`/owners/:address/booster-${resource}`, async (c) => {
      const address3 = c.req.param("address");
      if (!isAddress4(address3)) return c.json({ error: "invalid_owner" }, 400);
      const cursor = c.req.query("after") ?? "0";
      if (!validId(cursor)) return c.json({ error: "invalid_cursor" }, 400);
      const limit = Number(c.req.query("limit") ?? 50);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        return c.json({ error: "invalid_limit" }, 400);
      const state = await snapshot();
      if (!state.enabled)
        return c.json({ ...state, items: [], nextCursor: null });
      const args = [address3.toLowerCase(), cursor, limit + 1];
      let items;
      if (resource === "originals") {
        const [result, packs] = await Promise.all([
          pool2.query(
            `SELECT ${originalColumns} FROM ${schema}.booster_original
            WHERE owner=$1 AND NOT burned AND token_id::numeric>$2::numeric ORDER BY token_id::numeric LIMIT $3`,
            args
          ),
          pool2.query(`SELECT ${typeColumns} FROM ${schema}.booster_type`)
        ]);
        items = result.rows.map((row) => ({
          ...row,
          pack: packs.rows.find((pack) => pack.id === row.typeKey)
        }));
      } else if (resource === "monsters") {
        const result = await pool2.query(
          `SELECT ${monsterColumns} FROM ${schema}.booster_monster m
          JOIN ${schema}.booster_type p ON p.id=m.type_key
          WHERE m.owner=$1 AND NOT m.burned AND m.token_id::numeric>$2::numeric ORDER BY m.token_id::numeric LIMIT $3`,
          args
        );
        items = result.rows;
      } else {
        const result = await pool2.query(
          `SELECT ${requestColumns} FROM ${schema}.booster_request
          WHERE payer=$1 AND request_id::numeric>$2::numeric ORDER BY request_id::numeric LIMIT $3`,
          args
        );
        items = result.rows;
      }
      const more = items.length > limit;
      items = items.slice(0, limit);
      return c.json({
        ...state,
        items,
        nextCursor: more ? String(
          items.at(-1)[resource === "requests" ? "requestId" : "tokenId"]
        ) : null
      });
    });
  }
  router.get("/owners/:address/booster-refunds", async (c) => {
    const address3 = c.req.param("address");
    if (!isAddress4(address3)) return c.json({ error: "invalid_owner" }, 400);
    const state = await snapshot();
    const result = state.enabled ? await pool2.query(
      `SELECT engine, requester, credit::text,
      returned::text, withdrawn::text FROM ${schema}.booster_refund WHERE requester=$1`,
      [address3.toLowerCase()]
    ) : { rows: [] };
    return c.json({ ...state, items: result.rows });
  });
  app2.route("/v1", router);
}

// lib/api/action-evidence-routes.ts
import { Hono as Hono4 } from "hono";
import { bodyLimit as bodyLimit2 } from "hono/body-limit";

// ../../packages/yunipals-market-core/src/indexedAction.ts
import { decodeEventLog } from "viem";

// ../../packages/yunipals-market-core/src/boosterSourceAbi.e8145098.ts
var boosterPacksAbiE8145098 = [
  {
    type: "function",
    name: "CALLBACK_RESERVE",
    inputs: [],
    outputs: [{ name: "", type: "uint32", internalType: "uint32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "CONFIG_ROLE",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "DEFAULT_ADMIN_ROLE",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "PAUSER_ROLE",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "UPGRADER_ROLE",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "UPGRADE_INTERFACE_VERSION",
    inputs: [],
    outputs: [{ name: "", type: "string", internalType: "string" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "checkpointBlockHeaders",
    inputs: [
      { name: "childBlock", type: "uint256", internalType: "uint256" },
      { name: "headers", type: "bytes[]", internalType: "bytes[]" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "checkpointRequestBlock",
    inputs: [{ name: "id", type: "uint256", internalType: "uint256" }],
    outputs: [{ name: "hash", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "checkpointedBlockhash",
    inputs: [{ name: "number", type: "uint256", internalType: "uint256" }],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "claim",
    inputs: [
      { name: "originalId", type: "uint256", internalType: "uint256" },
      { name: "quantity", type: "uint32", internalType: "uint32" },
      { name: "maxVrfPrice", type: "uint256", internalType: "uint256" },
      { name: "deadline", type: "uint256", internalType: "uint256" }
    ],
    outputs: [{ name: "requestId", type: "uint256", internalType: "uint256" }],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "claimable",
    inputs: [{ name: "originalId", type: "uint256", internalType: "uint256" }],
    outputs: [{ name: "", type: "uint32", internalType: "uint32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "execute",
    inputs: [{ name: "id", type: "uint256", internalType: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "getOriginal",
    inputs: [{ name: "id", type: "uint256", internalType: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct BoosterPacks.Original",
        components: [
          { name: "packTypeId", type: "uint256", internalType: "uint256" },
          { name: "pendingRequest", type: "uint256", internalType: "uint256" },
          { name: "revealedAt", type: "uint64", internalType: "uint64" },
          { name: "remaining", type: "uint32", internalType: "uint32" },
          { name: "minted", type: "uint32", internalType: "uint32" },
          { name: "dailyCommitted", type: "uint32", internalType: "uint32" },
          { name: "burned", type: "bool", internalType: "bool" }
        ]
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "getRequest",
    inputs: [{ name: "id", type: "uint256", internalType: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct BoosterPacks.Request",
        components: [
          { name: "originalId", type: "uint256", internalType: "uint256" },
          { name: "payer", type: "address", internalType: "address" },
          { name: "paid", type: "uint256", internalType: "uint256" },
          { name: "seed", type: "uint256", internalType: "uint256" },
          { name: "ruleHash", type: "bytes32", internalType: "bytes32" },
          { name: "receivedAt", type: "uint64", internalType: "uint64" },
          { name: "quantity", type: "uint32", internalType: "uint32" },
          { name: "executionGas", type: "uint32", internalType: "uint32" },
          {
            name: "status",
            type: "uint8",
            internalType: "enum BoosterPacks.Status"
          },
          { name: "opening", type: "bool", internalType: "bool" },
          { name: "received", type: "bool", internalType: "bool" }
        ]
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "getRoleAdmin",
    inputs: [{ name: "role", type: "bytes32", internalType: "bytes32" }],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "grantRole",
    inputs: [
      { name: "role", type: "bytes32", internalType: "bytes32" },
      { name: "account", type: "address", internalType: "address" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [
      { name: "role", type: "bytes32", internalType: "bytes32" },
      { name: "account", type: "address", internalType: "address" }
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "initialize",
    inputs: [
      { name: "admin", type: "address", internalType: "address" },
      {
        name: "registry_",
        type: "address",
        internalType: "contract PackRegistry"
      },
      {
        name: "monsters_",
        type: "address",
        internalType: "contract YunipalMonsters"
      },
      {
        name: "wrapper_",
        type: "address",
        internalType: "contract IVRFV2PlusWrapper"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "monsters",
    inputs: [],
    outputs: [
      { name: "", type: "address", internalType: "contract YunipalMonsters" }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "onOriginalBurned",
    inputs: [{ name: "originalId", type: "uint256", internalType: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "openPack",
    inputs: [
      { name: "packTypeId", type: "uint256", internalType: "uint256" },
      { name: "maxVrfPrice", type: "uint256", internalType: "uint256" },
      { name: "deadline", type: "uint256", internalType: "uint256" }
    ],
    outputs: [
      { name: "requestId", type: "uint256", internalType: "uint256" },
      { name: "originalId", type: "uint256", internalType: "uint256" }
    ],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "originals",
    inputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    outputs: [
      { name: "packTypeId", type: "uint256", internalType: "uint256" },
      { name: "pendingRequest", type: "uint256", internalType: "uint256" },
      { name: "revealedAt", type: "uint64", internalType: "uint64" },
      { name: "remaining", type: "uint32", internalType: "uint32" },
      { name: "minted", type: "uint32", internalType: "uint32" },
      { name: "dailyCommitted", type: "uint32", internalType: "uint32" },
      { name: "burned", type: "bool", internalType: "bool" }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "pauseRequests",
    inputs: [{ name: "paused", type: "bool", internalType: "bool" }],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "proofContext",
    inputs: [{ name: "id", type: "uint256", internalType: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct BoosterProofRecovery.ProofContext",
        components: [
          { name: "coordinator", type: "address", internalType: "address" },
          { name: "requestBlock", type: "uint64", internalType: "uint64" },
          { name: "confirmations", type: "uint16", internalType: "uint16" },
          { name: "blockhashStore", type: "address", internalType: "address" },
          { name: "chainId", type: "uint256", internalType: "uint256" }
        ]
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "proxiableUUID",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "quote",
    inputs: [
      { name: "packTypeId", type: "uint256", internalType: "uint256" },
      { name: "quantity", type: "uint32", internalType: "uint32" },
      { name: "gasPrice", type: "uint256", internalType: "uint256" }
    ],
    outputs: [
      { name: "price", type: "uint256", internalType: "uint256" },
      { name: "callbackGas", type: "uint32", internalType: "uint32" }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "rawFulfillRandomWords",
    inputs: [
      { name: "id", type: "uint256", internalType: "uint256" },
      { name: "words", type: "uint256[]", internalType: "uint256[]" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "recover",
    inputs: [{ name: "id", type: "uint256", internalType: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "refundCredits",
    inputs: [{ name: "", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "registry",
    inputs: [],
    outputs: [
      { name: "", type: "address", internalType: "contract PackRegistry" }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "renounceRole",
    inputs: [
      { name: "role", type: "bytes32", internalType: "bytes32" },
      { name: "callerConfirmation", type: "address", internalType: "address" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "requests",
    inputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    outputs: [
      { name: "originalId", type: "uint256", internalType: "uint256" },
      { name: "payer", type: "address", internalType: "address" },
      { name: "paid", type: "uint256", internalType: "uint256" },
      { name: "seed", type: "uint256", internalType: "uint256" },
      { name: "ruleHash", type: "bytes32", internalType: "bytes32" },
      { name: "receivedAt", type: "uint64", internalType: "uint64" },
      { name: "quantity", type: "uint32", internalType: "uint32" },
      { name: "executionGas", type: "uint32", internalType: "uint32" },
      {
        name: "status",
        type: "uint8",
        internalType: "enum BoosterPacks.Status"
      },
      { name: "opening", type: "bool", internalType: "bool" },
      { name: "received", type: "bool", internalType: "bool" }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "requestsPaused",
    inputs: [],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "restoreRandomness",
    inputs: [
      { name: "id", type: "uint256", internalType: "uint256" },
      {
        name: "proof",
        type: "tuple",
        internalType: "struct VRF.Proof",
        components: [
          { name: "pk", type: "uint256[2]", internalType: "uint256[2]" },
          { name: "gamma", type: "uint256[2]", internalType: "uint256[2]" },
          { name: "c", type: "uint256", internalType: "uint256" },
          { name: "s", type: "uint256", internalType: "uint256" },
          { name: "seed", type: "uint256", internalType: "uint256" },
          { name: "uWitness", type: "address", internalType: "address" },
          {
            name: "cGammaWitness",
            type: "uint256[2]",
            internalType: "uint256[2]"
          },
          {
            name: "sHashWitness",
            type: "uint256[2]",
            internalType: "uint256[2]"
          },
          { name: "zInv", type: "uint256", internalType: "uint256" }
        ]
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "revokeRole",
    inputs: [
      { name: "role", type: "bytes32", internalType: "bytes32" },
      { name: "account", type: "address", internalType: "address" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "supportsInterface",
    inputs: [{ name: "interfaceId", type: "bytes4", internalType: "bytes4" }],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "totalRefundLiability",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "upgradeToAndCall",
    inputs: [
      { name: "newImplementation", type: "address", internalType: "address" },
      { name: "data", type: "bytes", internalType: "bytes" }
    ],
    outputs: [],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "withdrawRefund",
    inputs: [
      { name: "recipient", type: "address", internalType: "address payable" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "wrapper",
    inputs: [],
    outputs: [
      { name: "", type: "address", internalType: "contract IVRFV2PlusWrapper" }
    ],
    stateMutability: "view"
  },
  {
    type: "event",
    name: "BlockhashCheckpointed",
    inputs: [
      {
        name: "blockNumber",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "blockHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "Initialized",
    inputs: [
      {
        name: "version",
        type: "uint64",
        indexed: false,
        internalType: "uint64"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "OriginalRevealed",
    inputs: [
      {
        name: "originalId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "packTypeId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "revealedAt",
        type: "uint64",
        indexed: false,
        internalType: "uint64"
      },
      {
        name: "totalVariants",
        type: "uint32",
        indexed: false,
        internalType: "uint32"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "PaymentBurned",
    inputs: [
      {
        name: "requestId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "payer",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "token",
        type: "address",
        indexed: false,
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
    name: "ProofContextRecorded",
    inputs: [
      {
        name: "requestId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "coordinator",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "blockhashStore",
        type: "address",
        indexed: false,
        internalType: "address"
      },
      {
        name: "requestBlock",
        type: "uint64",
        indexed: false,
        internalType: "uint64"
      },
      {
        name: "confirmations",
        type: "uint16",
        indexed: false,
        internalType: "uint16"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RandomnessReceived",
    inputs: [
      {
        name: "requestId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "seed",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      },
      {
        name: "receivedAt",
        type: "uint64",
        indexed: false,
        internalType: "uint64"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RandomnessRestored",
    inputs: [
      {
        name: "requestId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "submitter",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RecoveryRequired",
    inputs: [
      {
        name: "requestId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RefundCredited",
    inputs: [
      {
        name: "requester",
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
    name: "RefundReturned",
    inputs: [
      {
        name: "requester",
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
    name: "RefundWithdrawn",
    inputs: [
      {
        name: "requester",
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
    name: "RequestCompleted",
    inputs: [
      {
        name: "requestId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "originalId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "recipient",
        type: "address",
        indexed: false,
        internalType: "address"
      },
      {
        name: "quantity",
        type: "uint32",
        indexed: false,
        internalType: "uint32"
      },
      {
        name: "minted",
        type: "uint32",
        indexed: false,
        internalType: "uint32"
      },
      {
        name: "remaining",
        type: "uint32",
        indexed: false,
        internalType: "uint32"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RequestCreated",
    inputs: [
      {
        name: "requestId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "originalId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "packTypeId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "payer",
        type: "address",
        indexed: false,
        internalType: "address"
      },
      {
        name: "quantity",
        type: "uint32",
        indexed: false,
        internalType: "uint32"
      },
      { name: "opening", type: "bool", indexed: false, internalType: "bool" },
      {
        name: "paid",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      },
      {
        name: "ruleHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32"
      },
      {
        name: "callbackGas",
        type: "uint32",
        indexed: false,
        internalType: "uint32"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RequestForfeited",
    inputs: [
      {
        name: "requestId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "originalId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RequestsPaused",
    inputs: [
      { name: "paused", type: "bool", indexed: false, internalType: "bool" }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RoleAdminChanged",
    inputs: [
      { name: "role", type: "bytes32", indexed: true, internalType: "bytes32" },
      {
        name: "previousAdminRole",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32"
      },
      {
        name: "newAdminRole",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RoleGranted",
    inputs: [
      { name: "role", type: "bytes32", indexed: true, internalType: "bytes32" },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RoleRevoked",
    inputs: [
      { name: "role", type: "bytes32", indexed: true, internalType: "bytes32" },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "Upgraded",
    inputs: [
      {
        name: "implementation",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  { type: "error", name: "AccessControlBadConfirmation", inputs: [] },
  {
    type: "error",
    name: "AccessControlUnauthorizedAccount",
    inputs: [
      { name: "account", type: "address", internalType: "address" },
      { name: "neededRole", type: "bytes32", internalType: "bytes32" }
    ]
  },
  {
    type: "error",
    name: "AddressEmptyCode",
    inputs: [{ name: "target", type: "address", internalType: "address" }]
  },
  {
    type: "error",
    name: "ERC1967InvalidImplementation",
    inputs: [
      { name: "implementation", type: "address", internalType: "address" }
    ]
  },
  { type: "error", name: "ERC1967NonPayable", inputs: [] },
  { type: "error", name: "FailedCall", inputs: [] },
  { type: "error", name: "InvalidInitialization", inputs: [] },
  { type: "error", name: "NotInitializing", inputs: [] },
  { type: "error", name: "ReentrancyGuardReentrantCall", inputs: [] },
  {
    type: "error",
    name: "SafeERC20FailedOperation",
    inputs: [{ name: "token", type: "address", internalType: "address" }]
  },
  { type: "error", name: "UUPSUnauthorizedCallContext", inputs: [] },
  {
    type: "error",
    name: "UUPSUnsupportedProxiableUUID",
    inputs: [{ name: "slot", type: "bytes32", internalType: "bytes32" }]
  }
];
var yunipalMonstersAbiE8145098 = [
  {
    type: "function",
    name: "CONFIG_ROLE",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "DEFAULT_ADMIN_ROLE",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "PAUSER_ROLE",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "UPGRADER_ROLE",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "UPGRADE_INTERFACE_VERSION",
    inputs: [],
    outputs: [{ name: "", type: "string", internalType: "string" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "to", type: "address", internalType: "address" },
      { name: "tokenId", type: "uint256", internalType: "uint256" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "owner", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "burn",
    inputs: [{ name: "tokenId", type: "uint256", internalType: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "getApproved",
    inputs: [{ name: "tokenId", type: "uint256", internalType: "uint256" }],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "getRoleAdmin",
    inputs: [{ name: "role", type: "bytes32", internalType: "bytes32" }],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "grantRole",
    inputs: [
      { name: "role", type: "bytes32", internalType: "bytes32" },
      { name: "account", type: "address", internalType: "address" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [
      { name: "role", type: "bytes32", internalType: "bytes32" },
      { name: "account", type: "address", internalType: "address" }
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "initialize",
    inputs: [
      { name: "admin", type: "address", internalType: "address" },
      {
        name: "registry_",
        type: "address",
        internalType: "contract PackRegistry"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "isApprovedForAll",
    inputs: [
      { name: "owner", type: "address", internalType: "address" },
      { name: "operator", type: "address", internalType: "address" }
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "mintOffspring",
    inputs: [
      { name: "originalId", type: "uint256", internalType: "uint256" },
      { name: "recipient", type: "address", internalType: "address" },
      { name: "variantId", type: "uint32", internalType: "uint32" }
    ],
    outputs: [{ name: "id", type: "uint256", internalType: "uint256" }],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "mintOriginal",
    inputs: [
      { name: "tokenId", type: "uint256", internalType: "uint256" },
      { name: "recipient", type: "address", internalType: "address" },
      { name: "variantId", type: "uint32", internalType: "uint32" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "name",
    inputs: [],
    outputs: [{ name: "", type: "string", internalType: "string" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "nextTokenId",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "ownerOf",
    inputs: [{ name: "tokenId", type: "uint256", internalType: "uint256" }],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "provenance",
    inputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    outputs: [
      { name: "packTypeId", type: "uint256", internalType: "uint256" },
      { name: "originalTokenId", type: "uint256", internalType: "uint256" },
      { name: "variantId", type: "uint32", internalType: "uint32" },
      {
        name: "traits",
        type: "tuple",
        internalType: "struct PackRegistry.Traits",
        components: [
          { name: "monsterType", type: "uint32", internalType: "uint32" },
          { name: "color", type: "uint32", internalType: "uint32" },
          { name: "horn", type: "uint32", internalType: "uint32" },
          { name: "glitter", type: "uint32", internalType: "uint32" }
        ]
      },
      { name: "isOriginal", type: "bool", internalType: "bool" }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "proxiableUUID",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "registry",
    inputs: [],
    outputs: [
      { name: "", type: "address", internalType: "contract PackRegistry" }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "renounceRole",
    inputs: [
      { name: "role", type: "bytes32", internalType: "bytes32" },
      { name: "callerConfirmation", type: "address", internalType: "address" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "reserveOriginal",
    inputs: [{ name: "packTypeId", type: "uint256", internalType: "uint256" }],
    outputs: [{ name: "tokenId", type: "uint256", internalType: "uint256" }],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "reservedType",
    inputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "revokeRole",
    inputs: [
      { name: "role", type: "bytes32", internalType: "bytes32" },
      { name: "account", type: "address", internalType: "address" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "safeTransferFrom",
    inputs: [
      { name: "from", type: "address", internalType: "address" },
      { name: "to", type: "address", internalType: "address" },
      { name: "tokenId", type: "uint256", internalType: "uint256" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "safeTransferFrom",
    inputs: [
      { name: "from", type: "address", internalType: "address" },
      { name: "to", type: "address", internalType: "address" },
      { name: "tokenId", type: "uint256", internalType: "uint256" },
      { name: "data", type: "bytes", internalType: "bytes" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "setApprovalForAll",
    inputs: [
      { name: "operator", type: "address", internalType: "address" },
      { name: "approved", type: "bool", internalType: "bool" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "supportsInterface",
    inputs: [{ name: "interfaceId", type: "bytes4", internalType: "bytes4" }],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ name: "", type: "string", internalType: "string" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "tokenURI",
    inputs: [{ name: "tokenId", type: "uint256", internalType: "uint256" }],
    outputs: [{ name: "", type: "string", internalType: "string" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "transferFrom",
    inputs: [
      { name: "from", type: "address", internalType: "address" },
      { name: "to", type: "address", internalType: "address" },
      { name: "tokenId", type: "uint256", internalType: "uint256" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "upgradeToAndCall",
    inputs: [
      { name: "newImplementation", type: "address", internalType: "address" },
      { name: "data", type: "bytes", internalType: "bytes" }
    ],
    outputs: [],
    stateMutability: "payable"
  },
  {
    type: "event",
    name: "Approval",
    inputs: [
      {
        name: "owner",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "approved",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "tokenId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "ApprovalForAll",
    inputs: [
      {
        name: "owner",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "operator",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      { name: "approved", type: "bool", indexed: false, internalType: "bool" }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "Initialized",
    inputs: [
      {
        name: "version",
        type: "uint64",
        indexed: false,
        internalType: "uint64"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "MonsterMinted",
    inputs: [
      {
        name: "tokenId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "originalTokenId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "packTypeId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "recipient",
        type: "address",
        indexed: false,
        internalType: "address"
      },
      {
        name: "variantId",
        type: "uint32",
        indexed: false,
        internalType: "uint32"
      },
      {
        name: "monsterType",
        type: "uint32",
        indexed: false,
        internalType: "uint32"
      },
      { name: "color", type: "uint32", indexed: false, internalType: "uint32" },
      { name: "horn", type: "uint32", indexed: false, internalType: "uint32" },
      {
        name: "glitter",
        type: "uint32",
        indexed: false,
        internalType: "uint32"
      },
      { name: "isOriginal", type: "bool", indexed: false, internalType: "bool" }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "OriginalBurned",
    inputs: [
      {
        name: "tokenId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      },
      {
        name: "packTypeId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RoleAdminChanged",
    inputs: [
      { name: "role", type: "bytes32", indexed: true, internalType: "bytes32" },
      {
        name: "previousAdminRole",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32"
      },
      {
        name: "newAdminRole",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RoleGranted",
    inputs: [
      { name: "role", type: "bytes32", indexed: true, internalType: "bytes32" },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "RoleRevoked",
    inputs: [
      { name: "role", type: "bytes32", indexed: true, internalType: "bytes32" },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true, internalType: "address" },
      { name: "to", type: "address", indexed: true, internalType: "address" },
      {
        name: "tokenId",
        type: "uint256",
        indexed: true,
        internalType: "uint256"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "Upgraded",
    inputs: [
      {
        name: "implementation",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  { type: "error", name: "AccessControlBadConfirmation", inputs: [] },
  {
    type: "error",
    name: "AccessControlUnauthorizedAccount",
    inputs: [
      { name: "account", type: "address", internalType: "address" },
      { name: "neededRole", type: "bytes32", internalType: "bytes32" }
    ]
  },
  {
    type: "error",
    name: "AddressEmptyCode",
    inputs: [{ name: "target", type: "address", internalType: "address" }]
  },
  {
    type: "error",
    name: "ERC1967InvalidImplementation",
    inputs: [
      { name: "implementation", type: "address", internalType: "address" }
    ]
  },
  { type: "error", name: "ERC1967NonPayable", inputs: [] },
  {
    type: "error",
    name: "ERC721IncorrectOwner",
    inputs: [
      { name: "sender", type: "address", internalType: "address" },
      { name: "tokenId", type: "uint256", internalType: "uint256" },
      { name: "owner", type: "address", internalType: "address" }
    ]
  },
  {
    type: "error",
    name: "ERC721InsufficientApproval",
    inputs: [
      { name: "operator", type: "address", internalType: "address" },
      { name: "tokenId", type: "uint256", internalType: "uint256" }
    ]
  },
  {
    type: "error",
    name: "ERC721InvalidApprover",
    inputs: [{ name: "approver", type: "address", internalType: "address" }]
  },
  {
    type: "error",
    name: "ERC721InvalidOperator",
    inputs: [{ name: "operator", type: "address", internalType: "address" }]
  },
  {
    type: "error",
    name: "ERC721InvalidOwner",
    inputs: [{ name: "owner", type: "address", internalType: "address" }]
  },
  {
    type: "error",
    name: "ERC721InvalidReceiver",
    inputs: [{ name: "receiver", type: "address", internalType: "address" }]
  },
  {
    type: "error",
    name: "ERC721InvalidSender",
    inputs: [{ name: "sender", type: "address", internalType: "address" }]
  },
  {
    type: "error",
    name: "ERC721NonexistentToken",
    inputs: [{ name: "tokenId", type: "uint256", internalType: "uint256" }]
  },
  { type: "error", name: "FailedCall", inputs: [] },
  { type: "error", name: "InvalidInitialization", inputs: [] },
  { type: "error", name: "NotInitializing", inputs: [] },
  { type: "error", name: "UUPSUnauthorizedCallContext", inputs: [] },
  {
    type: "error",
    name: "UUPSUnsupportedProxiableUUID",
    inputs: [{ name: "slot", type: "bytes32", internalType: "bytes32" }]
  }
];

// ../../packages/yunipals-market-core/src/boosterSourceAbi.ts
var boosterSourceAbiHashes = {
  e8145098: {
    boosterPacks: "0x4127c2493eff266363adae3bb24fcf53038b7da4d72af5f517600e2a7920635d",
    yunipalMonsters: "0x680148b00be6884d25a426041f93861ac175dfe3535224636c46cdcb3daa3a94"
  },
  current: {
    boosterPacks: "0x05373e5a7d5e3152ef7f2bb71695871ee789322f2d516004bff21a409e5aaf6c",
    yunipalMonsters: "0x0929ebf2bcf3ca334e1e5425ebf1ce23faa35243f68aac7b1b3d3aca94b3718f"
  }
};
var UnsupportedBoosterSourceAbi = class extends Error {
  constructor() {
    super("Unsupported booster source ABI.");
  }
};
function boosterPacksSourceAbi(sourceAbiHash) {
  switch (sourceAbiHash) {
    case void 0:
    case boosterSourceAbiHashes.current.boosterPacks:
      return boosterPacksAbi;
    case boosterSourceAbiHashes.e8145098.boosterPacks:
      return boosterPacksAbiE8145098;
    default:
      throw new UnsupportedBoosterSourceAbi();
  }
}
function yunipalMonstersSourceAbi(sourceAbiHash) {
  switch (sourceAbiHash) {
    case void 0:
    case boosterSourceAbiHashes.current.yunipalMonsters:
      return yunipalMonstersAbi;
    case boosterSourceAbiHashes.e8145098.yunipalMonsters:
      return yunipalMonstersAbiE8145098;
    default:
      throw new UnsupportedBoosterSourceAbi();
  }
}

// ../../packages/yunipals-market-core/src/seaportEvents.ts
import { parseAbi as parseAbi2 } from "viem";
var seaportEventAbi = parseAbi2([
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

// ../../packages/yunipals-market-core/src/indexedAction.ts
var InvalidIndexedActionRequest = class extends Error {
};
var UnsupportedIndexedAction = class extends Error {
};
var hash = /^0x[0-9a-fA-F]{64}$/;
var address = /^0x[0-9a-fA-F]{40}$/;
var decimal = /^(0|[1-9][0-9]{0,77})$/;
function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InvalidIndexedActionRequest();
  return value;
}
function keys(value, expected) {
  if (Object.keys(value).length !== expected.length || expected.some((key) => !Object.hasOwn(value, key)))
    throw new InvalidIndexedActionRequest();
}
function hex(value, pattern) {
  if (typeof value !== "string" || !pattern.test(value))
    throw new InvalidIndexedActionRequest();
  return value.toLowerCase();
}
function uint(value) {
  if (typeof value !== "string" || !decimal.test(value) || BigInt(value) >= 2n ** 256n)
    throw new InvalidIndexedActionRequest();
  return value;
}
function uint32(value, positive = false) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (positive ? 1 : 0) || value >= 2 ** 32)
    throw new InvalidIndexedActionRequest();
  return value;
}
function parseIndexedActionRequest(input) {
  const value = object(input);
  keys(value, [
    "version",
    "releaseId",
    "readIdentity",
    "chainId",
    "transactionHash",
    "blockNumber",
    "blockHash",
    "action"
  ]);
  if (value.version !== 1) throw new InvalidIndexedActionRequest();
  const raw = object(value.action);
  let action;
  if (raw.kind === "bnb-validate" || raw.kind === "bnb-cancel") {
    keys(raw, ["kind", "orderHash", "offerer"]);
    if (value.chainId !== 56) throw new InvalidIndexedActionRequest();
    action = {
      kind: raw.kind,
      orderHash: hex(raw.orderHash, hash),
      offerer: hex(raw.offerer, address)
    };
  } else if (raw.kind === "booster-request-created") {
    keys(raw, [
      "kind",
      "requestId",
      "originalId",
      "packTypeId",
      "payer",
      "quantity",
      "opening",
      "paid",
      "ruleHash",
      "callbackGas"
    ]);
    if (value.chainId !== 8453 || typeof raw.opening !== "boolean")
      throw new InvalidIndexedActionRequest();
    action = {
      kind: raw.kind,
      requestId: uint(raw.requestId),
      originalId: uint(raw.originalId),
      packTypeId: uint(raw.packTypeId),
      payer: hex(raw.payer, address),
      quantity: uint32(raw.quantity, true),
      opening: raw.opening,
      paid: uint(raw.paid),
      ruleHash: hex(raw.ruleHash, hash),
      callbackGas: uint32(raw.callbackGas, true)
    };
  } else {
    throw new UnsupportedIndexedAction();
  }
  return {
    version: 1,
    releaseId: hex(value.releaseId, hash),
    readIdentity: hex(value.readIdentity, hash),
    chainId: value.chainId,
    transactionHash: hex(value.transactionHash, hash),
    blockNumber: uint(value.blockNumber),
    blockHash: hex(value.blockHash, hash),
    action
  };
}
function indexedActionAbi(action, sourceAbiHash) {
  return action.kind === "booster-request-created" ? boosterPacksSourceAbi(sourceAbiHash) : seaportEventAbi;
}
function indexedActionEventName(action) {
  return action.kind === "booster-request-created" ? "RequestCreated" : action.kind === "bnb-validate" ? "OrderValidated" : "OrderCancelled";
}
function decodeIndexedActionLog(action, log, sourceAbiHash) {
  const decoded = decodeEventLog({
    abi: indexedActionAbi(action, sourceAbiHash),
    topics: log.topics,
    data: log.data,
    strict: true
  });
  if (decoded.eventName !== indexedActionEventName(action))
    throw new Error("Unexpected indexed action event.");
  const args = decoded.args;
  if (!args || typeof args !== "object" || Array.isArray(args))
    throw new Error("Expected named indexed action arguments.");
  return args;
}
function matchesIndexedAction(action, args) {
  const sameAddress = (value, expected) => typeof value === "string" && value.toLowerCase() === expected;
  if (action.kind === "booster-request-created")
    return String(args.requestId) === action.requestId && String(args.originalId) === action.originalId && String(args.packTypeId) === action.packTypeId && sameAddress(args.payer, action.payer) && args.quantity === action.quantity && args.opening === action.opening && String(args.paid) === action.paid && args.ruleHash === action.ruleHash && args.callbackGas === action.callbackGas;
  const offerer = action.kind === "bnb-validate" ? args.orderParameters?.offerer : args.offerer;
  return args.orderHash === action.orderHash && sameAddress(offerer, action.offerer);
}

// ../../packages/yunipals-market-core/src/registry.ts
var seaportDeployment = {
  address: "0x0000000000000068F116a894984e2DB1123eB395",
  name: "Seaport",
  version: "1.6"
};

// ../../packages/yunipals-market-core/src/seaportRuntime.ts
var seaportRuntimeHashes = {
  1: "0x74499ac0cce14428e4b41541d5e44f28f5a6882a1051d0118867c2a93cd5aec0",
  56: "0x16bd146d392a011a996f447b813623d4857ba2d7621af38194a009cbc03ab5f4",
  137: "0x24fd52b9fba5545dabf736449aa4f2beed9562a4a641d2f6c85ca05eeed35d52",
  8453: "0x2d5cb8553e21a19550413299c05a6493cc606fb0000b5042328a5ba06bfdaf35"
};

// ../../packages/yunipals-market-core/src/receiptEvidence.ts
import {
  formatTransactionReceipt,
  hexToBytes,
  keccak256,
  toHex
} from "viem";
function object2(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_receipt");
  return value;
}
function quantity(value) {
  if (typeof value !== "string" || value.length > 66 || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value))
    throw new Error("invalid_receipt_quantity");
  return BigInt(value);
}
function safeInteger(value) {
  const number = Number(quantity(value));
  if (!Number.isSafeInteger(number)) throw new Error("invalid_receipt_index");
  return number;
}
function hex2(value, bytes) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/i.test(value) || bytes !== void 0 && value.length !== 2 + bytes * 2)
    throw new Error("invalid_receipt_hex");
  return value.toLowerCase();
}
function receiptLogsBloom(logs) {
  const bloom = new Uint8Array(256);
  for (const log of logs) {
    for (const value of [log.address, ...log.topics]) {
      const digest = hexToBytes(keccak256(value));
      for (let offset = 0; offset < 6; offset += 2) {
        const bit = (digest[offset] << 8 | digest[offset + 1]) & 2047;
        bloom[255 - (bit >> 3)] |= 1 << (bit & 7);
      }
    }
  }
  return toHex(bloom);
}
function validateTransactionReceipt(candidate, input, block, expectedLogs, options = {}) {
  const maxBytes = options.maxBytes ?? 2e6;
  const maxLogs = options.maxLogs ?? 1e4;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(maxLogs) || maxLogs < 1)
    throw new Error("invalid_receipt_limits");
  const encoded = JSON.stringify(input);
  if (!encoded || Buffer.byteLength(encoded) > maxBytes)
    throw new Error("receipt_too_large");
  const raw = object2(input);
  if (raw.status !== "0x1" || hex2(raw.blockHash, 32) !== candidate.blockHash || hex2(raw.transactionHash, 32) !== candidate.transactionHash || quantity(raw.blockNumber) !== candidate.blockNumber || block.number !== candidate.blockNumber || block.hash !== candidate.blockHash || block.timestamp < 0n) {
    throw new Error("receipt_identity_mismatch");
  }
  const transactionIndex = safeInteger(raw.transactionIndex);
  hex2(raw.from, 20);
  if (raw.to !== null) hex2(raw.to, 20);
  if (raw.contractAddress !== null) hex2(raw.contractAddress, 20);
  for (const field of [
    "gasUsed",
    "cumulativeGasUsed",
    "effectiveGasPrice",
    "type"
  ])
    quantity(raw[field]);
  if (!Array.isArray(raw.logs) || !raw.logs.length || raw.logs.length > maxLogs || expectedLogs.length > maxLogs)
    throw new Error("invalid_receipt_logs");
  let previous = -1;
  const logs = raw.logs.map((value) => {
    const log = object2(value);
    const logIndex = safeInteger(log.logIndex);
    if (logIndex <= previous || previous >= 0 && logIndex !== previous + 1 || log.removed !== false || hex2(log.blockHash, 32) !== candidate.blockHash || quantity(log.blockNumber) !== candidate.blockNumber || hex2(log.transactionHash, 32) !== candidate.transactionHash || safeInteger(log.transactionIndex) !== transactionIndex || !Array.isArray(log.topics) || log.topics.length > 4)
      throw new Error("incomplete_receipt_logs");
    previous = logIndex;
    return {
      address: hex2(log.address, 20),
      logIndex,
      transactionIndex,
      data: hex2(log.data),
      topics: log.topics.map((topic) => hex2(topic, 32))
    };
  });
  for (const expected of expectedLogs) {
    const log = logs.find((log2) => log2.logIndex === expected.logIndex);
    if (!log || log.address !== expected.address || log.transactionIndex !== expected.transactionIndex || log.data !== expected.data || JSON.stringify(log.topics) !== JSON.stringify(expected.topics))
      throw new Error("indexed_log_missing_from_receipt");
  }
  if (receiptLogsBloom(logs) !== hex2(raw.logsBloom, 256))
    throw new Error("receipt_bloom_mismatch");
  const hasSeaport = logs.some(
    (log) => log.address === seaportDeployment.address.toLowerCase()
  );
  return {
    raw,
    receipt: formatTransactionReceipt(raw),
    hasSeaport
  };
}

// ../../packages/yunipals-indexer-server/src/database.ts
function sqlIdentifier2(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value) || Buffer.byteLength(value) > 63)
    throw new Error("Invalid shared indexer SQL identifier.");
  return `"${value}"`;
}
async function indexerTransaction(pool2, task, readOnly = false) {
  const db = await pool2.connect();
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

// ../../packages/yunipals-indexer-server/src/identity.ts
import { createHash as createHash5 } from "node:crypto";

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
var decimal2 = /^(0|[1-9][0-9]*)$/;
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
      if (value !== null && (!decimal2.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER))) {
        throw new Error(`Invalid source block: ${source.id}.`);
      }
    }
    if (source.enabled && (source.address === null || source.startBlock === null) || source.endBlock !== null && (source.startBlock === null || BigInt(source.endBlock) < BigInt(source.startBlock))) {
      throw new Error(`Incomplete source bounds: ${source.id}.`);
    }
    if (source.receiptStartBlock !== void 0 && (!source.enabled || source.receiptRequirement !== "full" || typeof source.receiptStartBlock !== "string" || !decimal2.test(source.receiptStartBlock) || BigInt(source.receiptStartBlock) > BigInt(Number.MAX_SAFE_INTEGER) || source.startBlock === null || BigInt(source.receiptStartBlock) < BigInt(source.startBlock) || source.endBlock !== null && BigInt(source.receiptStartBlock) > BigInt(source.endBlock))) {
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
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object3 = value;
    return `{${Object.keys(object3).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object3[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === void 0)
    throw new Error("Manifest contains a non-JSON value.");
  return encoded;
}
function manifestDigest(value) {
  return `0x${createHash5("sha256").update(stableJson(value)).digest("hex")}`;
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

// ../../packages/yunipals-indexer-server/src/event-topics.ts
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
  const schema = sqlIdentifier2(schemaName);
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
  if (new Set(chains2.map((chain2) => chain2.chainId)).size !== chains2.length) {
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
    (witness) => !chains2.some((chain2) => chain2.chainId === witness.chainId)
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
    `SELECT id,chain_id,manifest_hash,definition FROM ${sqlIdentifier2(release.schema)}.indexer_source ORDER BY id`
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

// ../../packages/yunipals-indexer-client/src/readiness.ts
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
  const available = indexed < boundary ? indexed : boundary;
  return result(
    available >= required && required >= BigInt(source.startBlock) && (!latestComplete || snapshot.frameworkReady) ? "ready" : "catching_up",
    available < BigInt(source.startBlock) ? null : available,
    required
  );
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

// ../../packages/yunipals-indexer-server/src/status.ts
async function readIndexerSourceStatus(db, release, sourceId, policy, options = {}) {
  const source = release.manifest.sources.find(
    (source2) => source2.id === sourceId
  );
  if (!source) throw new Error("Unknown shared indexer source.");
  const runtime = await readBoundRuntime(db, release);
  const status = await readChainStatus(db, release.id, source.chainId);
  const indexed = runtime.chains.find((chain2) => chain2.chainId === source.chainId)?.completeThroughBlock ?? null;
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
      `SELECT 1 FROM ${sqlIdentifier2(release.schema)}.chain_block
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

// ../../packages/yunipals-indexer-server/src/action-evidence.ts
var hash2 = /^0x[0-9a-f]{64}$/;
var address2 = /^0x[0-9a-f]{40}$/;
var decimal3 = /^(0|[1-9][0-9]{0,77})$/;
var maxEvents = 256;
var maxPointBytes = 524288;
var EvidenceUnavailable = class extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
};
function unavailable(reason) {
  throw new EvidenceUnavailable(reason);
}
function compiledAbiDigest(select) {
  try {
    return manifestDigest(select());
  } catch {
    unavailable("source_definition_mismatch");
  }
}
function unsigned(value) {
  return typeof value === "string" && decimal3.test(value);
}
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function normalizedArgs(value) {
  return JSON.parse(
    JSON.stringify(
      value,
      (_key, item) => typeof item === "bigint" ? item.toString() : typeof item === "string" && /^0x[0-9a-f]+$/i.test(item) ? item.toLowerCase() : item
    )
  );
}
async function selectedFrame(db, binding) {
  sqlIdentifier2(binding.physicalSchema);
  const read = sqlIdentifier2(binding.readSchema);
  if (!hash2.test(binding.releaseId) || binding.readSchema === binding.physicalSchema)
    unavailable("source_selection_changed");
  const release = await loadIndexerRelease(db, binding.releaseId);
  if (release.id !== binding.releaseId || release.schema !== binding.physicalSchema)
    unavailable("source_selection_changed");
  const markers = (await db.query(
    `SELECT identity,release_id,manifest_hash FROM ${read}._unified_read_release WHERE singleton LIMIT 2`
  )).rows;
  const marker = markers[0];
  if (markers.length !== 1 || !hash2.test(marker.identity) || marker.release_id !== release.id || marker.manifest_hash !== release.manifestHash)
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
async function readIndexedActionSelection(pool2, binding) {
  return indexerTransaction(
    pool2,
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
function sourceFor(release, request) {
  const booster = request.action.kind === "booster-request-created";
  const source = release.manifest.sources.find(
    (item) => item.id === (booster ? "boosters:boosterengine" : "marketplace:bnb:seaport")
  );
  if (!source?.enabled) return null;
  if (source.chainId !== request.chainId || source.feature !== (booster ? "boosters" : "marketplace") || source.contractName !== (booster ? "BoosterEngine" : "BnbSeaport") || !source.address || !address2.test(source.address) || /^0x0{40}$/.test(source.address) || !booster && source.address !== seaportDeployment.address.toLowerCase() || !unsigned(source.startBlock) || source.abiHash !== compiledAbiDigest(
    () => indexedActionAbi(request.action, source.abiHash)
  ) || !source.events.includes(indexedActionEventName(request.action)) || source.receiptRequirement !== (booster ? "none" : "full") || !source.policies.some((policy) => policy.kind === "latest"))
    unavailable("source_definition_mismatch");
  return source;
}
function checkedLog(row, source, request) {
  if (row.source_id !== source.id || row.chain_id !== source.chainId || row.address !== source.address || row.abi_hash !== source.abiHash || !source.events.includes(row.name) || !unsigned(row.block_number) || BigInt(row.block_number) < BigInt(source.startBlock) || !hash2.test(row.block_hash) || row.transaction_hash !== request.transactionHash || !Number.isSafeInteger(row.transaction_index) || row.transaction_index < 0 || !Number.isSafeInteger(row.log_index) || row.log_index < 0 || row.id !== `${source.chainId}:${source.address}:${row.transaction_hash}:${row.log_index}`)
    unavailable("canonical_event_invalid");
  let topics, args;
  try {
    topics = parseIndexedEventTopics(row.topics);
    args = JSON.parse(row.args);
  } catch {
    unavailable("canonical_event_invalid");
  }
  if (!Array.isArray(topics) || topics.length < 1 || topics.length > 4 || topics.some((item) => typeof item !== "string" || !hash2.test(item)) || typeof row.data !== "string" || !/^0x(?:[0-9a-f]{2})*$/.test(row.data) || !record(args))
    unavailable("canonical_event_invalid");
  return {
    address: row.address,
    logIndex: row.log_index,
    transactionIndex: row.transaction_index,
    topics,
    data: row.data,
    args
  };
}
async function readIndexedActionEvidence(pool2, binding, input) {
  const request = parseIndexedActionRequest(input);
  const booster = request.action.kind === "booster-request-created";
  const result = {
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
  const finish = (state, reason) => ({
    ...result,
    state,
    reason
  });
  try {
    return await indexerTransaction(
      pool2,
      async (db) => {
        await db.query("SET LOCAL statement_timeout = '2000ms'");
        await db.query("SET LOCAL lock_timeout = '500ms'");
        const schema = sqlIdentifier2(binding.physicalSchema);
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
        if (manifestDigest(status.source) !== manifestDigest(source) || !["ready", "catching_up"].includes(status.readiness.reason) || !status.anchor || status.readiness.availableThroughBlock === null || status.snapshot.completeThroughBlock === null)
          unavailable("source_unavailable");
        result.coverage = {
          sourceId: source.id,
          policy: "latest",
          completeThroughBlock: String(status.snapshot.completeThroughBlock),
          availableThroughBlock: String(status.readiness.availableThroughBlock),
          finalizedThroughBlock: status.snapshot.finalized?.blockNumber.toString() ?? null,
          anchor: { number: status.anchor.number, hash: status.anchor.hash },
          observationRevision: status.observationRevision === null ? null : String(status.observationRevision)
        };
        const number = BigInt(request.blockNumber);
        if (number < BigInt(source.startBlock) || source.endBlock !== null && number > BigInt(source.endBlock) || source.receiptRequirement === "full" && number < BigInt(source.receiptStartBlock ?? source.startBlock))
          return finish("unsupported", "history_unsupported");
        if (number > status.readiness.availableThroughBlock)
          return finish("awaiting_indexing", "block_not_indexed");
        const rows = (await db.query(
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
        )).rows;
        if (rows.length > maxEvents || rows.some(
          (row) => !unsigned(row.point_bytes) || BigInt(row.point_bytes) > BigInt(maxPointBytes)
        ))
          unavailable("event_limit_exceeded");
        const logs = rows.map((row) => checkedLog(row, source, request));
        if (new Set(rows.map((row) => row.log_index)).size !== rows.length || new Set(rows.map((row) => row.transaction_index)).size > 1)
          unavailable("canonical_event_invalid");
        if (rows.some(
          (row) => row.block_number !== request.blockNumber || row.block_hash !== request.blockHash
        ))
          return finish("inclusion_changed", "inclusion_changed");
        const witnesses = (await db.query(
          `SELECT block_hash FROM ${schema}.chain_block WHERE chain_id=$1 AND block_number=$2::bigint LIMIT 2`,
          [request.chainId, request.blockNumber]
        )).rows;
        if (witnesses.length > 1) unavailable("canonical_event_invalid");
        if (witnesses[0] && witnesses[0].block_hash !== request.blockHash)
          return finish("inclusion_changed", "inclusion_changed");
        if (!rows.length && !witnesses.length)
          unavailable("inclusion_evidence_unavailable");
        const matches = rows.filter((row, index) => {
          if (row.name !== indexedActionEventName(request.action)) return false;
          try {
            const args = decodeIndexedActionLog(
              request.action,
              logs[index],
              source.abiHash
            );
            if (manifestDigest(normalizedArgs(args)) !== manifestDigest(normalizedArgs(logs[index].args)))
              unavailable("canonical_event_invalid");
            return matchesIndexedAction(request.action, args);
          } catch {
            unavailable("canonical_event_invalid");
          }
        });
        if (!matches.length)
          return finish("action_not_observed", "action_not_observed");
        let receiptPayloadHash = null;
        if (source.receiptRequirement === "full") {
          const candidates = (await db.query(
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
          )).rows;
          const candidate = candidates[0];
          if (candidates.length !== 1 || !candidate || candidate.chain_id !== request.chainId || candidate.block_number !== request.blockNumber || candidate.block_hash !== request.blockHash || candidate.transaction_hash !== request.transactionHash)
            unavailable("receipt_candidate_missing");
          if (candidate.payload_hash === null)
            return finish("awaiting_receipt", "receipt_not_enriched");
          try {
            if (candidate.too_large !== false || candidate.evidence_block_number !== request.blockNumber || !hash2.test(candidate.payload_hash) || !record(candidate.block) || transactionEvidenceHash(candidate.receipt, candidate.block) !== candidate.payload_hash || candidate.block.number !== request.blockNumber || candidate.block.hash !== request.blockHash || typeof candidate.block.parentHash !== "string" || !hash2.test(candidate.block.parentHash) || !unsigned(candidate.block.timestamp) || candidate.block.seaportRuntimeHash !== seaportRuntimeHashes[56])
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
          if (!monsters?.enabled || monsters.chainId !== 8453 || monsters.feature !== "boosters" || monsters.contractName !== "BoosterMonsters" || !monsters.address || !address2.test(monsters.address) || monsters.abiHash !== compiledAbiDigest(
            () => yunipalMonstersSourceAbi(monsters.abiHash)
          ))
            unavailable("source_definition_mismatch");
          const projection = (await db.query(
            `SELECT engine,request_id,original_key,payer,quantity,opening,paid,rule_hash,callback_gas,transaction_hash
          FROM ${schema}.booster_request WHERE id=$1 LIMIT 2`,
            [boosterIdentity(source.address, action.requestId)]
          )).rows;
          const row = projection[0];
          if (projection.length !== 1 || !row || row.engine !== source.address || row.request_id !== action.requestId || row.original_key !== boosterIdentity(monsters.address, action.originalId) || row.payer !== action.payer || row.quantity !== action.quantity || row.opening !== action.opening || row.paid !== action.paid || row.rule_hash !== action.ruleHash || row.callback_gas !== action.callbackGas || row.transaction_hash !== request.transactionHash)
            unavailable("projection_inconsistent");
          result.application = {
            state: "applied",
            component: "booster_request"
          };
        }
        result.proof = {
          kind: source.receiptRequirement === "full" ? "canonical_event_and_full_receipt" : "canonical_event",
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
    result.proof = null;
    result.application = {
      state: "not_evaluated",
      component: booster ? "booster_request" : "marketplace"
    };
    return finish(
      "source_unavailable",
      error instanceof EvidenceUnavailable ? error.reason : "source_read_unavailable"
    );
  }
}

// lib/api/action-evidence-routes.ts
function registerActionEvidenceRoutes(app2, dependencies) {
  const route = new Hono4();
  const unavailable2 = {
    version: 1,
    state: "source_unavailable",
    reason: "source_read_unavailable"
  };
  route.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  route.use(
    "*",
    bodyLimit2({
      maxSize: 8192,
      onError: (c) => c.json({ error: "action_evidence_request_too_large" }, 413)
    })
  );
  route.onError((_error, c) => c.json(unavailable2, 503));
  route.get("/", async (c) => {
    const binding = dependencies.selection();
    if (!binding) return c.json(unavailable2, 503);
    const value = await (dependencies.readSelection ?? readIndexedActionSelection)(dependencies.pool, binding);
    c.header("X-Indexer-Release", value.identity.releaseId);
    return c.json(value);
  });
  route.post("/", async (c) => {
    let input;
    try {
      input = parseIndexedActionRequest(await c.req.json());
    } catch (error) {
      if (error instanceof UnsupportedIndexedAction)
        return c.json(
          { version: 1, state: "unsupported", reason: "action_not_supported" },
          422
        );
      if (error instanceof InvalidIndexedActionRequest || error instanceof SyntaxError)
        return c.json({ error: "invalid_action_evidence_request" }, 400);
      throw error;
    }
    const binding = dependencies.selection();
    if (!binding) return c.json(unavailable2, 503);
    const value = await (dependencies.readEvidence ?? readIndexedActionEvidence)(dependencies.pool, binding, input);
    if (value.identity) c.header("X-Indexer-Release", value.identity.releaseId);
    return c.json(
      value,
      value.reason === "source_selection_changed" ? 409 : value.state === "source_unavailable" ? 503 : value.state === "unsupported" ? 422 : 200
    );
  });
  app2.route("/v1/indexer/action-evidence", route);
}

// lib/solana/api.ts
import { createHash as createHash6 } from "node:crypto";

// lib/solana/das.ts
var alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
var digit = new Map(
  [...alphabet].map((character, index) => [character, BigInt(index)])
);
function isSolanaAddress(value) {
  if (typeof value !== "string" || value.length < 32 || value.length > 44)
    return false;
  let number = 0n;
  for (const character of value) {
    const next = digit.get(character);
    if (next === void 0) return false;
    number = number * 58n + next;
  }
  let bytes = 0;
  for (let n = number; n > 0n; n >>= 8n) bytes++;
  return value.match(/^1*/)?.[0].length + bytes === 32;
}

// lib/solana/api.ts
init_read_snapshot();
var solanaApiEnabled = () => process.env.SOLANA_API_ENABLED === "true";
var selection = (url) => new URL(url).searchParams.getAll("chain");
var wantsSolana = (url) => selection(url).includes("solana");
var solanaOnly = (url) => {
  const values = selection(url);
  return values.length > 0 && values.every((value) => value === "solana");
};
var chainJson = { chain: "solana", chains: ["solana"] };
var sorts = [
  "token-id-asc",
  "token-id-desc",
  "rarity-desc",
  "rarity-asc",
  "rarity-capped-desc",
  "rarity-capped-asc"
];
var metrics = {
  "total-rarity": { column: "total_rarity", label: "Total rarity" },
  "monster-count": { column: "monster_count", label: "Monster count" },
  "unique-types": { column: "unique_types", label: "Unique types" },
  "special-count": { column: "special_count", label: "Special count" },
  "glitter-count": { column: "glitter_count", label: "Glitter count" },
  "collector-score": { column: "collector_score", label: "Collector score" }
};
var limitOf = (raw) => {
  if (raw === void 0) return 50;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1 && value <= 100 ? value : null;
};
var hash3 = (value) => createHash6("sha256").update(JSON.stringify(value)).digest("base64url").slice(0, 20);
var encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
var decode = (value) => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString());
    return parsed?.v === 1 && Number.isSafeInteger(parsed.run) && Number.isSafeInteger(parsed.offset) && parsed.offset >= 0 && parsed.offset <= 1e5 && typeof parsed.config === "string" ? parsed : null;
  } catch {
    return null;
  }
};
async function published(client) {
  const row = (await client.query(
    `SELECT r.id::text AS "runId",r.completed_at AS "completedAt",
      r.asset_count AS "manifestCount",r.missing_count AS "missingCount"
      FROM solana_indexer.sync_state s JOIN solana_indexer.scan_run r ON r.id=s.published_run_id
      JOIN solana_indexer.manifest manifest ON manifest.singleton AND manifest.checksum=r.manifest_checksum
        AND manifest.asset_count=r.asset_count
      WHERE s.singleton AND r.state='published'`
  )).rows[0];
  return row ? { ...row, runId: Number(row.runId) } : null;
}
var isFresh = (run) => {
  const age = run ? Date.now() - new Date(run.completedAt).getTime() : null;
  return age !== null && age >= 0 && age < 864e5;
};
async function solanaStatus(pool2) {
  const row = (await pool2.query(`SELECT
    (SELECT row_to_json(x) FROM(SELECT r.id::text AS "runId",r.completed_at AS "completedAt",
      r.asset_count AS "manifestCount",r.missing_count AS "missingCount"
      FROM solana_indexer.sync_state s JOIN solana_indexer.scan_run r ON r.id=s.published_run_id
      JOIN solana_indexer.manifest manifest ON manifest.singleton AND manifest.checksum=r.manifest_checksum
        AND manifest.asset_count=r.asset_count
      WHERE s.singleton AND r.state='published')x) AS run,
    (SELECT row_to_json(x) FROM(SELECT next_scan_at AS "nextScanAt",last_error AS "lastError",updated_at AS "updatedAt"
      FROM solana_indexer.sync_state WHERE singleton)x) AS state,
    (SELECT row_to_json(x) FROM(SELECT COALESCE(sum(credits) FILTER
      (WHERE reserved_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)::int AS "todayCredits",
      COALESCE(sum(credits),0)::int AS "rolling31DayCredits" FROM solana_indexer.rpc_usage
      WHERE reserved_at>=now()-interval '31 days')x) AS usage,
    (SELECT row_to_json(x) FROM(SELECT count(*)::int AS "indexedTokens",
      count(*) FILTER(WHERE NOT burnt)::int AS "activeSupply",count(*) FILTER(WHERE burnt)::int AS "burnedTokens"
      FROM solana_indexer.token)x) AS tokens,
    (SELECT row_to_json(x) FROM(SELECT checksum,release_id FROM solana_indexer.manifest WHERE singleton)x) AS manifest`)).rows[0];
  const run = row.run;
  const ageMs = run ? Date.now() - new Date(run.completedAt).getTime() : null;
  return {
    enabled: solanaApiEnabled(),
    sourceKind: "observed-snapshot",
    network: "mainnet-beta",
    manifestChecksum: row.manifest?.checksum ?? null,
    metadataReleaseId: row.manifest?.release_id ?? null,
    ready: !!run && ageMs !== null && ageMs >= 0 && ageMs < 864e5,
    freshness: ageMs === null ? "unavailable" : ageMs < 0 || ageMs > 18e5 ? "stale" : "fresh",
    publishedRunId: run ? Number(run.runId) : null,
    publishedAt: run?.completedAt ?? null,
    manifestCount: run?.manifestCount ?? null,
    missingCount: run?.missingCount ?? null,
    ...row.tokens,
    ...row.state,
    rpc: row.usage
  };
}
function tokenColumns() {
  return `t.mint AS "tokenId",'solana'::text AS chain,'exomon'::text AS collection,
  'mainnet-beta'::text AS network,NULL::integer AS "chainId",NULL::text AS "contractAddress",
  t.owner,t.burnt AS burned,t.delegated,t.delegate,t.observed_at AS "ownershipObservedAt",
  t.metadata_uri AS "tokenUri",t.metadata_slot AS "metadataIndexedSlot",
  a.legacy_alias AS "legacyAlias",m.name,m.image,m.attributes,
  true AS "metadataAvailable",m.rarity_points::text AS "rarityPoints",
  m.rarity_points_capped::text AS "rarityPointsCapped"`;
}
async function tokenPage(pool2, url, ownerOverride) {
  const query = new URL(url).searchParams;
  const owner = ownerOverride ?? query.get("owner");
  if (owner && !isSolanaAddress(owner))
    return { error: "invalid_solana_owner", status: 400 };
  const limit = limitOf(query.get("limit") ?? void 0);
  if (limit === null) return { error: "invalid_limit", status: 400 };
  const sort = query.get("sort") ?? "token-id-asc";
  if (!sorts.includes(sort))
    return { error: "invalid_sort", status: 400 };
  const burned = query.get("burned");
  if (burned !== null && burned !== "true" && burned !== "false")
    return { error: "invalid_burned", status: 400 };
  const metadata = query.get("metadata") ?? "all";
  if (!["all", "available", "missing"].includes(metadata))
    return { error: "invalid_metadata_filter", status: 400 };
  const traitTypes = query.getAll("traitType"), traitValues2 = query.getAll("traitValue");
  if (traitTypes.length !== traitValues2.length || traitTypes.some((v) => !v) || traitValues2.some((v) => !v))
    return { error: "invalid_trait_filter", status: 400 };
  const rarityKeys = [
    "rarityMin",
    "rarityMax",
    "rarityCappedMin",
    "rarityCappedMax"
  ];
  for (const key of rarityKeys)
    if (query.has(key) && !/^-?\d+(\.\d+)?$/.test(query.get(key)))
      return { error: `invalid_${key}`, status: 400 };
  if (query.has("rarityMin") && query.has("rarityMax") && Number(query.get("rarityMin")) > Number(query.get("rarityMax")))
    return { error: "invalid_rarity_range", status: 400 };
  if (query.has("rarityCappedMin") && query.has("rarityCappedMax") && Number(query.get("rarityCappedMin")) > Number(query.get("rarityCappedMax")))
    return { error: "invalid_rarity_range", status: 400 };
  const traitGroups = /* @__PURE__ */ new Map();
  for (let i = 0; i < traitTypes.length; i++)
    traitGroups.set(traitTypes[i], [
      .../* @__PURE__ */ new Set([...traitGroups.get(traitTypes[i]) ?? [], traitValues2[i]])
    ]);
  const normalizedTraits = [...traitGroups].sort(([a], [b]) => a.localeCompare(b)).map(([type, values]) => [type, values.sort()]);
  const config = hash3({
    owner,
    burned,
    metadata,
    sort,
    traits: normalizedTraits,
    rarityKeys: rarityKeys.map((key) => query.get(key))
  });
  const rawCursor = query.get("cursor") ?? void 0, cursor = decode(rawCursor);
  if (rawCursor && (!cursor || cursor.config !== config))
    return { error: "invalid_cursor", status: 400 };
  const client = await pool2.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const run = await published(client);
    if (!isFresh(run)) {
      await client.query("COMMIT");
      return { error: "solana_ownership_unavailable", status: 503 };
    }
    if (cursor && cursor.run !== run.runId) {
      await client.query("COMMIT");
      return { error: "cursor_expired", status: 409 };
    }
    const params = [];
    const where = ["true"];
    if (owner) {
      params.push(owner);
      where.push(`t.owner=$${params.length}`);
    }
    if (ownerOverride) where.push("NOT t.burnt");
    if (burned !== null) {
      params.push(burned === "true");
      where.push(`t.burnt=$${params.length}`);
    }
    if (metadata === "missing") where.push("false");
    for (const [type, values] of normalizedTraits) {
      params.push(type, values);
      where.push(`EXISTS(SELECT 1 FROM jsonb_array_elements(m.attributes) f
        WHERE f->>'trait_type'=$${params.length - 1} AND f->>'value'=ANY($${params.length}::text[]))`);
    }
    for (const [key, column, op] of [
      ["rarityMin", "m.rarity_points", ">="],
      ["rarityMax", "m.rarity_points", "<="],
      ["rarityCappedMin", "m.rarity_points_capped", ">="],
      ["rarityCappedMax", "m.rarity_points_capped", "<="]
    ])
      if (query.has(key)) {
        params.push(query.get(key));
        where.push(`${column}${op}$${params.length}::numeric`);
      }
    const source = `FROM solana_indexer.token t JOIN solana_indexer.manifest_asset a USING(mint)
      JOIN solana_indexer.asset_metadata m USING(mint) WHERE ${where.join(" AND ")}`;
    const total = Number(
      (await client.query(
        `SELECT count(*)::text AS count ${source}`,
        params
      )).rows[0].count
    );
    const order = sort === "token-id-desc" ? `t.mint COLLATE "C" DESC` : sort === "token-id-asc" ? `t.mint COLLATE "C" ASC` : `m.${sort.startsWith("rarity-capped") ? "rarity_points_capped" : "rarity_points"}
          ${sort.endsWith("desc") ? "DESC" : "ASC"} NULLS LAST,t.mint COLLATE "C" ASC`;
    params.push(limit + 1, cursor?.offset ?? 0);
    const rows = (await client.query(
      `SELECT ${tokenColumns()} ${source}
      ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )).rows;
    await client.query("COMMIT");
    const items = rows.slice(0, limit), hasMore = rows.length > limit;
    return {
      ...chainJson,
      items,
      total,
      nextCursor: hasMore ? encode({
        v: 1,
        run: run.runId,
        offset: (cursor?.offset ?? 0) + limit,
        config
      }) : null,
      ownershipObservedAt: run.completedAt,
      historyMode: "observed_changes"
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
function mountSolanaApi(app2, sourcePool) {
  const pool2 = requestSnapshotPool(sourcePool);
  app2.use("/v1/*", async (c, next) => {
    if (!wantsSolana(c.req.url) && !c.req.path.startsWith("/v1/tokens/solana/"))
      return next();
    return withDatabaseReadSnapshot(pool2, async () => {
      await next();
    });
  });
  const scopeError = (url) => !solanaOnly(url);
  const disabled = () => !solanaApiEnabled();
  app2.get("/v1/tokens", async (c, next) => {
    if (!wantsSolana(c.req.url)) return next();
    if (disabled()) return c.json({ error: "solana_disabled" }, 503);
    if (scopeError(c.req.url))
      return c.json({ error: "mixed_solana_scope_unavailable" }, 400);
    const response2 = await tokenPage(pool2, c.req.url);
    return "error" in response2 ? c.json({ error: response2.error }, response2.status) : c.json(response2);
  });
  app2.get("/v1/tokens/solana/:mint", async (c) => {
    if (disabled()) return c.json({ error: "solana_disabled" }, 503);
    const mint = c.req.param("mint");
    if (!isSolanaAddress(mint))
      return c.json({ error: "invalid_solana_mint" }, 400);
    const run = await published(pool2);
    if (!isFresh(run))
      return c.json({ error: "solana_ownership_unavailable" }, 503);
    const [token, changes] = await Promise.all([
      pool2.query(
        `SELECT ${tokenColumns()},m.document,m.content_hash AS "metadataContentHash"
        FROM solana_indexer.token t JOIN solana_indexer.manifest_asset a USING(mint)
        JOIN solana_indexer.asset_metadata m USING(mint) WHERE t.mint=$1`,
        [mint]
      ),
      pool2.query(
        `SELECT previous_owner AS "previousOwner",owner,previous_burnt AS "previousBurnt",
        burnt,observed_at AS "observedAt" FROM solana_indexer.observed_change
        WHERE mint=$1 ORDER BY run_id DESC LIMIT 100`,
        [mint]
      )
    ]);
    const row = token.rows[0];
    if (!row) {
      const known = await pool2.query(
        `SELECT 1 FROM solana_indexer.manifest_asset WHERE mint=$1`,
        [mint]
      );
      return known.rowCount ? c.json({ error: "solana_ownership_unavailable" }, 503) : c.json({ error: "Token not found" }, 404);
    }
    row.document = {
      ...row.document,
      address: row.burned ? null : row.owner,
      minted: !row.burned,
      ownerSince: null,
      ownershipObservedAt: row.ownershipObservedAt
    };
    return c.json({
      token: row,
      transfers: [],
      lifecycles: [],
      observedChanges: changes.rows,
      historyMode: "observed_changes",
      ...chainJson
    });
  });
  app2.get(
    "/v1/tokens/solana/:mint/visibility/signing-data",
    (c) => c.json({ error: "solana_visibility_unsupported" }, 501)
  );
  app2.put(
    "/v1/tokens/solana/:mint/visibility",
    (c) => c.json({ error: "solana_visibility_unsupported" }, 501)
  );
  app2.get("/v1/owners/:address/tokens", async (c, next) => {
    if (!wantsSolana(c.req.url)) return next();
    if (disabled()) return c.json({ error: "solana_disabled" }, 503);
    if (scopeError(c.req.url))
      return c.json({ error: "mixed_solana_scope_unavailable" }, 400);
    const visibility = c.req.query("visibility") ?? "visible";
    if (visibility !== "visible" && visibility !== "all")
      return c.json({ error: "solana_visibility_unsupported" }, 501);
    const response2 = await tokenPage(pool2, c.req.url, c.req.param("address"));
    return "error" in response2 ? c.json({ error: response2.error }, response2.status) : c.json({ ...response2, owner: c.req.param("address"), visibility });
  });
  app2.get("/v1/traits", async (c, next) => {
    if (!wantsSolana(c.req.url)) return next();
    if (disabled()) return c.json({ error: "solana_disabled" }, 503);
    if (scopeError(c.req.url))
      return c.json({ error: "mixed_solana_scope_unavailable" }, 400);
    const run = await published(pool2);
    if (!isFresh(run))
      return c.json({ error: "solana_ownership_unavailable" }, 503);
    const values = await pool2.query(`WITH counted AS (
      SELECT f->>'trait_type' AS trait_type,f->>'value' AS value,
        count(*)::int AS count
      FROM solana_indexer.token t JOIN solana_indexer.asset_metadata m USING(mint)
      CROSS JOIN LATERAL jsonb_array_elements(m.attributes) f
      WHERE NOT t.burnt AND f ? 'trait_type' AND f ? 'value'
      GROUP BY f->>'trait_type',f->>'value')
      SELECT trait_type AS "traitType",jsonb_agg(jsonb_build_object('value',value,'count',count)
        ORDER BY count DESC,value) AS values FROM counted GROUP BY trait_type ORDER BY trait_type`);
    return c.json({
      ...chainJson,
      items: values.rows.map((row) => ({ ...row, kind: "categorical" })),
      metadata: { available: run.manifestCount, missing: 0 },
      ownershipMissing: run.missingCount,
      updatedAt: run.completedAt
    });
  });
  app2.get("/v1/collection", async (c, next) => {
    if (!wantsSolana(c.req.url)) return next();
    if (disabled()) return c.json({ error: "solana_disabled" }, 503);
    if (scopeError(c.req.url))
      return c.json({ error: "mixed_solana_scope_unavailable" }, 400);
    const status = await solanaStatus(pool2);
    if (!status.ready)
      return c.json({ error: "solana_ownership_unavailable" }, 503);
    return c.json({
      ...chainJson,
      collection: "exomon",
      network: "mainnet-beta",
      knownTokens: status.manifestCount ?? 0,
      indexedTokens: status.indexedTokens,
      activeSupply: status.activeSupply,
      burnedTokens: status.burnedTokens,
      missingCount: status.missingCount,
      lifecycles: null,
      ownershipObservedAt: status.publishedAt
    });
  });
  app2.get("/v1/leaderboards", async (c, next) => {
    if (!wantsSolana(c.req.url)) return next();
    if (disabled()) return c.json({ error: "solana_disabled" }, 503);
    if (scopeError(c.req.url))
      return c.json({ error: "mixed_solana_scope_unavailable" }, 400);
    if (!isFresh(await published(pool2)))
      return c.json({ error: "solana_ownership_unavailable" }, 503);
    const result = await pool2.query(`SELECT count(*)::int AS wallets,max(updated_at) AS "updatedAt"
      FROM solana_indexer.wallet_stats`);
    return c.json({
      ...chainJson,
      items: Object.entries(metrics).map(([slug, definition]) => ({
        slug,
        label: definition.label
      })),
      collectorScore: {
        version: "collector-score-v1",
        formula: "1000*ln(1+totalRarity) + 50*monsterCount + 500*uniqueTypes + 750*specialCount + 250*glitterCount"
      },
      ...result.rows[0]
    });
  });
  app2.get("/v1/leaderboards/:metric", async (c, next) => {
    if (!wantsSolana(c.req.url)) return next();
    if (disabled()) return c.json({ error: "solana_disabled" }, 503);
    if (scopeError(c.req.url))
      return c.json({ error: "mixed_solana_scope_unavailable" }, 400);
    const slug = c.req.param("metric"), definition = metrics[slug];
    if (!definition)
      return c.json(
        { error: "Unknown leaderboard", available: Object.keys(metrics) },
        404
      );
    const run = await published(pool2);
    if (!isFresh(run))
      return c.json({ error: "solana_ownership_unavailable" }, 503);
    const raw = c.req.query("cursor"), cursor = decode(raw);
    if (raw && (!cursor || cursor.run !== run.runId || cursor.config !== hash3(slug)))
      return c.json({ error: "invalid_or_expired_cursor" }, 409);
    const limit = limitOf(c.req.query("limit"));
    if (limit === null) return c.json({ error: "invalid_limit" }, 400);
    const result = await pool2.query(
      `WITH ranked AS (
      SELECT *,dense_rank() OVER (ORDER BY ${definition.column} DESC) AS rank
      FROM solana_indexer.wallet_stats WHERE ${definition.column}>0)
      SELECT rank::int,owner,${definition.column}::text AS score,
        monster_count AS "monsterCount",total_rarity::text AS "totalRarity",
        unique_types AS "uniqueTypes",special_count AS "specialCount",
        glitter_count AS "glitterCount",collector_score::text AS "collectorScore",
        updated_at AS "updatedAt",NULL::text AS "ensName" FROM ranked
      ORDER BY ${definition.column} DESC,monster_count DESC,owner COLLATE "C"
      LIMIT $1 OFFSET $2`,
      [limit + 1, cursor?.offset ?? 0]
    );
    return c.json({
      ...chainJson,
      metric: slug,
      label: definition.label,
      scoreVersion: slug === "collector-score" ? "collector-score-v1" : null,
      items: result.rows.slice(0, limit),
      nextCursor: result.rows.length > limit ? encode({
        v: 1,
        run: run.runId,
        offset: (cursor?.offset ?? 0) + limit,
        config: hash3(slug)
      }) : null,
      updatedAt: result.rows[0]?.updatedAt ?? null
    });
  });
  app2.get("/v1/owners/:address/leaderboard", async (c, next) => {
    if (!wantsSolana(c.req.url)) return next();
    if (disabled()) return c.json({ error: "solana_disabled" }, 503);
    if (scopeError(c.req.url))
      return c.json({ error: "mixed_solana_scope_unavailable" }, 400);
    const owner = c.req.param("address");
    if (!isSolanaAddress(owner))
      return c.json({ error: "invalid_solana_owner" }, 400);
    if (!isFresh(await published(pool2)))
      return c.json({ error: "solana_ownership_unavailable" }, 503);
    const result = await pool2.query(
      `WITH ranked AS (
      SELECT *,dense_rank() OVER (ORDER BY total_rarity DESC) AS total_rarity_rank,
        dense_rank() OVER (ORDER BY monster_count DESC) AS monster_count_rank,
        dense_rank() OVER (ORDER BY unique_types DESC) AS unique_types_rank,
        dense_rank() OVER (ORDER BY special_count DESC) AS special_count_rank,
        dense_rank() OVER (ORDER BY glitter_count DESC) AS glitter_count_rank,
        dense_rank() OVER (ORDER BY collector_score DESC) AS collector_score_rank
      FROM solana_indexer.wallet_stats)
      SELECT owner,monster_count AS "monsterCount",total_rarity::text AS "totalRarity",
        unique_types AS "uniqueTypes",special_count AS "specialCount",
        glitter_count AS "glitterCount",collector_score::text AS "collectorScore",
        total_rarity_rank::int AS "totalRarityRank",monster_count_rank::int AS "monsterCountRank",
        unique_types_rank::int AS "uniqueTypesRank",special_count_rank::int AS "specialCountRank",
        glitter_count_rank::int AS "glitterCountRank",collector_score_rank::int AS "collectorScoreRank",
        NULL::text AS "ensName",updated_at AS "updatedAt" FROM ranked WHERE owner=$1`,
      [owner]
    );
    if (!result.rows[0])
      return c.json({ error: "Wallet has no active Exomon" }, 404);
    return c.json({
      ...result.rows[0],
      ...chainJson,
      ownerInput: owner,
      ownerName: null,
      resolvedAddresses: { solana: owner }
    });
  });
  app2.get("/v1/indexing-status", async (c, next) => {
    if (!wantsSolana(c.req.url)) return next();
    if (disabled()) return c.json({ error: "solana_disabled" }, 503);
    if (scopeError(c.req.url))
      return c.json({ error: "mixed_solana_scope_unavailable" }, 400);
    return c.json(await solanaStatus(pool2));
  });
}

// lib/api/indexer-status.ts
async function isolated(db, name, task) {
  await db.query(`SAVEPOINT ${name}`);
  try {
    const result = await task();
    await db.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch {
    await db.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await db.query(`RELEASE SAVEPOINT ${name}`);
    return { available: false, reason: "source_unavailable" };
  }
}
function mountProjectIndexerStatus(app2, pool2, options) {
  app2.get("/v1/indexer/status", async (c) => {
    const status = await indexerTransaction(
      pool2,
      async (db) => {
        const evm = options.evmReleaseId ? await isolated(db, "evm_status", async () => {
          const release = await loadIndexerRelease(
            db,
            options.evmReleaseId
          );
          const sources = [];
          for (const source of release.manifest.sources) {
            const policies = [];
            for (const policy of source.policies) {
              if (!source.enabled) {
                policies.push({
                  policy: confirmationPolicyKey(policy),
                  ready: false,
                  reason: "disabled",
                  availableThroughBlock: null,
                  requiredThroughBlock: null,
                  anchor: null
                });
                continue;
              }
              const status2 = await readIndexerSourceStatus(
                db,
                release,
                source.id,
                policy
              );
              policies.push({
                policy: confirmationPolicyKey(policy),
                ready: status2.readiness.ready,
                reason: status2.readiness.reason,
                availableThroughBlock: status2.readiness.availableThroughBlock?.toString() ?? null,
                requiredThroughBlock: status2.readiness.requiredThroughBlock?.toString() ?? null,
                anchor: status2.anchor
              });
            }
            sources.push({
              id: source.id,
              feature: source.feature,
              chainId: source.chainId,
              address: source.address,
              enabled: source.enabled,
              receiptRequirement: source.receiptRequirement,
              policies
            });
          }
          return {
            available: true,
            sourceKind: "evm-events",
            releaseId: release.id,
            manifestHash: release.manifestHash,
            sources
          };
        }) : { available: false, reason: "unified_release_not_selected" };
        const solana = options.solanaEnabled ? await isolated(db, "solana_status", async () => ({
          available: true,
          ...await solanaStatus(db)
        })) : { enabled: false, available: false, reason: "disabled" };
        return { scope: "source_observations", evm, solana };
      },
      true
    );
    return c.json(status);
  });
}

// lib/boosters/artwork.ts
import { createHash as createHash7, randomUUID } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

// ../../packages/yunipals-market-core/src/boosterCatalog.ts
import { encodeAbiParameters, keccak256 as keccak2562, parseAbiParameters } from "viem";
function validateBoosterCatalog(catalog) {
  const categories = [
    catalog.types,
    catalog.colors,
    catalog.horns,
    catalog.glitters
  ];
  for (const values of categories) {
    if (!Array.isArray(values) || values.length < 1 || values.length > 256 || values.some(
      (value, index) => !Number.isInteger(value) || value < 0 || value > 4294967295 || index > 0 && value <= values[index - 1]
    ))
      throw new Error(
        "Each category needs 1\u2013256 sorted, unique uint32 trait IDs."
      );
  }
  const product = categories.reduce(
    (count, values) => count * values.length,
    1
  );
  if (product > 4294967295)
    throw new Error("The catalog exceeds uint32 variant capacity.");
  if (!Array.isArray(catalog.allowed) || catalog.allowed.length > 4096)
    throw new Error("An allowed subset can have at most 4096 ranks.");
  if (catalog.allowed.length) {
    const counts = categories.map((values) => values.map(() => 0));
    catalog.allowed.forEach((value, index) => {
      if (!Number.isInteger(value) || value < 0 || value >= product || index > 0 && value <= catalog.allowed[index - 1])
        throw new Error(
          "Allowed variant ranks must be sorted, unique, and within the Cartesian product."
        );
      let rank = value;
      for (let category = 3; category >= 0; category--) {
        counts[category][rank % categories[category].length]++;
        rank = Math.floor(rank / categories[category].length);
      }
    });
    if (counts.some((values) => values.some((value) => value !== values[0])))
      throw new Error(
        "The allowed subset must give every value in each category equal probability."
      );
  }
  const encoded = encodeAbiParameters(
    parseAbiParameters(
      "(uint32[] types, uint32[] colors, uint32[] horns, uint32[] glitters, uint32[] allowed)"
    ),
    [catalog]
  );
  return {
    totalVariants: catalog.allowed.length || product,
    catalogHash: keccak2562(encoded)
  };
}

// lib/boosters/artwork.ts
var validSlug = (value) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
var validRank = (value) => /^(0|[1-9][0-9]{0,8})$/.test(value);
var missing = (error) => error.code === "ENOENT";
var BoosterArtworkStore = class {
  constructor(directory) {
    this.directory = directory;
  }
  async catalog(slug) {
    if (!validSlug(slug)) throw new Error("Invalid artwork catalog");
    const manifest = JSON.parse(
      await readFile(
        path.join(this.directory, "catalogs", slug, "manifest.json"),
        "utf8"
      )
    );
    const d = manifest.dictionary;
    const result = validateBoosterCatalog({
      types: d.types.map((t) => t.id),
      colors: d.colors.map((t) => t.id),
      horns: d.horns.map((t) => t.id),
      glitters: d.glitters.map((t) => t.id),
      allowed: []
    });
    if (manifest.slug !== slug || result.catalogHash !== manifest.catalogHash)
      throw new Error("Invalid artwork catalog commitment");
    return manifest;
  }
  decode(catalog, rank) {
    const d = catalog.dictionary;
    const categories = [d.types, d.colors, d.horns, d.glitters];
    const total = categories.reduce((n, items) => n * items.length, 1);
    if (!Number.isSafeInteger(rank) || rank < 0 || rank >= total)
      throw new Error("Invalid artwork variant");
    let rest = rank;
    const values = categories.map(() => ({ id: 0, name: "" }));
    for (let i = 3; i >= 0; i--) {
      values[i] = categories[i][rest % categories[i].length];
      rest = Math.floor(rest / categories[i].length);
    }
    return {
      traits: {
        type: values[0].name,
        color: values[1].name,
        horn: values[2].name,
        glitter: values[3].name
      },
      ids: values.map((t) => String(t.id))
    };
  }
  async metadata(slug, rank) {
    const catalog = await this.catalog(slug);
    const { traits } = this.decode(catalog, rank);
    try {
      const ready = JSON.parse(
        await readFile(
          path.join(
            this.directory,
            "catalogs",
            slug,
            "variants",
            `${rank}.json`
          ),
          "utf8"
        )
      );
      if (ready.yunipals?.variantId !== rank || ready.yunipals?.catalogCommitment !== catalog.artworkHash || ready.yunipals?.status !== "ready")
        throw new Error("Invalid published artwork");
      return { ready: true, document: ready };
    } catch (error) {
      if (!missing(error)) throw error;
    }
    let status = "missing";
    try {
      const job = JSON.parse(
        await readFile(
          path.join(this.directory, "jobs", slug, `${rank}.json`),
          "utf8"
        )
      );
      status = job.status === "blocked" ? "blocked" : "queued";
    } catch (error) {
      if (!missing(error)) throw error;
    }
    return {
      ready: false,
      document: {
        name: traits.type,
        attributes: Object.entries(traits).map(([key, value]) => ({
          trait_type: key[0].toUpperCase() + key.slice(1),
          value
        })),
        yunipals: { version: 1, variantId: rank, status }
      }
    };
  }
  async enqueue(slug, rank) {
    const catalog = await this.catalog(slug);
    const { traits } = this.decode(catalog, rank);
    if ((await this.metadata(slug, rank)).ready) return false;
    const directory = path.join(this.directory, "jobs", slug);
    await mkdir(directory, { recursive: true });
    const temporary = path.join(directory, `.${randomUUID()}.tmp`);
    await writeFile(
      temporary,
      JSON.stringify(
        {
          schemaVersion: 1,
          catalog: slug,
          catalogHash: catalog.catalogHash,
          variantId: rank,
          traits,
          status: "queued"
        },
        null,
        2
      )
    );
    try {
      await link(temporary, path.join(directory, `${rank}.json`));
      return true;
    } catch (error) {
      if (error.code === "EEXIST") return false;
      throw error;
    } finally {
      await unlink(temporary);
    }
  }
  async sync(pool2, schemaName, slugs) {
    const schema = sqlIdentifier(schemaName);
    let queued = 0;
    for (const slug of slugs) {
      const catalog = await this.catalog(slug);
      const rows = await pool2.query(
        `SELECT DISTINCT m.variant_id::text AS variant, m.monster_type::text AS type, m.color::text, m.horn::text, m.glitter::text FROM ${schema}.booster_monster m JOIN ${schema}.booster_type p ON p.id=m.type_key WHERE NOT m.burned AND p.catalog_hash=$1 AND p.metadata_base_uri=$2`,
        [catalog.catalogHash, catalog.metadataBaseURI]
      );
      for (const row of rows.rows) {
        const rank = Number(row.variant);
        const decoded = this.decode(catalog, rank);
        if (decoded.ids.some(
          (id, i) => id !== String([row.type, row.color, row.horn, row.glitter][i])
        ))
          throw new Error("Indexed variant does not match artwork catalog");
        if (await this.enqueue(slug, rank)) queued++;
      }
    }
    return queued;
  }
};
function registerBoosterArtworkRoutes(app2, store) {
  app2.get("/v1/boosters/art/:catalog/:file", async (c) => {
    const slug = c.req.param("catalog"), file = c.req.param("file");
    if (!validSlug(slug)) return c.json({ error: "invalid_catalog" }, 400);
    try {
      if (file === "manifest.json") {
        c.header("Cache-Control", "public, max-age=31536000, immutable");
        return c.json(await store.catalog(slug));
      }
      const rank = file.replace(/\.json$/, "");
      if (!file.endsWith(".json") || !validRank(rank))
        return c.json({ error: "invalid_variant" }, 400);
      const result = await store.metadata(slug, Number(rank));
      c.header(
        "Cache-Control",
        result.ready ? "public, max-age=31536000, immutable" : "no-store"
      );
      if (!result.ready) c.header("Retry-After", "5");
      return c.json(result.document, result.ready ? 200 : 202);
    } catch (error) {
      if (missing(error))
        return c.json({ error: "artwork_catalog_not_found" }, 404);
      if (error instanceof Error && error.message === "Invalid artwork variant")
        return c.json({ error: "invalid_variant" }, 400);
      return c.json({ error: "artwork_unavailable" }, 503);
    }
  });
  app2.get("/v1/boosters/art-assets/:file", async (c) => {
    const file = c.req.param("file");
    if (!/^[a-f0-9]{64}\.(png|svg)$/.test(file))
      return c.json({ error: "invalid_asset" }, 400);
    try {
      const data = await readFile(path.join(store.directory, "assets", file));
      if (createHash7("sha256").update(data).digest("hex") !== file.split(".")[0])
        throw new Error("Asset fingerprint mismatch");
      return new Response(data, {
        headers: {
          "Content-Type": file.endsWith(".svg") ? "image/svg+xml" : "image/png",
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; style-src 'none'; sandbox"
        }
      });
    } catch (error) {
      return c.json(
        { error: "artwork_asset_unavailable" },
        missing(error) ? 404 : 503
      );
    }
  });
}

// lib/api/server.ts
var app = new Hono5();
var localMetadata = new LocalMetadataReader(apiPool, readSchemaName);
var port = Number(process.env.API_PORT ?? 9011);
var exactCountCache = new ExactCountCache(
  Number(process.env.API_EXACT_COUNT_CACHE_TTL_MS ?? 15e3),
  Number(process.env.API_EXACT_COUNT_CACHE_MAX ?? 1e3)
);
var isDatabaseUnavailable = (error) => {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : String(error);
  return [
    "55P03",
    "57014",
    "53300",
    "57P01",
    "57P02",
    "57P03",
    "08000",
    "08003",
    "08006"
  ].includes(code) || /timeout|connection terminated|connection refused|projection_generation_unavailable|derived_snapshot_pending/i.test(
    message
  );
};
app.onError((error, c) => {
  if (error instanceof InvalidOwnerError)
    return c.json({ error: "invalid_owner", message: error.message }, 400);
  if (error instanceof OwnerNameUnresolvedError)
    return c.json(
      { error: "owner_name_unresolved", message: error.message },
      404
    );
  if (error instanceof EnsUnavailableError)
    return c.json({ error: "ens_resolution_unavailable" }, 503);
  if (error instanceof OwnershipSourceUnavailable || "code" in error && error.code === "YI001")
    return c.json({ error: "ownership_source_unavailable" }, 503);
  if (isDatabaseUnavailable(error)) {
    console.error("API database request unavailable", {
      path: c.req.path,
      error: error.message
    });
    return c.json({ error: "database_unavailable" }, 503);
  }
  console.error("API request failed", { path: c.req.path, error });
  return c.json({ error: "internal_server_error" }, 500);
});
var limitOf2 = (raw) => Math.min(100, Math.max(1, Number(raw ?? 50) || 50));
var leaderboardMetrics = {
  "total-rarity": { column: "total_rarity", label: "Total rarity" },
  "monster-count": { column: "monster_count", label: "Monster count" },
  "unique-types": { column: "unique_types", label: "Unique types" },
  "special-count": { column: "special_count", label: "Special count" },
  "glitter-count": { column: "glitter_count", label: "Glitter count" },
  "collector-score": { column: "collector_score", label: "Collector score" }
};
var encodeRankCursor = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
var decodeRankCursor = (raw) => {
  if (!raw) return void 0;
  try {
    const value = JSON.parse(
      Buffer.from(raw, "base64url").toString()
    );
    if (typeof value.score !== "string" || !Number.isInteger(value.monsterCount) || !/^0x[0-9a-f]{40}$/.test(value.owner))
      return void 0;
    return value;
  } catch {
    return void 0;
  }
};
var tokenSorts = [
  "token-id-asc",
  "token-id-desc",
  "rarity-desc",
  "rarity-asc",
  "rarity-capped-desc",
  "rarity-capped-asc"
];
var encodeTokenCursor = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
var decodeTokenCursor = (raw) => {
  try {
    const value = JSON.parse(
      Buffer.from(raw, "base64url").toString()
    );
    if (value.v !== 2 || typeof value.config !== "string" || !collectionSlugs.includes(value.collection) || !/^\d+$/.test(value.tokenId) || value.rarity !== null && !/^-?\d+(\.\d+)?$/.test(value.rarity))
      return void 0;
    return value;
  } catch {
    return void 0;
  }
};
var configHash = (value) => createHash8("sha256").update(JSON.stringify(value)).digest("base64url").slice(0, 16);
var chainOf = (raw) => raw && collectionSlugs.includes(raw) ? raw : void 0;
var requireResolvedOwner = async (input, chains2) => {
  const resolved = await resolveOwner(input, chains2);
  if (!Object.keys(resolved.addresses).length)
    throw new OwnerNameUnresolvedError(`No address record found for ${input}`);
  return resolved;
};
var ownerResolutionJson = (resolved) => ({
  ownerInput: resolved.input,
  ownerName: resolved.normalizedName,
  resolvedAddresses: resolved.addresses
});
var canonicalOwnerAddress = (resolved, chains2) => chains2.map((slug) => resolved.addresses[slug]).find(Boolean);
var ensChainIds = collectionSlugs.map((slug) => collections[slug].chainId);
var ensScopeChainCase = collectionSlugs.map((slug) => `WHEN '${slug}' THEN ${collections[slug].chainId}`).join(" ");
var verifiedEnsJoin = (ownerSql, scopeSql) => `LEFT JOIN LATERAL (
  SELECT identity.name FROM metadata.ens_identity identity
  WHERE identity.address=${ownerSql} AND identity.verified
    AND identity.chain_id = ANY(CASE WHEN ${scopeSql}='all' THEN ARRAY[${ensChainIds.join(",")}]
      ELSE ARRAY(SELECT CASE selected.slug ${ensScopeChainCase} END
        FROM unnest(string_to_array(${scopeSql}, '+')) selected(slug)) END)
  ORDER BY array_position(ARRAY[${ensChainIds.join(",")}], identity.chain_id) LIMIT 1
) selected_ens ON true`;
var visibilityModes = ["visible", "hidden", "all"];
var encodeOwnerCursor = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
var decodeOwnerCursor = (raw) => {
  if (!raw) return void 0;
  try {
    const value = JSON.parse(
      Buffer.from(raw, "base64url").toString()
    );
    if (value.v !== 3 || typeof value.scope !== "string" || !collectionSlugs.includes(value.collection) || !/^\d+$/.test(value.tokenId) || !visibilityModes.includes(value.visibility))
      return void 0;
    return value;
  } catch {
    return void 0;
  }
};
var visibilityMessageSchema = z7.object({
  owner: z7.string().regex(/^0x[0-9a-fA-F]{40}$/),
  tokenId: z7.string().regex(/^\d+$/),
  lifecycle: z7.number().int().positive(),
  ownershipTransactionHash: z7.string().regex(/^0x[0-9a-fA-F]{64}$/),
  ownershipLogIndex: z7.number().int().nonnegative(),
  hidden: z7.boolean(),
  nonce: z7.string().regex(/^\d+$/),
  deadline: z7.number().int().positive()
});
var visibilityRequestSchema = z7.object({
  message: visibilityMessageSchema,
  signature: z7.string().regex(/^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/)
});
async function currentVisibilityState(client, collection, tokenId) {
  const result = await client.query(
    `
    SELECT t.owner, t.burned, t.lifecycle,
      e.id AS "eventId", e.block_number AS "blockNumber",
      e.transaction_hash AS "transactionHash", e.transaction_index AS "transactionIndex", e.log_index AS "logIndex"
    FROM ${ponderSchema}.token t
    JOIN LATERAL (
      SELECT id, block_number, transaction_hash, transaction_index, log_index
      FROM ${ponderSchema}.transfer_event
      WHERE collection=t.collection AND token_id=t.token_id AND lifecycle=t.lifecycle
      ORDER BY block_number DESC, transaction_index DESC, log_index DESC LIMIT 1
    ) e ON true
    WHERE t.collection=$1 AND t.token_id=$2
  `,
    [collection, tokenId]
  );
  return result.rows[0];
}
app.use(
  "*",
  cors2({
    origin: "*",
    allowMethods: ["GET", "HEAD", "POST", "PUT", "OPTIONS"],
    allowHeaders: ["Content-Type", "If-None-Match"],
    exposeHeaders: [
      "ETag",
      "X-Metadata-Release",
      "X-Metadata-Ownership",
      "X-Indexer-Release"
    ]
  })
);
registerBoosterRoutes(app, {
  pool: apiPool,
  schemaName: process.env.BOOSTER_DATABASE_SCHEMA?.trim() || physicalPonderSchemaName
});
registerActionEvidenceRoutes(app, {
  pool: apiPool,
  selection: () => ownershipReadConfig.mode === "unified" ? {
    releaseId: ownershipReadConfig.releaseId,
    physicalSchema: physicalPonderSchemaName,
    readSchema: readSchemaName
  } : null
});
if (process.env.SOLANA_API_ENABLED === "true") mountSolanaApi(app, apiPool);
mountProjectIndexerStatus(app, apiPool, {
  evmReleaseId: ownershipReadConfig.releaseId,
  solanaEnabled: process.env.SOLANA_API_ENABLED === "true"
});
if (process.env.BOOSTER_ARTWORK_DIRECTORY)
  registerBoosterArtworkRoutes(
    app,
    new BoosterArtworkStore(process.env.BOOSTER_ARTWORK_DIRECTORY)
  );
app.use("/v1/*", async (c, next) => {
  if (metadataSourceMode() === "archive" && !["/v1/status", "/v1/indexing-status"].includes(c.req.path)) {
    const specific = c.req.path.match(
      /^\/v1\/tokens\/(ethereum|base|polygon|bnb)\//
    )?.[1] ?? (/^\/v1\/tokens\/[0-9]+$/.test(c.req.path) ? "ethereum" : void 0);
    const selected2 = specific ? [specific] : chainSelection(c.req.url)?.chains ?? collectionSlugs;
    const ownership = await chainReadiness(apiPool, selected2);
    if (!ownership.ready)
      return c.json({ error: "ownership_rebuilding", ownership }, 503);
  }
  await next();
});
app.use("*", async (c, next) => {
  if (!unifiedOwnershipReads || !["GET", "HEAD"].includes(c.req.method))
    return next();
  const specific = c.req.path.match(
    /^\/v1\/tokens\/(ethereum|base|polygon|bnb)\//
  )?.[1] ?? (/^\/v1\/tokens\/[0-9]+$/.test(c.req.path) ? "ethereum" : void 0);
  const islands = c.req.path.startsWith("/v2/collections/ethereum-islands");
  const diagnostic = ["/v1/status", "/v1/indexing-status"].includes(c.req.path) || c.req.path.startsWith("/legacy-meta");
  const selected2 = diagnostic ? [] : islands ? ["ethereum-islands"] : specific ? [specific] : chainSelection(c.req.url)?.chains ?? collectionSlugs;
  return withOwnershipRequest(
    apiPool,
    async (db) => {
      const proof = await assertOwnershipAvailable(db, selected2);
      if (c.req.path.startsWith("/v1/tokens") && !c.req.path.endsWith("/visibility/signing-data") || c.req.path.startsWith("/v1/owners") && !c.req.path.endsWith("/leaderboard") || c.req.path.startsWith("/v2/owners") || c.req.path === "/v1/traits")
        await readActiveProjectionId(db);
      if (c.req.path.includes("/leaderboards") || c.req.path.endsWith("/leaderboard"))
        await assertDerivedOwnership(db, "leaderboard");
      if (selected2.length && metadataSourceMode() === "archive" && !(await chainReadiness(db, selected2)).ready)
        throw new OwnershipSourceUnavailable("ownership_rebuilding");
      return proof;
    },
    async () => {
      await next();
      c.header("X-Indexer-Release", ownershipReadConfig.releaseId);
    }
  );
});
app.get(
  "/v1/indexing-status",
  async (c) => c.json(
    unifiedOwnershipReads ? await unifiedOwnershipStatus(
      apiPool,
      chainSelection(c.req.url)?.chains ?? collectionSlugs
    ) : metadataSourceMode() === "archive" ? await chainReadiness(apiPool) : { ready: true, mode: "legacy-http" }
  )
);
if (metadataSourceMode() === "archive")
  app.route("/legacy-meta", legacyMetadataRouter(localMetadata));
app.get("/docs", (c) => c.html(docsHtml));
app.get("/docs/", (c) => c.html(docsHtml));
app.get("/docs/openapi.json", (c) => c.json(openApiDocument));
app.get("/openapi.json", (c) => c.json(openApiDocument));
app.get("/health", (c) => c.json({ status: "ok" }));
registerIslandsRoutes(app, { pool: apiPool, schemaName: ownershipIslandsSchemaName });
app.get("/ready", async (c) => {
  try {
    await apiPool.query("SELECT 1");
    const metadata = await metadataReadiness(apiPool);
    if (!metadata.ready) return c.json({ status: "not_ready", metadata }, 503);
    return c.json({
      status: "ready",
      databasePool: {
        total: apiPool.totalCount,
        idle: apiPool.idleCount,
        waiting: apiPool.waitingCount
      }
    });
  } catch (error) {
    return c.json(
      {
        status: "not_ready",
        databasePool: {
          total: apiPool.totalCount,
          idle: apiPool.idleCount,
          waiting: apiPool.waitingCount
        },
        error: error instanceof Error ? error.message : String(error)
      },
      503
    );
  }
});
app.get("/v1/tokens", async (c) => {
  const limit = limitOf2(c.req.query("limit"));
  const cursorRaw = c.req.query("cursor");
  const ownerInput = c.req.query("owner");
  const burned = c.req.query("burned");
  const url = new URL(c.req.url);
  const traitTypes = url.searchParams.getAll("traitType");
  const traitValues2 = url.searchParams.getAll("traitValue");
  const rarityMin = c.req.query("rarityMin");
  const rarityMax = c.req.query("rarityMax");
  const rarityCappedMin = c.req.query("rarityCappedMin");
  const rarityCappedMax = c.req.query("rarityCappedMax");
  const metadata = c.req.query("metadata") ?? "all";
  const sort = c.req.query("sort") ?? "token-id-asc";
  const selection2 = chainSelection(c.req.url);
  if (!selection2)
    return c.json({ error: "Invalid chain", available: collectionSlugs }, 400);
  const { chain: chain2, chains: chains2 } = selection2;
  if (traitTypes.length !== traitValues2.length || traitTypes.some((value) => !value) || traitValues2.some((value) => !value))
    return c.json(
      { error: "Each traitType must have a positional traitValue" },
      400
    );
  if (!tokenSorts.includes(sort))
    return c.json({ error: "Invalid sort", available: tokenSorts }, 400);
  if (!["all", "available", "missing"].includes(metadata))
    return c.json({ error: "Invalid metadata filter" }, 400);
  if (burned !== void 0 && burned !== "true" && burned !== "false")
    return c.json({ error: "Invalid burned filter" }, 400);
  if (rarityMin !== void 0 && !/^-?\d+(\.\d+)?$/.test(rarityMin))
    return c.json({ error: "Invalid rarityMin" }, 400);
  if (rarityMax !== void 0 && !/^-?\d+(\.\d+)?$/.test(rarityMax))
    return c.json({ error: "Invalid rarityMax" }, 400);
  if (rarityMin !== void 0 && rarityMax !== void 0 && Number(rarityMin) > Number(rarityMax))
    return c.json({ error: "rarityMin cannot exceed rarityMax" }, 400);
  if (rarityCappedMin !== void 0 && !/^-?\d+(\.\d+)?$/.test(rarityCappedMin))
    return c.json({ error: "Invalid rarityCappedMin" }, 400);
  if (rarityCappedMax !== void 0 && !/^-?\d+(\.\d+)?$/.test(rarityCappedMax))
    return c.json({ error: "Invalid rarityCappedMax" }, 400);
  if (rarityCappedMin !== void 0 && rarityCappedMax !== void 0 && Number(rarityCappedMin) > Number(rarityCappedMax))
    return c.json(
      { error: "rarityCappedMin cannot exceed rarityCappedMax" },
      400
    );
  const traitGroups = /* @__PURE__ */ new Map();
  traitTypes.forEach((type, index) => {
    const values = traitGroups.get(type) ?? [];
    if (!values.includes(traitValues2[index])) values.push(traitValues2[index]);
    traitGroups.set(type, values);
  });
  const ownerResolution = ownerInput ? await requireResolvedOwner(ownerInput, chains2) : void 0;
  const projectionId = await readActiveProjectionId();
  const cachedProofs = process.env.YUNIPALS_READ_CACHE === "1" && projectionId !== null;
  const searchRelation = projectionId ? metadataSearchReadRelationAt(projectionId) : metadataSearchReadRelation;
  const traitRelation = projectionId ? metadataTraitReadRelationAt(projectionId) : metadataTraitReadRelation;
  const filterConfig = {
    ...ownershipReadConfig.releaseId ? { ownershipRelease: ownershipReadConfig.releaseId } : {},
    visibility: "visible",
    chains: chains2,
    owner: ownerResolution?.addresses ?? null,
    burned: burned ?? null,
    traits: [...traitGroups].sort(([a], [b]) => a.localeCompare(b)).map(([type, values]) => [type, [...values].sort()]),
    rarityMin: rarityMin ?? null,
    rarityMax: rarityMax ?? null,
    rarityCappedMin: rarityCappedMin ?? null,
    rarityCappedMax: rarityCappedMax ?? null,
    metadata,
    sort
  };
  const expectedConfig = configHash(
    projectionId ? { ...filterConfig, projectionId } : filterConfig
  );
  const { sort: _countSort, ...countFilterConfig } = filterConfig;
  const visibilityRevision = (await apiPool.query(`SELECT md5(coalesce(jsonb_agg(
    jsonb_build_array(collection,token_id::text,owner,lifecycle,anchor_event_id,anchor_block::text,
      anchor_transaction_index,anchor_log_index) ORDER BY collection,token_id)::text,'[]')) AS revision
    FROM metadata.token_visibility`)).rows[0].revision;
  const countConfig = configHash({
    ...countFilterConfig,
    projectionId,
    visibilityRevision,
    ownership: ownershipRequestFingerprint(),
    // Publications can change while the ownership boundary stays identical.
    // Native Base counts may share work only within the same MVCC snapshot;
    // an optional/absent cache trigger cannot make an old count look current.
    metadataSnapshot: nativeBaseMetadataReads() && chains2.includes("base") ? (await apiPool.query(
      "SELECT pg_current_snapshot()::text AS snapshot"
    )).rows[0]?.snapshot : null
  });
  let cursor;
  if (cursorRaw) {
    cursor = decodeTokenCursor(cursorRaw);
    if (!cursor && /^\d+$/.test(cursorRaw) && sort === "token-id-asc")
      cursor = {
        v: 2,
        config: expectedConfig,
        collection: "ethereum",
        tokenId: cursorRaw,
        rarity: null
      };
    if (!cursor || cursor.config !== expectedConfig)
      return c.json(
        { error: "Cursor does not match this filter and sort configuration" },
        400
      );
  }
  const params = [];
  const where = [`NOT ${activeVisibilityPredicate()}`];
  params.push(chains2);
  where.push(`t.collection = ANY($${params.length}::text[])`);
  if (ownerResolution) {
    const clauses = [];
    for (const [ownerChain, address3] of Object.entries(
      ownerResolution.addresses
    )) {
      params.push(ownerChain, address3.toLowerCase());
      clauses.push(
        `(t.collection = $${params.length - 1} AND t.owner = $${params.length})`
      );
    }
    where.push(`(${clauses.join(" OR ")})`);
  }
  if (burned === "true" || burned === "false") {
    params.push(burned === "true");
    where.push(`t.burned = $${params.length}`);
  }
  const indexedRarityBrowse = sort.startsWith("rarity") && metadata === "available";
  if (indexedRarityBrowse) where.push("s.collection = ANY($1::text[])");
  const tokenOnlyBrowse = !sort.startsWith("rarity") && metadata === "all" && rarityMin === void 0 && rarityMax === void 0 && rarityCappedMin === void 0 && rarityCappedMax === void 0;
  if (metadata !== "all") {
    params.push(metadata === "available");
    where.push(
      indexedRarityBrowse ? `s.metadata_available = $${params.length}` : `COALESCE(s.metadata_available, false) = $${params.length}`
    );
  }
  if (rarityMin !== void 0) {
    params.push(rarityMin);
    where.push(`s.rarity_points >= $${params.length}::numeric`);
  }
  if (rarityMax !== void 0) {
    params.push(rarityMax);
    where.push(`s.rarity_points <= $${params.length}::numeric`);
  }
  if (rarityCappedMin !== void 0) {
    params.push(rarityCappedMin);
    where.push(`s.rarity_points_capped >= $${params.length}::numeric`);
  }
  if (rarityCappedMax !== void 0) {
    params.push(rarityCappedMax);
    where.push(`s.rarity_points_capped <= $${params.length}::numeric`);
  }
  let traitCandidateParams;
  const nonTraitFilters = [...where];
  const traitFilters = [];
  const traitPredicate = (relation, filter, pointRead = false) => `EXISTS (SELECT 1 FROM ${relation} f WHERE f.collection=ANY($1::text[]) AND f.collection=t.collection AND f.token_id=t.token_id::numeric AND f.lifecycle=t.lifecycle AND f.trait_type=$${filter.type} AND f.value=ANY($${filter.values}::text[])${pointRead ? " OFFSET 0" : ""})`;
  for (const [type, values] of traitGroups) {
    params.push(type, values);
    traitCandidateParams ??= { type: params.length - 1, values: params.length };
    const filter = { type: params.length - 1, values: params.length };
    traitFilters.push(filter);
    where.push(traitPredicate(traitRelation, filter, true));
  }
  let broadTraits = false;
  if (!ownerResolution) {
    for (const filter of traitFilters) {
      const sample = await apiPool.query(
        `SELECT count(*)::int AS total FROM (SELECT 1 FROM ${metadataRawTraitReadRelationAt(projectionId ?? void 0)} candidate
          WHERE candidate.collection=ANY($1::text[]) AND candidate.trait_type=$2
            AND candidate.value=ANY($3::text[]) LIMIT 4097) sample`,
        [chains2, params[filter.type - 1], params[filter.values - 1]]
      );
      broadTraits = Number(sample.rows[0].total) > 4096;
      if (!broadTraits) {
        traitCandidateParams = filter;
        break;
      }
    }
  }
  const baseWhere = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const cursorWhere = tokenOnlyBrowse ? [...where.slice(1)] : [...where];
  if (cursor) {
    if (sort === "token-id-asc" || sort === "token-id-desc") {
      params.push(cursor.tokenId, cursor.collection);
      const op = sort === "token-id-asc" ? ">" : "<";
      cursorWhere.push(
        `(t.token_id::numeric ${op} $${params.length - 1}::numeric OR (t.token_id::numeric = $${params.length - 1}::numeric AND t.collection > $${params.length}))`
      );
    } else if (cursor.rarity === null) {
      const rarityColumn = sort.startsWith("rarity-capped") ? "rarity_points_capped" : "rarity_points";
      params.push(cursor.tokenId, cursor.collection);
      cursorWhere.push(
        `s.${rarityColumn} IS NULL AND (t.token_id::numeric > $${params.length - 1}::numeric OR (t.token_id::numeric = $${params.length - 1}::numeric AND t.collection > $${params.length}))`
      );
    } else {
      const rarityColumn = sort.startsWith("rarity-capped") ? "rarity_points_capped" : "rarity_points";
      params.push(cursor.rarity, cursor.tokenId, cursor.collection);
      const op = sort.endsWith("-desc") ? "<" : ">";
      cursorWhere.push(
        `(s.${rarityColumn} ${op} $${params.length - 2}::numeric OR s.${rarityColumn} IS NULL OR (s.${rarityColumn} = $${params.length - 2}::numeric AND (t.token_id::numeric > $${params.length - 1}::numeric OR (t.token_id::numeric = $${params.length - 1}::numeric AND t.collection > $${params.length}))))`
      );
    }
  }
  const sortRarityColumn = sort.startsWith("rarity-capped") ? "rarity_points_capped" : "rarity_points";
  const orderBy = sort === "token-id-asc" ? "t.token_id::numeric ASC, t.collection ASC" : sort === "token-id-desc" ? "t.token_id::numeric DESC, t.collection ASC" : `s.${sortRarityColumn} ${sort.endsWith("-desc") ? "DESC" : "ASC"} NULLS LAST, t.token_id::numeric ASC, t.collection ASC`;
  const cursorParamCount = cursor ? sort.startsWith("rarity") && cursor.rarity !== null ? 3 : 2 : 0;
  const countParams = params.slice(0, params.length - cursorParamCount);
  const includesBnb = chains2.includes("bnb");
  const includesPhysical = chains2.some((slug) => slug !== "bnb");
  const tokenRelation = includesBnb && !includesPhysical ? `${ownershipBnbSchema}.token` : `${ownershipPonderSchema}.token`;
  const selectiveTokenSource = (relation) => {
    if (!traitCandidateParams) return relation;
    const rawTraits = metadataRawTraitReadRelationAt(projectionId ?? void 0);
    return `(SELECT current.* FROM (SELECT DISTINCT collection,token_id,lifecycle
      FROM ${rawTraits} candidates WHERE candidates.collection=ANY($1::text[])
        AND candidates.trait_type=$${traitCandidateParams.type}::text
        AND candidates.value=ANY($${traitCandidateParams.values}::text[])) candidate_keys
      JOIN LATERAL (SELECT * FROM ${relation} current
        WHERE current.collection=candidate_keys.collection AND current.token_id=candidate_keys.token_id::text
          AND current.lifecycle=candidate_keys.lifecycle OFFSET 0) current ON true)`;
  };
  const sourceFor2 = (relation, pointRead = false) => {
    const schema = relation.slice(0, -".token".length);
    const search = pointRead ? searchRelation : cachedProofs ? cachedSearchReadRelationFor(schema, chains2, projectionId) : metadataSearchReadRelationFor(
      schema,
      !ownershipBnbOnlySchema(schema) && chains2.includes("base"),
      chains2,
      projectionId ?? void 0
    );
    const tokens = selectiveTokenSource(relation);
    return tokenOnlyBrowse ? `${tokens} t` : indexedRarityBrowse ? `${search} s JOIN ${tokens} t ON t.collection=s.collection AND t.token_id::numeric=s.token_id AND t.lifecycle=s.lifecycle` : `${tokens} t LEFT JOIN ${search} s ON s.collection=t.collection AND s.token_id=t.token_id::numeric AND s.lifecycle=t.lifecycle`;
  };
  const candidateSource = sourceFor2(tokenRelation);
  const countNeedsSearch = metadata !== "all" || rarityMin !== void 0 || rarityMax !== void 0 || rarityCappedMin !== void 0 || rarityCappedMax !== void 0;
  const simpleExactCount = !countNeedsSearch && !ownerResolution && traitGroups.size === 0;
  const countWithoutVisibility = where.slice(1);
  const countWhere = countWithoutVisibility.length ? `WHERE ${countWithoutVisibility.join(" AND ")}` : "";
  const selectedRelations = [
    ...new Set(
      [
        includesPhysical ? `${ownershipPonderSchema}.token` : null,
        includesBnb ? `${ownershipBnbSchema}.token` : null
      ].filter((value) => Boolean(value))
    )
  ];
  const baseCountSql = selectedRelations.map((relation) => `(SELECT count(*) FROM ${relation} t ${countWhere})`).join(" + ");
  const hiddenProbe = (relation) => `EXISTS (SELECT 1 FROM ${relation} t
    WHERE t.collection=visibility.collection AND t.token_id::numeric=visibility.token_id
      AND ${activeVisibilityRowPredicate("t")}
      ${countWithoutVisibility.length ? `AND ${countWithoutVisibility.join(" AND ")}` : ""})`;
  const hiddenCountSql = `(SELECT count(*) FROM metadata.token_visibility visibility WHERE (${selectedRelations.map(hiddenProbe).join(" OR ")}))`;
  const countSourceFor = (relation) => {
    const tokens = selectiveTokenSource(relation);
    if (!countNeedsSearch) return `${tokens} t`;
    if (ownerResolution || traitGroups.size > 0)
      return `${tokens} t LEFT JOIN LATERAL (SELECT * FROM ${searchRelation} validated
        WHERE validated.collection=t.collection AND validated.token_id=t.token_id::numeric
          AND validated.lifecycle=t.lifecycle OFFSET 0) s ON true`;
    const schema = relation.slice(0, -".token".length);
    const search = cachedProofs ? cachedSearchReadRelationFor(schema, chains2, projectionId) : metadataSearchReadRelationFor(
      schema,
      !ownershipBnbOnlySchema(schema) && chains2.includes("base"),
      chains2,
      projectionId ?? void 0
    );
    return `${tokens} t LEFT JOIN ${search} s ON s.collection=t.collection AND s.token_id=t.token_id::numeric AND s.lifecycle=t.lifecycle`;
  };
  const filteredCountSql = broadTraits ? chains2.map((slug) => {
    const schema = slug === "bnb" ? ownershipBnbSchema : ownershipPonderSchema;
    const search = cachedProofs ? cachedSearchReadRelationFor(schema, [slug], projectionId) : metadataSearchReadRelationFor(
      schema,
      slug === "base",
      [slug],
      projectionId ?? void 0
    );
    const traits = cachedProofs ? cachedTraitReadRelationFor(schema, [slug], projectionId) : metadataTraitReadRelationFor(
      schema,
      [slug],
      projectionId ?? void 0
    );
    const source = `${schema}.token t${countNeedsSearch ? ` LEFT JOIN ${search} s ON s.collection=t.collection AND s.token_id=t.token_id::numeric AND s.lifecycle=t.lifecycle` : ""}`;
    return `(${traitCountQuery({ chain: slug, source, filters: nonTraitFilters, traits, rawTraits: metadataRawTraitReadRelationAt(projectionId ?? void 0), traitFilters })})`;
  }).join(" UNION ALL ") : selectedRelations.map(
    (relation) => `SELECT count(*)::bigint AS total FROM ${countSourceFor(relation)} ${baseWhere}`
  ).join(" UNION ALL ");
  const canonicalCountSql = simpleExactCount ? `SELECT (${baseCountSql} - ${hiddenCountSql})::int AS total` : `SELECT COALESCE(sum(total), 0)::int AS total FROM (${filteredCountSql}) filtered_counts`;
  const countSql = cachedProofs && countNeedsSearch && !ownerResolution && traitGroups.size === 0 && burned === void 0 ? cachedExactCountSql({
    chains: chains2,
    generation: projectionId,
    relations: selectedRelations,
    filters: countWithoutVisibility,
    fallback: canonicalCountSql
  }) : canonicalCountSql;
  const queryExactCount = async () => {
    if (simpleExactCount)
      return Number((await apiPool.query(countSql, countParams)).rows[0].total);
    return apiReadTransaction(apiPool, async (client) => {
      await client.query("SET LOCAL statement_timeout = '30s'");
      await client.query("SET LOCAL work_mem = '32MB'");
      await client.query("SET LOCAL jit = off");
      if (!ownerResolution && (traitGroups.size === 0 || broadTraits)) {
        await client.query("SET LOCAL work_mem = '64MB'");
        await client.query("SET LOCAL enable_nestloop = off");
        await client.query("SET LOCAL random_page_cost = 1.1");
        await client.query("SET LOCAL join_collapse_limit = 1");
        await client.query("SET LOCAL from_collapse_limit = 1");
      }
      return Number((await client.query(countSql, countParams)).rows[0].total);
    });
  };
  const countPromise = (async () => {
    const started = performance.now();
    const cached2 = await exactCountCache.get(countConfig, queryExactCount);
    return { ...cached2, durationMs: performance.now() - started };
  })();
  params.push(limit + 1);
  const candidateColumns = `t.collection, t.chain_id, t.contract_address, t.token_id, t.owner, t.burned, t.lifecycle,
      t.mint_block, t.last_transfer_block,
      ${tokenOnlyBrowse ? "false" : "COALESCE(s.metadata_available, false)"} AS metadata_available,
      ${tokenOnlyBrowse ? "NULL::numeric" : "s.rarity_points"} AS rarity_points,
      ${tokenOnlyBrowse ? "NULL::numeric" : "s.rarity_points_capped"} AS rarity_points_capped`;
  const candidateLimit = tokenOnlyBrowse ? `($${params.length} + (SELECT count(*) FROM metadata.token_visibility))` : `$${params.length}`;
  const candidateWhere = cursorWhere.length ? `WHERE ${cursorWhere.join(" AND ")}` : "";
  const branch = (relation) => `SELECT ${candidateColumns} FROM ${relation} t
    ${candidateWhere} ORDER BY ${orderBy} LIMIT ${candidateLimit}`;
  const sourceBranch = (relation) => {
    const source = sourceFor2(relation, true);
    return `SELECT ${candidateColumns} FROM ${source} ${candidateWhere} ORDER BY ${orderBy} LIMIT ${candidateLimit}`;
  };
  const candidateQuery = selectedRelations.length > 1 ? `SELECT * FROM ((${selectedRelations.map(sourceBranch).join(") UNION ALL (")})) merged
       ORDER BY ${orderBy.replaceAll("t.", "merged.").replaceAll("s.", "merged.")} LIMIT ${candidateLimit}` : sourceBranch(selectedRelations[0]);
  const rarityQueries = sort.startsWith("rarity") ? rarityPageQueries({
    relations: selectedRelations,
    rawSearch: metadataRawSearchReadRelationAt(projectionId ?? void 0),
    validatedSearch: searchRelation,
    bulkSearch: (relation) => {
      const schema = relation.slice(0, -".token".length);
      return cachedProofs ? cachedSearchReadRelationFor(schema, chains2, projectionId) : metadataSearchReadRelationFor(
        schema,
        !ownershipBnbOnlySchema(schema) && chains2.includes("base"),
        chains2,
        projectionId ?? void 0
      );
    },
    missingKeys: cachedProofs ? (relation) => cachedMissingKeys(
      relation.slice(0, -".token".length),
      chains2,
      projectionId
    ) : void 0,
    columns: candidateColumns,
    filters: where,
    cursorFilters: cursorWhere,
    values: params,
    sort,
    cursor,
    selective: Boolean(ownerResolution) || traitGroups.size > 0 && !broadTraits,
    selectiveTokens: selectiveTokenSource,
    nullsExcluded: sort.startsWith("rarity-capped") ? rarityCappedMin !== void 0 || rarityCappedMax !== void 0 : rarityMin !== void 0 || rarityMax !== void 0,
    missingExcluded: metadata === "available" || rarityMin !== void 0 || rarityMax !== void 0 || rarityCappedMin !== void 0 || rarityCappedMax !== void 0
  }) : null;
  let pagePhase = sort.startsWith("rarity") ? "rank-page" : "token-page";
  const resultPromise = (async () => {
    const started = performance.now();
    const pageSql = (candidates) => `WITH candidates AS MATERIALIZED (${candidates})
    SELECT c.collection AS chain, c.chain_id AS "chainId", c.contract_address AS "contractAddress",
      c.token_id AS "tokenId", c.owner, c.burned, c.lifecycle,
      c.mint_block AS "mintBlock", c.last_transfer_block AS "lastTransferBlock",
      m.name, m.image, m.attributes, m.token_uri AS "tokenUri",
      m.uri_provenance AS "uriProvenance", m.audit_status AS "uriAuditStatus",
      ${tokenOnlyBrowse ? "COALESCE(search.metadata_available, false)" : "c.metadata_available"} AS "metadataAvailable",
      ${tokenOnlyBrowse ? "search.rarity_points" : "c.rarity_points"}::text AS "rarityPoints",
      ${tokenOnlyBrowse ? "search.rarity_points_capped" : "c.rarity_points_capped"}::text AS "rarityPointsCapped"
    FROM candidates c
    LEFT JOIN LATERAL (SELECT * FROM ${metadataReadRelation} metadata_page
      WHERE metadata_page.collection=c.collection AND metadata_page.token_id=c.token_id::numeric AND metadata_page.lifecycle=c.lifecycle OFFSET 0) m ON true
    ${tokenOnlyBrowse ? `LEFT JOIN LATERAL (SELECT * FROM ${searchRelation} search_page
      WHERE search_page.collection=c.collection AND search_page.token_id=c.token_id::numeric AND search_page.lifecycle=c.lifecycle OFFSET 0) search ON true` : ""}
    ${tokenOnlyBrowse ? `WHERE NOT ${activeVisibilityPredicate("c")}` : ""}
    ORDER BY ${orderBy.replaceAll("t.", "c.").replaceAll("s.", "c.")}
    ${tokenOnlyBrowse ? `LIMIT $${params.length}` : ""}
    `;
    const rows = rarityQueries ? rarityQueries.nonnull ? (await apiPool.query(pageSql(rarityQueries.nonnull), params)).rows : [] : (await apiPool.query(pageSql(candidateQuery), params)).rows;
    if (rarityQueries?.nulls && rows.length <= limit) {
      pagePhase = "null-candidates";
      const nullCandidates = await apiReadTransaction(apiPool, async (client) => {
        await client.query("SET LOCAL work_mem = '32MB'");
        await client.query("SET LOCAL jit = off");
        if (!ownerResolution && traitGroups.size === 0) {
          await client.query("SET LOCAL work_mem = '64MB'");
          await client.query("SET LOCAL enable_nestloop = off");
          await client.query("SET LOCAL random_page_cost = 1.1");
          await client.query("SET LOCAL join_collapse_limit = 1");
          await client.query("SET LOCAL from_collapse_limit = 1");
        }
        return (await client.query(rarityQueries.nulls, params)).rows;
      });
      if (nullCandidates.length) {
        pagePhase = "null-page-enrichment";
        const bounded = `SELECT * FROM jsonb_to_recordset($1::jsonb) AS page(
          collection text,chain_id integer,contract_address text,token_id text,
          owner text,burned boolean,lifecycle integer,mint_block numeric,last_transfer_block numeric,
          metadata_available boolean,rarity_points numeric,rarity_points_capped numeric)`;
        rows.push(
          ...(await apiPool.query(pageSql(bounded), [JSON.stringify(nullCandidates)])).rows.slice(0, limit + 1 - rows.length)
        );
      }
    }
    const result2 = { rows };
    return { result: result2, durationMs: performance.now() - started };
  })();
  const [pageRead, countRead] = await Promise.allSettled([
    resultPromise,
    countPromise
  ]);
  if (pageRead.status === "rejected" || countRead.status === "rejected") {
    console.error("API token query failed", {
      chains: chains2,
      sort,
      projectionId,
      pagePhase,
      pageFailed: pageRead.status === "rejected",
      countFailed: countRead.status === "rejected"
    });
    throw pageRead.status === "rejected" ? pageRead.reason : countRead.status === "rejected" ? countRead.reason : new Error("token_query_failed");
  }
  const result = pageRead.value;
  const countResult = countRead.value;
  const resultMs = result.durationMs;
  const countMs = countResult.durationMs;
  c.header(
    "Server-Timing",
    `page;dur=${resultMs.toFixed(1)}, count;dur=${countMs.toFixed(1)};desc="${countResult.hit ? "hit" : "miss"}"`
  );
  if (resultMs > 1e3 || countMs > 1e3)
    console.info("API token query timing", {
      chains: chains2,
      sort,
      filters: where.length - 1,
      pageMs: Math.round(resultMs),
      countMs: Math.round(countMs),
      countCacheHit: countResult.hit
    });
  const hasMore = result.result.rows.length > limit;
  const items = result.result.rows.slice(0, limit);
  const last = items.at(-1);
  const cursorRarity = sort.startsWith("rarity-capped") ? last?.rarityPointsCapped : last?.rarityPoints;
  return c.json({
    ...chainSelectionJson(selection2),
    items,
    nextCursor: hasMore && last ? encodeTokenCursor({
      v: 2,
      config: expectedConfig,
      collection: last.chain,
      tokenId: last.tokenId,
      rarity: cursorRarity ?? null
    }) : null,
    total: countResult.value,
    ...ownerResolution ? ownerResolutionJson(ownerResolution) : {}
  });
});
app.get("/v1/traits", async (c) => {
  const selection2 = chainSelection(c.req.url);
  if (!selection2)
    return c.json({ error: "Invalid chain", available: collectionSlugs }, 400);
  const { scope } = selection2;
  const projectionId = await readActiveProjectionId();
  const table = projectionId ? "metadata_projection" : "metadata";
  const facet = projectionId ? "facet" : "trait_facet";
  const statusTable = projectionId ? "facet_status" : "trait_facet_status";
  const generationFilter = projectionId ? ` AND generation_id=${projectionId}::bigint` : "";
  const [facets, status] = await Promise.all([
    apiPool.query(
      `SELECT trait_type AS "traitType", kind, min_value::text AS min, max_value::text AS max, values FROM ${table}.${facet} WHERE scope=$1${generationFilter} ORDER BY trait_type`,
      [scope]
    ),
    apiPool.query(
      `SELECT available, missing, updated_at, ${metadataSourceMode() === "archive" ? projectionId ? `(SELECT metadata_release_id FROM metadata_projection.generation WHERE id=${projectionId}::bigint) AS metadata_release_id` : "(SELECT metadata_release_id FROM metadata.derived_snapshot WHERE name='traits') AS metadata_release_id" : "NULL::text AS metadata_release_id"} FROM ${table}.${statusTable} WHERE scope=$1${generationFilter}`,
      [scope]
    )
  ]);
  if (metadataSourceMode() === "archive") {
    const release = await localMetadata.release();
    if (status.rows[0]?.metadata_release_id !== release)
      return c.json({ error: "trait_snapshot_pending" }, 503);
  }
  const items = facets.rows.map(
    (row) => row.kind === "numeric" ? { traitType: row.traitType, kind: row.kind, min: row.min, max: row.max } : { traitType: row.traitType, kind: row.kind, values: row.values }
  );
  return c.json({
    ...chainSelectionJson(selection2),
    items,
    metadata: {
      available: status.rows[0]?.available ?? 0,
      missing: status.rows[0]?.missing ?? 0
    },
    updatedAt: status.rows[0]?.updated_at ?? null
  });
});
async function tokenDetail(collection, tokenId) {
  const results = await Promise.all([
    apiPool.query(
      `SELECT t.*, t.collection AS chain, m.name, m.description, m.image, m.animation_url, m.attributes,
      m.document, s.rarity_points::text AS "rarityPoints", s.rarity_points_capped::text AS "rarityPointsCapped",
      m.token_uri, m.uri_provenance, m.uri_verified_at_block, m.audit_status,
      m.fetch_status, m.fetched_at FROM ${ponderSchema}.token t
      LEFT JOIN ${metadataReadRelation} m ON m.collection=t.collection AND m.token_id=t.token_id::numeric AND m.lifecycle=t.lifecycle
      LEFT JOIN ${metadataSearchReadRelation} s ON s.collection=t.collection AND s.token_id=t.token_id::numeric AND s.lifecycle=t.lifecycle
      WHERE t.collection=$1 AND t.token_id=$2`,
      [collection, tokenId]
    ),
    apiPool.query(
      `SELECT * FROM ${ponderSchema}.transfer_event WHERE collection=$1 AND token_id=$2 ORDER BY block_number, transaction_index, log_index`,
      [collection, tokenId]
    ),
    apiPool.query(
      `SELECT l.*, m.token_uri, m.uri_provenance, m.audit_status, m.name, m.image
      FROM ${ponderSchema}.token_lifecycle l LEFT JOIN ${metadataReadRelation} m
      ON m.collection=l.collection AND m.token_id=l.token_id::numeric AND m.lifecycle=l.lifecycle
      WHERE l.collection=$1 AND l.token_id=$2 ORDER BY l.lifecycle`,
      [collection, tokenId]
    )
  ]);
  if (metadataSourceMode() === "archive" && results[0].rows.length) {
    const local = await localMetadata.token(collection, tokenId);
    Object.assign(results[0].rows[0], {
      document: local?.document ?? null,
      publication_status: local?.status ?? "unavailable",
      publication_error: local?.reason ?? null,
      metadata_release: local?.release ?? null,
      metadata_ownership_source: "indexed_chain"
    });
  }
  return results;
}
app.get("/v1/tokens/:chain/:tokenId/visibility/signing-data", async (c) => {
  const collection = chainOf(c.req.param("chain"));
  if (!collection)
    return c.json({ error: "invalid_chain", available: collectionSlugs }, 400);
  const tokenId = c.req.param("tokenId");
  if (!/^\d+$/.test(tokenId)) return c.json({ error: "invalid_token_id" }, 400);
  const hiddenRaw = c.req.query("hidden");
  if (hiddenRaw !== "true" && hiddenRaw !== "false")
    return c.json(
      { error: "invalid_hidden", message: "hidden must be true or false" },
      400
    );
  const state = await currentVisibilityState(apiPool, collection, tokenId);
  if (!state) return c.json({ error: "token_not_found" }, 404);
  if (state.burned) return c.json({ error: "token_not_active" }, 409);
  const owner = String(state.owner).toLowerCase();
  const nonceResult = await apiPool.query(
    "SELECT next_nonce::text FROM metadata.wallet_visibility_nonce WHERE owner=$1",
    [owner]
  );
  const message = {
    owner,
    tokenId,
    lifecycle: Number(state.lifecycle),
    ownershipTransactionHash: state.transactionHash,
    ownershipLogIndex: Number(state.logIndex),
    hidden: hiddenRaw === "true",
    nonce: nonceResult.rows[0]?.next_nonce ?? "0",
    deadline: Math.floor(Date.now() / 1e3) + visibilitySignatureTtlSeconds
  };
  return c.json({ typedData: visibilitySigningDataJson(collection, message) });
});
app.put("/v1/tokens/:chain/:tokenId/visibility", async (c) => {
  const collection = chainOf(c.req.param("chain"));
  if (!collection)
    return c.json({ error: "invalid_chain", available: collectionSlugs }, 400);
  const tokenId = c.req.param("tokenId");
  if (!/^\d+$/.test(tokenId)) return c.json({ error: "invalid_token_id" }, 400);
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const parsed = visibilityRequestSchema.safeParse(body);
  if (!parsed.success)
    return c.json(
      { error: "invalid_request", issues: parsed.error.issues },
      400
    );
  if (parsed.data.message.tokenId !== tokenId)
    return c.json({ error: "token_mismatch" }, 400);
  const now = Math.floor(Date.now() / 1e3);
  if (parsed.data.message.deadline < now)
    return c.json({ error: "signature_expired" }, 410);
  if (parsed.data.message.deadline > now + visibilitySignatureTtlSeconds)
    return c.json({ error: "invalid_deadline" }, 400);
  const message = parsed.data.message;
  const owner = message.owner.toLowerCase();
  const client = await apiPool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await assertOwnershipAvailable(client, [collection]);
    if (metadataSourceMode() === "archive") {
      await client.query(
        "SELECT pg_advisory_xact_lock_shared(hashtext('metadata:chain-recovery'))"
      );
      const ownership = await chainReadiness(client, [collection]);
      if (!ownership.ready) {
        await client.query("ROLLBACK");
        return c.json({ error: "ownership_rebuilding", ownership }, 503);
      }
    }
    await client.query(
      `INSERT INTO metadata.wallet_visibility_nonce(owner, next_nonce)
      VALUES ($1, 0) ON CONFLICT (owner) DO NOTHING`,
      [owner]
    );
    const nonceResult = await client.query(
      `SELECT next_nonce::text FROM metadata.wallet_visibility_nonce
      WHERE owner=$1 FOR UPDATE`,
      [owner]
    );
    if (nonceResult.rows[0].next_nonce !== message.nonce) {
      await client.query("ROLLBACK");
      return c.json(
        { error: "nonce_conflict", nextNonce: nonceResult.rows[0].next_nonce },
        409
      );
    }
    const state = await currentVisibilityState(client, collection, tokenId);
    if (!state) {
      await client.query("ROLLBACK");
      return c.json({ error: "token_not_found" }, 404);
    }
    if (state.burned) {
      await client.query("ROLLBACK");
      return c.json({ error: "token_not_active" }, 409);
    }
    const stateChanged = String(state.owner).toLowerCase() !== owner || Number(state.lifecycle) !== message.lifecycle || String(state.transactionHash).toLowerCase() !== message.ownershipTransactionHash.toLowerCase() || Number(state.logIndex) !== message.ownershipLogIndex;
    if (stateChanged) {
      await client.query("ROLLBACK");
      return c.json({ error: "ownership_changed" }, 409);
    }
    let validSignature = false;
    try {
      validSignature = await verifyVisibilitySignature(
        collection,
        message,
        parsed.data.signature
      );
    } catch {
      validSignature = false;
    }
    if (!validSignature) {
      await client.query("ROLLBACK");
      return c.json({ error: "invalid_signature" }, 401);
    }
    if (message.hidden) {
      await client.query(
        `INSERT INTO metadata.token_visibility(
          collection, token_id, owner, lifecycle, anchor_event_id, anchor_block,
          anchor_transaction_index, anchor_log_index, hidden_at, updated_at)
        VALUES ($1, $2::numeric, $3, $4, $5, $6, $7, $8, now(), now())
        ON CONFLICT (collection, token_id) DO UPDATE SET
          owner=EXCLUDED.owner, lifecycle=EXCLUDED.lifecycle, anchor_event_id=EXCLUDED.anchor_event_id,
          anchor_block=EXCLUDED.anchor_block, anchor_transaction_index=EXCLUDED.anchor_transaction_index,
          anchor_log_index=EXCLUDED.anchor_log_index, hidden_at=now(), updated_at=now()`,
        [
          collection,
          tokenId,
          owner,
          message.lifecycle,
          state.eventId,
          state.blockNumber,
          state.transactionIndex,
          state.logIndex
        ]
      );
    } else {
      await client.query(
        "DELETE FROM metadata.token_visibility WHERE collection=$1 AND token_id=$2::numeric",
        [collection, tokenId]
      );
    }
    await client.query(
      `UPDATE metadata.wallet_visibility_nonce
      SET next_nonce=next_nonce+1, updated_at=now() WHERE owner=$1`,
      [owner]
    );
    await client.query("COMMIT");
    return c.json({
      chain: collection,
      tokenId,
      owner,
      hidden: message.hidden
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => void 0);
    throw error;
  } finally {
    client.release();
  }
});
app.get("/v1/tokens/:chain/:tokenId", async (c) => {
  const collection = chainOf(c.req.param("chain"));
  if (!collection)
    return c.json({ error: "Invalid chain", available: collectionSlugs }, 400);
  const tokenId = c.req.param("tokenId");
  if (!/^\d+$/.test(tokenId)) return c.json({ error: "Invalid token id" }, 400);
  const [tokenResult, transfers, lifecycles] = await tokenDetail(
    collection,
    tokenId
  );
  if (!tokenResult.rows[0]) return c.json({ error: "Token not found" }, 404);
  return c.json({
    token: tokenResult.rows[0],
    transfers: transfers.rows,
    lifecycles: lifecycles.rows
  });
});
app.get("/v1/tokens/:tokenId", async (c) => {
  const tokenId = c.req.param("tokenId");
  if (!/^\d+$/.test(tokenId)) return c.json({ error: "Invalid token id" }, 400);
  const [tokenResult, transfers, lifecycles] = await tokenDetail(
    "ethereum",
    tokenId
  );
  if (!tokenResult.rows[0]) return c.json({ error: "Token not found" }, 404);
  return c.json({
    token: tokenResult.rows[0],
    transfers: transfers.rows,
    lifecycles: lifecycles.rows
  });
});
registerCollectorRoutes(app, {
  pool: apiPool,
  resolveOwner: requireResolvedOwner,
  checkReadiness: async (chains2) => metadataSourceMode() === "archive" ? chainReadiness(apiPool, chains2) : { ready: true }
});
app.get("/v1/owners/:address/tokens", async (c) => {
  const ownerInput = c.req.param("address");
  const limit = limitOf2(c.req.query("limit"));
  const selection2 = chainSelection(c.req.url);
  if (!selection2)
    return c.json({ error: "Invalid chain", available: collectionSlugs }, 400);
  const { chains: chains2, scope } = selection2;
  const cursorScope = ownershipReadConfig.releaseId ? `${scope}:${ownershipReadConfig.releaseId}` : scope;
  const visibility = c.req.query("visibility") ?? "visible";
  if (!visibilityModes.includes(visibility))
    return c.json(
      { error: "Invalid visibility", available: visibilityModes },
      400
    );
  const ownerResolution = await requireResolvedOwner(ownerInput, chains2);
  const cursorRaw = c.req.query("cursor");
  let cursor = decodeOwnerCursor(cursorRaw);
  if (cursorRaw && (!cursor || cursor.scope !== cursorScope || cursor.visibility !== visibility))
    return c.json(
      { error: "Invalid cursor for this chain and visibility filter" },
      400
    );
  const params = [];
  const ownerClauses = [];
  for (const [ownerChain, address3] of Object.entries(
    ownerResolution.addresses
  )) {
    params.push(ownerChain, address3.toLowerCase());
    ownerClauses.push(
      `(t.collection=$${params.length - 1} AND t.owner=$${params.length})`
    );
  }
  const where = [`(${ownerClauses.join(" OR ")})`, `NOT t.burned`];
  if (visibility === "visible")
    where.push(`NOT ${activeVisibilityPredicate()}`);
  else if (visibility === "hidden") where.push(activeVisibilityPredicate());
  params.push(chains2);
  where.push(`t.collection=ANY($${params.length}::text[])`);
  if (cursor) {
    params.push(cursor.tokenId, cursor.collection);
    where.push(
      `(t.token_id::numeric > $${params.length - 1}::numeric OR (t.token_id::numeric = $${params.length - 1}::numeric AND t.collection > $${params.length}))`
    );
  }
  params.push(limit + 1);
  const result = await apiPool.query(
    `SELECT t.collection AS chain, t.chain_id AS "chainId",
      t.contract_address AS "contractAddress", t.token_id AS "tokenId", t.lifecycle, m.name, m.image, m.attributes,
      s.rarity_points::text AS "rarityPoints", s.rarity_points_capped::text AS "rarityPointsCapped",
      ${activeVisibilityPredicate()} AS hidden
    FROM ${ponderSchema}.token t LEFT JOIN ${metadataReadRelation} m
    ON m.collection=t.collection AND m.token_id=t.token_id::numeric AND m.lifecycle=t.lifecycle
    LEFT JOIN ${metadataSearchReadRelation} s
    ON s.collection=t.collection AND s.token_id=t.token_id::numeric AND s.lifecycle=t.lifecycle
    WHERE ${where.join(" AND ")}
    ORDER BY t.token_id::numeric, t.collection LIMIT $${params.length}`,
    params
  );
  const hasMore = result.rows.length > limit;
  const items = result.rows.slice(0, limit);
  const last = items.at(-1);
  const canonicalOwner = canonicalOwnerAddress(ownerResolution, chains2);
  return c.json({
    owner: canonicalOwner?.toLowerCase(),
    ...ownerResolutionJson(ownerResolution),
    ...chainSelectionJson(selection2),
    visibility,
    items,
    nextCursor: hasMore && last ? encodeOwnerCursor({
      v: 3,
      scope: cursorScope,
      visibility,
      collection: last.chain,
      tokenId: last.tokenId
    }) : null
  });
});
app.get("/v1/leaderboards", async (c) => {
  const selection2 = chainSelection(c.req.url);
  if (!selection2)
    return c.json({ error: "Invalid chain", available: collectionSlugs }, 400);
  const { scope } = selection2;
  const snapshot = await apiPool.query(
    `SELECT max(updated_at) AS updated_at, count(*)::int AS wallets FROM ${leaderboardReadRelation} WHERE scope=$1`,
    [scope]
  );
  return c.json({
    items: Object.entries(leaderboardMetrics).map(([slug, value]) => ({
      slug,
      label: value.label
    })),
    collectorScore: { version: scoreVersion, formula: scoreFormula },
    ...chainSelectionJson(selection2),
    wallets: snapshot.rows[0].wallets,
    updatedAt: snapshot.rows[0].updated_at
  });
});
app.get("/v1/leaderboards/:metric", async (c) => {
  const slug = c.req.param("metric");
  const definition = leaderboardMetrics[slug];
  if (!definition)
    return c.json(
      {
        error: "Unknown leaderboard",
        available: Object.keys(leaderboardMetrics)
      },
      404
    );
  const limit = limitOf2(c.req.query("limit"));
  const selection2 = chainSelection(c.req.url);
  if (!selection2)
    return c.json({ error: "Invalid chain", available: collectionSlugs }, 400);
  const { scope } = selection2;
  const cursorRaw = c.req.query("cursor");
  const cursor = decodeRankCursor(cursorRaw);
  const rankCursorScope = ownershipReadConfig.releaseId ? `${scope}:${ownershipReadConfig.releaseId}` : scope;
  if (cursorRaw && (!cursor || (cursor.scope ?? "all") !== rankCursorScope))
    return c.json({ error: "Invalid cursor for this chain filter" }, 400);
  const params = [];
  let cursorWhere = "";
  if (cursor) {
    params.push(cursor.score, cursor.monsterCount, cursor.owner);
    cursorWhere = `WHERE (ranked.score < $1::numeric OR (ranked.score = $1::numeric AND ranked.monster_count < $2) OR (ranked.score = $1::numeric AND ranked.monster_count = $2 AND ranked.owner > $3))`;
  }
  params.push(scope);
  const scopeParam = params.length;
  params.push(limit + 1);
  const limitParam = params.length;
  const result = await apiPool.query(
    `
    WITH ranked AS (
      SELECT owner, ${definition.column}::numeric AS score, monster_count, total_rarity,
        unique_types, special_count, glitter_count, collector_score, updated_at,
        dense_rank() OVER (ORDER BY ${definition.column} DESC) AS rank
      FROM ${leaderboardReadRelation}
      WHERE scope=$${scopeParam} AND ${definition.column} > 0
    )
    SELECT rank::int, ranked.owner, score::text, monster_count AS "monsterCount",
      total_rarity::text AS "totalRarity", unique_types AS "uniqueTypes",
      special_count AS "specialCount", glitter_count AS "glitterCount",
      collector_score::text AS "collectorScore", ranked.updated_at AS "updatedAt",
      selected_ens.name AS "ensName"
    FROM ranked
    ${verifiedEnsJoin("ranked.owner", `$${scopeParam}`)}
    ${cursorWhere}
    ORDER BY ranked.score DESC, ranked.monster_count DESC, ranked.owner ASC LIMIT $${limitParam}
  `,
    params
  );
  const hasMore = result.rows.length > limit;
  const items = result.rows.slice(0, limit);
  const last = items.at(-1);
  return c.json({
    metric: slug,
    label: definition.label,
    ...chainSelectionJson(selection2),
    scoreVersion: slug === "collector-score" ? scoreVersion : null,
    items,
    nextCursor: hasMore && last ? encodeRankCursor({
      score: last.score,
      monsterCount: last.monsterCount,
      owner: last.owner,
      scope: rankCursorScope
    }) : null,
    updatedAt: items[0]?.updatedAt ?? null
  });
});
app.get("/v1/owners/:address/leaderboard", async (c) => {
  const ownerInput = c.req.param("address");
  const selection2 = chainSelection(c.req.url);
  if (!selection2)
    return c.json({ error: "Invalid chain", available: collectionSlugs }, 400);
  const { chains: chains2, scope } = selection2;
  const ownerResolution = await requireResolvedOwner(ownerInput, chains2);
  const address3 = canonicalOwnerAddress(ownerResolution, chains2).toLowerCase();
  const result = await apiPool.query(
    `
    WITH ranks AS (
      SELECT *, dense_rank() OVER (ORDER BY total_rarity DESC) AS total_rarity_rank,
        dense_rank() OVER (ORDER BY monster_count DESC) AS monster_count_rank,
        dense_rank() OVER (ORDER BY unique_types DESC) AS unique_types_rank,
        dense_rank() OVER (ORDER BY special_count DESC) AS special_count_rank,
        dense_rank() OVER (ORDER BY glitter_count DESC) AS glitter_count_rank,
        dense_rank() OVER (ORDER BY collector_score DESC) AS collector_score_rank
      FROM ${leaderboardReadRelation} WHERE scope=$2
    )
    SELECT ranks.owner, monster_count AS "monsterCount", total_rarity::text AS "totalRarity",
      unique_types AS "uniqueTypes", special_count AS "specialCount", glitter_count AS "glitterCount",
      collector_score::text AS "collectorScore", score_version AS "scoreVersion", ranks.updated_at AS "updatedAt",
      total_rarity_rank::int AS "totalRarityRank", monster_count_rank::int AS "monsterCountRank",
      unique_types_rank::int AS "uniqueTypesRank", special_count_rank::int AS "specialCountRank",
      glitter_count_rank::int AS "glitterCountRank", collector_score_rank::int AS "collectorScoreRank",
      selected_ens.name AS "ensName"
    FROM ranks
    ${verifiedEnsJoin("ranks.owner", "$2")}
    WHERE ranks.owner=$1
  `,
    [address3, scope]
  );
  if (!result.rows[0])
    return c.json({ error: "Wallet has no active Yunipals" }, 404);
  return c.json({
    ...result.rows[0],
    ...ownerResolutionJson(ownerResolution),
    ...chainSelectionJson(selection2)
  });
});
app.get("/v1/collection", async (c) => {
  const selection2 = chainSelection(c.req.url);
  if (!selection2)
    return c.json({ error: "Invalid chain", available: collectionSlugs }, 400);
  const params = [selection2.chains];
  const where = `WHERE collection=ANY($1::text[])`;
  const result = await apiPool.query(
    `SELECT count(*)::int AS "knownTokens",
    count(*) FILTER (WHERE NOT burned)::int AS "activeSupply",
    count(*) FILTER (WHERE burned)::int AS "burnedTokens",
    COALESCE(sum(lifecycle), 0)::int AS "lifecycles" FROM ${ponderSchema}.token ${where}`,
    params
  );
  return c.json({ ...chainSelectionJson(selection2), ...result.rows[0] });
});
app.get("/v1/collections", async (c) => {
  const counts = await apiPool.query(`SELECT collection AS chain, count(*)::int AS "knownTokens",
    count(*) FILTER (WHERE NOT burned)::int AS "activeSupply" FROM ${ponderSchema}.token GROUP BY collection`);
  const byChain = new Map(counts.rows.map((row) => [row.chain, row]));
  return c.json({
    items: collectionSlugs.map((slug) => ({
      ...collections[slug],
      ...byChain.get(slug) ?? { knownTokens: 0, activeSupply: 0 }
    }))
  });
});
app.get("/v1/status", async (c) => {
  if (unifiedOwnershipReads) {
    const source = await unifiedOwnershipStatus(apiPool, collectionSlugs);
    const publication2 = await publicationStatus(apiPool);
    const metadata2 = (await apiPool.query(
      "SELECT collection,fetch_status,count(*)::int AS count FROM metadata.token_metadata GROUP BY collection,fetch_status"
    )).rows;
    const items = [];
    for (const slug of collectionSlugs) {
      const status = source.collections.find(
        (item) => item.collection === slug
      );
      const counts = status.available ? (await apiPool.query(
        `SELECT count(*)::int AS "knownTokens",max(last_transfer_block)::text AS "lastEventBlock"
        FROM ${ponderSchema}.token WHERE collection=$1`,
        [slug]
      )).rows[0] : { knownTokens: null, lastEventBlock: null };
      items.push({
        ...collections[slug],
        ...counts,
        source: status,
        metadata: Object.fromEntries(
          metadata2.filter((row) => row.collection === slug).map((row) => [row.fetch_status, row.count])
        )
      });
    }
    const bnb = source.collections.find((item) => item.collection === "bnb");
    return c.json({
      publication: publication2,
      source,
      collections: items,
      bnbIngestion: {
        available: bnb.available,
        nextBlock: bnb.block_number ? (BigInt(bnb.block_number) + 1n).toString() : null,
        lastScannedBlock: bnb.block_number ?? null,
        lastScannedHash: bnb.block_hash ?? null,
        updatedAt: bnb.observed_at ?? null,
        caughtUpAt: bnb.ready ? bnb.observed_at : null,
        lastError: bnb.available ? null : bnb.reason
      },
      uriMode: Object.fromEntries(
        collectionSlugs.map((slug) => [
          slug,
          metadataSourceMode() === "archive" ? "verified_archive_binding" : "current_token_uri_call"
        ])
      ),
      verificationTokenId: process.env.URI_VERIFY_TOKEN_ID ?? "1000000000000",
      metadata: Object.fromEntries(
        metadata2.map((row) => [
          `${row.collection}:${row.fetch_status}`,
          row.count
        ])
      )
    });
  }
  const publication = await publicationStatus(apiPool);
  const [metadata, indexing, bnbIngestion] = await Promise.all([
    apiPool.query(
      "SELECT collection, fetch_status, count(*)::int AS count FROM metadata.token_metadata GROUP BY collection, fetch_status"
    ),
    apiPool.query(`SELECT collection, count(*)::int AS "knownTokens", max(last_transfer_block)::text AS "lastEventBlock"
      FROM ${ponderSchema}.token GROUP BY collection`),
    unifiedOwnershipReads ? apiPool.query(`SELECT (block_number+1)::text AS "nextBlock",block_number::text AS "lastScannedBlock",
      block_hash AS "lastScannedHash",observed_at AS "updatedAt",CASE WHEN ready THEN observed_at END AS "caughtUpAt",NULL::text AS "lastError"
      FROM ${ownershipBnbSchema}.source_status WHERE collection='bnb'`) : apiPool.query(`SELECT next_block::text AS "nextBlock", last_scanned_block::text AS "lastScannedBlock",
      caught_up_at AS "caughtUpAt", last_error AS "lastError", updated_at AS "updatedAt"
      FROM ${ownershipBnbSchema}.sync_state WHERE singleton`)
  ]);
  const indexedByCollection = new Map(
    indexing.rows.map((row) => [row.collection, row])
  );
  return c.json({
    publication,
    collections: collectionSlugs.map((slug) => ({
      ...collections[slug],
      ...indexedByCollection.get(slug) ?? {
        knownTokens: 0,
        lastEventBlock: null
      },
      metadata: Object.fromEntries(
        metadata.rows.filter((row) => row.collection === slug).map((row) => [row.fetch_status, row.count])
      )
    })),
    uriMode: metadataSourceMode() === "archive" ? {
      ethereum: "verified_archive_binding",
      base: "verified_archive_binding",
      polygon: "verified_archive_binding",
      bnb: "verified_archive_binding"
    } : {
      ethereum: "current_base_formula",
      base: "current_token_uri_call",
      polygon: "current_token_uri_call",
      bnb: "current_token_uri_call"
    },
    bnbIngestion: bnbIngestion.rows[0] ?? null,
    verificationTokenId: process.env.URI_VERIFY_TOKEN_ID ?? "1000000000000",
    metadata: Object.fromEntries(
      metadata.rows.map((r) => [`${r.collection}:${r.fetch_status}`, r.count])
    )
  });
});
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await assertOwnershipSourceSelection(apiPool);
  const hostname = process.env.API_HOST ?? "127.0.0.1";
  serve(
    { fetch: app.fetch, hostname, port },
    (info) => console.log(`Yunipals API listening on http://${hostname}:${info.port}`)
  );
}
export {
  app
};
//# sourceMappingURL=main-api.mjs.map
