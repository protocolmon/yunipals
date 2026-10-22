import type { PoolClient } from "pg";
import {
  marketplaceChains,
  type MarketplaceChain
} from "@protopals/yunipals-market-core/registry";
import { manifestDigest } from "@protopals/yunipals-indexer-server/identity";
import { sqlIdentifier } from "@protopals/yunipals-indexer-server/database";
import { ownershipReference } from "@protopals/yunipals-indexer-server/ownership";
import {
  createIndexerReader,
  type RegisteredRelease
} from "@protopals/yunipals-indexer-server/readers";
import { BnbOrderError } from "@/bnb/orders";
import {
  marketplaceOwnershipDefinition,
  marketplaceOwnershipIndexer
} from "@/indexer/ownership";

export function marketplaceOwnershipSqlRelations() {
  const indexer = marketplaceOwnershipIndexer();
  const schema = indexer
    ? sqlIdentifier(indexer.readSchema)
    : "yunipals_read_v4";
  return {
    mode: indexer ? ("unified" as const) : ("legacy" as const),
    tokenRelation: `${schema}.token`,
    transferRelation: `${schema}.transfer_event`
  };
}
export type MarketplaceOwnershipSqlContext = ReturnType<
  typeof marketplaceOwnershipSqlRelations
> & {
  releaseId?: string;
  anchors?: Partial<Record<MarketplaceChain, { number: string; hash: string }>>;
};
type Db = Pick<PoolClient, "query">;
export type Marker = {
  identity: string;
  release_id: string;
  manifest_hash: string;
  definitions: {
    collection: string;
    sourceId: string;
    policy: { kind: string; subsequentBlocks?: number };
  }[];
};
const relations = [
  "token",
  "transfer_event",
  "token_lifecycle",
  "source_status",
  "_unified_read_release"
];
const databaseIdentitySql =
  "SELECT current_database() AS database,inet_server_addr()::text AS host,inet_server_port() AS port";

/** Read-view labels cannot turn copied tables or views over another physical
 * dataset into the registered source. Owners remain trusted administrators. */
export async function assertSourceReadProvenance(
  db: Db,
  release: RegisteredRelease,
  readSchema: string,
  marker: Marker
) {
  const objects = await db.query<{
    relname: string;
    relkind: string;
    relowner: number;
    dependencies: string[];
    functions: string[];
  }>(
    `SELECT c.relname,c.relkind,c.relowner,
    ARRAY(SELECT DISTINCT target_ns.nspname||'.'||target.relname
      FROM pg_rewrite rule JOIN pg_depend dependency ON dependency.classid='pg_rewrite'::regclass AND dependency.objid=rule.oid
      JOIN pg_class target ON dependency.refclassid='pg_class'::regclass AND target.oid=dependency.refobjid
      JOIN pg_namespace target_ns ON target_ns.oid=target.relnamespace
      WHERE rule.ev_class=c.oid AND target.oid<>c.oid ORDER BY 1) AS dependencies,
    ARRAY(SELECT DISTINCT fn_ns.nspname||'.'||fn.proname
      FROM pg_rewrite rule JOIN pg_depend dependency ON dependency.classid='pg_rewrite'::regclass AND dependency.objid=rule.oid
      JOIN pg_proc fn ON dependency.refclassid='pg_proc'::regclass AND fn.oid=dependency.refobjid
      JOIN pg_namespace fn_ns ON fn_ns.oid=fn.pronamespace
      WHERE rule.ev_class=c.oid AND fn_ns.nspname<>'pg_catalog' ORDER BY 1) AS functions
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND c.relname=ANY($2::text[])`,
    [readSchema, relations]
  );
  const markerObject = objects.rows.find(
    (row) => row.relname === "_unified_read_release"
  );
  if (objects.rows.length !== relations.length || markerObject?.relkind !== "r")
    throw new Error("Read source provenance is incomplete.");
  const physical: Record<string, string[]> = {
    token: [
      `${release.schema}.token`,
      `${release.schema}.token_lifecycle`,
      `${release.schema}.transfer_event`
    ].sort(),
    token_lifecycle: [`${release.schema}.token_lifecycle`],
    transfer_event: [`${release.schema}.transfer_event`],
    source_status: []
  };
  for (const row of objects.rows) {
    if (row.relowner !== markerObject.relowner)
      throw new Error(
        "Read source ownership differs from the registered marker."
      );
    if (row.relname === "_unified_read_release") continue;
    if (
      row.relkind !== "v" ||
      manifestDigest(row.dependencies) !==
        manifestDigest(physical[row.relname]) ||
      manifestDigest(row.functions) !==
        manifestDigest([`${readSchema}.source_boundary`])
    )
      throw new Error(
        "Read view dependencies differ from the registered source."
      );
  }
  const boundary = (
    await db.query<{
      prosrc: string;
      prosecdef: boolean;
      provolatile: string;
      proconfig: string[];
      proowner: number;
      language: string;
    }>(
      `SELECT p.prosrc,p.prosecdef,p.provolatile,p.proconfig,p.proowner,l.lanname AS language FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure($1)`,
      [`${sqlIdentifier(readSchema)}.source_boundary(text)`]
    )
  ).rows[0];
  if (
    !boundary ||
    boundary.prosecdef ||
    boundary.provolatile !== "s" ||
    boundary.language !== "plpgsql" ||
    boundary.proowner !== markerObject.relowner ||
    manifestDigest(boundary.proconfig) !==
      manifestDigest(["search_path=pg_catalog"])
  )
    throw new Error("Read boundary function is not the qualified invoker.");
  const encoded = /jsonb_array_elements\('((?:[^']|'')*)'::jsonb\)/.exec(
    boundary.prosrc
  )?.[1];
  if (!encoded) throw new Error("Read boundary configuration is missing.");
  const expected = marker.definitions
    .map((definition) => {
      const source = release.manifest.sources.find(
        (source) => source.id === definition.sourceId
      );
      if (!source) throw new Error("Read boundary source is missing.");
      return {
        ...definition,
        source: ownershipReference(
          release.schema,
          source,
          definition.collection
        ).source
      };
    })
    .sort((a, b) => a.collection.localeCompare(b.collection));
  if (
    manifestDigest(JSON.parse(encoded.replaceAll("''", "'"))) !==
    manifestDigest(expected)
  )
    throw new Error(
      "Read boundary configuration differs from its registered source."
    );
  const body = boundary.prosrc;
  for (const relation of [
    "indexer_source",
    "_ponder_meta",
    "_ponder_checkpoint",
    "chain_block"
  ])
    if (!body.includes(`${sqlIdentifier(release.schema)}.${relation}`))
      throw new Error("Read boundary references another physical source.");
  if (
    !body.includes(`r.id='${release.id}'`) ||
    !body.includes(`stored_release.manifest_hash<>'${release.manifestHash}'`) ||
    !body.includes(`runtime->>'build_id' IS DISTINCT FROM '${release.buildId}'`)
  )
    throw new Error("Read boundary release binding differs.");
}

/** Validate a direct source connection or a read-only FDW mirror of this exact
 * candidate. This never reassigns the deployed compatibility schemas. */
export async function marketplaceOwnershipSqlContext(
  db: Db,
  collections: readonly MarketplaceChain[] = Object.keys(
    marketplaceChains
  ) as MarketplaceChain[]
): Promise<MarketplaceOwnershipSqlContext> {
  const sql = marketplaceOwnershipSqlRelations();
  const indexer = marketplaceOwnershipIndexer();
  if (!indexer) return sql;
  const selected = [...new Set(collections)];
  if (
    !selected.length ||
    selected.some((name) => !Object.hasOwn(marketplaceChains, name))
  )
    throw new BnbOrderError("indexer_unavailable", 503);
  try {
    const reader = await createIndexerReader(indexer.pool, {
      releaseId: indexer.releaseId
    });
    const target = sqlIdentifier(indexer.readSchema);
    const markerSql = `SELECT identity,release_id,manifest_hash,definitions FROM ${target}._unified_read_release WHERE singleton`;
    const marker = (await indexer.pool.query<Marker>(markerSql)).rows[0];
    if (
      !marker ||
      !/^0x[0-9a-f]{64}$/.test(marker.identity) ||
      marker.release_id !== reader.release.id ||
      marker.manifest_hash !== reader.release.manifestHash ||
      !Array.isArray(marker.definitions)
    )
      throw new Error("Read view source binding mismatch.");
    for (const collection of selected) {
      const definition = marketplaceOwnershipDefinition(
        reader.release,
        collection
      );
      const matches = marker.definitions.filter(
        (row) => row.collection === collection
      );
      if (
        matches.length !== 1 ||
        manifestDigest(matches[0]) !== manifestDigest(definition)
      )
        throw new Error("Read view ownership policy mismatch.");
    }
    await assertSourceReadProvenance(
      indexer.pool,
      reader.release,
      indexer.readSchema,
      marker
    );
    const local = (await db.query<Marker>(markerSql)).rows[0];
    if (!local || manifestDigest(local) !== manifestDigest(marker))
      throw new Error("Query database read view binding mismatch.");
    const sourceIdentity = (await indexer.pool.query(databaseIdentitySql))
      .rows[0];
    const localIdentity = (await db.query(databaseIdentitySql)).rows[0];
    if (manifestDigest(sourceIdentity) !== manifestDigest(localIdentity)) {
      const mapping = await db.query<{
        relname: string;
        relkind: string;
        server: number;
        host: string | null;
        port: string | null;
        database: string | null;
        schema: string | null;
        table: string | null;
      }>(
        `SELECT c.relname,c.relkind,f.ftserver AS server,
        (SELECT option_value FROM pg_options_to_table(s.srvoptions) WHERE option_name='host') AS host,
        (SELECT option_value FROM pg_options_to_table(s.srvoptions) WHERE option_name='port') AS port,
        (SELECT option_value FROM pg_options_to_table(s.srvoptions) WHERE option_name='dbname') AS database,
        (SELECT option_value FROM pg_options_to_table(f.ftoptions) WHERE option_name='schema_name') AS schema,
        (SELECT option_value FROM pg_options_to_table(f.ftoptions) WHERE option_name='table_name') AS table
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_foreign_table f ON f.ftrelid=c.oid LEFT JOIN pg_foreign_server s ON s.oid=f.ftserver
        WHERE n.nspname=$1 AND c.relname=ANY($2::text[])`,
        [indexer.readSchema, relations]
      );
      const url = new URL(indexer.databaseUrl);
      const server = mapping.rows[0]?.server;
      if (
        mapping.rows.length !== relations.length ||
        !server ||
        mapping.rows.some(
          (row) =>
            row.relkind !== "f" ||
            row.server !== server ||
            row.host !== url.hostname ||
            Number(row.port ?? 5432) !== Number(url.port || 5432) ||
            row.database !== decodeURIComponent(url.pathname.slice(1)) ||
            row.schema !== indexer.readSchema ||
            (row.table ?? row.relname) !== row.relname
        )
      )
        throw new Error("FDW source mapping mismatch.");
    }
    const status = await db.query<{
      collection: string;
      source_id: string;
      release_id: string;
      manifest_hash: string;
      policy: string;
      ready: boolean;
      block_number: string;
      block_hash: string;
    }>(
      `SELECT collection,source_id,release_id,manifest_hash,policy,ready,block_number::text,block_hash FROM ${target}.source_status WHERE collection=ANY($1::text[])`,
      [selected]
    );
    if (
      status.rows.length !== selected.length ||
      new Set(status.rows.map((row) => row.collection)).size !==
        selected.length ||
      status.rows.some((row) => {
        const definition = marketplaceOwnershipDefinition(
          reader.release,
          row.collection
        );
        const policy =
          definition.policy.kind === "depth"
            ? `depth:${definition.policy.subsequentBlocks}`
            : definition.policy.kind;
        return (
          !row.ready ||
          row.source_id !== definition.sourceId ||
          row.release_id !== reader.release.id ||
          row.manifest_hash !== reader.release.manifestHash ||
          row.policy !== policy
        );
      })
    )
      throw new Error("Read view ownership source is not ready.");
    // Current shared status is checked outside a held catalog/FDW snapshot too.
    for (const row of status.rows) {
      if (
        !/^(0|[1-9][0-9]*)$/.test(row.block_number) ||
        !/^0x[0-9a-f]{64}$/.test(row.block_hash)
      )
        throw new Error("Invalid held source anchor.");
      await indexer.assertCheckpoint(row.collection, {
        number: BigInt(row.block_number),
        hash: row.block_hash
      });
    }
    return {
      ...sql,
      releaseId: reader.release.id,
      anchors: Object.fromEntries(
        status.rows.map((row) => [
          row.collection,
          { number: row.block_number, hash: row.block_hash }
        ])
      )
    };
  } catch (error) {
    if (error instanceof BnbOrderError) throw error;
    throw new BnbOrderError("indexer_unavailable", 503);
  }
}
