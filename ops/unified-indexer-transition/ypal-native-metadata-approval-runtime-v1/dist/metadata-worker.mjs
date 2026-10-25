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

// lib/metadata/source/canonical.ts
import { createHash } from "node:crypto";
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
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function assetKey(family, id) {
  if (!family || !id) throw new Error("Missing asset family or ID");
  return contentHash(["legacy-nft", family, id]);
}
var init_canonical = __esm({
  "lib/metadata/source/canonical.ts"() {
    "use strict";
  }
});

// lib/metadata/publication.ts
import { z } from "zod";
function metadataSourceMode(env = process.env) {
  const mode = env.METADATA_SOURCE_MODE ?? "legacy-http";
  if (mode !== "legacy-http" && mode !== "archive") throw new Error("Invalid METADATA_SOURCE_MODE");
  return mode;
}
function validateMetadata(value) {
  const result2 = documentSchema.safeParse(value);
  if (!result2.success) throw new MetadataUnavailable("invalid_metadata_document");
  return result2.data;
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
var MetadataUnavailable, documentSchema;
var init_publication = __esm({
  "lib/metadata/publication.ts"() {
    "use strict";
    init_canonical();
    MetadataUnavailable = class extends Error {
      constructor(reason, status = "unavailable") {
        super(reason);
        this.reason = reason;
        this.status = status;
        this.name = "MetadataUnavailable";
      }
    };
    documentSchema = z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      description: z.string(),
      attributes: z.array(z.object({ trait_type: z.string(), value: z.unknown() }).passthrough()),
      image: z.string().optional(),
      animation_url: z.string().optional()
    }).passthrough();
  }
});

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
var storage, originals;
var init_read_snapshot = __esm({
  "lib/offchain/read-snapshot.ts"() {
    "use strict";
    storage = new AsyncLocalStorage();
    originals = /* @__PURE__ */ new WeakMap();
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
import pg from "pg";
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

// lib/constants.ts
var indexedChains, collections, collectionSlugs, CHAIN_ID, COLLECTION_ADDRESS, DEPLOYMENT_BLOCK, CONSTRUCTOR_BASE_URI, ZERO_ADDRESS, DEFAULT_ADMIN_ROLE, islandCollection, indexedCollections, baseIslandCollection;
var init_constants = __esm({
  "lib/constants.ts"() {
    "use strict";
    indexedChains = {
      ethereum: { chainId: 1, ensCoinType: 60 },
      base: { chainId: 8453, ensCoinType: 2147492101 },
      polygon: { chainId: 137, ensCoinType: 2147483785 },
      bnb: { chainId: 56, ensCoinType: 2147483704 }
    };
    collections = {
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
    collectionSlugs = Object.keys(collections);
    CHAIN_ID = collections.ethereum.chainId;
    COLLECTION_ADDRESS = collections.ethereum.address;
    DEPLOYMENT_BLOCK = collections.ethereum.deploymentBlock;
    CONSTRUCTOR_BASE_URI = "https://meta.polkamon.com/meta?id=";
    ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
    DEFAULT_ADMIN_ROLE = `0x${"00".repeat(32)}`;
    islandCollection = {
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
    indexedCollections = {
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
    baseIslandCollection = indexedCollections["base-islands-v2"];
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
var init_read_mode = __esm({
  "lib/ownership/read-mode.ts"() {
    "use strict";
  }
});

// lib/offchain/sql.ts
function sqlIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value))
    throw new Error(`Invalid SQL identifier: ${value}`);
  return `"${value}"`;
}
var physicalPonderSchemaName, ownershipReadConfig, unifiedOwnershipReads, readSchemaName, bnbSchemaName, physicalPonderSchema, ponderSchema, bnbSchema;
var init_sql = __esm({
  "lib/offchain/sql.ts"() {
    "use strict";
    init_read_mode();
    physicalPonderSchemaName = process.env.DATABASE_SCHEMA ?? "public";
    ownershipReadConfig = ownershipReadConfiguration();
    unifiedOwnershipReads = ownershipReadConfig.mode === "unified";
    readSchemaName = ownershipReadConfig.readSchema;
    bnbSchemaName = process.env.BNB_DATABASE_SCHEMA ?? "bnb_indexer";
    physicalPonderSchema = sqlIdentifier(physicalPonderSchemaName);
    ponderSchema = sqlIdentifier(readSchemaName);
    bnbSchema = sqlIdentifier(bnbSchemaName);
  }
});

// lib/ownership/readiness.ts
import { createHash as createHash2 } from "node:crypto";
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
async function assertLegacyOwnershipSelection(db, selection) {
  const row = (await db.query(
    "SELECT to_regclass($1) AS physical_source,to_regclass($2) AS read_source,to_regclass($3) AS marker",
    [
      `${sqlIdentifier(selection.physicalSchema)}.indexer_source`,
      `${sqlIdentifier(selection.readSchema)}.indexer_source`,
      `${sqlIdentifier(selection.readSchema)}._unified_read_release`
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
  const fingerprint2 = createHash2("sha256").update(
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
    fingerprint: fingerprint2
  };
}
var OwnershipSourceUnavailable;
var init_readiness = __esm({
  "lib/ownership/readiness.ts"() {
    "use strict";
    init_constants();
    init_sql();
    OwnershipSourceUnavailable = class extends Error {
      constructor(reason) {
        super("Ownership source unavailable.");
        this.reason = reason;
      }
      code = "YI001";
    };
  }
});

// ../../ops/unified-indexer-transition/ypal-native-metadata-approval-scheduler-v1.mjs
function startNativeApproval(task, {
  onError = () => {
  },
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  if (typeof task !== "function" || typeof onError !== "function" || typeof setTimer !== "function" || typeof clearTimer !== "function") {
    throw new Error("native_approval_task_and_timer_functions_required");
  }
  let stopping3 = false;
  let timer;
  let release;
  const pause = () => new Promise((resolve) => {
    const finish = () => {
      timer = void 0;
      release = void 0;
      resolve();
    };
    release = finish;
    timer = setTimer(finish, INTERVAL_MS);
  });
  const done = (async () => {
    while (!stopping3) {
      try {
        await task();
      } catch (error) {
        await onError(error);
      }
      if (!stopping3) await pause();
    }
  })();
  void done.catch(() => {
  });
  const requestStop = () => {
    stopping3 = true;
    if (timer !== void 0) {
      clearTimer(timer);
      release();
    }
  };
  return Object.freeze({
    requestStop,
    async stop() {
      requestStop();
      await done;
    }
  });
}
var INTERVAL_MS;
var init_ypal_native_metadata_approval_scheduler_v1 = __esm({
  "../../ops/unified-indexer-transition/ypal-native-metadata-approval-scheduler-v1.mjs"() {
    INTERVAL_MS = 2e3;
  }
});

// ../../packages/yunipals-market-core/src/collectionAbi.ts
import { parseAbi } from "viem";
var collectionAbi;
var init_collectionAbi = __esm({
  "../../packages/yunipals-market-core/src/collectionAbi.ts"() {
    collectionAbi = parseAbi([
      "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
      "event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)",
      "event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)",
      "function tokenURI(uint256 tokenId) view returns (string)",
      "function setBaseURI(string baseURI)",
      "function setTokenURI(uint256 tokenId, string tokenURI)"
    ]);
  }
});

// lib/abi.ts
import { parseAbi as parseAbi2 } from "viem";
var islandsAbi, baseIslandsAbi;
var init_abi = __esm({
  "lib/abi.ts"() {
    "use strict";
    init_collectionAbi();
    islandsAbi = parseAbi2([
      "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
      "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
      "function tokenURI(uint256 tokenId) view returns (string)",
      "function totalSupply() view returns (uint256)",
      "function tokenByIndex(uint256 index) view returns (uint256)",
      "function ownerOf(uint256 tokenId) view returns (address)",
      "function genesisLimit() view returns (uint256)",
      "function metadataStorage() view returns (address)"
    ]);
    baseIslandsAbi = parseAbi2([
      "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
      "event OwnershipTransferred(address indexed previousOwner,address indexed newOwner)",
      "event AirdropFinalized(uint256 totalSupply,uint256 sourceBlockNumber,bytes32 sourceBlockHash,bytes32 distributionSha256)",
      "function tokenURI(uint256 tokenId) view returns (string)",
      "function ownerOf(uint256 tokenId) view returns (address)",
      "function totalSupply() view returns (uint256)"
    ]);
  }
});

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
var init_rpc = __esm({
  "lib/rpc.ts"() {
    "use strict";
  }
});

// lib/safe-error.ts
function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https?:\/\/[^\s'"\]]+\/v2\/[^\s'"\]]+/gi, "<redacted-rpc-url>").replace(/wss?:\/\/[^\s'"\]]+\/v2\/[^\s'"\]]+/gi, "<redacted-rpc-url>");
}
var init_safe_error = __esm({
  "lib/safe-error.ts"() {
    "use strict";
  }
});

// lib/rarity/legacy.cjs
var require_legacy = __commonJS({
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

// lib/rarity/calculate.ts
import { createHash as createHash3 } from "node:crypto";
function relevantInput(tokenId, document) {
  return {
    id: document.id ?? tokenId,
    originScore: document.originScore ?? null,
    initialProbabilities: document.initialProbabilities ?? null,
    attributes: document.attributes ?? []
  };
}
function fingerprint(value) {
  return createHash3("sha256").update(JSON.stringify(value)).digest("hex");
}
function result(inputFingerprint, status, rarityPoints = null, rarityPointsCapped = null, errorCode = null) {
  return {
    formulaVersion: rarityFormulaVersion,
    inputFingerprint,
    status,
    rarityPoints,
    rarityPointsCapped,
    errorCode
  };
}
function calculateRarity(tokenId, document) {
  const input = relevantInput(tokenId, document);
  const inputFingerprint = fingerprint(input);
  if (!Array.isArray(input.attributes)) {
    return result(inputFingerprint, "invalid", null, null, "attributes_not_array");
  }
  try {
    const attributes = import_legacy.AttributeTransformingUtils.toAttributes(
      input.attributes
    );
    if (!attributes.type) {
      return result(inputFingerprint, "missing_input", null, null, "type_missing");
    }
    if ((0, import_legacy.isRainbowByAttrs)({ attributes }) && typeof input.originScore !== "number") {
      return result(
        inputFingerprint,
        "missing_input",
        null,
        null,
        "rainbow_origin_score_missing"
      );
    }
    const rarityInput = {
      id: String(input.id),
      originScore: input.originScore,
      initialProbabilities: input.initialProbabilities,
      attributes
    };
    const rarityPoints = (0, import_legacy.rarityFor)(rarityInput, {});
    const rarityPointsCapped = (0, import_legacy.rarityFor)(rarityInput);
    if (rarityPoints === void 0 && rarityPointsCapped === void 0) {
      return result(inputFingerprint, "unscored");
    }
    if (typeof rarityPoints !== "number" || typeof rarityPointsCapped !== "number" || !Number.isFinite(rarityPoints) || !Number.isFinite(rarityPointsCapped) || rarityPoints < 0 || rarityPointsCapped < 0) {
      return result(inputFingerprint, "invalid", null, null, "non_finite_score");
    }
    return result(
      inputFingerprint,
      "valid",
      rarityPoints,
      rarityPointsCapped
    );
  } catch {
    return result(inputFingerprint, "invalid", null, null, "calculation_failed");
  }
}
var import_legacy, rarityFormulaVersion;
var init_calculate = __esm({
  "lib/rarity/calculate.ts"() {
    "use strict";
    import_legacy = __toESM(require_legacy(), 1);
    rarityFormulaVersion = "web3-util-pmons-31.15.1-v1";
  }
});

// lib/rarity/store.ts
async function storeRarityCalculations(client, calculations) {
  if (!calculations.length) return;
  await client.query(
    `INSERT INTO metadata.token_rarity
      (collection, token_id, lifecycle, formula_version, metadata_content_hash,
       input_fingerprint, status, rarity_points, rarity_points_capped, error_code,
       calculated_at)
    SELECT collection, token_id, lifecycle, formula_version, metadata_content_hash,
      input_fingerprint, status, rarity_points, rarity_points_capped, error_code, now()
    FROM jsonb_to_recordset($1::jsonb) AS x(
      collection text, token_id numeric, lifecycle integer, formula_version text,
      metadata_content_hash text, input_fingerprint text, status text,
      rarity_points numeric, rarity_points_capped numeric, error_code text)
    ON CONFLICT (collection, token_id, lifecycle, formula_version) DO UPDATE SET
      metadata_content_hash=EXCLUDED.metadata_content_hash,
      input_fingerprint=EXCLUDED.input_fingerprint,
      status=EXCLUDED.status,
      rarity_points=EXCLUDED.rarity_points,
      rarity_points_capped=EXCLUDED.rarity_points_capped,
      error_code=EXCLUDED.error_code,
      calculated_at=EXCLUDED.calculated_at
    WHERE metadata.token_rarity.input_fingerprint IS DISTINCT FROM EXCLUDED.input_fingerprint
      OR metadata.token_rarity.metadata_content_hash IS DISTINCT FROM EXCLUDED.metadata_content_hash`,
    [
      JSON.stringify(
        calculations.map((item) => ({
          collection: item.collection,
          token_id: item.tokenId,
          lifecycle: item.lifecycle,
          formula_version: rarityFormulaVersion,
          metadata_content_hash: item.metadataContentHash,
          input_fingerprint: item.inputFingerprint,
          status: item.status,
          rarity_points: item.rarityPoints,
          rarity_points_capped: item.rarityPointsCapped,
          error_code: item.errorCode
        }))
      )
    ]
  );
}
var init_store = __esm({
  "lib/rarity/store.ts"() {
    "use strict";
    init_calculate();
  }
});

// lib/metadata/publication-store.ts
async function storePublicationValues(client, values) {
  if (!values.length) return;
  const rows = JSON.stringify(values), record = `x(release text,collection text,"tokenId" text,lifecycle integer,"assetKey" text,
    "rendererVersion" text,"inputHash" text,"contentHash" text,variant text,document jsonb,status text,reason text,uri text,
    "mintTransactionHash" text,"mintLogIndex" integer,"chainEventKey" text,"chainEventBlockHash" text)`;
  await client.query(
    `INSERT INTO metadata_source.render_revision(release_id,asset_key,variant,renderer_version,input_hash,content_hash,document)
    SELECT DISTINCT ON(release,"assetKey",variant,"rendererVersion","inputHash") release,"assetKey",variant,"rendererVersion","inputHash","contentHash",document
    FROM jsonb_to_recordset($1::jsonb) AS ${record} WHERE status='published' ON CONFLICT DO NOTHING`,
    [rows]
  );
  const conflict = await client.query(
    `SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS ${record}
    JOIN metadata_source.render_revision r ON r.release_id=x.release AND r.asset_key=x."assetKey" AND r.variant=x.variant
      AND r.renderer_version=x."rendererVersion" AND r.input_hash=x."inputHash"
    WHERE x.status='published' AND r.content_hash<>x."contentHash" LIMIT 1`,
    [rows]
  );
  if (conflict.rowCount) throw new Error("render_revision_conflict");
  await client.query(
    `INSERT INTO metadata.token_metadata(collection,token_id,lifecycle,token_uri,uri_provenance,fetch_status,name,description,image,animation_url,attributes,document,content_hash)
    SELECT collection,"tokenId"::numeric,lifecycle,coalesce(uri,'archive:'||release||':unavailable'),'archived_binding','not_requested',
      document->>'name',document->>'description',document->>'image',document->>'animation_url',coalesce(document->'attributes','[]'::jsonb),document,"contentHash"
    FROM jsonb_to_recordset($1::jsonb) AS ${record}
    ON CONFLICT(collection,token_id,lifecycle) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,image=EXCLUDED.image,
      animation_url=EXCLUDED.animation_url,attributes=EXCLUDED.attributes,document=EXCLUDED.document,content_hash=EXCLUDED.content_hash,updated_at=now()`,
    [rows]
  );
  await client.query(
    `INSERT INTO metadata.token_publication(collection,token_id,lifecycle,release_id,asset_key,renderer_version,input_hash,publication_content_hash,
    publication_status,publication_error,mint_transaction_hash,mint_log_index,chain_event_key,chain_event_block_hash)
    SELECT collection,"tokenId"::numeric,lifecycle,release,"assetKey","rendererVersion","inputHash","contentHash",status,reason,"mintTransactionHash","mintLogIndex","chainEventKey","chainEventBlockHash"
    FROM jsonb_to_recordset($1::jsonb) AS ${record}
    ON CONFLICT(collection,token_id,lifecycle) DO UPDATE SET release_id=EXCLUDED.release_id,asset_key=EXCLUDED.asset_key,renderer_version=EXCLUDED.renderer_version,
      input_hash=EXCLUDED.input_hash,publication_content_hash=EXCLUDED.publication_content_hash,publication_status=EXCLUDED.publication_status,
      publication_error=EXCLUDED.publication_error,published_at=now(),mint_transaction_hash=EXCLUDED.mint_transaction_hash,mint_log_index=EXCLUDED.mint_log_index,chain_event_key=EXCLUDED.chain_event_key,chain_event_block_hash=EXCLUDED.chain_event_block_hash`,
    [rows]
  );
  await storeRarityCalculations(
    client,
    values.map((value) => ({
      collection: value.collection,
      tokenId: value.tokenId,
      lifecycle: value.lifecycle,
      metadataContentHash: value.contentHash,
      ...calculateRarity(value.tokenId, value.document ?? {})
    }))
  );
}
var init_publication_store = __esm({
  "lib/metadata/publication-store.ts"() {
    "use strict";
    init_calculate();
    init_store();
  }
});

// lib/metadata/render/legacy.cjs
var require_legacy2 = __commonJS({
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

// lib/metadata/render/snapshot.ts
import { basename, extname } from "node:path";
import { z as z2 } from "zod";
function renderLegacySnapshot(value, options) {
  if (!Number.isSafeInteger(options.metadataUpdatedAt) || options.metadataUpdatedAt < 0) throw new Error("Invalid metadata timestamp");
  const envelope = envelopeSchema.parse(value), nft = envelope.nft;
  const legacyChain = (0, import_legacy2.getLegacyChain)(envelope.chain, nft.id), originChain = (0, import_legacy2.getLegacyChain)(envelope.chainOrigin, nft.id);
  const attrs = nft.attributes;
  const attributes = import_legacy2.AttributeTransformingUtils.toTraits(attrs);
  const nfb = import_legacy2.NFBOrigins.includes(envelope.origin.type);
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
  if ((0, import_legacy2.isRainbowByAttrs)({ attributes: attrs })) {
    const origins = options.rainbow;
    if (!origins || !origins.originIds.length || origins.originIds.length !== origins.origins.length || !Number.isFinite(origins.originScore)) {
      throw new MissingOriginData();
    }
    Object.assign(meta, origins);
  }
  if (options.legacyFactoryOnly) return JSON.parse(JSON.stringify(meta));
  const transformed = import_legacy2.AttributeTransformingUtils.toAttributes(attributes, meta);
  const transformer = options.publicFacing ? import_legacy2.PublicAttributeTransformingUtils : import_legacy2.AttributeTransformingUtils;
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
        attributes: import_legacy2.AttributeTransformingUtils.toAttributes(meta.attributes)
      };
      if (!rarityInput.attributes.type) Object.assign(meta, { rarity: 0, rarityCapped: 0 });
      else Object.assign(meta, { rarity: (0, import_legacy2.rarityFor)(rarityInput, {}), rarityCapped: (0, import_legacy2.rarityFor)(rarityInput) });
    } catch {
      Object.assign(meta, { rarity: 0, rarityCapped: 0 });
    }
  }
  return JSON.parse(JSON.stringify(meta));
}
var import_legacy2, rendererVersion, chain, envelopeSchema, MissingOriginData;
var init_snapshot = __esm({
  "lib/metadata/render/snapshot.ts"() {
    "use strict";
    import_legacy2 = __toESM(require_legacy2(), 1);
    rendererVersion = "legacy-snapshot-v1";
    chain = z2.object({ id: z2.enum(["1", "56", "137", "42161", "42170", "mainnet-beta"]), type: z2.enum(["EVM", "SOLANA"]) });
    envelopeSchema = z2.object({
      chain,
      chainOrigin: chain,
      origin: z2.object({ type: z2.string() }).passthrough(),
      nft: z2.object({ id: z2.string(), name: z2.string(), description: z2.string(), attributes: z2.record(z2.unknown()) }).passthrough()
    }).passthrough();
    MissingOriginData = class extends Error {
      constructor() {
        super("Historical rainbow origins are required before rendering");
        this.name = "MissingOriginData";
      }
    };
  }
});

// lib/metadata/source/ejson.ts
function decodeSource(value) {
  if (Array.isArray(value)) return value.map(decodeSource);
  if (value === null || typeof value !== "object") return value;
  const object = value, keys = Object.keys(object);
  if (keys.length === 1) {
    if (typeof object.$oid === "string") return object.$oid;
    if (typeof object.$numberInt === "string") {
      const number = Number(object.$numberInt);
      if (!Number.isSafeInteger(number)) throw new Error("Invalid BSON integer");
      return number;
    }
    if (typeof object.$numberLong === "string") {
      const number = Number(object.$numberLong);
      return Number.isSafeInteger(number) ? number : object.$numberLong;
    }
    if (typeof object.$numberDouble === "string") {
      const number = Number(object.$numberDouble);
      if (!Number.isFinite(number)) throw new Error("Non-finite BSON number cannot be rendered");
      return number;
    }
    if (typeof object.$numberDecimal === "string") return object.$numberDecimal;
    if (object.$date !== void 0) {
      const decoded = decodeSource(object.$date);
      if (typeof decoded !== "string" && typeof decoded !== "number") throw new Error("Invalid BSON date");
      const date = new Date(decoded);
      if (Number.isNaN(date.getTime())) throw new Error("Invalid BSON date");
      return date.toISOString();
    }
  }
  return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, decodeSource(item)]));
}
var init_ejson = __esm({
  "lib/metadata/source/ejson.ts"() {
    "use strict";
  }
});

// lib/metadata/render/origins.ts
import { z as z3 } from "zod";
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
      attributes: import_legacy3.AttributeTransformingUtils.toTraits(nft.attributes),
      background_color: "FFFFFF",
      animation_url: `https://assets.polkamon.com/videos/Unimons_${nft.code}.mp4`
    }))
  };
}
var import_legacy3, parentSchema;
var init_origins = __esm({
  "lib/metadata/render/origins.ts"() {
    "use strict";
    import_legacy3 = __toESM(require_legacy2(), 1);
    init_snapshot();
    parentSchema = z3.object({ nft: z3.object({
      id: z3.string(),
      code: z3.string(),
      birthday: z3.string(),
      initialRarityCapped: z3.number().finite(),
      name: z3.string(),
      description: z3.string(),
      attributes: z3.record(z3.unknown()),
      initialProbabilities: z3.unknown().optional()
    }).passthrough() });
  }
});

// lib/metadata/source/read.ts
var import_legacy4, ArchiveLookupError, ArchiveReader;
var init_read = __esm({
  "lib/metadata/source/read.ts"() {
    "use strict";
    init_canonical();
    init_ejson();
    init_origins();
    init_snapshot();
    import_legacy4 = __toESM(require_legacy2(), 1);
    ArchiveLookupError = class extends Error {
      constructor(code) {
        super(code);
        this.code = code;
        this.name = "ArchiveLookupError";
      }
    };
    ArchiveReader = class {
      constructor(pool2, release, candidate = false) {
        this.pool = pool2;
        this.release = release;
        this.candidate = candidate;
      }
      async checkRelease() {
        const result2 = await this.pool.query("SELECT state FROM metadata_source.archive_release WHERE release_id=$1", [this.release]);
        if (!result2.rowCount || (this.candidate ? !["candidate", "validated", "active", "superseded"].includes(result2.rows[0].state) : result2.rows[0].state !== "active")) throw new ArchiveLookupError("archive_unavailable");
      }
      async byAsset(key) {
        await this.checkRelease();
        const result2 = await this.pool.query(`SELECT r.asset_key AS "assetKey",r.content_hash AS hash,b.payload,
      r.source_burned AS burned,r.imported_at AS "importedAt",r.issue
      FROM metadata_source.source_record r JOIN metadata_source.source_blob b USING(content_hash)
      WHERE r.release_id=$1 AND r.asset_key=$2
      ORDER BY r.source_burned ASC, r.source_key ASC LIMIT 1`, [this.release, key]);
        if (!result2.rowCount) throw new ArchiveLookupError("source_missing");
        if (result2.rows[0].issue) throw new ArchiveLookupError("source_invalid");
        return result2.rows[0];
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
        if ((0, import_legacy4.isRainbowByAttrs)(decoded.nft)) {
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
  }
});

// lib/metadata/source/archive.ts
async function lockCandidate(client, release) {
  const result2 = await client.query("SELECT state FROM metadata_source.archive_release WHERE release_id=$1 FOR SHARE", [release]);
  if (result2.rows[0]?.state !== "candidate") throw new Error("Archive release is not a writable candidate");
}
var init_archive = __esm({
  "lib/metadata/source/archive.ts"() {
    "use strict";
    init_canonical();
  }
});

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
var baseMetadataEventsRelation, baseMetadataScanRelation;
var init_base_mode = __esm({
  "lib/metadata/base-mode.ts"() {
    "use strict";
    init_sql();
    baseMetadataEventsRelation = () => nativeBaseMetadataReads() ? `${ponderSchema}.base_metadata_event` : "metadata_source.chain_metadata_event";
    baseMetadataScanRelation = () => nativeBaseMetadataReads() ? `${ponderSchema}.base_metadata_scan` : "metadata_source.chain_metadata_scan";
  }
});

// lib/metadata/base-abi.ts
import { parseAbi as parseAbi3 } from "viem";
var baseMetadataAbi;
var init_base_abi = __esm({
  "lib/metadata/base-abi.ts"() {
    "use strict";
    baseMetadataAbi = parseAbi3([
      "event Mint(address indexed to,uint256 indexed tokenId,(uint16 monsterType,uint16 color,uint16 horn,uint8 background,uint8 glitter,uint40 rarityScore) yunipal)",
      "event Update(address indexed to,uint256 indexed tokenId,(uint16 monsterType,uint16 color,uint16 horn,uint8 background,uint8 glitter,uint40 rarityScore) yunipal)",
      "function yunipal(uint256 tokenId) view returns ((uint16 monsterType,uint16 color,uint16 horn,uint8 background,uint8 glitter,uint40 rarityScore))"
    ]);
  }
});

// lib/metadata/source/base-events.ts
import { z as z4 } from "zod";
function validateBaseMetadataEvents(from, to, hash, events) {
  if (from < 0n || to < from || !/^0x[0-9a-f]{64}$/.test(hash))
    throw new Error("Invalid Base event range");
  const identities = /* @__PURE__ */ new Map();
  for (const event of events) {
    baseTraitsSchema.parse(event.traits);
    if (BigInt(event.blockNumber) < from || BigInt(event.blockNumber) > to || !/^0x[0-9a-f]{64}$/.test(event.transactionHash) || !/^0x[0-9a-f]{64}$/.test(event.blockHash) || !/^0x[0-9a-f]{40}$/.test(event.recipient) || !/^(0|[1-9]\d*)$/.test(event.tokenId) || BigInt(event.tokenId) >= 2n ** 256n || !["Mint", "Update"].includes(event.eventName) || !Number.isSafeInteger(event.logIndex) || event.logIndex < 0 || !Number.isSafeInteger(event.transactionIndex) || event.transactionIndex < 0)
      throw new Error("Invalid Base event identity");
    const key = `${event.transactionHash}:${event.logIndex}`, encoded = canonicalJson(event);
    if (identities.has(key) && identities.get(key) !== encoded)
      throw new Error("Conflicting Base event identity");
    identities.set(key, encoded);
  }
}
async function insertBaseMetadataEvents(client, events) {
  await client.query(
    `INSERT INTO metadata_source.chain_metadata_event(chain_id,contract_address,transaction_hash,log_index,transaction_index,block_number,block_hash,event_name,token_id,recipient,traits)
   SELECT 8453,$1,"transactionHash","logIndex","transactionIndex","blockNumber"::bigint,"blockHash","eventName","tokenId",recipient,traits
   FROM jsonb_to_recordset($2::jsonb) AS x("transactionHash" text,"logIndex" integer,"transactionIndex" integer,"blockNumber" text,"blockHash" text,"eventName" text,"tokenId" text,recipient text,traits jsonb)
   ON CONFLICT DO NOTHING`,
    [collections.base.address, canonicalJson(events)]
  );
  const conflict = await client.query(
    `SELECT 1 FROM jsonb_to_recordset($2::jsonb) AS x("transactionHash" text,"logIndex" integer,"transactionIndex" integer,"blockNumber" text,"blockHash" text,"eventName" text,"tokenId" text,recipient text,traits jsonb)
   JOIN metadata_source.chain_metadata_event e ON e.chain_id=8453 AND e.contract_address=$1 AND e.transaction_hash=x."transactionHash" AND e.log_index=x."logIndex"
   WHERE (e.transaction_index,e.block_number,e.block_hash,e.event_name,e.token_id,e.recipient,e.traits)
    IS DISTINCT FROM (x."transactionIndex",x."blockNumber"::bigint,x."blockHash",x."eventName",x."tokenId",x.recipient,x.traits) LIMIT 1`,
    [collections.base.address, canonicalJson(events)]
  );
  if (conflict.rowCount) throw new Error("Conflicting stored Base event");
}
async function commitBaseMetadataRange(pool2, name2, from, to, hash, events) {
  validateBaseMetadataEvents(from, to, hash, events);
  const client = await pool2.connect();
  try {
    await client.query("BEGIN");
    const cursor = (await client.query(
      "SELECT next_block::text,chain_id,contract_address,target_block::text,ingestion_mode FROM metadata_source.chain_metadata_scan WHERE name=$1 FOR UPDATE",
      [name2]
    )).rows[0];
    if (!cursor || cursor.ingestion_mode !== "rpc" || BigInt(cursor.next_block) !== from || cursor.chain_id !== 8453 || cursor.contract_address !== collections.base.address || to > BigInt(cursor.target_block))
      throw new Error("Base event checkpoint changed");
    await insertBaseMetadataEvents(client, events);
    await client.query(
      "UPDATE metadata_source.chain_metadata_scan SET next_block=$2,last_scanned_hash=$3,updated_at=now() WHERE name=$1",
      [name2, (to + 1n).toString(), hash]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
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
var baseTraitsSchema;
var init_base_events = __esm({
  "lib/metadata/source/base-events.ts"() {
    "use strict";
    init_constants();
    init_canonical();
    init_base_mode();
    init_base_abi();
    baseTraitsSchema = z4.object({
      monsterType: z4.number().int().min(0).max(65535),
      color: z4.number().int().min(0).max(65535),
      horn: z4.number().int().min(0).max(65535),
      background: z4.number().int().min(0).max(255),
      glitter: z4.number().int().min(0).max(255),
      rarityScore: z4.string().regex(/^\d+$/).refine((v) => BigInt(v) < 2n ** 40n)
    }).strict();
  }
});

// lib/metadata/source/bindings.ts
function metadataLookupId(uri) {
  const url = new URL(uri);
  if (url.protocol !== "https:" || !["meta.polkamon.com", "meta.yunipals.com", "meta.polychainmonsters.com"].includes(url.hostname) || url.port || url.username || url.password || url.pathname !== "/meta" || url.hash || url.searchParams.getAll("id").length !== 1 || [...url.searchParams.keys()].some((key) => key !== "id"))
    throw new Error("unsupported_metadata_uri");
  const id = url.searchParams.get("id");
  if (!/^[a-zA-Z0-9]{1,100}$/.test(id))
    throw new Error("unsupported_metadata_id");
  return id;
}
function verifyBinding(input) {
  const config = collections[input.collection];
  if (!config || input.chainId !== config.chainId || input.contractAddress.toLowerCase() !== config.address)
    throw new Error("collection_mismatch");
  if (!/^(0|[1-9]\d*)$/.test(input.tokenId) || BigInt(input.tokenId) > 2n ** 256n - 1n)
    throw new Error("invalid_token_id");
  if (!Number.isSafeInteger(input.lifecycle) || input.lifecycle < 1 || !/^0x[0-9a-f]{64}$/.test(input.mintTransactionHash) || !Number.isSafeInteger(input.mintLogIndex) || input.mintLogIndex < 0)
    throw new Error("invalid_mint_anchor");
  if (!/^[0-9a-f]{64}$/.test(input.assetKey) || !input.family || !/^[0-9a-f]{64}$/.test(input.sourceHash))
    throw new Error("invalid_source_evidence");
  const lookupId = metadataLookupId(input.tokenUri);
  if (!["current_token_uri_call", "current_token_uri_call_host_fallback", "current_base_formula", "historical_formula_fallback"].includes(input.uriProvenance))
    throw new Error("unverified_uri_provenance");
  if (input.uriProvenance === "historical_formula_fallback" && !input.burned)
    throw new Error("live_token_requires_uri_evidence");
  if (input.uriProvenance === "current_base_formula" && input.collection !== "base")
    throw new Error("formula_collection_mismatch");
  if (["current_base_formula", "historical_formula_fallback"].includes(input.uriProvenance) && lookupId !== input.tokenId)
    throw new Error("formula_identity_mismatch");
  if (input.documentName && input.documentId !== input.sourceLegacyId)
    throw new Error("cached_document_identity_mismatch");
  return {
    lookupId,
    uri: input.tokenUri,
    uriProvenance: input.uriProvenance,
    sourceHash: input.sourceHash,
    family: input.family,
    documentId: input.documentId,
    rule: "configured contract + observed token URI + archived lookup + canonical mint event",
    version: 1
  };
}
async function storeRuntimeBindings(pool2, release, inputs) {
  return storeVerifiedBindings(pool2, release, inputs, true);
}
async function storeVerifiedBindings(pool2, release, inputs, runtime) {
  const rows = inputs.map((input) => ({ ...input, chainId: String(input.chainId), contractAddress: input.contractAddress.toLowerCase(), evidence: verifyBinding(input) }));
  const identities = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.chainId, row.contractAddress, row.tokenId]);
    if (identities.has(key) && identities.get(key) !== row.assetKey)
      throw new Error("conflicting_batch_binding");
    identities.set(key, row.assetKey);
  }
  const encoded = JSON.stringify(rows), client = await pool2.connect();
  try {
    await client.query("BEGIN");
    if (runtime) {
      const active = await client.query("SELECT 1 FROM metadata_source.archive_release WHERE release_id=$1 AND state='active' FOR SHARE", [release]);
      if (!active.rowCount) throw new Error("archive_unavailable");
      for (const row of rows) {
        const source = await client.query(`SELECT 1 FROM metadata_source.source_record WHERE release_id=$1
                  AND asset_key=$2 AND content_hash=$3 AND issue IS NULL LIMIT 1`, [release, row.assetKey, row.sourceHash]);
        if (!source.rowCount) throw new Error("unverified_source");
      }
    } else await lockCandidate(client, release);
    const conflict = await client.query(`SELECT 1 FROM metadata_source.asset_binding b
   JOIN jsonb_to_recordset($2::jsonb) AS x("chainId" text,"contractAddress" text,"tokenId" text,"assetKey" text)
    ON b.chain_id=x."chainId" AND b.contract_address=x."contractAddress" AND b.token_id=x."tokenId"
   WHERE b.release_id=$1 AND b.network='eip155' AND b.asset_key<>x."assetKey" LIMIT 1`, [release, encoded]);
    if (conflict.rowCount)
      throw new Error("existing_asset_binding_conflict");
    await client.query(`INSERT INTO metadata_source.asset_binding(release_id,network,chain_id,contract_address,token_id,asset_key,evidence)
   SELECT $1,'eip155',"chainId","contractAddress","tokenId","assetKey",evidence
   FROM jsonb_to_recordset($2::jsonb) AS x("chainId" text,"contractAddress" text,"tokenId" text,"assetKey" text,evidence jsonb)
   ON CONFLICT DO NOTHING`, [release, encoded]);
    const lifecycleConflict = await client.query(`SELECT 1 FROM metadata_source.lifecycle_binding b
   JOIN jsonb_to_recordset($2::jsonb) AS x("chainId" text,"contractAddress" text,"tokenId" text,"mintTransactionHash" text,"mintLogIndex" integer,"assetKey" text)
    ON b.chain_id=x."chainId" AND b.contract_address=x."contractAddress" AND b.token_id=x."tokenId"
    AND b.mint_transaction_hash=x."mintTransactionHash" AND b.mint_log_index=x."mintLogIndex"
   WHERE b.release_id=$1 AND b.asset_key<>x."assetKey" LIMIT 1`, [release, encoded]);
    if (lifecycleConflict.rowCount)
      throw new Error("existing_lifecycle_binding_conflict");
    await client.query(`INSERT INTO metadata_source.lifecycle_binding(release_id,chain_id,contract_address,token_id,mint_transaction_hash,mint_log_index,asset_key,input_hash)
   SELECT $1,"chainId","contractAddress","tokenId","mintTransactionHash","mintLogIndex","assetKey","sourceHash"
   FROM jsonb_to_recordset($2::jsonb) AS x("chainId" text,"contractAddress" text,"tokenId" text,"mintTransactionHash" text,"mintLogIndex" integer,"assetKey" text,"sourceHash" text)
   ON CONFLICT DO NOTHING`, [release, encoded]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
var ArchiveOwnershipReader;
var init_bindings = __esm({
  "lib/metadata/source/bindings.ts"() {
    "use strict";
    init_constants();
    init_sql();
    init_archive();
    init_read();
    init_base_events();
    ArchiveOwnershipReader = class {
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
        const result2 = await this.pool.query(`SELECT t.collection,t.chain_id AS "chainId",t.contract_address AS "contractAddress",t.token_id AS "tokenId",
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
        if (!result2.rowCount)
          return null;
        if (result2.rows.length !== 1)
          throw new Error("ambiguous_mint_anchor");
        const row = result2.rows[0];
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
  }
});

// lib/metadata/source/supplemental.ts
import { z as z5 } from "zod";
var staticNamespace, aliasSchema;
var init_supplemental = __esm({
  "lib/metadata/source/supplemental.ts"() {
    "use strict";
    init_canonical();
    init_archive();
    staticNamespace = "legacy.static-island-metadata";
    aliasSchema = z5.object({
      alias: z5.string().regex(/^\d+$/),
      targetId: z5.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
      family: z5.literal("GEN1")
    }).strict();
  }
});

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
var init_chain_readiness = __esm({
  "lib/metadata/chain-readiness.ts"() {
    "use strict";
    init_constants();
    init_publication();
    init_sql();
    init_readiness();
    init_base_mode();
    init_sql();
  }
});

// lib/metadata/resolve.ts
async function selectedRelease(pool2, options = {}) {
  const result2 = options.candidate && options.releaseId ? await pool2.query(
    "SELECT release_id FROM metadata_source.archive_release WHERE release_id=$1 AND state IN ('candidate','validated')",
    [options.releaseId]
  ) : await pool2.query(
    "SELECT release_id FROM metadata_source.archive_release WHERE state='active'"
  );
  if (result2.rowCount !== 1 || options.releaseId && result2.rows[0].release_id !== options.releaseId)
    throw new MetadataUnavailable("archive_unavailable", "retry");
  return result2.rows[0].release_id;
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
var LocalMetadataReader;
var init_resolve = __esm({
  "lib/metadata/resolve.ts"() {
    "use strict";
    init_constants();
    init_sql();
    init_read();
    init_bindings();
    init_supplemental();
    init_canonical();
    init_publication();
    init_chain_readiness();
    init_base_mode();
    LocalMetadataReader = class {
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
          const unavailable = metadataError(error);
          return {
            release,
            ownership,
            metadata: null,
            status: unavailable.status,
            reason: unavailable.reason
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
          const result2 = await this.token(
            live[0].collection,
            live[0].token_id,
            variant
          );
          if (!result2?.metadata)
            throw new MetadataUnavailable(
              result2?.reason ?? "binding_unavailable",
              "reconciliation_required"
            );
          return {
            document: result2.document,
            contentHash: contentHash(result2.document),
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
      async owned(address, chains2, limit = 1e3) {
        await this.release();
        if (!this.options.candidate) await assertChainReady(this.pool, chains2);
        const tokens = (await this.pool.query(
          `SELECT collection,token_id FROM ${this.schema}.token
      WHERE lower(owner)=lower($1) AND NOT burned AND collection=ANY($2::text[])
      ORDER BY collection,token_id LIMIT $3`,
          [address, chains2, limit + 1]
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
          for (const result2 of batch) {
            if (!result2?.metadata)
              throw new MetadataUnavailable(
                result2?.reason ?? "binding_unavailable",
                "reconciliation_required"
              );
            items.push(result2.document);
          }
        }
        return items;
      }
    };
  }
});

// lib/metadata/publication-request.ts
function publicationRequestKey(input, includeInclusionHash = false) {
  const fields = [
    rendererVersion,
    input.asset_key ?? null,
    input.input_hash ?? null,
    input.event_transaction ?? null,
    input.event_log ?? null
  ];
  if (includeInclusionHash) fields.push(input.event_block_hash ?? null);
  return contentHash(fields);
}
var init_publication_request = __esm({
  "lib/metadata/publication-request.ts"() {
    "use strict";
    init_snapshot();
    init_canonical();
  }
});

// lib/metadata/publish.ts
import { randomUUID } from "node:crypto";
async function enqueuePublicationRows(client, release, collection, rows) {
  const unique = /* @__PURE__ */ new Set();
  const jobs = rows.flatMap((row) => {
    if (!row.transaction_hash) return [];
    if (unique.has(row.token_id)) throw new Error("ambiguous_mint_anchor");
    unique.add(row.token_id);
    return [
      {
        tokenId: row.token_id,
        lifecycle: row.lifecycle,
        mintTransactionHash: row.transaction_hash,
        mintLogIndex: row.log_index,
        requestKey: publicationRequestKey(
          row,
          collection === "base" && nativeBaseMetadataReads()
        )
      }
    ];
  });
  const inserted = await client.query(
    `INSERT INTO metadata.publication_job(release_id,collection,token_id,lifecycle,mint_transaction_hash,mint_log_index,request_key)
        SELECT $1,$2,"tokenId"::numeric,lifecycle,"mintTransactionHash","mintLogIndex","requestKey"
        FROM jsonb_to_recordset($3::jsonb) AS x("tokenId" text,lifecycle integer,"mintTransactionHash" text,"mintLogIndex" integer,"requestKey" text)
        ON CONFLICT(release_id,collection,token_id,mint_transaction_hash,mint_log_index) DO UPDATE SET
          request_key=EXCLUDED.request_key,lifecycle=EXCLUDED.lifecycle,status='pending',lease_token=NULL,lease_until=NULL,next_attempt_at=now(),updated_at=now()
        WHERE metadata.publication_job.reason IS DISTINCT FROM 'token_uri_changed'
          AND (metadata.publication_job.request_key<>EXCLUDED.request_key OR metadata.publication_job.lifecycle<>EXCLUDED.lifecycle)`,
    [release, collection, JSON.stringify(jobs)]
  );
  return inserted.rowCount ?? 0;
}
async function enqueuePublications(pool2, readSchema, batchSize = 500) {
  const schema = sqlIdentifier(readSchema), release = await selectedRelease(pool2);
  let enqueued = 0;
  for (const collection of collectionSlugs) {
    if (!(await chainReadiness(pool2, [collection])).ready) continue;
    const client = await pool2.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO metadata.publication_cursor(release_id,collection) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [release, collection]
      );
      const cursor = (await client.query(
        "SELECT token_id FROM metadata.publication_cursor WHERE release_id=$1 AND collection=$2 AND next_scan_at<=now() FOR UPDATE SKIP LOCKED",
        [release, collection]
      )).rows[0];
      if (!cursor) {
        await client.query("COMMIT");
        continue;
      }
      const rows = (await client.query(
        `WITH batch AS MATERIALIZED(SELECT token_id,lifecycle FROM ${schema}.token
        WHERE collection=$2 AND token_id>$3 ORDER BY token_id LIMIT $4)
        SELECT t.token_id,t.lifecycle,mint.transaction_hash,mint.log_index,b.asset_key,b.input_hash,
          event.transaction_hash AS event_transaction,event.log_index AS event_log,event.block_hash AS event_block_hash
        FROM batch t LEFT JOIN LATERAL(SELECT mint_transaction_hash,mint_block FROM ${schema}.token_lifecycle
          WHERE collection=$2 AND token_id=t.token_id AND lifecycle=t.lifecycle OFFSET 0) l ON true
        LEFT JOIN LATERAL(SELECT transaction_hash,log_index FROM ${schema}.transfer_event
          WHERE collection=$2 AND token_id=t.token_id AND lifecycle=t.lifecycle AND transaction_hash=l.mint_transaction_hash
          AND block_number=l.mint_block AND "from"=$5 ORDER BY log_index LIMIT 2) mint ON true
        LEFT JOIN metadata_source.lifecycle_binding b ON b.release_id=$1 AND b.chain_id=$6
          AND b.contract_address=$7 AND b.token_id=t.token_id AND b.mint_transaction_hash=mint.transaction_hash AND b.mint_log_index=mint.log_index
        LEFT JOIN LATERAL(${collection === "base" ? `SELECT transaction_hash,log_index,block_hash FROM ${baseMetadataEventsRelation()}
          WHERE chain_id=8453 AND contract_address=$7 AND token_id=t.token_id
          ORDER BY block_number DESC,transaction_index DESC,log_index DESC LIMIT 1` : "SELECT NULL::text AS transaction_hash,NULL::integer AS log_index,NULL::text AS block_hash WHERE false"}) event ON true
        ORDER BY t.token_id`,
        [
          release,
          collection,
          cursor.token_id,
          batchSize,
          ZERO_ADDRESS,
          String(collections[collection].chainId),
          collections[collection].address
        ]
      )).rows;
      enqueued += await enqueuePublicationRows(
        client,
        release,
        collection,
        rows
      );
      await client.query(
        `UPDATE metadata.publication_cursor SET token_id=$3,next_scan_at=CASE WHEN $3='' THEN now()+interval '60 seconds' ELSE now() END,updated_at=now()
        WHERE release_id=$1 AND collection=$2`,
        [release, collection, rows.at(-1)?.token_id ?? ""]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return enqueued;
}
async function enqueueNativeBasePublications(pool2, readSchema, batchSize = 5e3) {
  if (!nativeBaseMetadataReads()) return 0;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1e4)
    throw new Error("Invalid native publication batch size.");
  const schema = sqlIdentifier(readSchema);
  if (schema !== ponderSchema)
    throw new Error(
      "Native publication queue requires the registered read schema."
    );
  const release = await selectedRelease(pool2), client = await pool2.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    if (!(await chainReadiness(client, ["base"])).ready) {
      await client.query("COMMIT");
      return 0;
    }
    const rows = (await client.query(
      `WITH frame AS MATERIALIZED(
        SELECT block_number FROM ${ponderSchema}.base_metadata_frame(true)),recent AS MATERIALIZED(
        SELECT event.token_id,max(event.block_number) AS newest FROM ${baseMetadataEventsRelation()} event,frame
        WHERE event.block_number>=GREATEST(0,frame.block_number-4096)
        GROUP BY event.token_id ORDER BY newest DESC,event.token_id LIMIT $2)
      SELECT t.token_id,t.lifecycle,mint.transaction_hash,mint.log_index,b.asset_key,b.input_hash,
        event.transaction_hash AS event_transaction,event.log_index AS event_log,event.block_hash AS event_block_hash
      FROM recent JOIN ${schema}.token t ON t.collection='base' AND t.token_id=recent.token_id
      LEFT JOIN LATERAL(SELECT mint_transaction_hash,mint_block FROM ${schema}.token_lifecycle
        WHERE collection='base' AND token_id=t.token_id AND lifecycle=t.lifecycle OFFSET 0) l ON true
      LEFT JOIN LATERAL(SELECT transaction_hash,log_index FROM ${schema}.transfer_event
        WHERE collection='base' AND token_id=t.token_id AND lifecycle=t.lifecycle AND transaction_hash=l.mint_transaction_hash
        AND block_number=l.mint_block AND "from"=$3 ORDER BY log_index LIMIT 2) mint ON true
      LEFT JOIN metadata_source.lifecycle_binding b ON b.release_id=$1 AND b.chain_id='8453'
        AND b.contract_address=$4 AND b.token_id=t.token_id AND b.mint_transaction_hash=mint.transaction_hash AND b.mint_log_index=mint.log_index
      LEFT JOIN LATERAL(SELECT transaction_hash,log_index,block_hash FROM ${baseMetadataEventsRelation()}
        WHERE token_id=t.token_id ORDER BY block_number DESC,transaction_index DESC,log_index DESC LIMIT 1) event ON true
      ORDER BY recent.newest DESC,t.token_id`,
      [release, batchSize, ZERO_ADDRESS, collections.base.address]
    )).rows;
    const enqueued = await enqueuePublicationRows(
      client,
      release,
      "base",
      rows
    );
    await client.query("COMMIT");
    return enqueued;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
async function claimPublications(pool2, limit = 8, leaseSeconds = 120) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1)
    throw new Error("Invalid publication claim limits");
  const active = (await pool2.query(
    "SELECT release_id FROM metadata_source.archive_release WHERE state='active'"
  )).rows[0]?.release_id;
  if (!active) return [];
  const lease = randomUUID();
  const claim = async (take, expired) => (await pool2.query(
    `WITH claimed AS(SELECT j.id FROM metadata.publication_job j
    WHERE j.release_id=$4 AND ${expired ? "j.status='publishing' AND j.lease_until<now()" : "j.status IN ('pending','retry') AND j.next_attempt_at<=now()"}
      AND EXISTS(SELECT 1 FROM metadata_source.archive_release r WHERE r.release_id=$4 AND r.state='active')
    ORDER BY ${expired ? "j.lease_until" : "j.next_attempt_at"},j.id LIMIT $1 FOR UPDATE OF j SKIP LOCKED)
    UPDATE metadata.publication_job j SET status='publishing',attempts=attempts+1,lease_token=$2,lease_until=now()+$3*interval '1 second',updated_at=now()
    FROM claimed c WHERE j.id=c.id RETURNING j.id::text,j.release_id AS "releaseId",j.collection,j.token_id::text AS "tokenId",j.lifecycle,
      j.mint_transaction_hash AS "mintTransactionHash",j.mint_log_index AS "mintLogIndex",j.request_key AS "requestKey",j.lease_token AS "leaseToken",j.attempts`,
    [take, lease, leaseSeconds, active]
  )).rows;
  const pending = await claim(limit, false);
  return pending.length === limit ? pending : [...pending, ...await claim(limit - pending.length, true)];
}
async function bindRuntimeToken(pool2, schema, job, uriResolver) {
  const owner = await new ArchiveOwnershipReader(
    pool2,
    job.releaseId,
    schema
  ).token(job.collection, job.tokenId);
  if (!owner || owner.mintTransactionHash !== job.mintTransactionHash || owner.mintLogIndex !== job.mintLogIndex)
    throw new MetadataUnavailable("obsolete_lifecycle");
  if (owner.assetKey) return;
  let uri, provenance = "current_token_uri_call";
  try {
    uri = await uriResolver(job.collection, job.tokenId);
  } catch {
    if (!owner.burned)
      throw new MetadataUnavailable("token_uri_pending", "retry");
    uri = `https://meta.polkamon.com/meta?id=${job.tokenId}`;
    provenance = "historical_formula_fallback";
  }
  let id;
  try {
    id = metadataLookupId(uri);
  } catch {
    throw new MetadataUnavailable(
      "unsupported_token_uri",
      "reconciliation_required"
    );
  }
  const source = await new ArchiveReader(pool2, job.releaseId).lookup(id);
  const fields = (await pool2.query(
    `SELECT legacy_id,family FROM metadata_source.source_record
    WHERE release_id=$1 AND asset_key=$2 AND content_hash=$3 LIMIT 1`,
    [job.releaseId, source.assetKey, source.hash]
  )).rows[0];
  await storeRuntimeBindings(pool2, job.releaseId, [
    {
      collection: job.collection,
      chainId: collections[job.collection].chainId,
      contractAddress: collections[job.collection].address,
      tokenId: job.tokenId,
      lifecycle: owner.lifecycle,
      burned: owner.burned,
      tokenUri: uri,
      uriProvenance: provenance,
      documentId: null,
      documentName: null,
      mintTransactionHash: job.mintTransactionHash,
      mintLogIndex: job.mintLogIndex,
      assetKey: source.assetKey,
      sourceHash: source.hash,
      sourceLegacyId: fields.legacy_id,
      family: fields.family
    }
  ]);
}
async function publishJob(pool2, readSchema, job, uriResolver) {
  const reader = new LocalMetadataReader(pool2, readSchema, {
    releaseId: job.releaseId
  });
  let result2 = null;
  let failure;
  try {
    if (uriResolver) await bindRuntimeToken(pool2, readSchema, job, uriResolver);
    result2 = await reader.token(job.collection, job.tokenId);
    if (!result2?.metadata)
      failure = new MetadataUnavailable(
        result2?.reason ?? "token_missing",
        result2?.status === "retry" ? "retry" : result2?.status === "reconciliation_required" ? "reconciliation_required" : "unavailable"
      );
  } catch (error) {
    failure = metadataError(error);
  }
  const client = await pool2.connect(), schema = sqlIdentifier(readSchema);
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock_shared(hashtext('metadata:chain-recovery'))"
    );
    await assertChainReady(client, [job.collection]);
    const active = await client.query(
      "SELECT 1 FROM metadata_source.archive_release WHERE release_id=$1 AND state='active' FOR SHARE",
      [job.releaseId]
    );
    const claim = await client.query(
      `SELECT 1 FROM metadata.publication_job WHERE id=$1 AND lease_token=$2 AND request_key=$3
      AND status='publishing' AND lease_until>now() FOR UPDATE`,
      [job.id, job.leaseToken, job.requestKey]
    );
    if (!claim.rowCount) {
      await client.query("ROLLBACK");
      return "claim_lost";
    }
    const canonical = await client.query(
      `SELECT t.lifecycle FROM ${schema}.token t JOIN ${schema}.token_lifecycle l
      ON l.collection=t.collection AND l.token_id=t.token_id AND l.lifecycle=t.lifecycle
      JOIN ${schema}.transfer_event e ON e.collection=l.collection AND e.token_id=l.token_id AND e.lifecycle=l.lifecycle
        AND e.transaction_hash=l.mint_transaction_hash AND e.block_number=l.mint_block
      WHERE t.collection=$1 AND t.token_id=$2 AND e.transaction_hash=$3 AND e.log_index=$4 AND e."from"=$5 AND t.lifecycle=$6`,
      [
        job.collection,
        job.tokenId,
        job.mintTransactionHash,
        job.mintLogIndex,
        ZERO_ADDRESS,
        job.lifecycle
      ]
    );
    if (!active.rowCount || canonical.rowCount !== 1) {
      await client.query(
        "UPDATE metadata.publication_job SET status='obsolete',reason='release_or_lifecycle_changed',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",
        [job.id]
      );
      await client.query("COMMIT");
      return "obsolete";
    }
    if (failure?.status === "retry") {
      await client.query(
        `UPDATE metadata.publication_job SET status='retry',reason=$2,lease_token=NULL,lease_until=NULL,
        next_attempt_at=now()+$3*interval '1 second',updated_at=now() WHERE id=$1`,
        [
          job.id,
          failure.reason,
          Math.min(3600, 5 * 2 ** Math.min(job.attempts, 10))
        ]
      );
      await client.query("COMMIT");
      return "retry";
    }
    const snapshot = result2?.metadata, document = failure ? null : snapshot.document;
    const observedUri = (await client.query(
      `SELECT evidence->>'uri' AS uri FROM metadata_source.asset_binding WHERE release_id=$1 AND network='eip155'
      AND chain_id=$2 AND contract_address=$3 AND token_id=$4`,
      [
        job.releaseId,
        String(collections[job.collection].chainId),
        collections[job.collection].address,
        job.tokenId
      ]
    )).rows[0]?.uri;
    await storePublicationValues(client, [
      {
        release: job.releaseId,
        collection: job.collection,
        tokenId: job.tokenId,
        lifecycle: job.lifecycle,
        assetKey: result2?.ownership.assetKey ?? null,
        rendererVersion: snapshot?.rendererVersion ?? rendererVersion,
        inputHash: snapshot?.inputHash ?? null,
        contentHash: document ? snapshot.contentHash : null,
        variant: snapshot?.variant ?? "public",
        document: document ?? null,
        status: failure?.status ?? "published",
        reason: failure?.reason ?? null,
        uri: observedUri ?? null,
        mintTransactionHash: job.mintTransactionHash,
        mintLogIndex: job.mintLogIndex,
        chainEventKey: result2?.chain?.eventKey ?? null,
        chainEventBlockHash: result2?.chain?.blockHash ?? null
      }
    ]);
    await client.query(
      `UPDATE metadata.publication_job SET status=$2,reason=$3,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1`,
      [job.id, failure?.status ?? "published", failure?.reason ?? null]
    );
    await client.query("COMMIT");
    return failure?.status ?? "published";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
var init_publish = __esm({
  "lib/metadata/publish.ts"() {
    "use strict";
    init_publication_store();
    init_constants();
    init_sql();
    init_snapshot();
    init_read();
    init_bindings();
    init_publication();
    init_resolve();
    init_chain_readiness();
    init_base_mode();
    init_publication_request();
  }
});

// lib/metadata/base-replay.ts
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
async function retry(operation, attempts = 3) {
  for (let attempt = 0; ; attempt++)
    try {
      return await operation();
    } catch (error) {
      const causes = [];
      for (let e = error; e; e = e.cause)
        causes.push(e);
      if (attempt >= attempts || causes.some((e) => e.name === "ResponseBodyTooLargeError" || e.code === -32005 || [400, 413].includes(e.status) || /response body too large|too many results|block range|limit the query/i.test(e.details ?? "")))
        throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(15e3, 1e3 * 2 ** attempt)));
    }
}
async function replayBaseMetadata(pool2, env, options = {}) {
  const name2 = "base_metadata_v1", stopping3 = options.stopping ?? (() => false);
  let range = options.range ?? 1e4;
  if (!Number.isSafeInteger(range) || range < 1 || range > 1e5) throw new Error("Invalid block range");
  const client = createPublicClient({ chain: base, transport: http(baseRpcUrlOf(env), { retryCount: 0, timeout: 3e4 }) });
  const lock = await pool2.connect();
  const acquired = (await lock.query("SELECT pg_try_advisory_lock(hashtext('metadata:base-replay')) AS acquired")).rows[0].acquired;
  if (!acquired) {
    lock.release();
    return { busy: true };
  }
  const maximumRange = range;
  try {
    const final = await retry(() => client.getBlock({ blockTag: "finalized" }));
    if (!final.number || !final.hash)
      throw new Error("Finalized Base block unavailable");
    await pool2.query(`INSERT INTO metadata_source.chain_metadata_scan(name,chain_id,contract_address,deployment_block,next_block,target_block,target_hash)
   VALUES($1,8453,$2,$3,$3,$4,$5) ON CONFLICT DO NOTHING`, [name2, collections.base.address, collections.base.deploymentBlock, final.number.toString(), final.hash]);
    let scan = (await pool2.query("SELECT * FROM metadata_source.chain_metadata_scan WHERE name=$1", [name2])).rows[0];
    if (scan.ingestion_mode !== "rpc") throw new Error("Base metadata is assigned to the unified consumer");
    if (options.advance && BigInt(scan.next_block) > BigInt(scan.target_block)) {
      if (final.number >= BigInt(scan.target_block)) {
        if ((await client.getBlock({ blockNumber: BigInt(scan.target_block) })).hash !== scan.target_hash)
          throw new Error("Previously finalized Base checkpoint changed");
        await pool2.query("UPDATE metadata_source.chain_metadata_scan SET target_block=$2,target_hash=$3 WHERE name=$1", [name2, final.number.toString(), final.hash]);
        scan = (await pool2.query("SELECT * FROM metadata_source.chain_metadata_scan WHERE name=$1", [name2])).rows[0];
      }
    }
    if ((await client.getBlock({ blockNumber: BigInt(scan.target_block) })).hash !== scan.target_hash)
      throw new Error("Base scan target hash changed");
    const implementation = await retry(() => client.getStorageAt({
      address: collections.base.address,
      slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
      blockNumber: BigInt(scan.target_block)
    }));
    if (implementation?.slice(-40).toLowerCase() !== "4ad380760abb9fad95cd48ef2d7c46ed5a072fca")
      throw new Error("Base implementation needs ABI review");
    if (scan.last_scanned_hash && (await client.getBlock({ blockNumber: BigInt(scan.next_block) - 1n })).hash !== scan.last_scanned_hash)
      throw new Error("Base scan checkpoint hash changed");
    let from = BigInt(scan.next_block), requests = 0, observed = 0;
    while (!stopping3() && from <= BigInt(scan.target_block) && requests < (options.maxRanges ?? Infinity)) {
      const to = from + BigInt(range) - 1n < BigInt(scan.target_block) ? from + BigInt(range) - 1n : BigInt(scan.target_block);
      let logs;
      try {
        logs = await retry(() => client.getLogs({ address: collections.base.address, events: baseMetadataAbi.filter((a) => a.type === "event"), fromBlock: from, toBlock: to, strict: false }), range === 1 ? 3 : 0);
      } catch (error) {
        if (stopping3() || range <= 1)
          throw error;
        console.log(JSON.stringify({ retryFrom: from.toString(), reducedRange: Math.max(1, Math.floor(range / 2)), error: "rpc_range_failed" }));
        range = Math.max(1, Math.floor(range / 2));
        continue;
      }
      const block = await retry(() => client.getBlock({ blockNumber: to }));
      if (!block.hash)
        throw new Error("Base range endpoint unavailable");
      const events = logs.map((log) => {
        if (log.removed || !log.transactionHash || log.logIndex === null || log.transactionIndex === null || log.blockNumber === null || !log.blockHash || !log.args.yunipal || log.args.tokenId === void 0 || !log.args.to)
          throw new Error("Incomplete Base metadata log");
        const value = log.args.yunipal;
        return {
          transactionHash: log.transactionHash,
          logIndex: log.logIndex,
          transactionIndex: log.transactionIndex,
          blockNumber: log.blockNumber.toString(),
          blockHash: log.blockHash,
          eventName: log.eventName,
          tokenId: log.args.tokenId.toString(),
          recipient: log.args.to.toLowerCase(),
          traits: { ...value, rarityScore: value.rarityScore.toString() }
        };
      });
      await commitBaseMetadataRange(pool2, name2, from, to, block.hash, events);
      observed += events.length;
      from = to + 1n;
      requests++;
      if (events.length < 100 && range < maximumRange)
        range = Math.min(maximumRange, range * 2);
      if (requests % 25 === 0 || from > BigInt(scan.target_block))
        console.log(JSON.stringify({ from: from.toString(), target: scan.target_block, range, observedThisInvocation: observed }));
    }
    if (from > BigInt(scan.target_block) && (await client.getBlock({ blockNumber: BigInt(scan.target_block) })).hash !== scan.target_hash)
      throw new Error("Finalized Base target changed during scan");
    const report = {
      observedAt: (/* @__PURE__ */ new Date()).toISOString(),
      complete: from > BigInt(scan.target_block),
      checkpoint: (await pool2.query("SELECT * FROM metadata_source.chain_metadata_scan WHERE name=$1", [name2])).rows[0],
      counts: options.includeCounts ? (await pool2.query("SELECT event_name,count(*)::text FROM metadata_source.chain_metadata_event WHERE chain_id=8453 AND contract_address=$1 GROUP BY event_name", [collections.base.address])).rows : void 0
    };
    return report;
  } finally {
    await lock.query("SELECT pg_advisory_unlock(hashtext('metadata:base-replay'))").finally(() => lock.release());
  }
}
var init_base_replay = __esm({
  "lib/metadata/base-replay.ts"() {
    "use strict";
    init_constants();
    init_rpc();
    init_base_events();
  }
});

// lib/metadata/uri-audit.ts
async function auditArchiveUris(pool2, readSchema, resolveUri2, limit = 128) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 512) throw new Error("Invalid URI audit limit");
  const release = await selectedRelease(pool2), schema = sqlIdentifier(readSchema);
  const rows = (await pool2.query(`SELECT m.collection,m.token_id::text,m.lifecycle,p.asset_key,m.token_uri
    FROM metadata.token_metadata m JOIN metadata.token_publication p USING(collection,token_id,lifecycle)
    JOIN ${schema}.token t ON t.collection=m.collection AND t.token_id=m.token_id::text AND t.lifecycle=m.lifecycle
    WHERE p.release_id=$1 AND p.asset_key IS NOT NULL AND NOT t.burned
      AND NOT EXISTS(SELECT 1 FROM metadata.chain_readiness recovery WHERE recovery.collection=m.collection AND recovery.state<>'ready')
      AND (m.uri_checked_at IS NULL OR m.uri_checked_at<now()-interval '7 days')
    ORDER BY m.uri_checked_at NULLS FIRST,m.collection,m.token_id LIMIT $2`, [release, limit])).rows;
  async function audit(row) {
    let uri;
    try {
      uri = await resolveUri2(row.collection, row.token_id);
    } catch {
      return;
    }
    let verified = false;
    let lookupId;
    try {
      lookupId = metadataLookupId(uri);
    } catch {
    }
    if (lookupId) try {
      verified = (await new ArchiveReader(pool2, release).lookup(lookupId)).assetKey === row.asset_key;
    } catch (error) {
      if (metadataError(error).status === "retry") throw error;
    }
    const client = await pool2.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock_shared(hashtext('metadata:chain-recovery'))");
      if (!(await chainReadiness(client, [row.collection])).ready) {
        await client.query("ROLLBACK");
        return;
      }
      if (!(await client.query("SELECT 1 FROM metadata_source.archive_release WHERE release_id=$1 AND state='active' FOR SHARE", [release])).rowCount) {
        await client.query("ROLLBACK");
        return;
      }
      if (verified) {
        await client.query(`UPDATE metadata.publication_job SET status='pending',reason=NULL,next_attempt_at=now(),updated_at=now()
          WHERE collection=$1 AND token_id=$2 AND lifecycle=$3 AND release_id=$4 AND reason='token_uri_changed'`, [row.collection, row.token_id, row.lifecycle, release]);
        await client.query(`UPDATE metadata.token_metadata SET token_uri=$4,uri_provenance='current_token_uri_call',uri_checked_at=now(),audit_status='onchain_resolved'
          WHERE collection=$1 AND token_id=$2 AND lifecycle=$3`, [row.collection, row.token_id, row.lifecycle, uri]);
      } else {
        await client.query(`UPDATE metadata.publication_job SET status='reconciliation_required',reason='token_uri_changed',lease_token=NULL,lease_until=NULL,updated_at=now()
          WHERE collection=$1 AND token_id=$2 AND lifecycle=$3 AND release_id=$4`, [row.collection, row.token_id, row.lifecycle, release]);
        await client.query(`UPDATE metadata.token_publication SET publication_status='reconciliation_required',publication_error='token_uri_changed'
          WHERE collection=$1 AND token_id=$2 AND lifecycle=$3 AND release_id=$4`, [row.collection, row.token_id, row.lifecycle, release]);
        await client.query(`UPDATE metadata.token_metadata SET attributes='[]',document=NULL,name=NULL,description=NULL,image=NULL,animation_url=NULL,
          content_hash=NULL,uri_checked_at=now(),audit_status='uri_reconciliation_required' WHERE collection=$1 AND token_id=$2 AND lifecycle=$3`, [row.collection, row.token_id, row.lifecycle]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  for (let offset = 0; offset < rows.length; offset += 8) {
    const results = await Promise.allSettled(rows.slice(offset, offset + 8).map(audit));
    const failed = results.find((result2) => result2.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }
  return rows.length;
}
var init_uri_audit = __esm({
  "lib/metadata/uri-audit.ts"() {
    "use strict";
    init_sql();
    init_read();
    init_bindings();
    init_resolve();
    init_publication();
    init_chain_readiness();
  }
});

// ../../packages/yunipals-indexer-client/src/sources.ts
function confirmationPolicyKey(policy2) {
  switch (policy2.kind) {
    case "latest":
    case "finalized":
      return policy2.kind;
    case "depth":
      if (!Number.isSafeInteger(policy2.subsequentBlocks) || policy2.subsequentBlocks < 1) {
        throw new Error("Confirmation depth must be a positive safe integer.");
      }
      return `depth:${policy2.subsequentBlocks}`;
    default:
      throw new Error("Unsupported confirmation policy.");
  }
}
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
var features, chains, decimal;
var init_sources = __esm({
  "../../packages/yunipals-indexer-client/src/sources.ts"() {
    features = [
      "ownership",
      "islands",
      "boosters",
      "base-metadata",
      "marketplace",
      "arena"
    ];
    chains = /* @__PURE__ */ new Set([1, 56, 137, 8453]);
    decimal = /^(0|[1-9][0-9]*)$/;
  }
});

// ../../packages/yunipals-indexer-server/src/identity.ts
import { createHash as createHash4 } from "node:crypto";
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
  return `0x${createHash4("sha256").update(stableJson(value)).digest("hex")}`;
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
var init_identity = __esm({
  "../../packages/yunipals-indexer-server/src/identity.ts"() {
    init_sources();
  }
});

// lib/metadata/base-implementation.ts
var approvedBaseMetadataImplementation;
var init_base_implementation = __esm({
  "lib/metadata/base-implementation.ts"() {
    "use strict";
    approvedBaseMetadataImplementation = "0x4ad380760abb9fad95cd48ef2d7c46ed5a072fca";
  }
});

// lib/metadata/unified-base.ts
import { decodeEventLog } from "viem";
async function state(db, lock = false) {
  return (await db.query(
    `SELECT s.chain_id,s.contract_address,s.deployment_block::text,s.next_block::text,
      s.target_block::text,s.target_hash,s.last_scanned_hash,s.ingestion_mode,
      c.release_id,c.manifest_hash,c.cursor
      FROM metadata_source.chain_metadata_scan s
      LEFT JOIN metadata_source.chain_metadata_consumer c USING(name)
      WHERE s.name=$1 ${lock ? "FOR UPDATE OF s" : ""}`,
    [name]
  )).rows[0] ?? null;
}
async function withWriter(pool2, task) {
  const db = await pool2.connect();
  let acquired = false;
  try {
    acquired = (await db.query(
      "SELECT pg_try_advisory_lock(hashtext('metadata:base-replay')) AS acquired"
    )).rows[0].acquired;
    if (!acquired) return { busy: true };
    return await task(db);
  } finally {
    if (acquired)
      await db.query("SELECT pg_advisory_unlock(hashtext('metadata:base-replay'))").finally(() => db.release());
    else db.release();
  }
}
function assertSource(reader) {
  const source = reader.release.manifest.sources.find(
    (source2) => source2.id === sourceId
  );
  if (!source?.enabled || source.chainId !== 8453 || source.feature !== "base-metadata" || source.address !== collections.base.address || source.startBlock !== String(collections.base.deploymentBlock) || source.endBlock !== null || source.abiHash !== manifestDigest(baseMetadataAbi))
    throw new Error("Base metadata source requires configuration/ABI review.");
}
async function checkBoundary(rpc, boundary) {
  if (await rpc.chainId() !== 8453)
    throw new Error("Base metadata RPC chain mismatch.");
  if (await rpc.blockHash(BigInt(boundary.number)) !== boundary.hash)
    throw new Error("Finalized Base metadata boundary changed.");
  if (await rpc.implementation(BigInt(boundary.number)) !== approvedBaseMetadataImplementation)
    throw new Error("Base implementation needs ABI review.");
}
async function checkStoredScan(scan, rpc) {
  const deployment = BigInt(collections.base.deploymentBlock);
  if (scan.chain_id !== 8453 || scan.contract_address !== collections.base.address || BigInt(scan.deployment_block) !== deployment || BigInt(scan.next_block) < deployment || BigInt(scan.target_block) < deployment || BigInt(scan.next_block) > BigInt(scan.target_block) + 1n)
    throw new Error("Base metadata scan configuration changed.");
  if (BigInt(scan.next_block) > deployment && (!scan.last_scanned_hash || await rpc.blockHash(BigInt(scan.next_block) - 1n) !== scan.last_scanned_hash))
    throw new Error("Previously finalized Base checkpoint changed.");
  if (await rpc.blockHash(BigInt(scan.target_block)) !== scan.target_hash)
    throw new Error("Previously finalized Base target changed.");
}
function assertBound(scan, reader) {
  if (scan.ingestion_mode !== "unified" || scan.release_id !== reader.release.id || scan.manifest_hash !== reader.release.manifestHash || !scan.cursor)
    throw new Error("Base metadata consumer needs explicit release adoption.");
  if (scan.cursor.releaseId !== scan.release_id || scan.cursor.sourceId !== sourceId || scan.cursor.policy !== "finalized" || (scan.cursor.completed ? BigInt(scan.cursor.completed.number) + 1n : BigInt(collections.base.deploymentBlock)) !== BigInt(scan.next_block) || scan.cursor.completed && scan.cursor.completed.hash !== scan.last_scanned_hash)
    throw new Error("Base metadata cursor and published coverage disagree.");
}
function decodeBaseMetadataEvent(event) {
  if (event.sourceId !== sourceId || event.chainId !== 8453 || event.address !== collections.base.address || event.abiHash !== manifestDigest(baseMetadataAbi))
    throw new Error("Unexpected Base metadata event source.");
  const decoded = decodeEventLog({
    abi: baseMetadataAbi,
    topics: event.topics,
    data: event.data,
    strict: true
  });
  if (decoded.eventName !== event.name || canonicalJson(
    JSON.parse(
      JSON.stringify(
        decoded.args,
        (_, value) => typeof value === "bigint" ? value.toString() : value
      )
    )
  ) !== canonicalJson(event.args))
    throw new Error("Base metadata decoded payload differs from raw evidence.");
  const args = decoded.args;
  return {
    transactionHash: event.transactionHash,
    transactionIndex: event.transactionIndex,
    logIndex: event.logIndex,
    blockNumber: event.blockNumber,
    blockHash: event.blockHash,
    eventName: decoded.eventName,
    tokenId: String(args.tokenId),
    recipient: args.to.toLowerCase(),
    traits: { ...args.yunipal, rarityScore: String(args.yunipal.rarityScore) }
  };
}
async function consumeBaseMetadataPage(pool2, reader, rpc, options = {}) {
  assertSource(reader);
  return withWriter(pool2, async (db) => {
    const before = await state(db);
    if (!before)
      throw new Error("Base metadata consumer has not been adopted.");
    assertBound(before, reader);
    await checkStoredScan(before, rpc);
    const page = await reader.page(sourceId, policy, {
      cursor: before.cursor,
      limit: options.limit,
      verifyOldAnchor: async (anchor, chainId) => chainId === 8453 && await rpc.blockHash(BigInt(anchor.number)) === anchor.hash
    });
    const target = page.cursor.target ?? page.cursor.completed;
    if (!target) throw new Error("Base metadata page has no coverage target.");
    await checkBoundary(rpc, target);
    const events = page.events.map(decodeBaseMetadataEvent);
    if (page.complete && !events.length && BigInt(target.number) < BigInt(before.next_block))
      return { applied: 0, complete: true, cursor: page.cursor };
    validateBaseMetadataEvents(
      BigInt(before.next_block),
      BigInt(target.number),
      target.hash,
      events
    );
    const current = await reader.status(sourceId, policy);
    if (!["ready", "catching_up"].includes(current.readiness.reason) || current.readiness.availableThroughBlock === null || current.readiness.availableThroughBlock < BigInt(target.number))
      throw new Error("Finalized Base metadata source changed before commit.");
    await db.query("BEGIN");
    try {
      if (canonicalJson(await state(db, true)) !== canonicalJson(before))
        throw new Error(
          "Base metadata writer changed before destination commit."
        );
      await insertBaseMetadataEvents(db, events);
      await db.query(
        `UPDATE metadata_source.chain_metadata_consumer SET cursor=$2,updated_at=now() WHERE name=$1`,
        [name, JSON.stringify(page.cursor)]
      );
      await db.query(
        `UPDATE metadata_source.chain_metadata_scan SET target_block=$2,target_hash=$3,
        next_block=CASE WHEN $4 THEN $2::bigint+1 ELSE next_block END,
        last_scanned_hash=CASE WHEN $4 THEN $3 ELSE last_scanned_hash END,updated_at=now()
        WHERE name=$1`,
        [name, target.number, target.hash, page.complete]
      );
      await db.query("COMMIT");
      return {
        applied: events.length,
        complete: page.complete,
        cursor: page.cursor
      };
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  });
}
var name, sourceId, policy;
var init_unified_base = __esm({
  "lib/metadata/unified-base.ts"() {
    "use strict";
    init_identity();
    init_constants();
    init_base_abi();
    init_base_events();
    init_canonical();
    init_base_implementation();
    init_base_implementation();
    name = "base_metadata_v1";
    sourceId = "metadata:base";
    policy = { kind: "finalized" };
  }
});

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
    const result2 = await task(db);
    await db.query("COMMIT");
    return result2;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
var init_database = __esm({
  "../../packages/yunipals-indexer-server/src/database.ts"() {
  }
});

// ../../packages/yunipals-indexer-client/src/events.ts
function validateCanonicalCursor(cursor) {
  const decimal2 = /^(0|[1-9][0-9]*)$/;
  const hash = /^0x[0-9a-f]{64}$/;
  const block = (value) => decimal2.test(value) && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER);
  if (cursor.version !== 1 || !hash.test(cursor.releaseId) || !cursor.sourceId || !cursor.policy)
    throw new Error("Invalid canonical cursor identity.");
  for (const anchor of [cursor.completed, cursor.target]) {
    if (anchor && (!block(anchor.number) || !hash.test(anchor.hash)))
      throw new Error("Invalid canonical cursor anchor.");
  }
  if (cursor.target && cursor.completed && BigInt(cursor.target.number) <= BigInt(cursor.completed.number))
    throw new Error("Invalid canonical cursor range.");
  if (cursor.after && (!cursor.target || !block(cursor.after.blockNumber) || !hash.test(cursor.after.blockHash) || !cursor.after.id || !Number.isSafeInteger(cursor.after.transactionIndex) || cursor.after.transactionIndex < 0 || !Number.isSafeInteger(cursor.after.logIndex) || cursor.after.logIndex < 0 || BigInt(cursor.after.blockNumber) > BigInt(cursor.target.number) || cursor.completed && BigInt(cursor.after.blockNumber) <= BigInt(cursor.completed.number)))
    throw new Error("Invalid canonical cursor position.");
}
var init_events = __esm({
  "../../packages/yunipals-indexer-client/src/events.ts"() {
  }
});

// ../../packages/yunipals-indexer-client/src/readiness.ts
function evaluateSourceReadiness(source, snapshot, options) {
  if (!Number.isFinite(options.nowMs) || !Number.isFinite(options.maxObservationAgeMs) || options.maxObservationAgeMs <= 0 || options.requiredThroughBlock !== void 0 && options.requiredThroughBlock < 0n) {
    throw new Error("Invalid readiness evaluation options.");
  }
  const result2 = (reason, availableThroughBlock = null, requiredThroughBlock = null) => ({
    ready: reason === "ready",
    reason,
    availableThroughBlock,
    requiredThroughBlock
  });
  if (!source.enabled) return result2("disabled");
  const policyKey = confirmationPolicyKey(options.policy);
  if (!source.policies.some(
    (policy2) => confirmationPolicyKey(policy2) === policyKey
  )) {
    return result2("policy_unsupported");
  }
  if (snapshot.release.schema !== options.expectedRelease.schema || snapshot.release.buildId !== options.expectedRelease.buildId || snapshot.release.manifestHash !== options.expectedRelease.manifestHash)
    return result2("release_mismatch");
  if (source.id !== snapshot.sourceId || source.chainId !== snapshot.chainId) {
    return result2("source_mismatch");
  }
  if (snapshot.halted) return result2("halted");
  if (source.startBlock === null || snapshot.coverageStartBlock > BigInt(source.startBlock))
    return result2("history_missing");
  const fresh = (at) => Number.isFinite(at) && at <= options.nowMs && options.nowMs - at <= options.maxObservationAgeMs;
  const valid = (observation) => observation.chainId === source.chainId && observation.blockNumber >= 0n && /^0x[0-9a-f]{64}$/.test(observation.blockHash);
  if (!fresh(snapshot.indexerObservedAtMs) || !snapshot.head || !fresh(snapshot.head.observedAtMs)) {
    return result2("observation_stale");
  }
  if (!valid(snapshot.head)) return result2("observation_inconsistent");
  let boundary = snapshot.head.blockNumber;
  if (options.policy.kind === "depth") {
    boundary -= BigInt(options.policy.subsequentBlocks);
  } else if (options.policy.kind === "finalized") {
    if (!snapshot.finalized) return result2("finality_unavailable");
    if (!fresh(snapshot.finalized.observedAtMs))
      return result2("observation_stale");
    if (!valid(snapshot.finalized) || snapshot.finalized.blockNumber > snapshot.head.blockNumber || snapshot.finalized.blockNumber === snapshot.head.blockNumber && snapshot.finalized.blockHash !== snapshot.head.blockHash)
      return result2("observation_inconsistent");
    boundary = snapshot.finalized.blockNumber;
  }
  if (source.endBlock !== null && boundary > BigInt(source.endBlock)) {
    boundary = BigInt(source.endBlock);
  }
  const required = options.requiredThroughBlock ?? boundary;
  const indexed = snapshot.completeThroughBlock;
  if (indexed === null || indexed < BigInt(source.startBlock)) {
    return result2("not_indexed", null, required);
  }
  if (indexed > snapshot.head.blockNumber) {
    return result2("observation_inconsistent", null, required);
  }
  const available = indexed < boundary ? indexed : boundary;
  return result2(
    available >= required && required >= BigInt(source.startBlock) ? "ready" : "catching_up",
    available < BigInt(source.startBlock) ? null : available,
    required
  );
}
var init_readiness2 = __esm({
  "../../packages/yunipals-indexer-client/src/readiness.ts"() {
    init_sources();
  }
});

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
var init_chain_status = __esm({
  "../../packages/yunipals-indexer-server/src/chain-status.ts"() {
  }
});

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
var init_ponder = __esm({
  "../../packages/yunipals-indexer-client/src/ponder.ts"() {
  }
});

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
var init_ponder_reader = __esm({
  "../../packages/yunipals-indexer-server/src/ponder-reader.ts"() {
    init_ponder();
    init_database();
  }
});

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
var init_releases = __esm({
  "../../packages/yunipals-indexer-server/src/releases.ts"() {
    init_sources();
    init_database();
    init_ponder_reader();
    init_identity();
  }
});

// ../../packages/yunipals-indexer-server/src/status.ts
async function readIndexerSourceStatus(db, release, sourceId2, policy2, options = {}) {
  const source = release.manifest.sources.find(
    (source2) => source2.id === sourceId2
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
    sourceId: sourceId2,
    chainId: source.chainId,
    release,
    coverageStartBlock: BigInt(source.startBlock ?? "0"),
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
  const readiness = evaluateSourceReadiness(source, snapshot, {
    expectedRelease: release,
    policy: policy2,
    nowMs: options.nowMs ?? Date.now(),
    maxObservationAgeMs: options.maxObservationAgeMs ?? 18e4
  });
  const anchor = readiness.availableThroughBlock === null ? null : status?.anchors[String(readiness.availableThroughBlock)] ?? null;
  return {
    source,
    snapshot,
    readiness,
    anchor,
    observationRevision: status?.revision ?? null,
    errorCode: status?.error_code ?? (!branchMatches ? "indexer_witness_unverified" : null)
  };
}
async function indexerSourceStatus(pool2, release, sourceId2, policy2, options = {}) {
  return indexerTransaction(
    pool2,
    (db) => readIndexerSourceStatus(db, release, sourceId2, policy2, options),
    true
  );
}
var init_status = __esm({
  "../../packages/yunipals-indexer-server/src/status.ts"() {
    init_readiness2();
    init_database();
    init_database();
    init_chain_status();
    init_releases();
  }
});

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
var init_event_topics = __esm({
  "../../packages/yunipals-indexer-server/src/event-topics.ts"() {
  }
});

// ../../packages/yunipals-indexer-server/src/paging.ts
async function retainedAnchor(db, release, chainId, anchor) {
  const direct = await db.query(
    `SELECT block_hash FROM ${sqlIdentifier2(release.schema)}.chain_block
    WHERE chain_id=$1 AND block_number=$2::bigint`,
    [chainId, anchor.number]
  );
  if (direct.rows[0])
    return direct.rows[0].block_hash === anchor.hash ? "valid" : "changed";
  const retained = await db.query(
    `
    SELECT a.block_hash,a.witness_hash,b.block_hash AS canonical_witness
    FROM yunipals_indexer_control.chain_anchor a LEFT JOIN ${sqlIdentifier2(release.schema)}.chain_block b
      ON b.chain_id=a.chain_id AND b.block_number=a.witness_number
    WHERE a.release_id=$1 AND a.chain_id=$2 AND a.block_number=$3::bigint`,
    [release.id, chainId, anchor.number]
  );
  const row = retained.rows[0];
  if (!row || row.canonical_witness !== row.witness_hash) return "expired";
  return row.block_hash === anchor.hash ? "valid" : "changed";
}
async function readCanonicalPage(pool2, release, sourceId2, policy2, options = {}) {
  const pageLimit = options.limit ?? 250;
  if (!Number.isSafeInteger(pageLimit) || pageLimit < 1 || pageLimit > 1e3)
    throw new Error("Invalid canonical page size.");
  const policyKey = confirmationPolicyKey(policy2);
  const source = release.manifest.sources.find(
    (source2) => source2.id === sourceId2
  );
  if (!source?.enabled || source.startBlock === null)
    throw new CanonicalSourceUnavailable("Source is disabled or unknown.");
  const cursor = options.cursor ?? {
    version: 1,
    releaseId: release.id,
    sourceId: sourceId2,
    policy: policyKey,
    completed: null,
    target: null,
    after: null
  };
  validateCanonicalCursor(cursor);
  if (cursor.releaseId !== release.id || cursor.sourceId !== sourceId2 || cursor.policy !== policyKey)
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
      pool2,
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
    pool2,
    async (db) => {
      const status = await readIndexerSourceStatus(
        db,
        release,
        sourceId2,
        policy2,
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
          `SELECT 1 FROM ${sqlIdentifier2(release.schema)}.canonical_event
        WHERE id=$1 AND source_id=$2 AND block_number=$3::bigint AND block_hash=$4 AND transaction_index=$5 AND log_index=$6`,
          [
            cursor.after.id,
            sourceId2,
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
      EXISTS(SELECT 1 FROM ${sqlIdentifier2(release.schema)}.transaction_candidate c
        WHERE c.chain_id=e.chain_id AND c.block_hash=e.block_hash AND c.transaction_hash=e.transaction_hash) AS needs_receipt
      FROM ${sqlIdentifier2(release.schema)}.canonical_event e
      WHERE e.source_id=$1 AND e.block_number>=$2::bigint AND e.block_number<=$3::bigint
      AND ($4::bigint IS NULL OR (e.block_number,e.transaction_index,e.log_index)>($4::bigint,$5::integer,$6::integer))
      ORDER BY e.block_number,e.transaction_index,e.log_index LIMIT $7`,
        [
          sourceId2,
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
      const evidence = requested.length ? (await db.query(
        `SELECT r.* FROM yunipals_indexer_control.transaction_evidence r
      JOIN jsonb_to_recordset($2::jsonb) AS x("blockHash" text,"transactionHash" text)
        ON r.block_hash=x."blockHash" AND r.transaction_hash=x."transactionHash" WHERE r.chain_id=$1`,
        [source.chainId, JSON.stringify(requested)]
      )).rows : [];
      const byReceipt = new Map(
        evidence.map((row) => [
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
var CanonicalCursorInvalidated, CanonicalSourceUnavailable, receiptKey;
var init_paging = __esm({
  "../../packages/yunipals-indexer-server/src/paging.ts"() {
    init_sources();
    init_events();
    init_database();
    init_database();
    init_status();
    init_identity();
    init_event_topics();
    CanonicalCursorInvalidated = class extends Error {
    };
    CanonicalSourceUnavailable = class extends Error {
    };
    receiptKey = (hash, transaction) => `${hash}:${transaction}`;
  }
});

// ../../packages/yunipals-indexer-server/src/readers.ts
async function createIndexerReader(pool2, options = {}) {
  const release = await indexerTransaction(
    pool2,
    async (db) => {
      const selected = await loadIndexerRelease(db, options.releaseId);
      await readBoundRuntime(db, selected);
      return selected;
    },
    true
  );
  return {
    release,
    status(sourceId2, policy2) {
      return indexerSourceStatus(pool2, release, sourceId2, policy2, {
        nowMs: options.now?.()
      });
    },
    page(sourceId2, policy2, pageOptions) {
      return readCanonicalPage(pool2, release, sourceId2, policy2, {
        nowMs: options.now?.(),
        ...pageOptions
      });
    },
    snapshot(sourceId2, policy2, read) {
      return indexerTransaction(
        pool2,
        async (db) => {
          const status = await readIndexerSourceStatus(
            db,
            release,
            sourceId2,
            policy2,
            { nowMs: options.now?.() }
          );
          return read(db, { release, status });
        },
        true
      );
    }
  };
}
var init_readers = __esm({
  "../../packages/yunipals-indexer-server/src/readers.ts"() {
    init_database();
    init_paging();
    init_releases();
    init_status();
    init_paging();
    init_releases();
  }
});

// lib/metadata/unified-runtime.ts
import pg2 from "pg";
import { createPublicClient as createPublicClient2, http as http2 } from "viem";
import { base as base2 } from "viem/chains";
function baseMetadataPointRpc(env = process.env) {
  const client = createPublicClient2({
    chain: base2,
    transport: http2(baseRpcUrlOf(env), { timeout: 15e3, retryCount: 0 })
  });
  return {
    chainId: () => client.getChainId(),
    blockHash: async (blockNumber) => {
      const hash = (await client.getBlock({ blockNumber })).hash;
      if (!hash) throw new Error("Base metadata block unavailable.");
      return hash.toLowerCase();
    },
    implementation: async (blockNumber) => {
      const value = await client.getStorageAt({
        address: collections.base.address,
        blockNumber,
        slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
      });
      if (!value || !/^0x0{24}[0-9a-fA-F]{40}$/.test(value))
        throw new Error("Base metadata implementation unavailable.");
      return `0x${value.slice(-40).toLowerCase()}`;
    }
  };
}
function unifiedBaseRuntime(env = process.env) {
  if (!env.UNIFIED_INDEXER_DATABASE_URL)
    throw new Error("Shared indexer read database is required.");
  const sourcePool = new pg2.Pool({
    connectionString: env.UNIFIED_INDEXER_DATABASE_URL,
    max: 2,
    application_name: "base_metadata_unified_reader",
    connectionTimeoutMillis: 5e3,
    statement_timeout: 15e3,
    idle_in_transaction_session_timeout: 15e3,
    lock_timeout: 2e3
  });
  return {
    reader: () => createIndexerReader(sourcePool, {
      releaseId: env.UNIFIED_INDEXER_RELEASE_ID
    }),
    rpc: baseMetadataPointRpc(env),
    close: () => sourcePool.end()
  };
}
var init_unified_runtime = __esm({
  "lib/metadata/unified-runtime.ts"() {
    "use strict";
    init_readers();
    init_constants();
    init_rpc();
    init_base_mode();
  }
});

// lib/metadata/native-base-traits.ts
var init_native_base_traits = __esm({
  "lib/metadata/native-base-traits.ts"() {
    "use strict";
  }
});

// lib/metadata/native-base.ts
async function frame(db) {
  const row = (await db.query(`SELECT block_number::text,block_hash,frontier
    FROM ${ponderSchema}.base_metadata_frame(false)`)).rows[0];
  if (!row || !/^\d+$/.test(row.block_number) || !/^0x[0-9a-f]{64}$/.test(row.block_hash))
    throw new Error("Native Base metadata frame unavailable.");
  return row;
}
async function pointCheck(rpc, boundary) {
  if (await rpc.chainId() !== 8453)
    throw new Error("Base metadata RPC chain mismatch.");
  if (await rpc.blockHash(BigInt(boundary.block_number)) !== boundary.block_hash)
    throw new Error("Native Base metadata boundary changed.");
  if (await rpc.implementation(BigInt(boundary.block_number)) !== approvedBaseMetadataImplementation)
    throw new Error("Base implementation needs ABI review.");
  if (await rpc.blockHash(BigInt(boundary.block_number)) !== boundary.block_hash)
    throw new Error("Native Base metadata boundary changed during code check.");
}
async function withNativeWriter(pool2, task) {
  if (!nativeBaseMetadataReads())
    throw new Error("Native Base metadata mode is required.");
  const db = await pool2.connect();
  let acquired = false;
  try {
    acquired = (await db.query(
      "SELECT pg_try_advisory_lock(hashtext('metadata:base-replay')) AS acquired"
    )).rows[0]?.acquired === true;
    if (!acquired) return { busy: true };
    return await task(db);
  } finally {
    if (acquired)
      await db.query("SELECT pg_advisory_unlock(hashtext('metadata:base-replay'))").finally(() => db.release());
    else db.release();
  }
}
async function approve(db, identity, boundary) {
  await db.query(
    `INSERT INTO metadata_source.native_base_metadata_state
    (release_id,read_identity,state,frontier,implementation,checked_block,checked_hash,checked_at,error_code)
    VALUES($1,$2,'ready',$3,$4,$5,$6,clock_timestamp(),NULL)
    ON CONFLICT(release_id) DO UPDATE SET read_identity=EXCLUDED.read_identity,state='ready',frontier=EXCLUDED.frontier,
      implementation=EXCLUDED.implementation,checked_block=EXCLUDED.checked_block,checked_hash=EXCLUDED.checked_hash,
      checked_at=EXCLUDED.checked_at,error_code=NULL`,
    [
      identity.release_id,
      identity.identity,
      boundary.frontier,
      approvedBaseMetadataImplementation,
      boundary.block_number,
      boundary.block_hash
    ]
  );
}
async function refreshNativeBaseMetadata(pool2, rpc) {
  return withNativeWriter(pool2, async (db) => {
    const identity = await ownershipReadIdentity(db);
    if (!identity)
      throw new Error("Native Base metadata read identity unavailable.");
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    let transactionOpen = true;
    try {
      const boundary = await frame(db);
      const state2 = (await db.query(
        `SELECT a.*,a.checked_at>statement_timestamp()-interval '60 seconds'
        AND a.checked_at<=statement_timestamp() AND a.checked_block<=$2
        AND EXISTS(SELECT 1 FROM ${physicalPonderSchema}.chain_block b WHERE b.chain_id=8453
          AND b.block_number=a.checked_block AND b.block_hash=a.checked_hash) AS fresh
        FROM metadata_source.native_base_metadata_state a
        JOIN metadata_source.chain_metadata_scan s ON s.name='base_metadata_v1' AND s.ingestion_mode='native'
        WHERE a.release_id=$1`,
        [identity.release_id, boundary.block_number]
      )).rows[0];
      if (!state2 || state2.read_identity !== identity.identity)
        throw new Error("Native Base metadata requires explicit adoption.");
      if (state2.state === "ready" && state2.frontier === boundary.frontier && state2.implementation === approvedBaseMetadataImplementation && state2.fresh) {
        await db.query("COMMIT");
        return {
          checked: false,
          blockNumber: boundary.block_number,
          frontier: boundary.frontier
        };
      }
      await db.query("COMMIT");
      transactionOpen = false;
      await pointCheck(rpc, boundary);
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      transactionOpen = true;
      const current = await frame(db);
      const stillCanonical = (await db.query(
        `SELECT 1 FROM ${physicalPonderSchema}.chain_block
        WHERE chain_id=8453 AND block_number=$1 AND block_hash=$2`,
        [boundary.block_number, boundary.block_hash]
      )).rowCount === 1;
      const stillAdopted = (await db.query(`SELECT 1 FROM metadata_source.chain_metadata_scan
        WHERE name='base_metadata_v1' AND ingestion_mode='native'`)).rowCount === 1;
      if (current.frontier !== boundary.frontier || BigInt(current.block_number) < BigInt(boundary.block_number) || !stillCanonical || !stillAdopted)
        throw new Error("Native Base metadata changed during approval.");
      await approve(db, identity, boundary);
      await db.query("COMMIT");
      return {
        checked: true,
        blockNumber: boundary.block_number,
        frontier: boundary.frontier
      };
    } catch (error) {
      if (transactionOpen) await db.query("ROLLBACK");
      await db.query(
        `UPDATE metadata_source.native_base_metadata_state SET state='blocked',error_code='native_base_check_failed'
        WHERE release_id=$1 AND read_identity=$2 AND (state<>'blocked' OR error_code IS DISTINCT FROM 'native_base_check_failed')`,
        [identity.release_id, identity.identity]
      );
      throw error;
    }
  });
}
var metadataAbiHash;
var init_native_base = __esm({
  "lib/metadata/native-base.ts"() {
    "use strict";
    init_constants();
    init_readiness();
    init_sql();
    init_base_mode();
    init_base_implementation();
    init_identity();
    init_base_abi();
    init_native_base_traits();
    init_publication_request();
    metadataAbiHash = manifestDigest(baseMetadataAbi);
  }
});

// lib/metadata/archive-worker.ts
var archive_worker_exports = {};
import { createPublicClient as createPublicClient3, http as http3 } from "viem";
import { mainnet, base as base3, polygon, bsc } from "viem/chains";
var nativeApproval, stopping, nextBase, nextUri, nextEnqueue, role, baseIngestion, unifiedBase, nativeBase, concurrency, scanBatchSize, enqueueIntervalMs, clients, resolveUri;
var init_archive_worker = __esm({
  async "lib/metadata/archive-worker.ts"() {
    "use strict";
    init_ypal_native_metadata_approval_scheduler_v1();
    init_db();
    init_sql();
    init_constants();
    init_abi();
    init_rpc();
    init_safe_error();
    init_publish();
    init_base_replay();
    init_uri_audit();
    init_unified_base();
    init_unified_runtime();
    init_native_base();
    stopping = false;
    nextBase = 0;
    nextUri = 0;
    nextEnqueue = 0;
    process.on("SIGTERM", () => {
      stopping = true;
      nativeApproval?.requestStop();
    });
    process.on("SIGINT", () => {
      stopping = true;
      nativeApproval?.requestStop();
    });
    role = process.env.METADATA_WORKER_ROLE ?? "full";
    if (role !== "full" && role !== "publish-only")
      throw new Error("Invalid metadata worker role");
    baseIngestion = baseMetadataIngestionMode();
    unifiedBase = role === "full" && baseIngestion === "unified" ? unifiedBaseRuntime() : void 0;
    nativeBase = role === "full" && baseIngestion === "native" ? baseMetadataPointRpc() : void 0;
    concurrency = Number(process.env.METADATA_CONCURRENCY ?? 8);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32)
      throw new Error("Invalid metadata concurrency");
    scanBatchSize = Number(process.env.METADATA_SCAN_BATCH_SIZE ?? 5e3);
    if (!Number.isInteger(scanBatchSize) || scanBatchSize < 1 || scanBatchSize > 1e4)
      throw new Error("Invalid metadata scan batch size");
    enqueueIntervalMs = Number(
      process.env.METADATA_ENQUEUE_INTERVAL_MS ?? 5e3
    );
    if (!Number.isInteger(enqueueIntervalMs) || enqueueIntervalMs < 1e3 || enqueueIntervalMs > 3e5)
      throw new Error("Invalid metadata enqueue interval");
    clients = {
      ethereum: createPublicClient3({
        chain: mainnet,
        transport: http3(process.env.PONDER_RPC_URL_1, {
          timeout: 15e3,
          retryCount: 1
        })
      }),
      base: createPublicClient3({
        chain: base3,
        transport: http3(baseRpcUrlOf(), { timeout: 15e3, retryCount: 1 })
      }),
      polygon: createPublicClient3({
        chain: polygon,
        transport: http3(polygonRpcUrlOf(), { timeout: 15e3, retryCount: 1 })
      }),
      bnb: createPublicClient3({
        chain: bsc,
        transport: http3(bnbRpcUrlOf(), { timeout: 15e3, retryCount: 1 })
      })
    };
    resolveUri = async (collection, tokenId) => clients[collection].readContract({
      address: collections[collection].address,
      abi: collectionAbi,
      functionName: "tokenURI",
      args: [BigInt(tokenId)]
    });
    nativeApproval = nativeBase ? startNativeApproval(async () => {
      try {
        if (nativeBase) await refreshNativeBaseMetadata(pool, nativeBase);
        else if (unifiedBase)
          await consumeBaseMetadataPage(
            pool,
            await unifiedBase.reader(),
            unifiedBase.rpc
          );
        else
          await replayBaseMetadata(pool, process.env, {
            advance: true,
            maxRanges: 2,
            stopping: () => stopping
          });
        await pool.query(
          "UPDATE metadata.publication_runtime SET base_error=NULL,base_checked_at=now() WHERE singleton"
        );
      } catch (error) {
        await pool.query(
          "UPDATE metadata.publication_runtime SET base_error='base_replay_unavailable',base_checked_at=now() WHERE singleton"
        );
        console.error(
          "Base metadata replay deferred",
          safeErrorMessage(error)
        );
      }
    }, {
      onError: (error) => console.error("Metadata archive worker deferred", safeErrorMessage(error))
    }) : void 0;
    try {
      while (!stopping) {
        try {
          if (role === "full" && !nativeBase && Date.now() >= nextBase) {
            try {
              if (nativeBase) await refreshNativeBaseMetadata(pool, nativeBase);
              else if (unifiedBase)
                await consumeBaseMetadataPage(
                  pool,
                  await unifiedBase.reader(),
                  unifiedBase.rpc
                );
              else
                await replayBaseMetadata(pool, process.env, {
                  advance: true,
                  maxRanges: 2,
                  stopping: () => stopping
                });
              await pool.query(
                "UPDATE metadata.publication_runtime SET base_error=NULL,base_checked_at=now() WHERE singleton"
              );
            } catch (error) {
              await pool.query(
                "UPDATE metadata.publication_runtime SET base_error='base_replay_unavailable',base_checked_at=now() WHERE singleton"
              );
              console.error(
                "Base metadata replay deferred",
                safeErrorMessage(error)
              );
            }
            nextBase = Date.now() + (nativeBase ? 2e3 : 15e3);
          }
          if (role === "full" && Date.now() >= nextEnqueue) {
            if (nativeBase) {
              try {
                await enqueueNativeBasePublications(
                  pool,
                  readSchemaName,
                  scanBatchSize
                );
              } catch (error) {
                console.error(
                  "Native Base publication discovery deferred",
                  safeErrorMessage(error)
                );
              }
            }
            await enqueuePublications(pool, readSchemaName, scanBatchSize);
            nextEnqueue = Date.now() + enqueueIntervalMs;
          }
          if (role === "full" && Date.now() >= nextUri) {
            await auditArchiveUris(pool, readSchemaName, resolveUri);
            nextUri = Date.now() + 6e4;
          }
          const jobs = await claimPublications(pool, concurrency);
          const results = await Promise.allSettled(
            jobs.map((job) => publishJob(pool, readSchemaName, job, resolveUri))
          );
          for (const result2 of results)
            if (result2.status === "rejected")
              console.error(
                "Local publication failed; lease will expire",
                safeErrorMessage(result2.reason)
              );
          await pool.query(
            "UPDATE metadata.publication_runtime SET last_worker_at=now() WHERE singleton"
          );
          if (!jobs.length)
            await new Promise((resolve) => setTimeout(resolve, 2e3));
        } catch (error) {
          console.error(
            "Metadata archive worker deferred",
            safeErrorMessage(error)
          );
          await new Promise((resolve) => setTimeout(resolve, 2e3));
        }
      }
    } finally {
      try {
        await nativeApproval?.stop();
      } finally {
        await unifiedBase?.close();
        await pool.end();
      }
    }
  }
});

// lib/uri/build.ts
function buildTokenUri(tokenId) {
  if (!/^\d+$/.test(tokenId)) throw new Error("Token ID must be a decimal integer");
  return `${CONSTRUCTOR_BASE_URI}${tokenId}`;
}
var init_build = __esm({
  "lib/uri/build.ts"() {
    "use strict";
    init_constants();
  }
});

// lib/uri/verify.ts
import { createPublicClient as createPublicClient4, http as http4 } from "viem";
import { mainnet as mainnet2 } from "viem/chains";
async function verifyCurrentBaseUri() {
  const rpcUrl = process.env.PONDER_RPC_URL_1;
  if (!rpcUrl) throw new Error("PONDER_RPC_URL_1 is required");
  const tokenId = process.env.URI_VERIFY_TOKEN_ID ?? "1000000000000";
  if (!/^\d+$/.test(tokenId)) throw new Error("URI_VERIFY_TOKEN_ID must be a decimal token ID");
  const client = createPublicClient4({ chain: mainnet2, transport: http4(rpcUrl) });
  const [actual, blockNumber] = await Promise.all([
    client.readContract({
      address: COLLECTION_ADDRESS,
      abi: collectionAbi,
      functionName: "tokenURI",
      args: [BigInt(tokenId)]
    }),
    client.getBlockNumber()
  ]);
  const expected = buildTokenUri(tokenId);
  if (actual !== expected) {
    throw new Error(`URI base verification failed for token ${tokenId}: expected ${expected}, received ${actual}`);
  }
  return { tokenId, tokenUri: actual, blockNumber };
}
var init_verify = __esm({
  "lib/uri/verify.ts"() {
    "use strict";
    init_abi();
    init_constants();
    init_build();
  }
});

// lib/metadata/retry.ts
function metadataRetry(error, attempts, previousError) {
  const missing = error instanceof MetadataHttpError && error.status === 404;
  const repeatedMissing = missing && attempts >= 3 && previousError === "Metadata HTTP 404";
  return {
    fetchStatus: repeatedMissing ? "not_found" : "retry",
    lastError: error instanceof Error ? error.message.slice(0, 1e3) : String(error),
    delaySeconds: repeatedMissing ? 7 * 86400 : Math.min(86400, 2 ** Math.min(attempts, 12) * 15)
  };
}
var MetadataHttpError;
var init_retry = __esm({
  "lib/metadata/retry.ts"() {
    "use strict";
    MetadataHttpError = class extends Error {
      constructor(status) {
        super(`Metadata HTTP ${status}`);
        this.status = status;
      }
    };
  }
});

// lib/metadata/fetch.ts
import { createHash as createHash5 } from "node:crypto";
import { isIP } from "node:net";
import { promises as dns } from "node:dns";
import { z as z6 } from "zod";
function isPrivateIp(address) {
  if (address === "::1" || address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:")) return true;
  if (!isIP(address)) return true;
  const octets = address.split(".").map(Number);
  return isIP(address) === 4 && (octets[0] === 10 || octets[0] === 127 || octets[0] === 0 || octets[0] === 169 && octets[1] === 254 || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31 || octets[0] === 192 && octets[1] === 168);
}
async function fetchMetadata(uri, options) {
  const url = new URL(uri);
  if (url.protocol !== "https:") throw new Error("Only HTTPS metadata URLs are allowed");
  if (!options.allowedHosts.has(url.hostname)) throw new Error(`Metadata host is not allowlisted: ${url.hostname}`);
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (addresses.some(({ address }) => isPrivateIp(address))) throw new Error("Metadata host resolved to a private address");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15e3);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "error", headers: { accept: "application/json" } });
    if (!response.ok) throw new MetadataHttpError(response.status);
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > options.maxBytes) throw new Error("Metadata payload is too large");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > options.maxBytes) throw new Error("Metadata payload is too large");
    const raw = new TextDecoder().decode(bytes);
    const document = metadataSchema.parse(JSON.parse(raw));
    return {
      document,
      contentHash: createHash5("sha256").update(bytes).digest("hex")
    };
  } finally {
    clearTimeout(timeout);
  }
}
var metadataSchema;
var init_fetch = __esm({
  "lib/metadata/fetch.ts"() {
    "use strict";
    init_retry();
    metadataSchema = z6.object({
      name: z6.string().optional(),
      description: z6.string().optional(),
      image: z6.string().optional(),
      animation_url: z6.string().optional(),
      attributes: z6.array(z6.record(z6.unknown())).optional()
    }).passthrough();
  }
});

// lib/uri/fetch-url.ts
function metadataFetchUrl(tokenUri) {
  const url = new URL(tokenUri);
  if (url.protocol === "https:" && url.hostname === "meta.yunipals.com") {
    url.hostname = "meta.polkamon.com";
  }
  return url.toString();
}
var init_fetch_url = __esm({
  "lib/uri/fetch-url.ts"() {
    "use strict";
  }
});

// lib/metadata/legacy-http-worker.ts
var legacy_http_worker_exports = {};
import { createPublicClient as createPublicClient5, http as http5, parseAbi as parseAbi4 } from "viem";
import { base as base4, bsc as bsc2, polygon as polygon2 } from "viem/chains";
async function enqueueLifecycles() {
  if (Date.now() < nextEnqueueAt) return 0;
  const result2 = await pool.query(`
    WITH candidates AS (
      SELECT l.collection, l.token_id, l.lifecycle
      FROM ${ponderSchema}.token_lifecycle l
      JOIN ${ponderSchema}.token t ON t.collection=l.collection AND t.token_id=l.token_id
      LEFT JOIN metadata.token_metadata m ON m.collection=l.collection
        AND m.token_id=l.token_id::numeric AND m.lifecycle=l.lifecycle
      WHERE m.token_id IS NULL AND l.collection=ANY($1::text[]) LIMIT 10000
    )
    INSERT INTO metadata.token_metadata(collection, token_id, lifecycle, token_uri, uri_provenance, audit_status)
    SELECT collection, token_id::numeric, lifecycle,
      CASE WHEN collection='ethereum' THEN 'https://meta.polkamon.com/meta?id=' || token_id
        ELSE 'onchain:' || collection || ':' || token_id END,
      CASE WHEN collection='ethereum' THEN 'current_base_formula' ELSE 'pending_token_uri_call' END,
      CASE WHEN collection='ethereum' THEN 'sample_verified' ELSE 'onchain_resolved' END
    FROM candidates ON CONFLICT DO NOTHING
  `, [collectionSlugs]);
  const inserted = result2.rowCount ?? 0;
  if (inserted < 1e4) nextEnqueueAt = Date.now() + enqueueIdleMs;
  return inserted;
}
async function resolveTokenUris(collection) {
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
    batchSize: 16384,
    contracts: pending.rows.map((row) => ({
      address: collections[collection].address,
      abi: collectionAbi,
      functionName: "tokenURI",
      args: [BigInt(row.tokenId)]
    }))
  });
  const tokenIds = [];
  const lifecycles = [];
  const tokenUris = [];
  const fallbackTokenIds = [];
  const fallbackLifecycles = [];
  for (const [index, result2] of results.entries()) {
    const row = pending.rows[index];
    if (result2.status !== "success" || typeof result2.result !== "string") {
      if (collection === "polygon" || collection === "bnb") {
        fallbackTokenIds.push(row.tokenId);
        fallbackLifecycles.push(row.lifecycle);
      }
      continue;
    }
    tokenIds.push(row.tokenId);
    lifecycles.push(row.lifecycle);
    tokenUris.push(result2.result);
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
async function auditTokenUris(collection) {
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
    batchSize: 16384,
    contracts: due.rows.map((row) => ({
      address: collections[collection].address,
      abi: collectionAbi,
      functionName: "tokenURI",
      args: [BigInt(row.tokenId)]
    }))
  });
  const client = await pool.connect();
  let checked = 0;
  try {
    await client.query("BEGIN");
    for (const [index, result2] of results.entries()) {
      if (result2.status !== "success" || typeof result2.result !== "string") continue;
      const row = due.rows[index];
      await client.query(
        `UPDATE metadata.token_metadata SET token_uri=$3,
        uri_provenance='current_token_uri_call', audit_status='onchain_resolved', uri_checked_at=now(),
        fetch_status=CASE WHEN token_uri<>$3 THEN 'pending' ELSE fetch_status END,
        next_attempt_at=CASE WHEN token_uri<>$3 THEN now() ELSE next_attempt_at END,
        last_error=CASE WHEN token_uri<>$3 THEN NULL ELSE last_error END, updated_at=now()
        WHERE collection=$4 AND token_id=$1 AND lifecycle=$2`,
        [row.tokenId, row.lifecycle, result2.result, collection]
      );
      checked++;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return checked;
}
function startTokenUriResolution() {
  if (uriResolution) return;
  uriResolution = Promise.all([resolveTokenUris("base"), resolveTokenUris("polygon"), resolveTokenUris("bnb")]).then(() => void 0).catch((error) => console.error("Token URI resolution failed", safeErrorMessage(error))).finally(() => {
    uriResolution = void 0;
  });
}
async function syncBaseMetadataUpdates() {
  if (Date.now() < nextUpdateSyncAt) return;
  nextUpdateSyncAt = Date.now() + 15e3;
  const latestBlock = await baseClient.getBlockNumber();
  await pool.query(`INSERT INTO metadata.chain_event_cursor(name, block_number)
    VALUES ('base_metadata_update', $1) ON CONFLICT (name) DO NOTHING`, [latestBlock.toString()]);
  const cursorResult = await pool.query(`SELECT block_number::text AS "blockNumber"
    FROM metadata.chain_event_cursor WHERE name='base_metadata_update'`);
  const fromBlock = BigInt(cursorResult.rows[0].blockNumber) + 1n;
  if (fromBlock > latestBlock) return;
  const toBlock = fromBlock + 1999n < latestBlock ? fromBlock + 1999n : latestBlock;
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
  } finally {
    client.release();
  }
}
async function claimBatch(limit) {
  const result2 = await pool.query(`
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
  return result2.rows;
}
async function processBatch() {
  const items = await claimBatch(concurrency2);
  if (!items.length) return 0;
  const results = await Promise.all(items.map(async (item) => {
    try {
      const fetchUrl = metadataFetchUrl(item.tokenUri);
      const { document, contentHash: contentHash2 } = await fetchMetadata(fetchUrl, { maxBytes, allowedHosts });
      return {
        ok: true,
        collection: item.collection,
        token_id: item.tokenId,
        lifecycle: item.lifecycle,
        content_hash: contentHash2,
        fetch_url: fetchUrl,
        used_fallback: fetchUrl !== item.tokenUri,
        name: document.name ?? null,
        description: document.description ?? null,
        image: document.image ?? null,
        animation_url: document.animation_url ?? null,
        attributes: document.attributes ?? [],
        document,
        rarity: calculateRarity(item.tokenId, document)
      };
    } catch (error) {
      const retry2 = metadataRetry(error, item.attempts + 1, item.lastError);
      return {
        ok: false,
        collection: item.collection,
        token_id: item.tokenId,
        lifecycle: item.lifecycle,
        last_error: retry2.lastError,
        fetch_status: retry2.fetchStatus,
        delay_seconds: retry2.delaySeconds
      };
    }
  }));
  const successes = results.filter((result2) => result2.ok);
  const failures = results.filter((result2) => !result2.ok);
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
      await client.query(
        `UPDATE metadata.token_metadata m SET fetch_status=x.fetch_status, attempts=m.attempts+1,
        last_error=x.last_error, next_attempt_at=now() + (x.delay_seconds * interval '1 second'), updated_at=now()
        FROM jsonb_to_recordset($1::jsonb) AS x(collection text, token_id numeric, lifecycle integer,
          last_error text, fetch_status text, delay_seconds integer)
        WHERE m.collection=x.collection AND m.token_id=x.token_id AND m.lifecycle=x.lifecycle`,
        [JSON.stringify(failures)]
      );
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
var concurrency2, pollMs, maxBytes, allowedHosts, polygonUriAuditMs, bnbUriAuditMs, enqueueIdleMs, stopping2, nextUpdateSyncAt, nextEnqueueAt, uriResolution, baseRpcUrl, baseClient, polygonClient, bnbClient, metadataUpdateAbi, verification, recovered;
var init_legacy_http_worker = __esm({
  async "lib/metadata/legacy-http-worker.ts"() {
    "use strict";
    init_db();
    init_sql();
    init_verify();
    init_fetch();
    init_retry();
    init_abi();
    init_constants();
    init_rpc();
    init_fetch_url();
    init_safe_error();
    init_calculate();
    init_store();
    concurrency2 = Number(process.env.METADATA_CONCURRENCY ?? 8);
    pollMs = Number(process.env.METADATA_POLL_MS ?? 2e3);
    maxBytes = Number(process.env.METADATA_MAX_BYTES ?? 1048576);
    allowedHosts = new Set((process.env.METADATA_ALLOWED_HOSTS ?? "meta.polkamon.com,meta.yunipals.com").split(",").map((v) => v.trim()));
    polygonUriAuditMs = Number(process.env.POLYGON_URI_AUDIT_MS ?? 7 * 864e5);
    bnbUriAuditMs = Number(process.env.BNB_URI_AUDIT_MS ?? 7 * 864e5);
    enqueueIdleMs = Number(process.env.METADATA_ENQUEUE_IDLE_MS ?? 6e4);
    stopping2 = false;
    nextUpdateSyncAt = 0;
    nextEnqueueAt = 0;
    baseRpcUrl = baseRpcUrlOf();
    baseClient = createPublicClient5({ chain: base4, transport: http5(baseRpcUrl) });
    polygonClient = createPublicClient5({ chain: polygon2, transport: http5(polygonRpcUrlOf()) });
    bnbClient = createPublicClient5({ chain: bsc2, transport: http5(bnbRpcUrlOf()) });
    metadataUpdateAbi = parseAbi4([
      "event Update(address indexed to, uint256 indexed tokenId, (uint16 monsterType, uint16 color, uint16 horn, uint8 background, uint8 glitter, uint40 rarityScore) yunipal)"
    ]);
    process.on("SIGTERM", () => {
      stopping2 = true;
    });
    process.on("SIGINT", () => {
      stopping2 = true;
    });
    verification = await verifyCurrentBaseUri();
    console.log(`Verified current token URI formula at block ${verification.blockNumber} using token ${verification.tokenId}`);
    recovered = await pool.query(`UPDATE metadata.token_metadata SET fetch_status='retry',
  next_attempt_at=now(), updated_at=now(), last_error='Recovered after metadata worker restart'
  WHERE fetch_status='fetching'`);
    if (recovered.rowCount) console.log(`Recovered ${recovered.rowCount} interrupted metadata fetches`);
    while (!stopping2) {
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
  }
});

// lib/metadata/worker.ts
init_publication();
init_db();
init_readiness();
await assertOwnershipSourceSelection(pool);
if (metadataSourceMode() === "archive") await init_archive_worker().then(() => archive_worker_exports);
else await init_legacy_http_worker().then(() => legacy_http_worker_exports);
//# sourceMappingURL=metadata-worker.mjs.map
