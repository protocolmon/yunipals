import assert from "node:assert/strict";
import pg from "pg";
import { toHex } from "viem";

const connectionString = process.env.PONDER_UNIFIED_TEST_DATABASE_URL;
assert.ok(connectionString, "PONDER_UNIFIED_TEST_DATABASE_URL is required");
const url = new URL(connectionString);
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
assert.equal(url.pathname, "/yunipals_ponder_dependency_test");
assert.equal(url.search, "");
const db = new pg.Pool({ connectionString, max: 5 });
const schema = "unified_ownership_test",
  readSchema = "unified_api_read_test";
const alice = `0x${"12".repeat(20)}`,
  bob = `0x${"34".repeat(20)}`;
const hash = (chain, number) =>
  toHex(BigInt(chain) * 10n ** 18n + number, { size: 32 });
const checkpoint = (chain, number) =>
  `0000001000${String(chain).padStart(16, "0")}${String(number).padStart(16, "0")}${"9".repeat(33)}`;
let apiPools;
try {
  const id = (
    await db.query(
      "SELECT id FROM yunipals_indexer_control.release WHERE physical_schema=$1",
      [schema]
    )
  ).rows[0]?.id;
  assert.ok(id, "Run test:unified:ownership:postgres first.");
  Object.assign(process.env, {
    DATABASE_URL: connectionString,
    DATABASE_SCHEMA: schema,
    READ_DATABASE_SCHEMA: readSchema,
    BNB_DATABASE_SCHEMA: "unused_legacy_bnb",
    OWNERSHIP_READ_MODE: "unified",
    OWNERSHIP_READ_SCHEMA: readSchema,
    OWNERSHIP_RELEASE_ID: id,
    YUNIPALS_PROJECTION_MODE: "generation",
    METADATA_SOURCE_MODE: "legacy-http",
    YUNIPALS_READ_CACHE: "1",
    API_COLLECTOR_FILTERS_ENABLED: "true",
    API_COLLECTOR_NAME_SEARCH_ENABLED: "true",
    API_COLLECTOR_RARITY_RANGE_ENABLED: "true",
    API_ISLANDS_ENABLED: "false",
    SOLANA_API_ENABLED: "true"
  });
  for (const chain of [1, 56, 137, 8453])
    process.env[`PONDER_RPC_URL_${chain}`] = "http://127.0.0.1:1";
  const { loadIndexerRelease } = await import("../lib/unified/releases.ts");
  const { createOwnershipReadViews } = await import(
    "../lib/unified/ownership-views.ts"
  );
  const { ownershipReadDefinitions } = await import(
    "../lib/unified/ownership-config.ts"
  );
  const { observeIndexerChain } = await import("../lib/unified/observer.ts");
  const release = await loadIndexerRelease(db, id);
  await db.query(`DROP SCHEMA IF EXISTS ${readSchema} CASCADE`);
  await createOwnershipReadViews(
    db,
    release,
    readSchema,
    ownershipReadDefinitions(release)
  );
  const { migrations } = await import("../lib/offchain/migrations.ts");
  const { projectionSchemaStatements } = await import(
    "../lib/metadata/projection-schema.ts"
  );
  const { installReadCache } = await import(
    "../lib/metadata/read-cache-schema.ts"
  );
  const { buildReadCache, readCacheFreshSql, cachedSearchReadRelationFor } =
    await import("../lib/metadata/read-cache.ts");
  const {
    unifiedOwnershipStatus,
    assertOwnershipAvailable,
    assertLegacyOwnershipSelection
  } = await import("../lib/ownership/readiness.ts");
  const { requestSnapshotPool, withOwnershipRequest, apiReadTransaction } =
    await import("../lib/ownership/request-snapshot.ts");
  const { ownershipReadConfig } = await import("../lib/offchain/sql.ts");
  assert.equal(ownershipReadConfig.mode, "unified");
  await assert.rejects(
    assertLegacyOwnershipSelection(db, {
      physicalSchema: schema,
      readSchema: "unused_legacy_read"
    }),
    (error) => error.reason === "mixed_read_configuration"
  );
  await assert.rejects(
    assertLegacyOwnershipSelection(db, {
      physicalSchema: "unused_legacy_physical",
      readSchema: schema
    }),
    (error) => error.reason === "mixed_read_configuration"
  );
  await db.query(
    "DROP SCHEMA IF EXISTS metadata_projection,metadata_source,metadata,leaderboard,solana_indexer CASCADE"
  );
  for (const sql of migrations) await db.query(sql);
  const { solanaSchemaStatements } = await import("../lib/solana/schema.ts");
  for (const statement of solanaSchemaStatements) await db.query(statement);
  const solanaMint = "9oDGqXsG2n3P4Bs6KsA1a6QCvjELi3bU2XMEwEiqcAus";
  const solanaOwner = "4zdNGgAtFsW1cQgHqkiWyRsxaAgxrSRRynnuunxzjxue";
  await db.query(
    "INSERT INTO solana_indexer.manifest VALUES(true,'fixture','fixture-checksum',1,now())"
  );
  await db.query(
    "INSERT INTO solana_indexer.manifest_asset VALUES($1,'1',repeat('a',64),repeat('b',64),'fixture')",
    [solanaMint]
  );
  await db.query(
    `INSERT INTO solana_indexer.asset_metadata(mint,release_id,source_hash,document,content_hash,attributes)
    VALUES($1,'fixture',repeat('b',64),'{"name":"Exomon"}',repeat('c',64),'[]')`,
    [solanaMint]
  );
  const solanaRun = (
    await db.query(`INSERT INTO solana_indexer.scan_run(manifest_checksum,state,asset_count,batch_size,completed_at)
    VALUES('fixture-checksum','published',1,1,now()) RETURNING id`)
  ).rows[0].id;
  await db.query(
    `INSERT INTO solana_indexer.token(mint,owner,burnt,observed_at,published_run_id) VALUES($1,$2,false,now(),$3)`,
    [solanaMint, solanaOwner, solanaRun]
  );
  await db.query(
    "UPDATE solana_indexer.sync_state SET published_run_id=$1 WHERE singleton",
    [solanaRun]
  );
  for (const sql of projectionSchemaStatements) await db.query(sql);
  const marker = (
    await db.query(
      `SELECT * FROM ${readSchema}._unified_read_release WHERE singleton`
    )
  ).rows[0];
  const tokens = (
    await db.query(
      `SELECT * FROM ${readSchema}.token WHERE collection=ANY($1::text[]) ORDER BY collection,token_id`,
      [["ethereum", "base", "polygon", "bnb"]]
    )
  ).rows;
  await db.query(
    `INSERT INTO metadata_projection.generation(source_mode,state) VALUES('legacy','ready'),('legacy','ready')`
  );
  await db.query(
    "UPDATE metadata_projection.active SET current_id=1,previous_id=NULL"
  );
  for (const token of tokens) {
    const document = {
      id: token.token_id,
      name: `Test ${token.collection} ${token.token_id}`,
      attributes: [{ trait_type: "Color", value: "Blue" }],
      image: "/images/test.png"
    };
    const content = `${token.collection}-${token.token_id}-${token.lifecycle}`;
    await db.query(
      `INSERT INTO metadata.token_metadata(collection,token_id,lifecycle,token_uri,uri_provenance,name,image,attributes,document,content_hash,fetch_status)
      VALUES($1,$2,$3,'https://meta.yunipals.com/meta?id=1','current_token_uri_call',$4,$5,$6,$7,$8,'success')`,
      [
        token.collection,
        token.token_id,
        token.lifecycle,
        document.name,
        document.image,
        JSON.stringify(document.attributes),
        document,
        content
      ]
    );
    for (const generation of [1, 2]) {
      await db.query(
        `INSERT INTO metadata_projection.search(generation_id,collection,token_id,lifecycle,metadata_available,rarity_points,rarity_points_capped,updated_at)
        VALUES($1,$2,$3,$4,true,$5,$5,now())`,
        [
          generation,
          token.collection,
          token.token_id,
          token.lifecycle,
          Number(token.token_id) * 100
        ]
      );
      await db.query(
        `INSERT INTO metadata_projection.trait(generation_id,collection,token_id,lifecycle,trait_type,value) VALUES($1,$2,$3,$4,'Color','Blue')`,
        [generation, token.collection, token.token_id, token.lifecycle]
      );
      await db.query(
        `INSERT INTO metadata_projection.revision(generation_id,collection,token_id,lifecycle,metadata_content_hash) VALUES($1,$2,$3,$4,$5)`,
        [generation, token.collection, token.token_id, token.lifecycle, content]
      );
    }
  }
  const { app } = await import("../lib/api/server.ts");
  assert.equal((await app.request("/v1/collection?chain=solana")).status, 200);
  apiPools = await import("../lib/offchain/db.ts");
  let response = await app.request("/v1/tokens?chain=bnb");
  assert.equal(
    response.status,
    503,
    "old generation must not become a unified generation implicitly"
  );
  await db.query(
    "UPDATE metadata_projection.generation SET ownership_release_id=$1,ownership_read_identity=$2 WHERE id=2",
    [id, marker.identity]
  );
  await db.query(
    "UPDATE metadata_projection.active SET current_id=2,previous_id=1"
  );
  const installer = await db.connect();
  try {
    await installer.query("BEGIN");
    await installReadCache(installer);
    await installer.query("COMMIT");
    for (const chain of ["ethereum", "base", "polygon", "bnb"])
      await buildReadCache(installer, "2", chain);
  } finally {
    installer.release();
  }

  response = await app.request("/v1/collection");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).knownTokens, 9);
  response = await app.request("/v1/tokens?limit=3&chain=bnb");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-indexer-release"), id);
  let body = await response.json();
  assert.equal(body.total, 7);
  assert.equal(body.items.length, 3);
  assert.ok(body.nextCursor);
  const cursor = JSON.parse(
    Buffer.from(body.nextCursor, "base64url").toString()
  );
  cursor.config = "from_another_release";
  assert.equal(
    (
      await app.request(
        `/v1/tokens?limit=3&chain=bnb&cursor=${Buffer.from(JSON.stringify(cursor)).toString("base64url")}`
      )
    ).status,
    400
  );
  response = await app.request(
    "/v1/tokens?metadata=available&sort=rarity-desc&limit=100"
  );
  assert.equal(response.status, 200);
  body = await response.json();
  assert.equal(body.total, 9);
  assert.equal(
    new Set(body.items.map((item) => `${item.chain}:${item.tokenId}`)).size,
    9
  );
  assert.equal(
    (
      await app.request(
        `/v2/owners/${alice}/tokens?chain=bnb&sort=rarity-capped-desc&limit=2`
      )
    ).status,
    200
  );
  assert.equal((await app.request("/v1/tokens/bnb/3")).status, 200);
  assert.equal(
    (await app.request("/v1/leaderboards?chain=bnb")).status,
    503,
    "old derived statistics must not be published under a new source"
  );

  // The archive join must retain Base and BNB together when both read from
  // the same logical schema. Base tuple and mint-log proofs still fence data.
  const { metadataReadRelationFor } = await import(
    "../lib/metadata/read-source.ts"
  );
  await db.query(
    "INSERT INTO metadata_source.archive_release(release_id,state) VALUES('api-fixture','active')"
  );
  for (const token of tokens) {
    const mint = (
      await db.query(
        `SELECT l.mint_transaction_hash,l.mint_block,e.log_index FROM ${schema}.token_lifecycle l
      JOIN ${schema}.transfer_event e ON e.collection=l.collection AND e.token_id=l.token_id AND e.lifecycle=l.lifecycle
        AND e.transaction_hash=l.mint_transaction_hash AND e."from"='0x0000000000000000000000000000000000000000'
      WHERE l.collection=$1 AND l.token_id=$2 AND l.lifecycle=$3 ORDER BY e.log_index LIMIT 1`,
        [token.collection, token.token_id, token.lifecycle]
      )
    ).rows[0];
    const eventKey =
      token.collection === "base"
        ? `${mint.mint_transaction_hash}:${mint.log_index + 1}`
        : null;
    if (token.collection === "base") {
      const target = BigInt(mint.mint_block) + 100n;
      await db.query(
        `INSERT INTO metadata_source.chain_metadata_scan(name,chain_id,contract_address,deployment_block,next_block,target_block,target_hash)
        VALUES('base_metadata_v1',8453,$1,22224075,$2,$3,$4)`,
        [
          token.contract_address,
          String(target + 1n),
          String(target),
          hash(8453, target)
        ]
      );
      await db.query(
        `INSERT INTO metadata_source.chain_metadata_event VALUES(8453,$1,$2,$3,0,$4,$5,'Mint',$6,$7,'{}')`,
        [
          token.contract_address,
          mint.mint_transaction_hash,
          mint.log_index + 1,
          mint.mint_block,
          hash(8453, BigInt(mint.mint_block)),
          token.token_id,
          token.owner
        ]
      );
    }
    await db.query(
      `INSERT INTO metadata.token_publication(collection,token_id,lifecycle,source_kind,release_id,renderer_version,
      publication_content_hash,publication_status,mint_transaction_hash,mint_log_index,chain_event_key)
      VALUES($1,$2,$3,'archive','api-fixture','fixture',$4,'published',$5,$6,$7)`,
      [
        token.collection,
        token.token_id,
        token.lifecycle,
        `${token.collection}-${token.token_id}-${token.lifecycle}`,
        mint.mint_transaction_hash,
        mint.log_index,
        eventKey
      ]
    );
  }
  process.env.METADATA_SOURCE_MODE = "archive";
  try {
    const publication = metadataReadRelationFor(`"${readSchema}"`, true, [
      "base",
      "bnb"
    ]);
    assert.equal(
      (
        await db.query(
          `SELECT count(*)::int AS count FROM ${publication} publication`
        )
      ).rows[0].count,
      8
    );
    await db.query(
      "UPDATE metadata.token_publication SET chain_event_key='wrong' WHERE collection='base'"
    );
    assert.equal(
      (
        await db.query(
          `SELECT count(*)::int AS count FROM ${publication} publication`
        )
      ).rows[0].count,
      7
    );
    await db.query(
      "UPDATE metadata.token_publication SET mint_log_index=mint_log_index+1 WHERE collection='bnb' AND token_id=1"
    );
    assert.equal(
      (
        await db.query(
          `SELECT count(*)::int AS count FROM ${publication} publication`
        )
      ).rows[0].count,
      6
    );
  } finally {
    process.env.METADATA_SOURCE_MODE = "legacy-http";
  }

  // Request leases are lazy, read-only and share one snapshot even when the
  // underlying source changes between the health proof and data read.
  const scoped = requestSnapshotPool(db);
  let validations = 0;
  await withOwnershipRequest(
    scoped,
    async (client) => {
      validations++;
      return assertOwnershipAvailable(client, ["bnb"]);
    },
    async () => {
      assert.equal(validations, 0);
      const before = (await scoped.query("SHOW join_collapse_limit")).rows[0]
        .join_collapse_limit;
      await apiReadTransaction(scoped, async (client) => {
        await client.query("SET LOCAL join_collapse_limit=1");
        assert.equal(
          (await client.query("SHOW join_collapse_limit")).rows[0]
            .join_collapse_limit,
          "1"
        );
      });
      assert.equal(
        (await scoped.query("SHOW join_collapse_limit")).rows[0]
          .join_collapse_limit,
        before
      );
      const pids = await Promise.all([
        scoped.query("SELECT pg_backend_pid() AS pid"),
        scoped.query("SELECT pg_backend_pid() AS pid")
      ]);
      assert.equal(pids[0].rows[0].pid, pids[1].rows[0].pid);
      assert.equal(validations, 1);
    }
  );
  await assert.rejects(
    withOwnershipRequest(
      scoped,
      (client) => assertOwnershipAvailable(client, ["bnb"]),
      async () => {
        await scoped.query("DELETE FROM metadata.token_visibility");
      }
    ),
    (error) => error.code === "25006"
  );
  let proofReady, continueRead;
  const reached = new Promise((resolve) => {
      proofReady = resolve;
    }),
    continued = new Promise((resolve) => {
      continueRead = resolve;
    });
  const retained = withOwnershipRequest(
    scoped,
    async (client) => {
      const proof = await assertOwnershipAvailable(client, ["bnb"]);
      proofReady();
      await continued;
      return proof;
    },
    async () =>
      (
        await scoped.query(
          `SELECT owner FROM ${readSchema}.token WHERE collection='bnb' AND token_id='1'`
        )
      ).rows[0].owner
  );
  await reached;
  const buildId = (
    await db.query(
      `SELECT value->>'build_id' AS build FROM ${schema}._ponder_meta WHERE key='app'`
    )
  ).rows[0].build;
  await db.query(
    `UPDATE ${schema}._ponder_meta SET value=jsonb_set(value,'{build_id}','"wrong"') WHERE key='app'`
  );
  continueRead();
  assert.equal(await retained, `0x${"56".repeat(20)}`);
  await assert.rejects(
    withOwnershipRequest(
      scoped,
      (client) => assertOwnershipAvailable(client, ["bnb"]),
      async () => scoped.query("SELECT 1")
    )
  );
  await db.query(
    `UPDATE ${schema}._ponder_meta SET value=jsonb_set(value,'{build_id}',$1::jsonb) WHERE key='app'`,
    [JSON.stringify(buildId)]
  );

  // Crossing an already-indexed transfer invalidates the cache even though no
  // native dirty trigger fires at the later confirmation boundary.
  let head = BigInt(
    (
      await db.query(
        "SELECT head_number::text FROM yunipals_indexer_control.chain_status WHERE release_id=$1 AND chain_id=56",
        [id]
      )
    ).rows[0].head_number
  );
  const next = head + 10n;
  const tx = hash(56, next + 90000n),
    contract = "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d";
  await db.query(
    `UPDATE ${schema}.token SET owner=$1,last_transfer_block=$2,last_transfer_timestamp=$2,last_transaction_hash=$3 WHERE collection='bnb' AND token_id='6'`,
    [bob, String(next), tx]
  );
  await db.query(
    `INSERT INTO ${schema}.transfer_event VALUES($1,'bnb',56,$2,'6',1,$3,$4,$5,$5,$6,0,0)`,
    [`bnb:${tx}:0`, contract, alice, bob, String(next), tx]
  );
  const transferSource = release.manifest.sources.find(
    (source) => source.id === "ownership:bnb"
  );
  await db.query(
    `INSERT INTO ${schema}.canonical_event VALUES($1,'ownership:bnb',56,$2,'Transfer',$3,$4,$5,$6,$5,$7,0,0,'[]','0x')`,
    [
      `56:${contract}:${tx}:0`,
      contract,
      JSON.stringify({ from: alice, to: bob, tokenId: "6" }),
      transferSource.abiHash,
      String(next),
      hash(56, next),
      tx
    ]
  );
  await db.query(
    `UPDATE ${schema}._ponder_checkpoint SET latest_checkpoint=$1 WHERE chain_id=56`,
    [checkpoint(56, next)]
  );
  const builder = await db.connect();
  try {
    await buildReadCache(builder, "2", "bnb");
  } finally {
    builder.release();
  }
  const beforeRevision = (
    await db.query(
      "SELECT revision::text FROM metadata_projection.read_epoch WHERE collection='bnb'"
    )
  ).rows[0].revision;
  assert.equal(
    (await db.query(`SELECT ${readCacheFreshSql("2", ["bnb"])} AS fresh`))
      .rows[0].fresh,
    true
  );
  head = next + 20n;
  await db.query(
    `UPDATE ${schema}._ponder_meta SET value=jsonb_set(value,'{heartbeat_at}',$1::jsonb) WHERE key='app'`,
    [String(Date.now())]
  );
  await db.query(
    `UPDATE ${schema}._ponder_checkpoint SET latest_checkpoint=$1 WHERE chain_id=56`,
    [checkpoint(56, head)]
  );
  const timestamp = String(Math.floor(Date.now() / 1000));
  await db.query(
    `UPDATE ${schema}.chain_checkpoint SET block_number=$1,block_hash=$2,parent_hash=$3,timestamp=$4 WHERE chain_id=56`,
    [String(head), hash(56, head), hash(56, head - 1n), timestamp]
  );
  for (let number = head - 50n; number <= head; number++)
    await db.query(
      `INSERT INTO ${schema}.chain_block VALUES($1,56,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING`,
      [
        `56:${number}`,
        String(number),
        hash(56, number),
        hash(56, number - 1n),
        timestamp
      ]
    );
  const rpc = {
    providerId: "local-api-test",
    chainId: async () => 56,
    block: async (tag) => {
      const number =
        tag === "latest" ? head : tag === "finalized" ? head - 30n : tag;
      return {
        number,
        hash: hash(56, number),
        parentHash: hash(56, number - 1n),
        timestamp: BigInt(timestamp)
      };
    }
  };
  assert.equal(await observeIndexerChain(db, release, 56, rpc), "observed");
  assert.equal(
    (
      await db.query(
        "SELECT revision::text FROM metadata_projection.read_epoch WHERE collection='bnb'"
      )
    ).rows[0].revision,
    beforeRevision
  );
  assert.equal(
    (await db.query(`SELECT ${readCacheFreshSql("2", ["bnb"])} AS fresh`))
      .rows[0].fresh,
    false
  );
  assert.equal(
    (
      await db.query(
        `SELECT count(*)::int AS count FROM ${cachedSearchReadRelationFor(`"${readSchema}"`, ["bnb"], "2")} s`
      )
    ).rows[0].count,
    7
  );
  const rebuild = await db.connect();
  try {
    await buildReadCache(rebuild, "2", "bnb");
  } finally {
    rebuild.release();
  }
  assert.equal(
    (await db.query(`SELECT ${readCacheFreshSql("2", ["bnb"])} AS fresh`))
      .rows[0].fresh,
    true
  );
  const cachedHash = (
    await db.query(
      "SELECT ownership_boundary_hash FROM metadata_projection.read_set WHERE collection='bnb' AND generation_id=2"
    )
  ).rows[0].ownership_boundary_hash;
  await db.query(
    "UPDATE metadata_projection.read_set SET ownership_boundary_hash=$1 WHERE collection='bnb' AND generation_id=2",
    [hash(56, 1n)]
  );
  assert.equal(
    (await db.query(`SELECT ${readCacheFreshSql("2", ["bnb"])} AS fresh`))
      .rows[0].fresh,
    false
  );
  await db.query(
    "UPDATE metadata_projection.read_set SET ownership_boundary_hash=$1 WHERE collection='bnb' AND generation_id=2",
    [cachedHash]
  );
  await db.query(
    "UPDATE metadata_projection.read_set SET ownership_read_identity='wrong' WHERE collection='bnb' AND generation_id=2"
  );
  assert.equal(
    (await db.query(`SELECT ${readCacheFreshSql("2", ["bnb"])} AS fresh`))
      .rows[0].fresh,
    false
  );

  // Availability is checked before empty results and stays scoped by chain.
  await db.query(
    "UPDATE yunipals_indexer_control.chain_status SET error_code='fixture_unavailable' WHERE release_id=$1 AND chain_id=137",
    [id]
  );
  assert.equal((await app.request("/v1/collection?chain=polygon")).status, 503);
  assert.equal((await app.request("/v1/collection?chain=base")).status, 200);
  response = await app.request("/v1/indexing-status");
  assert.equal(response.status, 200);
  assert.equal(
    (await response.json()).collections.find(
      (source) => source.collection === "polygon"
    ).available,
    false
  );
  response = await app.request("/v1/status");
  assert.equal(response.status, 200);
  assert.equal(
    (await response.json()).collections.find(
      (source) => source.slug === "polygon"
    ).knownTokens,
    null
  );
  assert.equal((await app.request("/v1/tokens/not-a-chain/1")).status, 400);
  response = await app.request("/v1/indexer/status");
  assert.equal(response.status, 200);
  const combinedStatus = await response.json();
  assert.equal(combinedStatus.evm.available, true);
  assert.equal(
    combinedStatus.evm.sources
      .find((source) => source.id === "ownership:base")
      .policies.find((policy) => policy.policy === "latest").ready,
    true
  );
  assert.equal(
    combinedStatus.evm.sources
      .find((source) => source.id === "ownership:polygon")
      .policies.find((policy) => policy.policy === "latest").ready,
    false
  );
  assert.equal(combinedStatus.solana.ready, true);
  assert.equal(combinedStatus.solana.sourceKind, "observed-snapshot");
  await db.query(
    "ALTER SCHEMA solana_indexer RENAME TO temporarily_missing_solana"
  );
  try {
    response = await app.request("/v1/indexer/status");
    assert.equal(response.status, 200);
    const missingSolana = await response.json();
    assert.equal(missingSolana.evm.available, true);
    assert.equal(missingSolana.solana.available, false);
  } finally {
    await db.query(
      "ALTER SCHEMA temporarily_missing_solana RENAME TO solana_indexer"
    );
  }
  // An incomplete deployment is unavailable, including an empty collection.
  await db.query(
    `ALTER FUNCTION "${readSchema}".source_probe(text) RENAME TO source_probe_temporarily_missing`
  );
  try {
    assert.equal((await app.request("/v1/collection?chain=base")).status, 503);
  } finally {
    await db.query(
      `ALTER FUNCTION "${readSchema}".source_probe_temporarily_missing(text) RENAME TO source_probe`
    );
  }
  await db.query(
    `ALTER TABLE "${readSchema}"._unified_read_release RENAME TO temporarily_missing_release`
  );
  try {
    assert.equal((await app.request("/v1/collection?chain=base")).status, 503);
    assert.equal(
      (await app.request("/v1/collection?chain=solana")).status,
      200
    );
  } finally {
    await db.query(
      `ALTER TABLE "${readSchema}".temporarily_missing_release RENAME TO _unified_read_release`
    );
  }
  console.log(
    JSON.stringify({
      event: "unified_api_postgres_verified",
      checks: [
        "existing collection/token/collector routes and all-chain deduplication",
        "archive joins preserve Base tuple and mint-log fences in a shared schema",
        "release-qualified cursors and generation rejection",
        "lazy same-snapshot request proofs and read-only writes rejected",
        "planner settings isolated across count/page reads",
        "cache invalidation on eligible-boundary crossing without dirty writes",
        "read identity mismatch and canonical fallback",
        "unavailable empty collection returns 503 while other chains remain readable",
        "diagnostic status reports unavailable counts explicitly",
        "missing release marker or source function returns 503",
        "Solana snapshot routes remain independent of EVM release faults"
      ]
    })
  );
} finally {
  if (apiPools)
    await Promise.all([apiPools.pool.end(), apiPools.apiPool.end()]);
  await db.end();
}
