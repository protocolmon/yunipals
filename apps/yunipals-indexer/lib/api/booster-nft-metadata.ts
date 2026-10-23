import type { Hono } from "hono";
import type { Pool, PoolClient } from "pg";
import { isAddress } from "viem";
import { boosterIdentity } from "../../../../packages/yunipals-market-core/src/boosters.js";
import { BoosterArtworkStore } from "../boosters/artwork.js";
import {
  boosterDeployment,
  type BoosterDeployment
} from "../boosters/config.js";
import { boosterReadiness } from "../boosters/readiness.js";
import { sqlIdentifier } from "../offchain/sql.js";

type Monster = {
  id: string;
  collection: string;
  tokenId: string;
  originalKey: string;
  typeKey: string;
  variantId: string;
  monsterType: string;
  color: string;
  horn: string;
  glitter: string;
  isOriginal: boolean;
  mintedTo: string;
  mintBlock: string;
};
type MintEvent = {
  id: string;
  address: string;
  name: string;
  args: string;
  blockNumber: string;
  blockHash: string;
  timestamp: string;
  transactionHash: string;
  logIndex: number;
};
type Row = {
  monster: Monster;
  original: Monster | null;
  pack: {
    id: string;
    packTypeId: string;
    registry: string;
    engine: string;
    catalogHash: string;
    metadataBaseUri: string;
  } | null;
  mintEvents: MintEvent[];
  originalMintEvents: MintEvent[];
};
type Snapshot = Extract<
  Awaited<ReturnType<typeof boosterReadiness>>,
  { ready: true }
>;
const decimal = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(0|[1-9][0-9]{0,77})$/.test(value) &&
  BigInt(value) < 2n ** 256n;
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value);
function requireProvenance(value: unknown): asserts value {
  if (!value) throw new Error("Booster birth provenance unavailable");
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function monsterJson(alias: string) {
  return `jsonb_build_object('id',${alias}.id,'collection',${alias}.collection,
    'tokenId',${alias}.token_id,'originalKey',${alias}.original_key,'typeKey',${alias}.type_key,
    'variantId',${alias}.variant_id::text,'monsterType',${alias}.monster_type::text,
    'color',${alias}.color::text,'horn',${alias}.horn::text,'glitter',${alias}.glitter::text,
    'isOriginal',${alias}.is_original,'mintedTo',${alias}.minted_to,'mintBlock',${alias}.mint_block::text)`;
}
function mintEventsSql(schema: string, alias: string) {
  // Keep the journal's original JSON text. JSONB alone would hide duplicate
  // keys; the exact source serialization is verified before metadata is served.
  return `(SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'address',e.address,
    'name',e.name,'args',e.args,'blockNumber',e.block_number::text,'blockHash',e.block_hash,
    'timestamp',e.timestamp::text,'transactionHash',e.transaction_hash,'logIndex',e.log_index)), '[]'::jsonb)
    FROM (SELECT * FROM ${schema}.booster_event
      WHERE name='MonsterMinted' AND address=$2 AND block_number=${alias}.mint_block
        AND block_number<=$3::bigint AND args::jsonb->>'tokenId'=${alias}.token_id
      ORDER BY log_index LIMIT 2) e)`;
}

function verifyMint(
  monster: Monster,
  originalId: string,
  packTypeId: string,
  events: MintEvent[],
  snapshot: Snapshot
) {
  requireProvenance(Array.isArray(events) && events.length === 1);
  const event = events[0];
  requireProvenance(
    event &&
      event.name === "MonsterMinted" &&
      event.address === monster.collection &&
      decimal(event.blockNumber) &&
      event.blockNumber === monster.mintBlock &&
      BigInt(event.blockNumber) <= BigInt(snapshot.indexedBlock) &&
      hash(event.blockHash) &&
      hash(event.transactionHash) &&
      Number.isSafeInteger(event.logIndex) &&
      event.logIndex >= 0 &&
      event.id ===
        `${event.blockHash}:${event.transactionHash}:${event.logIndex}` &&
      decimal(event.timestamp) &&
      BigInt(event.timestamp) > 0n &&
      BigInt(event.timestamp) <= BigInt(snapshot.indexedTimestamp) &&
      BigInt(event.timestamp) <= BigInt(Number.MAX_SAFE_INTEGER)
  );
  const args: unknown = JSON.parse(event.args);
  const keys = [
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
  ];
  requireProvenance(
    object(args) &&
      JSON.stringify(args) === event.args &&
      Object.keys(args).length === keys.length &&
      keys.every((key) => Object.hasOwn(args, key)) &&
      typeof args.tokenId === "string" &&
      args.tokenId === monster.tokenId &&
      typeof args.originalTokenId === "string" &&
      args.originalTokenId === originalId &&
      typeof args.packTypeId === "string" &&
      args.packTypeId === packTypeId &&
      typeof args.recipient === "string" &&
      isAddress(args.recipient) &&
      args.recipient.toLowerCase() === monster.mintedTo &&
      typeof args.isOriginal === "boolean" &&
      args.isOriginal === monster.isOriginal
  );
  for (const field of [
    "variantId",
    "monsterType",
    "color",
    "horn",
    "glitter"
  ] as const)
    requireProvenance(
      typeof args[field] === "number" &&
        Number.isInteger(args[field]) &&
        args[field] >= 0 &&
        args[field] <= 0xffffffff &&
        String(args[field]) === monster[field]
    );
  return event;
}

function verifyBirth(
  row: Row,
  deployment: BoosterDeployment,
  tokenId: string,
  snapshot: Snapshot
) {
  const { monster, original, pack } = row;
  requireProvenance(
    monster &&
      original &&
      pack &&
      monster.id === boosterIdentity(deployment.monsters, tokenId) &&
      monster.tokenId === tokenId &&
      monster.collection === deployment.monsters &&
      original.collection === deployment.monsters &&
      decimal(original.tokenId) &&
      original.id === boosterIdentity(deployment.monsters, original.tokenId) &&
      monster.originalKey === original.id &&
      original.originalKey === original.id &&
      original.isOriginal === true &&
      monster.isOriginal === (monster.id === original.id) &&
      monster.typeKey === original.typeKey &&
      decimal(pack.packTypeId) &&
      pack.id === boosterIdentity(deployment.registry, pack.packTypeId) &&
      pack.id === monster.typeKey &&
      pack.engine === deployment.engine &&
      pack.registry === deployment.registry &&
      hash(pack.catalogHash) &&
      decimal(monster.variantId) &&
      decimal(monster.mintBlock) &&
      decimal(original.mintBlock)
  );
  const born = verifyMint(
    monster,
    original.tokenId,
    pack.packTypeId,
    row.mintEvents,
    snapshot
  );
  const originalBorn = verifyMint(
    original,
    original.tokenId,
    pack.packTypeId,
    row.originalMintEvents,
    snapshot
  );
  requireProvenance(
    BigInt(originalBorn.blockNumber) <= BigInt(born.blockNumber) &&
      BigInt(originalBorn.timestamp) <= BigInt(born.timestamp) &&
      (originalBorn.blockNumber !== born.blockNumber ||
        (originalBorn.blockHash === born.blockHash &&
          originalBorn.timestamp === born.timestamp)) &&
      (monster.isOriginal ||
        originalBorn.blockNumber !== born.blockNumber ||
        originalBorn.logIndex < born.logIndex)
  );
  return {
    monster,
    original,
    pack,
    born,
    originalBorn,
    birthDay: Number(
      (BigInt(born.timestamp) - BigInt(originalBorn.timestamp)) / 86400n
    )
  };
}

function witness(event: MintEvent) {
  return {
    eventId: event.id,
    blockNumber: event.blockNumber,
    blockHash: event.blockHash,
    transactionHash: event.transactionHash,
    logIndex: event.logIndex
  };
}

/** Additive route only. Callers register this after the current API release;
 * it does not modify legacy shared-variant metadata or enqueue artwork. */
export function registerBoosterNftMetadataRoutes(
  app: Hono,
  dependencies: {
    pool: Pick<Pool, "connect">;
    schemaName: string;
    store: BoosterArtworkStore;
    catalogs: string[];
    readSnapshot?: (
      client: Pick<PoolClient, "query">,
      deployment: BoosterDeployment
    ) => ReturnType<typeof boosterReadiness>;
  }
) {
  const schema = sqlIdentifier(dependencies.schemaName);
  const { catalogs, store } = dependencies;
  if (
    !catalogs.length ||
    catalogs.length > 32 ||
    new Set(catalogs).size !== catalogs.length ||
    catalogs.some((slug) => !/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug))
  )
    throw new Error("Configured booster artwork catalogs are required");
  app.get("/v1/boosters/metadata/:collection/:file", async (c) => {
    c.header("Cache-Control", "no-store");
    const { collection, file } = c.req.param();
    const tokenId = file.endsWith(".json") ? file.slice(0, -5) : "";
    if (!isAddress(collection) || !decimal(tokenId))
      return c.json({ error: "invalid_monster_identity" }, 400);
    try {
      const deployment = boosterDeployment();
      if (!deployment) return c.json({ error: "boosters_not_configured" }, 503);
      if (collection.toLowerCase() !== deployment.monsters)
        return c.json({ error: "invalid_monster_identity" }, 400);
      const client = await dependencies.pool.connect();
      let verified: ReturnType<typeof verifyBirth> | null = null;
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const snapshot = dependencies.readSnapshot
          ? await dependencies.readSnapshot(client, deployment)
          : await boosterReadiness(
              client,
              dependencies.schemaName,
              deployment.engine
            );
        requireProvenance(snapshot.ready);
        const result = await client.query<Row>(
          `SELECT ${monsterJson("m")} AS monster,
          CASE WHEN o.id IS NULL THEN NULL ELSE ${monsterJson("o")} END AS original,
          CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('id',p.id,'packTypeId',p.pack_type_id,
            'registry',p.registry,'engine',p.engine,'catalogHash',p.catalog_hash,'metadataBaseUri',p.metadata_base_uri) END AS pack,
          ${mintEventsSql(schema, "m")} AS "mintEvents",${mintEventsSql(schema, "o")} AS "originalMintEvents"
          FROM ${schema}.booster_monster m
          LEFT JOIN ${schema}.booster_monster o ON o.id=m.original_key AND o.collection=$2
          LEFT JOIN ${schema}.booster_type p ON p.id=m.type_key
          WHERE m.id=$1 AND m.collection=$2`,
          [
            boosterIdentity(deployment.monsters, tokenId),
            deployment.monsters,
            snapshot.indexedBlock
          ]
        );
        requireProvenance(result.rows.length <= 1);
        if (result.rows[0])
          verified = verifyBirth(result.rows[0], deployment, tokenId, snapshot);
        await client.query("COMMIT");
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* Preserve the original refusal. */
        }
        throw error;
      } finally {
        client.release();
      }
      if (!verified) return c.json({ error: "monster_not_indexed" }, 404);
      // Disk/catalog work happens after releasing the read-only DB snapshot.
      const matching = [];
      for (const slug of catalogs) {
        const catalog = await store.catalog(slug);
        if (
          catalog.catalogHash === verified.pack.catalogHash &&
          catalog.metadataBaseURI === verified.pack.metadataBaseUri
        )
          matching.push({ slug, catalog });
      }
      requireProvenance(matching.length === 1);
      const { slug, catalog } = matching[0];
      const rank = Number(verified.monster.variantId);
      const decoded = store.decode(catalog, rank);
      requireProvenance(
        decoded.ids.every(
          (id, i) =>
            id ===
            [
              verified.monster.monsterType,
              verified.monster.color,
              verified.monster.horn,
              verified.monster.glitter
            ][i]
        )
      );
      const artwork = await store.metadata(slug, rank);
      const document: unknown = artwork.document;
      requireProvenance(
        object(document) &&
          (document.attributes === undefined ||
            Array.isArray(document.attributes)) &&
          (document.yunipals === undefined || object(document.yunipals))
      );
      const attributes = (document.attributes ?? []) as Record<
        string,
        unknown
      >[];
      requireProvenance(
        attributes.every(
          (attribute) =>
            object(attribute) &&
            !["Birth day", "Born"].includes(String(attribute.trait_type))
        )
      );
      if (!artwork.ready) c.header("Retry-After", "5");
      return c.json(
        {
          ...document,
          attributes: [
            ...attributes,
            {
              trait_type: "Birth day",
              display_type: "number",
              value: verified.birthDay
            },
            {
              trait_type: "Born",
              display_type: "date",
              value: Number(verified.born.timestamp)
            }
          ],
          yunipals: {
            ...(document.yunipals ?? {}),
            birthMetadataVersion: 1,
            chainId: 8453,
            collection: deployment.monsters,
            tokenId,
            originalTokenId: verified.original.tokenId,
            isOriginal: verified.monster.isOriginal,
            birthDay: verified.birthDay,
            bornAt: verified.born.timestamp,
            originalBornAt: verified.originalBorn.timestamp,
            mint: witness(verified.born),
            originalMint: witness(verified.originalBorn)
          }
        },
        artwork.ready ? 200 : 202
      );
    } catch {
      return c.json({ error: "booster_birth_metadata_unavailable" }, 503);
    }
  });
}
