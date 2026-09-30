import assert from "node:assert/strict";
import pg from "pg";

const url = new URL(process.env.DATABASE_URL ?? "");
if (
  url.pathname !== "/yunipals_rarity_test" ||
  !["localhost", "127.0.0.1"].includes(url.hostname)
)
  throw new Error("Use the disposable loopback yunipals_rarity_test database");
Object.assign(process.env, {
  DATABASE_SCHEMA: "rarity_physical",
  READ_DATABASE_SCHEMA: "rarity_read",
  BNB_DATABASE_SCHEMA: "rarity_bnb",
  METADATA_SOURCE_MODE: "archive",
  YUNIPALS_PROJECTION_MODE: "generation"
});
const { rarityPageQueries } = await import("../lib/api/rarity-page-query.ts");
const {
  metadataRawSearchReadRelationAt,
  metadataSearchReadRelationAt,
  metadataSearchReadRelationFor,
  metadataTraitReadRelationAt,
  metadataRawTraitReadRelationAt
} = await import("../lib/metadata/read-source.ts");
const { projectionSchemaStatements } = await import(
  "../lib/metadata/projection-schema.ts"
);
const { installReadCache } = await import(
  "../lib/metadata/read-cache-schema.ts"
);
const {
  buildReadCache,
  readCacheFreshSql,
  cachedSearchReadRelation,
  cachedSearchReadRelationFor,
  cachedMissingKeys
} = await import("../lib/metadata/read-cache.ts");
const { activeVisibilityPredicate } = await import(
  "../lib/api/visibility-query.ts"
);
const db = new pg.Pool({
  connectionString: url.toString(),
  statement_timeout: 5000
});
const owner = "0x1111111111111111111111111111111111111111";
const zero = "0x0000000000000000000000000000000000000000";
const chains = ["ethereum", "base", "polygon", "bnb"];
try {
  await db.query(`DROP SCHEMA IF EXISTS rarity_physical,rarity_bnb,rarity_read,metadata,metadata_source,metadata_projection CASCADE;
    CREATE SCHEMA rarity_physical; CREATE SCHEMA rarity_bnb; CREATE SCHEMA rarity_read;
    CREATE SCHEMA metadata; CREATE SCHEMA metadata_source;
    CREATE TABLE rarity_physical.token(collection text,token_id text,lifecycle integer,owner text,burned boolean,
      PRIMARY KEY(collection,token_id));
    CREATE TABLE rarity_bnb.token(LIKE rarity_physical.token INCLUDING ALL);
    CREATE TABLE rarity_physical.token_lifecycle(collection text,token_id text,lifecycle integer,
      mint_transaction_hash text,mint_block bigint,PRIMARY KEY(collection,token_id,lifecycle));
    CREATE TABLE rarity_bnb.token_lifecycle(LIKE rarity_physical.token_lifecycle INCLUDING ALL);
    CREATE TABLE rarity_physical.transfer_event(id text PRIMARY KEY,collection text,token_id text,lifecycle integer,
      "from" text,"to" text,block_number bigint,transaction_hash text,transaction_index integer,log_index integer);
    CREATE TABLE rarity_bnb.transfer_event(LIKE rarity_physical.transfer_event INCLUDING ALL);
    CREATE VIEW rarity_read.token AS SELECT * FROM rarity_physical.token UNION ALL SELECT * FROM rarity_bnb.token;
    CREATE VIEW rarity_read.token_lifecycle AS SELECT * FROM rarity_physical.token_lifecycle UNION ALL SELECT * FROM rarity_bnb.token_lifecycle;
    CREATE VIEW rarity_read.transfer_event AS SELECT * FROM rarity_physical.transfer_event UNION ALL SELECT * FROM rarity_bnb.transfer_event;
    CREATE TABLE metadata.token_metadata(collection text,token_id numeric,lifecycle integer,document jsonb,
      content_hash text,fetch_status text DEFAULT 'success',PRIMARY KEY(collection,token_id,lifecycle));
    CREATE TABLE metadata.token_publication(collection text,token_id numeric,lifecycle integer,source_kind text,
      release_id text,asset_key text,renderer_version text,input_hash text,publication_content_hash text,
      publication_status text,publication_error text,published_at timestamptz,mint_transaction_hash text,
      mint_log_index integer,chain_event_key text,PRIMARY KEY(collection,token_id,lifecycle));
    CREATE TABLE metadata.token_search(collection text,token_id numeric,lifecycle integer,metadata_available boolean,
      rarity_points numeric,rarity_points_capped numeric,PRIMARY KEY(collection,token_id,lifecycle));
    CREATE TABLE metadata.projection_revision(collection text,token_id numeric,lifecycle integer,metadata_content_hash text,
      PRIMARY KEY(collection,token_id,lifecycle));
    CREATE TABLE metadata.token_trait(collection text,token_id numeric,lifecycle integer,trait_type text,value text,value_numeric numeric);
    CREATE TABLE metadata.trait_facet(scope text,trait_type text);
    CREATE TABLE metadata.trait_facet_status(scope text);
    CREATE TABLE metadata.token_visibility(collection text,token_id numeric,owner text,lifecycle integer,
      anchor_event_id text,anchor_block bigint,anchor_transaction_index integer,anchor_log_index integer);
    CREATE TABLE metadata.publication_runtime(singleton boolean,base_error text);
    INSERT INTO metadata.publication_runtime VALUES(true,NULL);
    CREATE TABLE metadata_source.archive_release(release_id text PRIMARY KEY,state text);
    INSERT INTO metadata_source.archive_release VALUES('fixture','active'),('old','superseded');
    CREATE TABLE metadata_source.chain_metadata_scan(name text,chain_id integer,contract_address text,next_block bigint);
    INSERT INTO metadata_source.chain_metadata_scan VALUES('base_metadata_v1',8453,'contract',1000);
    CREATE TABLE metadata_source.chain_metadata_event(token_id text,chain_id integer,contract_address text,
      block_number bigint,transaction_hash text,transaction_index integer,log_index integer);`);
  for (const sql of projectionSchemaStatements) await db.query(sql);
  await db.query(`INSERT INTO metadata_projection.generation(source_mode,metadata_release_id,state)
    VALUES('archive','fixture','ready'),('archive','fixture','ready');
    UPDATE metadata_projection.active SET current_id=2,previous_id=1;`);
  for (const chain of chains) {
    const schema = chain === "bnb" ? "rarity_bnb" : "rarity_physical";
    for (let i = 1; i <= 18; i++) {
      const id = i === 18 ? (2n ** 255n + 1n).toString() : String(i);
      const hash = `${chain}-${id}`;
      await db.query(`INSERT INTO ${schema}.token VALUES($1,$2,1,$3,$4)`, [
        chain,
        id,
        i === 13 ? zero : owner,
        i === 13
      ]);
      await db.query(
        `INSERT INTO ${schema}.token_lifecycle VALUES($1,$2,1,$3,10)`,
        [chain, id, hash]
      );
      await db.query(
        `INSERT INTO ${schema}.transfer_event VALUES($1,$2,$3,1,$4,$5,10,$6,0,0)`,
        [hash, chain, id, zero, owner, hash]
      );
      if (chain === "base")
        await db.query(
          "INSERT INTO metadata_source.chain_metadata_event VALUES($1,8453,'contract',20,$2,0,0)",
          [id, hash]
        );
      if (i === 12) continue; // Current token with no published search row.
      await db.query(
        `INSERT INTO metadata.token_metadata(collection,token_id,lifecycle,document,content_hash) VALUES($1,$2,1,$3::jsonb,$4)`,
        [
          chain,
          id,
          JSON.stringify({ id, name: "Fixture", attributes: [] }),
          hash
        ]
      );
      await db.query(
        `INSERT INTO metadata.token_publication VALUES($1,$2,1,'archive',$3,NULL,'fixture',NULL,$4,$5,NULL,now(),$6,0,$7)`,
        [
          chain,
          id,
          i === 9 ? "old" : "fixture",
          hash,
          i === 10 ? "unavailable" : "published",
          i === 8 ? "wrong-mint" : hash,
          `${hash}:0`
        ]
      );
      await db.query(
        `INSERT INTO metadata_projection.search VALUES(2,$1,$2,1,true,$3,$4),(1,$1,$2,1,true,999,999)`,
        [
          chain,
          id,
          i === 5 ? null : `${Math.floor(i / 3)}.000000000000000001`,
          i === 6 ? null : String(i % 4)
        ]
      );
      await db.query(
        `INSERT INTO metadata_projection.revision VALUES(2,$1,$2,1,$3),(1,$1,$2,1,$3)`,
        [chain, id, i === 7 ? "wrong-revision" : hash]
      );
      if (i === 4)
        await db.query(
          "UPDATE metadata_projection.search SET metadata_available=false WHERE generation_id=2 AND collection=$1 AND token_id=$2",
          [chain, id]
        );
      await db.query(
        `INSERT INTO metadata_projection.trait(generation_id,collection,token_id,lifecycle,trait_type,value)
        VALUES(2,$1,$2,1,'Color',$3)`,
        [chain, id, i % 2 ? "Blue" : "Red"]
      );
      if (i === 3)
        await db.query(
          `INSERT INTO metadata_projection.trait(generation_id,collection,token_id,lifecycle,trait_type,value)
          VALUES(2,$1,$2,1,'Color','Red')`,
          [chain, id]
        );
      if (i === 11)
        await db.query(
          "UPDATE metadata.token_metadata SET content_hash='changed' WHERE collection=$1 AND token_id=$2",
          [chain, id]
        );
      if (i === 14)
        await db.query(
          "UPDATE metadata.token_metadata SET document='{}' WHERE collection=$1 AND token_id=$2",
          [chain, id]
        );
      if (i === 15)
        await db.query(
          `UPDATE ${schema}.token SET lifecycle=2 WHERE collection=$1 AND token_id=$2`,
          [chain, id]
        );
      if (i === 16)
        await db.query(
          `INSERT INTO metadata.token_visibility VALUES($1,$2,$3,1,$4,10,0,0)`,
          [chain, id, owner, hash]
        );
      if (i === 17) {
        await db.query(
          `INSERT INTO metadata.token_visibility VALUES($1,$2,$3,1,$4,10,0,0)`,
          [chain, id, owner, hash]
        );
        await db.query(
          `UPDATE ${schema}.token SET owner=$3 WHERE collection=$1 AND token_id=$2`,
          [chain, id, zero]
        );
      }
    }
  }
  const installer = await db.connect();
  try {
    await installer.query("BEGIN");
    await installReadCache(installer);
    await installer.query("COMMIT");
    for (const chain of chains) await buildReadCache(installer, "2", chain);
  } finally {
    installer.release();
  }
  const validated = metadataSearchReadRelationAt("2");
  await db.query("SET work_mem='32MB'");
  await db.query("SET jit=off");
  let cases = 0;
  for (const cached of [false, true])
    for (const selected of [["bnb"], chains])
      for (const sort of [
        "rarity-desc",
        "rarity-asc",
        "rarity-capped-desc",
        "rarity-capped-asc"
      ])
        for (const metadata of ["all", "available", "missing"])
          for (const filter of [
            "none",
            "owner",
            "trait",
            "trait-values",
            "rank-range",
            "other-range"
          ]) {
            const isTrait = filter.startsWith("trait");
            const traitValues =
              filter === "trait-values"
                ? "ARRAY['Blue','Red']"
                : "ARRAY['Blue']";
            const selective = filter === "owner" || isTrait;
            const relations =
              selected.length === 1
                ? ["rarity_bnb.token"]
                : ["rarity_physical.token", "rarity_bnb.token"];
            const score = sort.startsWith("rarity-capped")
              ? "rarity_points_capped"
              : "rarity_points";
            const direction = sort.endsWith("desc") ? "DESC" : "ASC";
            const initial = [selected];
            const filters = [
              "t.collection=ANY($1::text[])",
              `NOT ${activeVisibilityPredicate()}`
            ];
            if (metadata !== "all") {
              initial.push(metadata === "available");
              filters.push("COALESCE(s.metadata_available,false)=$2");
            }
            if (filter === "owner")
              filters.push(`t.owner='${owner}' AND t.token_id::numeric<100`);
            if (isTrait)
              filters.push(`EXISTS(SELECT 1 FROM ${metadataTraitReadRelationAt("2")} f
      WHERE f.collection=t.collection AND f.token_id=t.token_id::numeric AND f.lifecycle=t.lifecycle
        AND f.trait_type='Color' AND f.value=ANY(${traitValues}))`);
            if (filter === "rank-range" || filter === "other-range") {
              const boundedScore =
                filter === "rank-range"
                  ? score
                  : score === "rarity_points"
                    ? "rarity_points_capped"
                    : "rarity_points";
              filters.push(`s.${boundedScore}>=1 AND s.${boundedScore}<=4`);
            }
            const columns =
              "t.collection,t.token_id,t.owner,t.burned,COALESCE(s.metadata_available,false) AS metadata_available,s.rarity_points,s.rarity_points_capped";
            const baseline = (
              await db.query(
                `SELECT ${columns} FROM rarity_read.token t LEFT JOIN ${validated} s
      ON s.collection=t.collection AND s.token_id=t.token_id::numeric AND s.lifecycle=t.lifecycle
      WHERE ${filters.join(" AND ")} ORDER BY s.${score} ${direction} NULLS LAST,t.token_id::numeric,t.collection`,
                initial
              )
            ).rows;
            let cursor;
            const actual = [];
            for (let page = 0; page < 30; page++) {
              const values = [...initial];
              const positioned = [...filters];
              if (cursor) {
                if (cursor.rarity === null) {
                  values.push(cursor.tokenId, cursor.collection);
                  positioned.push(`s.${score} IS NULL AND (t.token_id::numeric>$${values.length - 1}::numeric OR
            (t.token_id::numeric=$${values.length - 1}::numeric AND t.collection>$${values.length}))`);
                } else {
                  values.push(cursor.rarity, cursor.tokenId, cursor.collection);
                  positioned.push(`(s.${score}${direction === "DESC" ? "<" : ">"}$${values.length - 2}::numeric OR s.${score} IS NULL OR
            (s.${score}=$${values.length - 2}::numeric AND (t.token_id::numeric>$${values.length - 1}::numeric OR
              (t.token_id::numeric=$${values.length - 1}::numeric AND t.collection>$${values.length}))))`);
                }
              }
              values.push(6);
              const statement = rarityPageQueries({
                relations,
                rawSearch: metadataRawSearchReadRelationAt("2"),
                validatedSearch: cached
                  ? cachedSearchReadRelation(selected, "2")
                  : validated,
                missingKeys: cached
                  ? (relation) =>
                      cachedMissingKeys(
                        relation.startsWith("rarity_bnb")
                          ? '"rarity_bnb"'
                          : '"rarity_physical"',
                        selected,
                        "2"
                      )
                  : undefined,
                bulkSearch: (relation) =>
                  cached
                    ? cachedSearchReadRelationFor(
                        relation.startsWith("rarity_bnb")
                          ? '"rarity_bnb"'
                          : '"rarity_physical"',
                        selected,
                        "2"
                      )
                    : metadataSearchReadRelationFor(
                        relation.startsWith("rarity_bnb")
                          ? '"rarity_bnb"'
                          : '"rarity_physical"',
                        true,
                        selected,
                        "2"
                      ),
                columns,
                filters,
                cursorFilters: positioned,
                values,
                sort,
                cursor,
                selective,
                selectiveTokens: (relation) =>
                  isTrait
                    ? `(SELECT current.* FROM (SELECT DISTINCT collection,token_id,lifecycle FROM ${metadataRawTraitReadRelationAt("2")}
                    WHERE trait_type='Color' AND value=ANY(${traitValues}) AND collection=ANY($1::text[])) keys
                    JOIN LATERAL (SELECT * FROM ${relation} current WHERE current.collection=keys.collection
                      AND current.token_id=keys.token_id::text AND current.lifecycle=keys.lifecycle OFFSET 0) current ON true)`
                    : relation,
                nullsExcluded: filter === "rank-range",
                missingExcluded:
                  metadata === "available" ||
                  filter === "rank-range" ||
                  filter === "other-range"
              });
              const rows = statement.nonnull
                ? (await db.query(statement.nonnull, values)).rows
                : [];
              if (statement.nulls && rows.length <= 5)
                rows.push(
                  ...(await db.query(statement.nulls, values)).rows.slice(
                    0,
                    6 - rows.length
                  )
                );
              actual.push(...rows.slice(0, 5));
              if (rows.length <= 5) break;
              const last = rows[4];
              cursor = {
                tokenId: last.token_id,
                collection: last.collection,
                rarity: last[score]
              };
            }
            assert.deepEqual(
              actual,
              baseline,
              `cached=${cached}:${selected}:${sort}:${metadata}:filter=${filter}`
            );
            cases++;
          }
  // Every proof dependency must invalidate in the writer's transaction. The
  // independent canonical relation verifies that stale sets really fall back.
  const verifyProofs = async (client) => {
    const columns =
      "collection,token_id,lifecycle,metadata_available,rarity_points,rarity_points_capped";
    const order = " ORDER BY collection,token_id,lifecycle";
    assert.deepEqual(
      (
        await client.query(
          `SELECT ${columns} FROM ${cachedSearchReadRelation(chains, "2")} s WHERE EXISTS(SELECT 1 FROM rarity_read.token t WHERE t.collection=s.collection AND t.token_id::numeric=s.token_id AND t.lifecycle=s.lifecycle)${order}`
        )
      ).rows,
      (
        await client.query(
          `SELECT ${columns} FROM ${validated} s WHERE EXISTS(SELECT 1 FROM rarity_read.token t WHERE t.collection=s.collection AND t.token_id::numeric=s.token_id AND t.lifecycle=s.lifecycle)${order}`
        )
      ).rows
    );
  };
  const mutations = [
    [
      "bnb",
      "DELETE FROM metadata_projection.search WHERE generation_id=2 AND collection='bnb' AND token_id=1"
    ],
    [
      "bnb",
      "INSERT INTO metadata_projection.search VALUES(2,'bnb',12,1,false,NULL,NULL)"
    ],
    [
      "bnb",
      "ALTER TABLE metadata_projection.search DISABLE TRIGGER read_cache_dirty_update"
    ],
    ["bnb", "TRUNCATE metadata_projection.search"],
    [
      "bnb",
      "UPDATE metadata.token_metadata SET content_hash='changed-after-cache' WHERE collection='bnb' AND token_id=1"
    ],
    [
      "bnb",
      "UPDATE metadata.token_metadata SET document='{}' WHERE collection='bnb' AND token_id=1"
    ],
    [
      "bnb",
      "UPDATE metadata.token_publication SET publication_status='unavailable' WHERE collection='bnb' AND token_id=1"
    ],
    [
      "bnb",
      "UPDATE metadata.token_publication SET mint_log_index=99 WHERE collection='bnb' AND token_id=1"
    ],
    [
      "bnb",
      "UPDATE rarity_bnb.token_lifecycle SET mint_transaction_hash='changed' WHERE collection='bnb' AND token_id='1'"
    ],
    [
      "bnb",
      "DELETE FROM rarity_bnb.transfer_event WHERE collection='bnb' AND token_id='1'"
    ],
    [
      "bnb",
      "UPDATE metadata_projection.revision SET metadata_content_hash='changed' WHERE generation_id=2 AND collection='bnb' AND token_id=1"
    ],
    [
      "bnb",
      "UPDATE metadata_projection.search SET rarity_points=333 WHERE generation_id=2 AND collection='bnb' AND token_id=1"
    ],
    [
      "bnb",
      "UPDATE rarity_bnb.token SET lifecycle=2 WHERE collection='bnb' AND token_id='1'"
    ],
    [
      "bnb",
      `INSERT INTO rarity_bnb.token VALUES('bnb','100',1,'${owner}',false)`
    ],
    [
      "bnb",
      "DELETE FROM rarity_bnb.token WHERE collection='bnb' AND token_id='1'"
    ],
    ["bnb", "TRUNCATE rarity_bnb.transfer_event"],
    [
      "bnb",
      "UPDATE metadata_source.archive_release SET state='superseded' WHERE release_id='fixture'"
    ],
    ["base", "UPDATE metadata_source.chain_metadata_scan SET next_block=1"],
    [
      "base",
      "DELETE FROM metadata_source.chain_metadata_event WHERE token_id='1'"
    ],
    [
      "base",
      "UPDATE metadata.publication_runtime SET base_error='fixture failure'"
    ],
    ["bnb", "ALTER TABLE rarity_bnb.token DISABLE TRIGGER read_cache_dirty"],
    ["bnb", "ALTER TABLE rarity_bnb.token DISABLE TRIGGER read_cache_truncate"]
  ];
  const writer = await db.connect();
  try {
    for (const [chain, mutation] of mutations) {
      await writer.query("BEGIN");
      try {
        await writer.query(mutation);
        assert.equal(
          (
            await writer.query(
              `SELECT ${readCacheFreshSql("2", [chain])} AS fresh`
            )
          ).rows[0].fresh,
          false,
          mutation
        );
        await verifyProofs(writer);
      } finally {
        await writer.query("ROLLBACK");
      }
    }
    // Ownership changes remain live without rebuilding metadata membership.
    await writer.query("BEGIN");
    await writer.query(
      `UPDATE rarity_bnb.token SET owner='${zero}',burned=true WHERE token_id='1'`
    );
    assert.equal(
      (await writer.query(`SELECT ${readCacheFreshSql("2", ["bnb"])} AS fresh`))
        .rows[0].fresh,
      true
    );
    await verifyProofs(writer);
    await writer.query("ROLLBACK");
    // An uncached new generation must use the original proof path.
    await writer.query("BEGIN");
    await writer.query(
      "UPDATE metadata_projection.active SET current_id=1,previous_id=NULL"
    );
    assert.equal(
      (await writer.query(`SELECT ${readCacheFreshSql("1", ["bnb"])} AS fresh`))
        .rows[0].fresh,
      false
    );
    await writer.query("ROLLBACK");
  } finally {
    writer.release();
  }

  // A proof committed while the builder is blocked must leave its older
  // snapshot unusable, even when that build publishes after the proof change.
  const blocker = await db.connect();
  const builder = await db.connect();
  let building;
  try {
    await blocker.query("BEGIN");
    await blocker.query(
      "LOCK TABLE metadata_projection.read_member IN ACCESS EXCLUSIVE MODE"
    );
    const pid = (await builder.query("SELECT pg_backend_pid() AS pid")).rows[0]
      .pid;
    building = buildReadCache(builder, "2", "bnb");
    let blocked = false;
    const deadline = Date.now() + 2000;
    while (!blocked && Date.now() < deadline) {
      blocked = (
        await db.query(
          "SELECT wait_event_type='Lock' AS blocked FROM pg_stat_activity WHERE pid=$1",
          [pid]
        )
      ).rows[0]?.blocked;
      if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(blocked, true);
    await db.query(
      "UPDATE metadata.token_metadata SET content_hash='concurrent-change' WHERE collection='bnb' AND token_id=1"
    );
    await blocker.query("ROLLBACK");
    await building;
    assert.equal(
      (await db.query(`SELECT ${readCacheFreshSql("2", ["bnb"])} AS fresh`))
        .rows[0].fresh,
      false
    );
    await verifyProofs(db);
    await db.query(
      "UPDATE metadata.token_metadata SET content_hash='bnb-1' WHERE collection='bnb' AND token_id=1"
    );
    await buildReadCache(builder, "2", "bnb");
    assert.equal(
      (await db.query(`SELECT ${readCacheFreshSql("2", chains)} AS fresh`))
        .rows[0].fresh,
      true
    );
  } finally {
    await blocker.query("ROLLBACK");
    await building?.catch(() => undefined);
    blocker.release();
    builder.release();
  }
  console.log(
    JSON.stringify({
      event: "rarity_pagination_parity",
      cases,
      invalidationCases: mutations.length + 3,
      checks: [
        "null ranks",
        "missing search",
        "stale hash/revision",
        "mint anchors",
        "inactive release",
        "invalid documents",
        "lifecycle changes",
        "hidden/transferred/burned tokens",
        "cross-chain ties",
        "uint256 IDs",
        "raw/capped asc/desc",
        "selective owner/trait",
        "same/opposite score ranges"
      ]
    })
  );
} finally {
  await db.end();
}
