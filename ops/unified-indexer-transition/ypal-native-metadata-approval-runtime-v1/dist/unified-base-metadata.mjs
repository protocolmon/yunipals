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

// lib/metadata/render/legacy.cjs
var require_legacy = __commonJS({
  "lib/metadata/render/legacy.cjs"(exports, module) {
    "use strict";
    var { rarityFor: rarityFor2 } = __require("@polkamon/web3-util-pmons/src/lib/rarity/rarity.js");
    var { AttributeTransformingUtils: AttributeTransformingUtils2 } = __require("@polkamon/web3-util-pmons/src/lib/attributeRepository/transforming/AttributeTransforming.js");
    var { PublicAttributeTransformingUtils: PublicAttributeTransformingUtils2 } = __require("@polkamon/web3-util-pmons/src/lib/attributeRepository/transforming/PublicAttributeTransforming.js");
    var { getLegacyChain: getLegacyChain2 } = __require("@polkamon/web3-util-pmons/src/lib/legacy/chain.js");
    var { isRainbowByAttrs: isRainbowByAttrs2 } = __require("@polkamon/web3-util-pmons/src/lib/type/rainbowType.js");
    var { NFBOrigins: NFBOrigins2 } = __require("@polkamon/web3-util-core/src/lib/ids/nfb.js");
    module.exports = { AttributeTransformingUtils: AttributeTransformingUtils2, PublicAttributeTransformingUtils: PublicAttributeTransformingUtils2, getLegacyChain: getLegacyChain2, isRainbowByAttrs: isRainbowByAttrs2, rarityFor: rarityFor2, NFBOrigins: NFBOrigins2 };
  }
});

// lib/metadata/unified-base.ts
import { decodeEventLog } from "viem";

// ../../packages/yunipals-indexer-server/src/identity.ts
import { createHash } from "node:crypto";

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
import { parseAbi } from "viem";
var baseMetadataAbi = parseAbi([
  "event Mint(address indexed to,uint256 indexed tokenId,(uint16 monsterType,uint16 color,uint16 horn,uint8 background,uint8 glitter,uint40 rarityScore) yunipal)",
  "event Update(address indexed to,uint256 indexed tokenId,(uint16 monsterType,uint16 color,uint16 horn,uint8 background,uint8 glitter,uint40 rarityScore) yunipal)",
  "function yunipal(uint256 tokenId) view returns ((uint16 monsterType,uint16 color,uint16 horn,uint8 background,uint8 glitter,uint40 rarityScore))"
]);

// lib/metadata/source/base-events.ts
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

// lib/ownership/read-mode.ts
function ownershipReadConfiguration(env2 = process.env) {
  const mode = env2.OWNERSHIP_READ_MODE ?? "legacy";
  const bnbConfirmations = Number(env2.BNB_CONFIRMATIONS ?? 20);
  if (!Number.isSafeInteger(bnbConfirmations) || bnbConfirmations < 1 || bnbConfirmations > 1e3)
    throw new Error("Invalid BNB ownership confirmation policy.");
  if (mode !== "legacy" && mode !== "unified")
    throw new Error("Invalid ownership read mode.");
  if (mode === "legacy") {
    if (env2.OWNERSHIP_READ_SCHEMA !== void 0 || env2.OWNERSHIP_RELEASE_ID !== void 0)
      throw new Error("Unified ownership selectors require unified read mode.");
    return {
      mode,
      readSchema: env2.READ_DATABASE_SCHEMA ?? env2.DATABASE_SCHEMA ?? "public",
      releaseId: null,
      bnbConfirmations
    };
  }
  const readSchema = env2.OWNERSHIP_READ_SCHEMA, releaseId = env2.OWNERSHIP_RELEASE_ID;
  if (!readSchema || !/^[a-z_][a-z0-9_]{0,62}$/i.test(readSchema) || !releaseId || !/^0x[0-9a-f]{64}$/.test(releaseId) || !env2.DATABASE_SCHEMA || env2.YUNIPALS_PROJECTION_MODE !== "generation" || readSchema === env2.DATABASE_SCHEMA || env2.READ_DATABASE_SCHEMA !== void 0 && env2.READ_DATABASE_SCHEMA !== readSchema)
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

// lib/metadata/base-mode.ts
function baseMetadataIngestionMode(env2 = process.env) {
  const mode = env2.BASE_METADATA_INGESTION ?? "rpc";
  if (!["rpc", "unified", "native"].includes(mode))
    throw new Error("Invalid Base metadata ingestion mode.");
  if (mode === "native" && (env2.OWNERSHIP_READ_MODE !== "unified" || env2.METADATA_SOURCE_MODE !== "archive"))
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

// lib/metadata/source/base-events.ts
var baseTraitsSchema = z.object({
  monsterType: z.number().int().min(0).max(65535),
  color: z.number().int().min(0).max(65535),
  horn: z.number().int().min(0).max(65535),
  background: z.number().int().min(0).max(255),
  glitter: z.number().int().min(0).max(255),
  rarityScore: z.string().regex(/^\d+$/).refine((v) => BigInt(v) < 2n ** 40n)
}).strict();
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

// lib/metadata/base-implementation.ts
var approvedBaseMetadataImplementation = "0x4ad380760abb9fad95cd48ef2d7c46ed5a072fca";

// lib/metadata/unified-base.ts
var name = "base_metadata_v1";
var sourceId = "metadata:base";
var policy = { kind: "finalized" };
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
async function adoptBaseMetadataConsumer(pool2, reader, rpc) {
  assertSource(reader);
  return withWriter(pool2, async (db) => {
    const before = await state(db);
    const status = await reader.status(sourceId, policy);
    if (!["ready", "catching_up"].includes(status.readiness.reason) || !status.anchor)
      throw new Error("Finalized Base metadata source is unavailable.");
    await checkBoundary(rpc, status.anchor);
    if (before) {
      await checkStoredScan(before, rpc);
      if (before.ingestion_mode === "unified") {
        assertBound(before, reader);
        return { adopted: false, releaseId: reader.release.id };
      }
      if (before.cursor || BigInt(before.target_block) > BigInt(status.anchor.number))
        throw new Error(
          "Shared source has not covered the existing Base scan target."
        );
    }
    const cursor = {
      version: 1,
      releaseId: reader.release.id,
      sourceId,
      policy: "finalized",
      completed: before && BigInt(before.next_block) > BigInt(collections.base.deploymentBlock) ? {
        number: String(BigInt(before.next_block) - 1n),
        hash: before.last_scanned_hash
      } : null,
      target: null,
      after: null
    };
    await db.query("BEGIN");
    try {
      if (canonicalJson(await state(db, true)) !== canonicalJson(before))
        throw new Error("Base metadata writer changed during adoption.");
      if (!before)
        await db.query(
          `INSERT INTO metadata_source.chain_metadata_scan
          (name,chain_id,contract_address,deployment_block,next_block,target_block,target_hash,ingestion_mode)
          VALUES($1,8453,$2,$3,$3,$4,$5,'unified')`,
          [
            name,
            collections.base.address,
            collections.base.deploymentBlock,
            status.anchor.number,
            status.anchor.hash
          ]
        );
      else
        await db.query(
          "UPDATE metadata_source.chain_metadata_scan SET ingestion_mode='unified',updated_at=now() WHERE name=$1",
          [name]
        );
      await db.query(
        `INSERT INTO metadata_source.chain_metadata_consumer(name,release_id,manifest_hash,cursor)
        VALUES($1,$2,$3,$4)`,
        [
          name,
          reader.release.id,
          reader.release.manifestHash,
          JSON.stringify(cursor)
        ]
      );
      await db.query("COMMIT");
      return { adopted: true, releaseId: reader.release.id };
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  });
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
  const args2 = decoded.args;
  return {
    transactionHash: event.transactionHash,
    transactionIndex: event.transactionIndex,
    logIndex: event.logIndex,
    blockNumber: event.blockNumber,
    blockHash: event.blockHash,
    eventName: decoded.eventName,
    tokenId: String(args2.tokenId),
    recipient: args2.to.toLowerCase(),
    traits: { ...args2.yunipal, rarityScore: String(args2.yunipal.rarityScore) }
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

// lib/metadata/unified-runtime.ts
import pg from "pg";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

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
    (policy2) => confirmationPolicyKey(policy2) === policyKey
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
  const required = options.requiredThroughBlock ?? boundary;
  const indexed = snapshot.completeThroughBlock;
  if (indexed === null || indexed < BigInt(source.startBlock)) {
    return result("not_indexed", null, required);
  }
  if (indexed > snapshot.head.blockNumber) {
    return result("observation_inconsistent", null, required);
  }
  const available = indexed < boundary ? indexed : boundary;
  return result(
    available >= required && required >= BigInt(source.startBlock) ? "ready" : "catching_up",
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
  const runtime2 = await readPonderRuntime(db, release.schema);
  if (runtime2.buildId !== release.buildId)
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
  return runtime2;
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

// ../../packages/yunipals-indexer-server/src/status.ts
async function readIndexerSourceStatus(db, release, sourceId2, policy2, options = {}) {
  const source = release.manifest.sources.find(
    (source2) => source2.id === sourceId2
  );
  if (!source) throw new Error("Unknown shared indexer source.");
  const runtime2 = await readBoundRuntime(db, release);
  const status = await readChainStatus(db, release.id, source.chainId);
  const indexed = runtime2.chains.find((chain2) => chain2.chainId === source.chainId)?.completeThroughBlock ?? null;
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
    indexerObservedAtMs: runtime2.observedAtMs,
    halted: status?.halted === true || !runtime2.running,
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

// ../../packages/yunipals-indexer-server/src/paging.ts
var CanonicalCursorInvalidated = class extends Error {
};
var CanonicalSourceUnavailable = class extends Error {
};
var receiptKey = (hash, transaction) => `${hash}:${transaction}`;
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

// lib/metadata/unified-runtime.ts
function baseMetadataPointRpc(env2 = process.env) {
  const client = createPublicClient({
    chain: base,
    transport: http(baseRpcUrlOf(env2), { timeout: 15e3, retryCount: 0 })
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
function unifiedBaseRuntime(env2 = process.env) {
  if (!env2.UNIFIED_INDEXER_DATABASE_URL)
    throw new Error("Shared indexer read database is required.");
  const sourcePool = new pg.Pool({
    connectionString: env2.UNIFIED_INDEXER_DATABASE_URL,
    max: 2,
    application_name: "base_metadata_unified_reader",
    connectionTimeoutMillis: 5e3,
    statement_timeout: 15e3,
    idle_in_transaction_session_timeout: 15e3,
    lock_timeout: 2e3
  });
  return {
    reader: () => createIndexerReader(sourcePool, {
      releaseId: env2.UNIFIED_INDEXER_RELEASE_ID
    }),
    rpc: baseMetadataPointRpc(env2),
    close: () => sourcePool.end()
  };
}

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

// lib/metadata/native-base-traits.ts
var nativeBaseTraitsSql = `jsonb_set(e.args::jsonb->'yunipal',
  '{rarityScore}',to_jsonb(e.args::jsonb->'yunipal'->>'rarityScore'),false)`;

// lib/metadata/render/snapshot.ts
var import_legacy = __toESM(require_legacy(), 1);
import { z as z2 } from "zod";
var rendererVersion = "legacy-snapshot-v1";
var chain = z2.object({ id: z2.enum(["1", "56", "137", "42161", "42170", "mainnet-beta"]), type: z2.enum(["EVM", "SOLANA"]) });
var envelopeSchema = z2.object({
  chain,
  chainOrigin: chain,
  origin: z2.object({ type: z2.string() }).passthrough(),
  nft: z2.object({ id: z2.string(), name: z2.string(), description: z2.string(), attributes: z2.record(z2.unknown()) }).passthrough()
}).passthrough();

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

// lib/metadata/native-base.ts
var metadataAbiHash = manifestDigest(baseMetadataAbi);
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
async function adoptNativeBaseMetadata(pool2, rpc) {
  return withNativeWriter(pool2, async (db) => {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    try {
      await db.query("SET LOCAL statement_timeout='10min'");
      const identity = await ownershipReadIdentity(db);
      if (!identity)
        throw new Error("A registered native read identity is required.");
      const boundary = await frame(db);
      const scan = (await db.query(`SELECT chain_id,contract_address,deployment_block::text,next_block::text,ingestion_mode
        FROM metadata_source.chain_metadata_scan WHERE name='base_metadata_v1' FOR UPDATE`)).rows[0];
      if (!scan || scan.chain_id !== 8453 || scan.contract_address !== collections.base.address || scan.deployment_block !== String(collections.base.deploymentBlock) || BigInt(scan.next_block) < BigInt(scan.deployment_block) || BigInt(scan.next_block) - 1n > BigInt(boundary.block_number))
        throw new Error(
          "Native Base metadata has not covered the legacy cursor."
        );
      for (let partition = 0; partition < 16; partition++) {
        const mismatch = (await db.query(
          `WITH legacy AS MATERIALIZED (
        SELECT transaction_hash,log_index,transaction_index,block_number,block_hash,event_name,token_id,recipient,traits
        FROM metadata_source.chain_metadata_event WHERE chain_id=8453 AND contract_address=$1 AND block_number<$2
          AND (hashtextextended(transaction_hash,0) & 15)=$5),
        native AS MATERIALIZED (
        SELECT e.transaction_hash,e.log_index,e.transaction_index,e.block_number,e.block_hash,e.name AS event_name,
          e.args::jsonb->>'tokenId' AS token_id,lower(e.args::jsonb->>'to') AS recipient,${nativeBaseTraitsSql} AS traits
        FROM ${physicalPonderSchema}.canonical_event e WHERE e.source_id='metadata:base' AND e.chain_id=8453
          AND e.address=$1 AND e.block_number>=$3 AND e.block_number<$2 AND e.abi_hash=$4
          AND (hashtextextended(e.transaction_hash,0) & 15)=$5)
        SELECT 1 FROM legacy l FULL JOIN native n USING(transaction_hash,log_index)
        WHERE (l.transaction_index,l.block_number,l.block_hash,l.event_name,l.token_id,l.recipient,l.traits)
          IS DISTINCT FROM (n.transaction_index,n.block_number,n.block_hash,n.event_name,n.token_id,n.recipient,n.traits) LIMIT 1`,
          [
            collections.base.address,
            scan.next_block,
            scan.deployment_block,
            metadataAbiHash,
            partition
          ]
        )).rowCount;
        if (mismatch)
          throw new Error(
            "Native/legacy Base metadata parity failed; no cutover performed."
          );
      }
      await pointCheck(rpc, boundary);
      await db.query(
        "UPDATE metadata_source.chain_metadata_scan SET ingestion_mode='native',updated_at=now() WHERE name='base_metadata_v1'"
      );
      await approve(db, identity, boundary);
      await db.query("COMMIT");
      return {
        adopted: true,
        releaseId: identity.release_id,
        readIdentity: identity.identity,
        legacyNextBlock: scan.next_block,
        blockNumber: boundary.block_number,
        frontier: boundary.frontier
      };
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  });
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
async function backfillNativeBaseMetadataProvenance(pool2, batchSize = 5e3) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1e4)
    throw new Error("Invalid native provenance batch size.");
  return withNativeWriter(pool2, async (db) => {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    try {
      await ownershipReadIdentity(db);
      const result = await db.query(
        `WITH candidates AS MATERIALIZED (
        SELECT p.collection,p.token_id,p.lifecycle,latest.block_hash,b.asset_key,b.input_hash,
          latest.transaction_hash AS event_transaction,latest.log_index AS event_log FROM metadata.token_publication p
        CROSS JOIN ${ponderSchema}.base_metadata_frame(true) f
        JOIN LATERAL(SELECT e.transaction_hash,e.log_index,e.block_hash,${nativeBaseTraitsSql} AS traits
          FROM ${physicalPonderSchema}.canonical_event e WHERE e.source_id='metadata:base'
          AND e.chain_id=8453 AND e.address=$1 AND e.abi_hash=$3
          AND e.args::jsonb->>'tokenId'=p.token_id::text AND e.block_number<=f.block_number
          ORDER BY e.block_number DESC,e.transaction_index DESC,e.log_index DESC LIMIT 1) latest ON true
        JOIN metadata_source.chain_metadata_event old ON old.chain_id=8453 AND old.contract_address=$1
          AND old.transaction_hash=latest.transaction_hash AND old.log_index=latest.log_index
          AND old.block_hash=latest.block_hash AND old.traits=latest.traits AND old.token_id=p.token_id::text
        LEFT JOIN metadata_source.lifecycle_binding b ON b.release_id=p.release_id AND b.chain_id='8453'
          AND b.contract_address=$1 AND b.token_id=p.token_id::text
          AND b.mint_transaction_hash=p.mint_transaction_hash AND b.mint_log_index=p.mint_log_index
        WHERE p.collection='base' AND p.chain_event_block_hash IS NULL
          AND p.source_kind='archive' AND EXISTS(SELECT 1 FROM metadata_source.archive_release r
            WHERE r.release_id=p.release_id AND r.state='active')
          AND p.chain_event_key=latest.transaction_hash||':'||latest.log_index::text
        ORDER BY p.token_id,p.lifecycle LIMIT $2 FOR UPDATE OF p)
        UPDATE metadata.token_publication p SET chain_event_block_hash=c.block_hash
        FROM candidates c WHERE p.collection=c.collection AND p.token_id=c.token_id AND p.lifecycle=c.lifecycle
        RETURNING p.token_id::text,p.lifecycle,p.mint_transaction_hash,p.mint_log_index,p.publication_status,
          c.asset_key,c.input_hash,c.event_transaction,c.event_log,c.block_hash AS event_block_hash`,
        [collections.base.address, batchSize, metadataAbiHash]
      );
      const jobs = result.rows.filter((row) => row.publication_status === "published").map((row) => ({
        tokenId: row.token_id,
        lifecycle: row.lifecycle,
        mintTransaction: row.mint_transaction_hash,
        mintLog: row.mint_log_index,
        previousKey: publicationRequestKey(row),
        nextKey: publicationRequestKey(row, true)
      }));
      await db.query(
        `UPDATE metadata.publication_job j SET request_key=x."nextKey"
        FROM jsonb_to_recordset($1::jsonb) AS x("tokenId" text,lifecycle integer,"mintTransaction" text,"mintLog" integer,"previousKey" text,"nextKey" text)
        WHERE j.collection='base' AND j.token_id=x."tokenId"::numeric AND j.lifecycle=x.lifecycle
          AND j.mint_transaction_hash=x."mintTransaction" AND j.mint_log_index=x."mintLog"
          AND j.request_key=x."previousKey" AND j.status='published' AND j.reason IS NULL
          AND EXISTS(SELECT 1 FROM metadata_source.archive_release r WHERE r.release_id=j.release_id AND r.state='active')`,
        [JSON.stringify(jobs)]
      );
      await db.query("COMMIT");
      return { stamped: result.rowCount ?? 0 };
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  });
}

// scripts/metadata/support.ts
import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { parseArgs, parseEnv } from "node:util";
import pg2 from "pg";
function argumentsOf(extra = {}) {
  return parseArgs({ options: {
    "legacy-root": { type: "string" },
    "env-file": { type: "string", default: ".env" },
    ...extra
  }, strict: true }).values;
}
async function environmentFrom(path) {
  return parseEnv(await readFile(resolve(path), "utf8"));
}
async function postgresFrom(path) {
  const env2 = await environmentFrom(path);
  if (!env2.DATABASE_URL) throw new Error("DATABASE_URL missing from selected environment file");
  const pool2 = new pg2.Pool({
    connectionString: env2.DATABASE_URL,
    max: 2,
    application_name: "metadata_migration",
    connectionTimeoutMillis: 5e3,
    statement_timeout: 12e4,
    lock_timeout: 2e3
  });
  return { pool: pool2, env: env2 };
}
function safeFailure(error) {
  if (error instanceof Error) {
    const code = "code" in error && /^[A-Z0-9_]+$/i.test(String(error.code)) ? ` (${error.code})` : "";
    return `${error.name}${code}; operation failed, report remains resumable`;
  }
  return "Migration operation failed";
}

// scripts/metadata/recovery.ts
function assertRecoveryRuntimeEnvironment(selected, runtime2 = process.env) {
  for (const key of [
    "DATABASE_URL",
    "DATABASE_SCHEMA",
    "READ_DATABASE_SCHEMA",
    "BNB_DATABASE_SCHEMA",
    "METADATA_SOURCE_MODE",
    "RARITY_READ_SOURCE",
    "OWNERSHIP_READ_MODE",
    "OWNERSHIP_READ_SCHEMA",
    "OWNERSHIP_RELEASE_ID",
    "BNB_CONFIRMATIONS",
    "YUNIPALS_PROJECTION_MODE",
    "BASE_METADATA_INGESTION",
    "UNIFIED_INDEXER_DATABASE_URL",
    "UNIFIED_INDEXER_RELEASE_ID"
  ]) {
    if (selected[key] !== runtime2[key])
      throw new Error(`Recovery runtime environment mismatch: ${key}`);
  }
}

// scripts/unified-base-metadata.ts
var args = argumentsOf({ command: { type: "string", default: "consume" } });
if (![
  "adopt",
  "consume",
  "native-adopt",
  "native-refresh",
  "native-provenance"
].includes(String(args.command)))
  throw new Error(
    "Use --command adopt, consume, native-adopt, native-refresh or native-provenance."
  );
var { pool, env } = await postgresFrom(String(args["env-file"]));
var runtime;
try {
  if (args.command === "adopt" && !env.UNIFIED_INDEXER_RELEASE_ID)
    throw new Error("Adoption requires an explicit registered release ID.");
  if (String(args.command).startsWith("native-")) {
    assertRecoveryRuntimeEnvironment(env);
    if (!env.OWNERSHIP_RELEASE_ID)
      throw new Error(
        "Native migration requires an explicit ownership release ID."
      );
    const rpc = baseMetadataPointRpc(env);
    if (args.command === "native-provenance")
      await refreshNativeBaseMetadata(pool, rpc);
    const result = args.command === "native-adopt" ? await adoptNativeBaseMetadata(pool, rpc) : args.command === "native-refresh" ? await refreshNativeBaseMetadata(pool, rpc) : await backfillNativeBaseMetadataProvenance(pool);
    console.log(
      JSON.stringify({ event: `base_metadata_${args.command}`, ...result })
    );
  } else {
    runtime = unifiedBaseRuntime(env);
    const reader = await runtime.reader();
    const result = args.command === "adopt" ? await adoptBaseMetadataConsumer(pool, reader, runtime.rpc) : await consumeBaseMetadataPage(pool, reader, runtime.rpc);
    console.log(
      JSON.stringify({ event: `base_metadata_${args.command}`, ...result })
    );
  }
} catch (error) {
  console.error(safeFailure(error));
  process.exitCode = 1;
} finally {
  await runtime?.close();
  await pool.end();
}
//# sourceMappingURL=unified-base-metadata.mjs.map
