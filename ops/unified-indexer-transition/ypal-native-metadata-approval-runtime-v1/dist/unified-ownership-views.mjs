import { createRequire as __runtimeCreateRequire } from "node:module"; const require = __runtimeCreateRequire(import.meta.url);

// scripts/unified-ownership-views.ts
import pg from "pg";

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

// ../../packages/yunipals-indexer-server/src/database.ts
function sqlIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value) || Buffer.byteLength(value) > 63)
    throw new Error("Invalid shared indexer SQL identifier.");
  return `"${value}"`;
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

// ../../packages/yunipals-indexer-server/src/identity.ts
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

// ../../packages/yunipals-indexer-server/src/ownership.ts
var zero = "0x0000000000000000000000000000000000000000";
function ownershipReference(schema, source, collection) {
  sqlIdentifier(schema);
  const island = /^([a-z]+)-islands(?:-v([1-9][0-9]*))?$/.exec(collection);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(collection) || !source.enabled || !source.address || !source.startBlock || ![1, 56, 137, 8453].includes(source.chainId) || !/^0x[0-9a-f]{40}$/.test(source.address) || !/^(0|[1-9][0-9]*)$/.test(source.startBlock) || !["ownership", "islands"].includes(source.feature) || source.feature === "ownership" && source.id !== `ownership:${collection}` || source.feature === "islands" && (!island || source.id !== `islands:${island[1]}${island[2] ? `:v${island[2]}` : ""}`) || !source.events.includes("Transfer"))
    throw new Error("Invalid ownership read source.");
  return {
    schema,
    source: {
      ...source,
      address: source.address,
      startBlock: source.startBlock
    },
    collection
  };
}
function boundarySql(boundary) {
  if ("parameter" in boundary) {
    if (!Number.isSafeInteger(boundary.parameter) || boundary.parameter < 1)
      throw new Error("Invalid ownership boundary parameter.");
    return `SELECT $${boundary.parameter}::bigint AS block_number`;
  }
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(boundary.collection))
    throw new Error("Invalid ownership collection.");
  return `SELECT block_number FROM ${sqlIdentifier(boundary.readSchema)}.source_boundary('${boundary.collection}')`;
}
function ownershipTokenSql(ref, boundary) {
  ownershipReference(ref.schema, ref.source, ref.collection);
  const schema = sqlIdentifier(ref.schema);
  const scope = `t.collection='${ref.collection}' AND t.chain_id=${ref.source.chainId} AND t.contract_address='${ref.source.address}'`;
  return `WITH b AS MATERIALIZED (${boundarySql(boundary)})
    SELECT '${ref.collection}'::text AS collection,t.chain_id,t.contract_address,t.token_id,
      t.owner,t.burned,t.lifecycle,t.mint_block,t.mint_timestamp,
      t.last_transfer_block,t.last_transfer_timestamp,t.last_transaction_hash
    FROM ${schema}.token t CROSS JOIN b WHERE ${scope} AND t.last_transfer_block<=b.block_number
    UNION ALL
    SELECT '${ref.collection}'::text,t.chain_id,t.contract_address,t.token_id,
      e."to" AS owner,e."to"='${zero}' AS burned,e.lifecycle,l.mint_block,l.mint_timestamp,
      e.block_number,e.block_timestamp,e.transaction_hash
    FROM ${schema}.token t CROSS JOIN b
    JOIN LATERAL (
      SELECT e.* FROM ${schema}.transfer_event e
      WHERE e.collection=t.collection AND e.chain_id=t.chain_id AND e.contract_address=t.contract_address
        AND e.token_id=t.token_id AND e.block_number<=b.block_number
      ORDER BY e.block_number DESC,e.transaction_index DESC,e.log_index DESC LIMIT 1
    ) e ON true
    JOIN ${schema}.token_lifecycle l ON l.collection=t.collection AND l.token_id=t.token_id
      AND l.lifecycle=e.lifecycle AND l.mint_block<=b.block_number
    WHERE ${scope} AND t.last_transfer_block>b.block_number`;
}
function ownershipLifecycleSql(ref, boundary) {
  ownershipReference(ref.schema, ref.source, ref.collection);
  return `WITH b AS MATERIALIZED (${boundarySql(boundary)})
    SELECT '${ref.collection}'::text AS collection,l.token_id,l.lifecycle,l.minted_to,l.mint_block,l.mint_timestamp,
      l.mint_transaction_hash,
      CASE WHEN l.burned_at_block<=b.block_number THEN l.burned_at_block END AS burned_at_block,
      CASE WHEN l.burned_at_block<=b.block_number THEN l.burned_at_timestamp END AS burned_at_timestamp,
      CASE WHEN l.burned_at_block<=b.block_number THEN l.burn_transaction_hash END AS burn_transaction_hash
    FROM ${sqlIdentifier(ref.schema)}.token_lifecycle l CROSS JOIN b
    WHERE l.collection='${ref.collection}' AND l.mint_block<=b.block_number`;
}
function ownershipHistorySql(ref, relation, boundary) {
  ownershipReference(ref.schema, ref.source, ref.collection);
  if (!["transfer_event", "admin_role_event", "contract_owner_event"].includes(
    relation
  ))
    throw new Error("Invalid ownership history relation.");
  return `WITH b AS MATERIALIZED (${boundarySql(boundary)})
    SELECT e.* FROM ${sqlIdentifier(ref.schema)}.${relation} e CROSS JOIN b
    WHERE e.collection='${ref.collection}' AND e.chain_id=${ref.source.chainId}
      AND e.contract_address='${ref.source.address}' AND e.block_number<=b.block_number`;
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
var baseIslandOwnershipPolicy = { kind: "latest" };

// lib/metadata/base-abi.ts
import { parseAbi as parseAbi4 } from "viem";
var baseMetadataAbi = parseAbi4([
  "event Mint(address indexed to,uint256 indexed tokenId,(uint16 monsterType,uint16 color,uint16 horn,uint8 background,uint8 glitter,uint40 rarityScore) yunipal)",
  "event Update(address indexed to,uint256 indexed tokenId,(uint16 monsterType,uint16 color,uint16 horn,uint8 background,uint8 glitter,uint40 rarityScore) yunipal)",
  "function yunipal(uint256 tokenId) view returns ((uint16 monsterType,uint16 color,uint16 horn,uint8 background,uint8 glitter,uint40 rarityScore))"
]);

// lib/metadata/base-implementation.ts
var approvedBaseMetadataImplementation = "0x4ad380760abb9fad95cd48ef2d7c46ed5a072fca";

// lib/metadata/native-base-traits.ts
var nativeBaseTraitsSql = `jsonb_set(e.args::jsonb->'yunipal',
  '{rarityScore}',to_jsonb(e.args::jsonb->'yunipal'->>'rarityScore'),false)`;

// lib/unified/base-metadata-views.ts
var literal = (value) => `'${value.replaceAll("'", "''")}'`;
function nativeBaseMetadataDefinition(release, includeBase) {
  const source = release.manifest.sources.find(
    (source2) => source2.id === "metadata:base"
  );
  if (!includeBase || !source?.enabled || !source.policies.some((policy) => policy.kind === "latest"))
    return null;
  if (source.feature !== "base-metadata" || source.chainId !== 8453 || source.address !== collections.base.address || source.startBlock !== String(collections.base.deploymentBlock) || source.endBlock !== null || !source.events.includes("Mint") || !source.events.includes("Update") || source.abiHash !== manifestDigest(baseMetadataAbi))
    throw new Error(
      "Native Base metadata source requires ABI/deployment review."
    );
  return source;
}
async function createNativeBaseMetadataViews(db, release, readSchema, identity, source) {
  const target = sqlIdentifier(readSchema), physical = sqlIdentifier(release.schema);
  await db.query(`CREATE FUNCTION ${target}.base_metadata_frame(require_approval boolean DEFAULT true)
    RETURNS TABLE(block_number bigint,block_hash text,frontier text,frontier_event_id text,frontier_event_hash text)
    LANGUAGE plpgsql STABLE SECURITY INVOKER ROWS 1 SET search_path=pg_catalog AS $yunipals_native_base$
    DECLARE boundary record; latest record; approval record;
    BEGIN
      SELECT * INTO boundary FROM ${target}.source_boundary('base');
      IF NOT FOUND OR boundary.policy<>'latest' THEN RAISE EXCEPTION 'base_policy_unavailable'; END IF;
      IF NOT EXISTS(SELECT 1 FROM ${physical}.indexer_source s WHERE s.id='metadata:base' AND s.chain_id=8453
        AND s.manifest_hash=${literal(release.manifestHash)} AND s.definition::jsonb=${literal(JSON.stringify(source))}::jsonb)
        THEN RAISE EXCEPTION 'base_metadata_source_mismatch'; END IF;
      SELECT e.id,e.block_hash INTO latest FROM ${physical}.canonical_event e
        WHERE e.source_id='metadata:base' AND e.chain_id=8453 AND e.address=${literal(collections.base.address)}
          AND e.abi_hash=${literal(source.abiHash)} AND e.block_number>=${source.startBlock}::bigint
          AND e.block_number<=boundary.block_number
        ORDER BY e.block_number DESC,e.transaction_index DESC,e.log_index DESC LIMIT 1;
      block_number:=boundary.block_number;block_hash:=boundary.block_hash;
      frontier_event_id:=latest.id;frontier_event_hash:=latest.block_hash;
      frontier:=COALESCE(latest.id||':'||latest.block_hash,'none');
      IF require_approval THEN
        SELECT a.* INTO approval FROM metadata_source.native_base_metadata_state a
          JOIN metadata_source.chain_metadata_scan s ON s.name='base_metadata_v1' AND s.ingestion_mode='native'
          WHERE a.release_id=${literal(release.id)};
        IF NOT FOUND OR approval.read_identity IS DISTINCT FROM ${literal(identity)} OR approval.state<>'ready'
          OR approval.frontier IS DISTINCT FROM frontier OR approval.implementation IS DISTINCT FROM ${literal(approvedBaseMetadataImplementation)}
          OR approval.checked_at<statement_timestamp()-interval '90 seconds' OR approval.checked_at>statement_timestamp()
          OR approval.checked_block>boundary.block_number OR NOT EXISTS(SELECT 1 FROM ${physical}.chain_block b
            WHERE b.chain_id=8453 AND b.block_number=approval.checked_block AND b.block_hash=approval.checked_hash)
          THEN RAISE EXCEPTION 'base_metadata_approval_pending'; END IF;
      END IF;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION USING ERRCODE='YI001',MESSAGE='Native Base metadata unavailable',DETAIL=SQLERRM;
    END $yunipals_native_base$`);
  await db.query(
    `REVOKE ALL ON FUNCTION ${target}.base_metadata_frame(boolean) FROM PUBLIC`
  );
  await db.query(`CREATE FUNCTION ${target}.base_metadata_probe() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $probe$
    BEGIN PERFORM 1 FROM ${target}.base_metadata_frame(true); RETURN FOUND;
    EXCEPTION WHEN OTHERS THEN RETURN false; END $probe$`);
  await db.query(
    `REVOKE ALL ON FUNCTION ${target}.base_metadata_probe() FROM PUBLIC`
  );
  await db.query(`CREATE VIEW ${target}.base_metadata_scan AS
    SELECT 'base_metadata_v1'::text AS name,8453::integer AS chain_id,${literal(collections.base.address)}::text AS contract_address,
      ${source.startBlock}::bigint AS deployment_block,f.block_number+1 AS next_block,f.block_number AS target_block,
      f.block_hash AS target_hash,f.block_hash AS last_scanned_hash,statement_timestamp() AS updated_at
    FROM ${target}.base_metadata_frame(true) f`);
  await db.query(`CREATE VIEW ${target}.base_metadata_event AS
    SELECT e.chain_id,e.address AS contract_address,e.transaction_hash,e.log_index,e.transaction_index,e.block_number,e.block_hash,
      e.name AS event_name,e.args::jsonb->>'tokenId' AS token_id,lower(e.args::jsonb->>'to') AS recipient,
      ${nativeBaseTraitsSql} AS traits
    FROM ${physical}.canonical_event e CROSS JOIN ${target}.base_metadata_frame(true) f
    WHERE e.source_id='metadata:base' AND e.chain_id=8453 AND e.address=${literal(collections.base.address)}
      AND e.abi_hash=${literal(source.abiHash)} AND e.name IN('Mint','Update')
      AND e.block_number>=${source.startBlock}::bigint AND e.block_number<=f.block_number`);
}

// lib/unified/ownership-views.ts
var literal2 = (value) => `'${value.replaceAll("'", "''")}'`;
async function createOwnershipReadViews(pool2, release, readSchema, definitions) {
  const target = sqlIdentifier(readSchema), sourceSchema = sqlIdentifier(release.schema);
  if (readSchema === release.schema || !definitions.length || definitions.length > 32 || new Set(definitions.map((row) => row.collection)).size !== definitions.length || new Set(definitions.map((row) => row.sourceId)).size !== definitions.length)
    throw new Error("Invalid candidate ownership read schema/configuration.");
  const configs = definitions.map((definition) => {
    const source = release.manifest.sources.find(
      (source2) => source2.id === definition.sourceId
    );
    if (!source || !source.policies.some(
      (policy) => confirmationPolicyKey(policy) === confirmationPolicyKey(definition.policy)
    ))
      throw new Error("Unsupported ownership source confirmation policy.");
    const ref = ownershipReference(
      release.schema,
      source,
      definition.collection
    );
    return { ...definition, source: ref.source };
  }).sort((a, b) => a.collection.localeCompare(b.collection));
  const nativeBase = nativeBaseMetadataDefinition(
    release,
    definitions.some(
      (definition) => definition.collection === "base" && definition.policy.kind === "latest"
    )
  );
  const identity = manifestDigest({
    version: nativeBase ? 4 : 3,
    releaseId: release.id,
    configs,
    nativeBase
  });
  const db = await pool2.connect();
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL lock_timeout='3s'");
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('unified-ownership-read-views'),hashtext($1))",
      [readSchema]
    );
    await readBoundRuntime(db, release);
    const exists = (await db.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [
      readSchema
    ])).rowCount === 1;
    if (exists) {
      const marker = (await db.query("SELECT to_regclass($1) AS relation", [
        `${target}._unified_read_release`
      ])).rows[0]?.relation;
      if (!marker)
        throw new Error(
          "Refusing to replace a schema without a unified read identity."
        );
      const previous = (await db.query(
        `SELECT identity FROM ${target}._unified_read_release WHERE singleton`
      )).rows[0]?.identity;
      if (previous !== identity)
        throw new Error(
          "A candidate read schema cannot be reassigned to another release/configuration."
        );
      const complete = (await db.query(
        `SELECT count(*)=$5::integer AND
        to_regprocedure($2) IS NOT NULL AND to_regprocedure($4) IS NOT NULL
        AND ($6::text IS NULL OR (to_regprocedure($6) IS NOT NULL AND to_regprocedure($7) IS NOT NULL)) AS complete FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=$1 AND c.relkind='v' AND c.relname=ANY($3::text[])`,
        [
          readSchema,
          `${target}.source_boundary(text)`,
          [
            "token",
            "token_lifecycle",
            "transfer_event",
            "admin_role_event",
            "contract_owner_event",
            "source_status",
            ...nativeBase ? ["base_metadata_event", "base_metadata_scan"] : []
          ],
          `${target}.source_probe(text)`,
          nativeBase ? 8 : 6,
          nativeBase ? `${target}.base_metadata_frame(boolean)` : null,
          nativeBase ? `${target}.base_metadata_probe()` : null
        ]
      )).rows[0]?.complete;
      if (!complete)
        throw new Error(
          "Candidate ownership read objects are incomplete; review the schema before reuse."
        );
      await db.query("COMMIT");
      return {
        schema: readSchema,
        releaseId: release.id,
        identity,
        created: false,
        activated: false
      };
    }
    await db.query(`CREATE SCHEMA ${target}`);
    await db.query(`CREATE TABLE ${target}._unified_read_release (
      singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
      identity text NOT NULL,release_id text NOT NULL,manifest_hash text NOT NULL,
      definitions jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
    await db.query(
      `INSERT INTO ${target}._unified_read_release(identity,release_id,manifest_hash,definitions)
      VALUES($1,$2,$3,$4)`,
      [identity, release.id, release.manifestHash, JSON.stringify(definitions)]
    );
    let delimiterIndex = 0;
    while (JSON.stringify(configs).includes(`$yunipals_ownership_${delimiterIndex}$`))
      delimiterIndex++;
    const dollar = `$yunipals_ownership_${delimiterIndex}$`;
    await db.query(`CREATE FUNCTION ${target}.source_boundary(selected_collection text)
      RETURNS TABLE(source_id text,collection text,chain_id integer,contract_address text,
        block_number bigint,block_hash text,block_timestamp bigint,observed_at timestamptz,
        heartbeat_at bigint,ready boolean,release_id text,manifest_hash text,policy text)
      LANGUAGE plpgsql STABLE SECURITY INVOKER ROWS 1 SET search_path=pg_catalog AS ${dollar}
      DECLARE config jsonb; v_definition jsonb; observation record; runtime jsonb;
        checkpoint text; indexed bigint; verified bigint; required bigint; available bigint;
        boundary jsonb; clock_ms bigint; source_record record; stored_release record;
      BEGIN
        SELECT value INTO config FROM jsonb_array_elements(${literal2(JSON.stringify(configs))}::jsonb)
          WHERE value->>'collection'=selected_collection;
        IF config IS NULL THEN RAISE EXCEPTION 'source_unknown'; END IF;
        v_definition:=config->'source';
        SELECT r.physical_schema,r.build_id,r.manifest_hash INTO stored_release
          FROM yunipals_indexer_control.release r WHERE r.id=${literal2(release.id)};
        IF NOT FOUND OR stored_release.physical_schema<>${literal2(release.schema)} OR
          stored_release.build_id<>${literal2(release.buildId)} OR stored_release.manifest_hash<>${literal2(release.manifestHash)}
          THEN RAISE EXCEPTION 'release_mismatch'; END IF;
        SELECT s.chain_id,s.manifest_hash,s.definition::jsonb AS definition INTO source_record
          FROM ${sourceSchema}.indexer_source s WHERE s.id=v_definition->>'id';
        IF NOT FOUND OR source_record.chain_id<>(v_definition->>'chainId')::integer
          OR source_record.manifest_hash<>${literal2(release.manifestHash)} OR source_record.definition<>v_definition
          THEN RAISE EXCEPTION 'source_mismatch'; END IF;
        SELECT m.value INTO runtime FROM ${sourceSchema}._ponder_meta m WHERE m.key='app';
        IF runtime IS NULL OR runtime->>'version' IS DISTINCT FROM '6' OR runtime->>'build_id' IS DISTINCT FROM ${literal2(release.buildId)}
          OR runtime->>'is_dev' IS DISTINCT FROM '0' OR runtime->>'is_locked' IS DISTINCT FROM '1'
          OR COALESCE(runtime->>'heartbeat_at','')!~'^[0-9]{1,16}$' THEN RAISE EXCEPTION 'runtime_unavailable'; END IF;
        clock_ms:=floor(extract(epoch FROM statement_timestamp())*1000)::bigint;
        IF (runtime->>'heartbeat_at')::bigint>clock_ms OR clock_ms-(runtime->>'heartbeat_at')::bigint>180000
          THEN RAISE EXCEPTION 'observation_stale'; END IF;
        SELECT s.* INTO observation FROM yunipals_indexer_control.chain_status s
          WHERE s.release_id=${literal2(release.id)} AND s.chain_id=(v_definition->>'chainId')::integer;
        IF NOT FOUND OR observation.halted OR observation.error_code IS NOT NULL
          OR observation.head_number IS NULL OR observation.observed_at_ms IS NULL
          OR observation.head_hash IS NULL OR observation.head_hash!~'^0x[0-9a-f]{64}$'
          OR observation.observed_at_ms>clock_ms OR clock_ms-observation.observed_at_ms>180000
          THEN RAISE EXCEPTION 'source_unavailable'; END IF;
        IF NOT EXISTS(SELECT 1 FROM ${sourceSchema}.chain_block b WHERE b.chain_id=observation.chain_id
          AND b.block_number=observation.witness_number AND b.block_hash=observation.witness_hash)
          THEN RAISE EXCEPTION 'indexer_witness_unverified'; END IF;
        SELECT c.latest_checkpoint INTO checkpoint FROM ${sourceSchema}._ponder_checkpoint c
          WHERE c.chain_id=observation.chain_id;
        IF checkpoint IS NULL OR checkpoint!~'^[0-9]{75}$' OR checkpoint=repeat('0',75)
          OR substring(checkpoint FROM 11 FOR 16)::bigint<>observation.chain_id
          THEN RAISE EXCEPTION 'checkpoint_unavailable'; END IF;
        indexed:=substring(checkpoint FROM 27 FOR 16)::bigint
          -CASE WHEN substring(checkpoint FROM 43)=repeat('9',33) THEN 0 ELSE 1 END;
        IF EXISTS(SELECT 1 FROM jsonb_each(observation.anchors)
          WHERE COALESCE(value->>'number','')!~'^(0|[1-9][0-9]*)$'
            OR COALESCE(value->>'hash','')!~'^0x[0-9a-f]{64}$') THEN RAISE EXCEPTION 'anchor_invalid'; END IF;
        SELECT max((value->>'number')::bigint) INTO verified FROM jsonb_each(observation.anchors);
        indexed:=least(indexed,verified);
        IF verified IS NULL OR indexed>observation.head_number THEN RAISE EXCEPTION 'observation_inconsistent'; END IF;
        required:=observation.head_number;
        IF config->'policy'->>'kind'='depth' THEN
          required:=required-(config->'policy'->>'subsequentBlocks')::bigint;
        ELSIF config->'policy'->>'kind'='finalized' THEN
          IF observation.finality_error_code IS NOT NULL OR observation.finalized_number IS NULL
            THEN RAISE EXCEPTION 'finality_unavailable'; END IF;
          IF observation.finalized_number>observation.head_number OR observation.finalized_hash IS NULL
            OR (observation.finalized_number=observation.head_number AND observation.finalized_hash<>observation.head_hash)
            THEN RAISE EXCEPTION 'observation_inconsistent'; END IF;
          required:=observation.finalized_number;
        END IF;
        IF v_definition->>'endBlock' IS NOT NULL THEN required:=least(required,(v_definition->>'endBlock')::bigint); END IF;
        available:=least(indexed,verified,required);
        IF available<(v_definition->>'startBlock')::bigint THEN RAISE EXCEPTION 'not_indexed'; END IF;
        boundary:=observation.anchors->available::text;
        IF boundary IS NULL OR COALESCE(boundary->>'hash','')!~'^0x[0-9a-f]{64}$'
          OR COALESCE(boundary->>'timestamp','')!~'^(0|[1-9][0-9]*)$'
          THEN RAISE EXCEPTION 'anchor_unavailable'; END IF;
        RETURN QUERY SELECT v_definition->>'id',selected_collection,observation.chain_id,v_definition->>'address',
          available,boundary->>'hash',(boundary->>'timestamp')::bigint,
          to_timestamp(observation.observed_at_ms::numeric/1000),
          (runtime->>'heartbeat_at')::bigint,available>=required,${literal2(release.id)},${literal2(release.manifestHash)},
          CASE WHEN config->'policy'->>'kind'='depth' THEN 'depth:'||(config->'policy'->>'subsequentBlocks')
            ELSE config->'policy'->>'kind' END;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION USING ERRCODE='YI001',MESSAGE='unified_ownership_source_unavailable',DETAIL=SQLERRM;
      END ${dollar}`);
    await db.query(
      `REVOKE ALL ON FUNCTION ${target}.source_boundary(text) FROM PUBLIC`
    );
    await db.query(`CREATE FUNCTION ${target}.source_probe(selected_collection text) RETURNS jsonb
      LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $probe$
      DECLARE boundary record; reason text;
      BEGIN
        SELECT * INTO boundary FROM ${target}.source_boundary(selected_collection);
        RETURN to_jsonb(boundary)||jsonb_build_object('block_number',boundary.block_number::text,
          'block_timestamp',boundary.block_timestamp::text,'heartbeat_at',boundary.heartbeat_at::text,
          'available',true,'reason',CASE WHEN boundary.ready THEN 'ready' ELSE 'catching_up' END);
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS reason=PG_EXCEPTION_DETAIL;
        RETURN jsonb_build_object('collection',selected_collection,'available',false,'ready',false,
          'reason',CASE WHEN reason~'^[a-z_]{1,80}$' THEN reason ELSE 'source_unavailable' END);
      END $probe$`);
    await db.query(
      `REVOKE ALL ON FUNCTION ${target}.source_probe(text) FROM PUBLIC`
    );
    if (nativeBase)
      await createNativeBaseMetadataViews(
        db,
        release,
        readSchema,
        identity,
        nativeBase
      );
    await db.query(
      `CREATE VIEW ${target}.source_status AS ${configs.map(
        (config) => `SELECT s.source_id,${literal2(config.collection)}::text AS collection,s.chain_id,s.contract_address,
      s.block_number,s.block_hash,s.block_timestamp,s.observed_at,s.heartbeat_at,s.ready,s.release_id,s.manifest_hash,s.policy
      FROM ${target}.source_boundary(${literal2(config.collection)}) s`
      ).join(" UNION ALL ")}`
    );
    for (const relation of [
      "token",
      "token_lifecycle",
      "transfer_event",
      "admin_role_event",
      "contract_owner_event"
    ]) {
      const queries = configs.map((config) => {
        const ref = ownershipReference(
          release.schema,
          config.source,
          config.collection
        );
        const boundary = { readSchema, collection: config.collection };
        return relation === "token" ? ownershipTokenSql(ref, boundary) : relation === "token_lifecycle" ? ownershipLifecycleSql(ref, boundary) : ownershipHistorySql(ref, relation, boundary);
      });
      await db.query(
        `CREATE VIEW ${target}.${relation} AS ${queries.map((query) => `(${query})`).join(" UNION ALL ")}`
      );
    }
    await db.query("COMMIT");
    return {
      schema: readSchema,
      releaseId: release.id,
      identity,
      created: true,
      activated: false
    };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

// lib/unified/ownership-config.ts
function ownershipReadDefinitions(release) {
  const definitions = [
    ...Object.values(collections).map((collection) => {
      const sourceId = `ownership:${collection.slug}`;
      const source = release.manifest.sources.find(
        (source2) => source2.id === sourceId
      );
      if (!source?.enabled || source.chainId !== collection.chainId || source.address !== collection.address || source.startBlock !== String(collection.deploymentBlock))
        throw new Error("Ownership deployment manifest mismatch.");
      const depths = source.policies.filter(
        (policy) => policy.kind === "depth"
      );
      if (collection.slug === "bnb" && (depths.length !== 1 || depths[0].subsequentBlocks > 1e3))
        throw new Error("BNB confirmation policy requires review.");
      return {
        collection: collection.slug,
        sourceId,
        policy: collection.slug === "bnb" ? depths[0] : { kind: "latest" }
      };
    }),
    {
      collection: islandCollection.slug,
      sourceId: "islands:ethereum",
      policy: { kind: "latest" }
    }
  ];
  const baseIslands = release.manifest.sources.find(
    (source) => source.id === "islands:base:v2"
  );
  if (baseIslands?.enabled) {
    if (baseIslands.chainId !== baseIslandCollection.chainId || baseIslands.address !== baseIslandCollection.address || baseIslands.startBlock !== String(baseIslandCollection.deploymentBlock))
      throw new Error("Base Islands deployment manifest mismatch.");
    definitions.push({
      collection: baseIslandCollection.slug,
      sourceId: baseIslands.id,
      policy: baseIslandOwnershipPolicy
    });
  }
  return definitions;
}

// scripts/unified-ownership-views.ts
var env = process.env;
if (!env.UNIFIED_INDEXER_DATABASE_URL || !env.UNIFIED_INDEXER_RELEASE_ID || !env.UNIFIED_INDEXER_READ_SCHEMA)
  throw new Error(
    "Set the candidate database, registered release ID and fresh ownership read schema."
  );
var pool = new pg.Pool({
  connectionString: env.UNIFIED_INDEXER_DATABASE_URL,
  max: 2,
  connectionTimeoutMillis: 5e3,
  statement_timeout: 3e4,
  application_name: "unified_ownership_views"
});
try {
  const release = await loadIndexerRelease(
    pool,
    env.UNIFIED_INDEXER_RELEASE_ID
  );
  const result = await createOwnershipReadViews(
    pool,
    release,
    env.UNIFIED_INDEXER_READ_SCHEMA,
    ownershipReadDefinitions(release)
  );
  console.log(
    JSON.stringify({ event: "unified_ownership_candidate_created", ...result })
  );
} catch {
  console.error(
    "Unified ownership candidate creation failed; existing read schemas were not reassigned."
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
//# sourceMappingURL=unified-ownership-views.mjs.map
