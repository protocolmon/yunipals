import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { decodeEventLog, encodeAbiParameters, encodeEventTopics } from "viem";
import { baseMetadataAbi } from "../lib/metadata/base-abi.ts";

const connectionString = process.env.PONDER_UNIFIED_TEST_DATABASE_URL;
assert.ok(connectionString);
const url = new URL(connectionString);
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
assert.equal(url.pathname, "/yunipals_ponder_dependency_test");
assert.equal(url.search, "");
const pool = new pg.Pool({ connectionString, max: 5 });
const schema = "unified_ownership_test",
  readSchema = "unified_native_metadata_test";
const passed = [];
const originalFetch = globalThis.fetch;
let apiPools;
try {
  const releaseId = (
    await pool.query(
      "SELECT id FROM yunipals_indexer_control.release WHERE physical_schema=$1",
      [schema]
    )
  ).rows[0]?.id;
  assert.ok(releaseId, "Run test:unified:ownership:postgres first.");
  Object.assign(process.env, {
    DATABASE_URL: connectionString,
    DATABASE_SCHEMA: schema,
    READ_DATABASE_SCHEMA: readSchema,
    OWNERSHIP_READ_MODE: "unified",
    OWNERSHIP_READ_SCHEMA: readSchema,
    OWNERSHIP_RELEASE_ID: releaseId,
    YUNIPALS_PROJECTION_MODE: "generation",
    METADATA_SOURCE_MODE: "archive",
    BASE_METADATA_INGESTION: "native",
    API_ISLANDS_ENABLED: "false",
    SOLANA_API_ENABLED: "false",
    YUNIPALS_READ_CACHE: "1"
  });
  for (const chain of [1, 56, 137, 8453])
    process.env[`PONDER_RPC_URL_${chain}`] = "http://127.0.0.1:1";
  const { migrations } = await import("../lib/offchain/migrations.ts");
  const { projectionSchemaStatements } = await import(
    "../lib/metadata/projection-schema.ts"
  );
  const { loadIndexerRelease } = await import("../lib/unified/releases.ts");
  const { createOwnershipReadViews } = await import(
    "../lib/unified/ownership-views.ts"
  );
  const { ownershipReadDefinitions } = await import(
    "../lib/unified/ownership-config.ts"
  );
  const {
    adoptNativeBaseMetadata,
    refreshNativeBaseMetadata,
    backfillNativeBaseMetadataProvenance
  } = await import("../lib/metadata/native-base.ts");
  const {
    insertBaseMetadataEvents,
    latestBaseMetadata,
    baseMetadataState,
    commitBaseMetadataRange
  } = await import("../lib/metadata/source/base-events.ts");
  const { approvedBaseMetadataImplementation } = await import(
    "../lib/metadata/base-implementation.ts"
  );
  const { basePublicationState } = await import("../lib/metadata/resolve.ts");
  const { metadataReadRelationFor, metadataReadRelation } = await import(
    "../lib/metadata/read-source.ts"
  );
  const { enqueueNativeBasePublications, claimPublications, publishJob } =
    await import("../lib/metadata/publish.ts");
  const { ensureCandidate, beginSource, commitSourceBatch } = await import(
    "../lib/metadata/source/archive.ts"
  );
  const { sourceIdentity } = await import("../lib/metadata/source/identity.ts");
  const { contentHash } = await import("../lib/metadata/source/canonical.ts");
  const { publicationRequestKey } = await import(
    "../lib/metadata/publication-request.ts"
  );
  const { storeRuntimeBindings } = await import(
    "../lib/metadata/source/bindings.ts"
  );
  const { collections } = await import("../lib/constants.ts");
  const { installReadCache } = await import(
    "../lib/metadata/read-cache-schema.ts"
  );
  const { buildReadCache, readCacheFreshSql } = await import(
    "../lib/metadata/read-cache.ts"
  );
  const release = await loadIndexerRelease(pool, releaseId);
  await pool.query(
    `DROP SCHEMA IF EXISTS ${readSchema},metadata_projection,metadata_source,metadata,leaderboard CASCADE`
  );
  for (const sql of migrations) await pool.query(sql);
  for (const sql of projectionSchemaStatements) await pool.query(sql);
  const candidate = await createOwnershipReadViews(
    pool,
    release,
    readSchema,
    ownershipReadDefinitions(release)
  );
  const boundary = (
    await pool.query(
      `SELECT block_number::text,block_hash FROM ${readSchema}.source_boundary('base')`
    )
  ).rows[0];
  const head = BigInt(boundary.block_number),
    oldNext = head - 20n;
  const baseToken = (
    await pool.query(`SELECT t.*,l.mint_transaction_hash,l.mint_block::text,e.log_index
    FROM ${readSchema}.token t JOIN ${readSchema}.token_lifecycle l USING(collection,token_id,lifecycle)
    JOIN ${readSchema}.transfer_event e ON e.collection=l.collection AND e.token_id=l.token_id AND e.lifecycle=l.lifecycle
      AND e.transaction_hash=l.mint_transaction_hash AND e.block_number=l.mint_block
    WHERE t.collection='base' AND t.token_id='1'`)
  ).rows[0];
  const hash = (number) => `0x${BigInt(number).toString(16).padStart(64, "0")}`;
  const traits = {
    monsterType: 1,
    color: 2,
    horn: 3,
    background: 4,
    glitter: 0,
    rarityScore: "42"
  };
  const mint = {
    transactionHash: baseToken.mint_transaction_hash,
    logIndex: baseToken.log_index + 1,
    transactionIndex: 0,
    blockNumber: baseToken.mint_block,
    blockHash: hash(8453n * 10n ** 18n + BigInt(baseToken.mint_block)),
    eventName: "Mint",
    tokenId: "1",
    recipient: baseToken.owner,
    traits
  };
  const abiHash = release.manifest.sources.find(
    (row) => row.id === "metadata:base"
  ).abiHash;
  function nativeRow(event) {
    const definition = baseMetadataAbi.find(
      (item) => item.type === "event" && item.name === event.eventName
    );
    const topics = encodeEventTopics({
      abi: baseMetadataAbi,
      eventName: event.eventName,
      args: { to: event.recipient, tokenId: BigInt(event.tokenId) }
    });
    const data = encodeAbiParameters(
      definition.inputs.filter((input) => !input.indexed),
      [{ ...event.traits, rarityScore: Number(event.traits.rarityScore) }]
    );
    const decoded = decodeEventLog({ abi: baseMetadataAbi, topics, data });
    assert.equal(typeof decoded.args.yunipal.rarityScore, "number");
    return {
      id: `8453:${collections.base.address}:${event.transactionHash}:${event.logIndex}`,
      source_id: "metadata:base",
      chain_id: 8453,
      address: collections.base.address,
      name: event.eventName,
      args: JSON.stringify(decoded.args, (_, value) =>
        typeof value === "bigint" ? value.toString() : value
      ),
      abi_hash: abiHash,
      block_number: event.blockNumber,
      block_hash: event.blockHash,
      timestamp: "1700000000",
      transaction_hash: event.transactionHash,
      transaction_index: event.transactionIndex,
      log_index: event.logIndex,
      topics: JSON.stringify(topics),
      data
    };
  }
  const insertNative = async (event) =>
    pool.query(
      `INSERT INTO ${schema}.canonical_event
    SELECT * FROM json_populate_record(NULL::${schema}.canonical_event,$1::json)`,
      [JSON.stringify(nativeRow(event))]
    );
  await pool.query(
    `INSERT INTO metadata_source.chain_metadata_scan(name,chain_id,contract_address,deployment_block,next_block,target_block,target_hash,last_scanned_hash)
    VALUES('base_metadata_v1',8453,$1,$2,$3,$4,$5,$5)`,
    [
      collections.base.address,
      collections.base.deploymentBlock,
      String(oldNext),
      String(oldNext - 1n),
      hash(8453n * 10n ** 18n + oldNext - 1n)
    ]
  );
  await insertBaseMetadataEvents(pool, [mint]);
  let pointCalls = 0,
    implementation = approvedBaseMetadataImplementation,
    wrongHash = false;
  let duringPoint;
  const rpc = {
    chainId: async () => {
      pointCalls++;
      return 8453;
    },
    blockHash: async (number) => {
      pointCalls++;
      return wrongHash ? hash(1) : hash(8453n * 10n ** 18n + number);
    },
    implementation: async () => {
      pointCalls++;
      if (duringPoint) {
        const action = duringPoint;
        duringPoint = undefined;
        await action();
      }
      return implementation;
    }
  };
  const probe = async () =>
    (await pool.query(`SELECT ${readSchema}.base_metadata_probe() AS ready`))
      .rows[0].ready;
  assert.equal(await probe(), false);
  await assert.rejects(
    refreshNativeBaseMetadata(pool, rpc),
    /explicit adoption/
  );
  assert.equal(pointCalls, 0);
  await assert.rejects(adoptNativeBaseMetadata(pool, rpc), /parity failed/);
  assert.equal(
    (
      await pool.query(
        "SELECT ingestion_mode FROM metadata_source.chain_metadata_scan"
      )
    ).rows[0].ingestion_mode,
    "rpc"
  );
  await insertNative(mint);
  const partitionProbes = (
    await pool.query(`SELECT DISTINCT ON(bucket) bucket,transaction_hash FROM (
      SELECT '0x'||lpad(to_hex(value),64,'0') AS transaction_hash,
        hashtextextended('0x'||lpad(to_hex(value),64,'0'),0) & 15 AS bucket
      FROM generate_series(10000,10256) value) candidates
      WHERE bucket IN(0,15) ORDER BY bucket,transaction_hash`)
  ).rows;
  assert.equal(partitionProbes.length, 2);
  for (const probe of partitionProbes) {
    const changed = { ...mint, transactionHash: probe.transaction_hash };
    await insertBaseMetadataEvents(pool, [changed]);
    await insertNative({
      ...changed,
      traits: { ...changed.traits, rarityScore: "99" }
    });
    await assert.rejects(adoptNativeBaseMetadata(pool, rpc), /parity failed/);
    await pool.query(
      `DELETE FROM ${schema}.canonical_event WHERE id=$1`,
      [nativeRow(changed).id]
    );
    await pool.query(
      `DELETE FROM metadata_source.chain_metadata_event
       WHERE chain_id=8453 AND contract_address=$1 AND transaction_hash=$2`,
      [collections.base.address, changed.transactionHash]
    );
  }
  passed.push("early and final parity partitions reject changed rarity values");
  wrongHash = true;
  await assert.rejects(adoptNativeBaseMetadata(pool, rpc), /boundary changed/);
  wrongHash = false;
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM metadata_source.native_base_metadata_state"
      )
    ).rows[0].n,
    0
  );
  assert.equal((await adoptNativeBaseMetadata(pool, rpc)).adopted, true);
  assert.equal(await probe(), true);
  assert.deepEqual((await latestBaseMetadata(pool, "1")).traits, traits);
  assert.equal(
    (
      await pool.query(
        `SELECT jsonb_typeof(args::jsonb->'yunipal'->'rarityScore') AS type
         FROM ${schema}.canonical_event WHERE source_id='metadata:base'`
      )
    ).rows[0].type,
    "number"
  );
  passed.push(
    "actual uint40 ABI decode retains numeric evidence and string-compatible metadata"
  );
  await assert.rejects(
    commitBaseMetadataRange(
      pool,
      "base_metadata_v1",
      oldNext,
      oldNext,
      "0x" + "a".repeat(64),
      []
    ),
    /checkpoint changed/
  );
  assert.equal(
    (
      await pool.query(
        "SELECT next_block::text FROM metadata_source.chain_metadata_scan"
      )
    ).rows[0].next_block,
    String(oldNext)
  );
  assert.equal((await baseMetadataState(pool, "1")).asOfBlock, String(head));
  assert.equal((await latestBaseMetadata(pool, "1")).blockHash, mint.blockHash);
  passed.push(
    "explicit full-event parity adoption; failed adoption atomicity; old writer fenced; virtual latest coverage"
  );
  const quietCalls = pointCalls;
  assert.equal((await refreshNativeBaseMetadata(pool, rpc)).checked, false);
  assert.equal(pointCalls, quietCalls);
  passed.push("quiet blocks require no point RPC or mirror writes");
  const inFlight = {
    ...mint,
    eventName: "Update",
    transactionHash: hash(999),
    blockNumber: String(head - 8n),
    blockHash: hash(8453n * 10n ** 18n + head - 8n)
  };
  await pool.query(
    "UPDATE metadata_source.native_base_metadata_state SET checked_at=now()-interval '61 seconds'"
  );
  duringPoint = () => insertNative(inFlight);
  await assert.rejects(
    refreshNativeBaseMetadata(pool, rpc),
    /changed during approval/
  );
  assert.equal(await probe(), false);
  await pool.query(`DELETE FROM ${schema}.canonical_event WHERE id=$1`, [
    nativeRow(inFlight).id
  ]);
  await refreshNativeBaseMetadata(pool, rpc);
  assert.equal(await probe(), true);
  passed.push(
    "publication changing during point calls is rechecked in a fresh snapshot before approval"
  );

  const fixture = JSON.parse(
    await readFile(
      new URL("../test/fixtures/metadata/gen1_booster.json", import.meta.url),
      "utf8"
    )
  );
  const identity = sourceIdentity(fixture.envelope),
    archiveRelease = "native-metadata-test";
  await ensureCandidate(pool, archiveRelease, {});
  await beginSource(pool, archiveRelease, "test.source", {}, "one");
  await commitSourceBatch(
    pool,
    archiveRelease,
    "test.source",
    null,
    "one",
    [{ key: "one", payload: fixture.envelope, ...identity, burned: false }],
    true
  );
  await pool.query(
    "UPDATE metadata_source.archive_release SET state='active' WHERE release_id=$1",
    [archiveRelease]
  );
  await pool.query(
    `INSERT INTO metadata.chain_readiness(collection,state,checkpoint_block,verified_at)
    SELECT unnest($1::text[]),'ready',$2,now()`,
    [["ethereum", "base", "polygon", "bnb"], String(head)]
  );
  await storeRuntimeBindings(pool, archiveRelease, [
    {
      collection: "base",
      chainId: 8453,
      contractAddress: collections.base.address,
      tokenId: "1",
      lifecycle: 1,
      burned: false,
      tokenUri: `https://meta.polkamon.com/meta?id=${identity.legacyId}`,
      uriProvenance: "current_token_uri_call",
      documentId: identity.legacyId,
      documentName: fixture.envelope.nft.name,
      mintTransactionHash: mint.transactionHash,
      mintLogIndex: baseToken.log_index,
      assetKey: identity.assetKey,
      sourceHash: contentHash(fixture.envelope),
      sourceLegacyId: identity.legacyId,
      family: identity.family
    }
  ]);
  globalThis.fetch = async () => {
    throw new Error("Forbidden network in native metadata fixture");
  };
  async function publishBase() {
    await pool.query(
      `INSERT INTO metadata.publication_cursor(release_id,collection,token_id,next_scan_at)
      VALUES($1,'base','999999999999',now()+interval '1 hour') ON CONFLICT(release_id,collection)
      DO UPDATE SET token_id=EXCLUDED.token_id,next_scan_at=EXCLUDED.next_scan_at`,
      [archiveRelease]
    );
    assert.equal(await enqueueNativeBasePublications(pool, readSchema, 1), 1);
    assert.equal(
      await enqueueNativeBasePublications(pool, readSchema, 1),
      0,
      "recent discovery must preserve an unchanged job/lease"
    );
    const jobs = await claimPublications(pool, 100);
    const job = jobs.find((row) => row.collection === "base");
    assert.ok(job, "Base publication was enqueued");
    assert.equal(await enqueueNativeBasePublications(pool, readSchema, 1), 0);
    const leased = (
      await pool.query(
        "SELECT status,lease_token,request_key FROM metadata.publication_job WHERE id=$1",
        [job.id]
      )
    ).rows[0];
    assert.equal(leased.status, "publishing");
    assert.equal(leased.lease_token, job.leaseToken);
    assert.equal(leased.request_key, job.requestKey);
    return publishJob(pool, readSchema, job);
  }
  const publishedCount = async () =>
    (
      await pool.query(
        `SELECT count(*)::int AS n FROM ${metadataReadRelationFor(`"${readSchema}"`, true, ["base"])} p`
      )
    ).rows[0].n;
  assert.equal(await publishBase(), "published");
  assert.equal(await publishedCount(), 1);
  assert.equal(
    (
      await pool.query(
        "SELECT chain_event_block_hash FROM metadata.token_publication WHERE collection='base'"
      )
    ).rows[0].chain_event_block_hash,
    mint.blockHash
  );
  await pool.query(
    "UPDATE metadata.token_publication SET chain_event_block_hash=NULL WHERE collection='base'"
  );
  const oldInput = (
    await pool.query(
      `SELECT b.asset_key,b.input_hash,$1::text AS event_transaction,
    $2::integer AS event_log,$3::text AS event_block_hash FROM metadata_source.lifecycle_binding b WHERE b.chain_id='8453'`,
      [mint.transactionHash, mint.logIndex, mint.blockHash]
    )
  ).rows[0];
  await pool.query(
    "UPDATE metadata.publication_job SET request_key=$1 WHERE collection='base'",
    [publicationRequestKey(oldInput)]
  );
  assert.equal(await publishedCount(), 0);
  assert.deepEqual(await backfillNativeBaseMetadataProvenance(pool, 1), {
    stamped: 1
  });
  assert.equal(await publishedCount(), 1);
  assert.equal(
    await enqueueNativeBasePublications(pool, readSchema, 1),
    0,
    "proven migration must not republish an unchanged historical card"
  );
  passed.push(
    "archive publisher stores inclusion hash; missing proof withheld; bounded two-journal provenance backfill"
  );
  passed.push(
    "bounded recent-event publication queue bypasses a delayed full sweep and preserves idempotent leases"
  );

  await pool.query(
    `INSERT INTO metadata_projection.generation(source_mode,metadata_release_id,state,ownership_release_id,ownership_read_identity)
    VALUES('archive',$1,'ready',$2,$3)`,
    [archiveRelease, releaseId, candidate.identity]
  );
  await pool.query(
    "UPDATE metadata_projection.active SET current_id=1 WHERE singleton"
  );
  await pool.query(`INSERT INTO metadata_projection.search(generation_id,collection,token_id,lifecycle,metadata_available,updated_at)
    VALUES(1,'base',1,1,true,now())`);
  await pool.query(`INSERT INTO metadata_projection.revision(generation_id,collection,token_id,lifecycle,metadata_content_hash)
    SELECT 1,collection,token_id,lifecycle,content_hash FROM metadata.token_metadata WHERE collection='base'`);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await installReadCache(db);
    await db.query("COMMIT");
    await buildReadCache(db, "1", "base");
  } finally {
    db.release();
  }
  const cacheFresh = async () =>
    (await pool.query(`SELECT ${readCacheFreshSql("1", ["base"])} AS fresh`))
      .rows[0].fresh;
  const epoch = async () =>
    (
      await pool.query(
        "SELECT revision FROM metadata_projection.read_epoch WHERE collection='base'"
      )
    ).rows[0].revision;
  assert.equal(await cacheFresh(), true);
  const { app } = await import("../lib/api/server.ts");
  apiPools = await import("../lib/offchain/db.ts");
  const apiCount = async () => {
    const response = await app.request(
      "/v1/tokens?chain=base&metadata=available"
    );
    assert.equal(response.status, 200);
    return (await response.json()).total;
  };
  assert.equal(await apiCount(), 1);
  const beforeQuiet = await epoch();
  await pool.query(
    "UPDATE metadata_source.native_base_metadata_state SET checked_at=now()-interval '61 seconds'"
  );
  assert.equal((await refreshNativeBaseMetadata(pool, rpc)).checked, true);
  assert.equal(await epoch(), beforeQuiet);
  assert.equal(await cacheFresh(), true);
  const update = {
    ...mint,
    eventName: "Update",
    transactionHash: hash(1001),
    blockNumber: String(head - 5n),
    blockHash: hash(8453n * 10n ** 18n + head - 5n)
  };
  await insertNative(update);
  assert.equal(await probe(), false);
  assert.notEqual(await epoch(), beforeQuiet);
  await assert.rejects(cacheFresh(), (error) => error.code === "YI001");
  assert.equal((await refreshNativeBaseMetadata(pool, rpc)).checked, true);
  assert.equal(await cacheFresh(), false);
  assert.equal(await publishedCount(), 0);
  assert.equal(
    await apiCount(),
    0,
    "same-head approval cannot reuse the earlier published count"
  );
  assert.equal(await publishBase(), "published");
  assert.equal(await publishedCount(), 1);
  assert.equal(
    await apiCount(),
    1,
    "same-head publication refresh must invalidate the earlier unavailable count"
  );
  assert.equal(
    (await basePublicationState(pool, "1", mint.transactionHash)).eventKey,
    `${update.transactionHash}:${update.logIndex}`
  );
  const afterUpdate = await epoch();
  const revisionCount = (
    await pool.query(
      "SELECT count(*)::int AS n FROM metadata_source.render_revision"
    )
  ).rows[0].n;
  // Same transaction/log in a replacement block must not reuse its previous
  // publication, even though its event key is unchanged.
  await pool.query(
    `UPDATE ${schema}.canonical_event SET block_hash=$1 WHERE id=$2`,
    [hash(2222), nativeRow(update).id]
  );
  assert.equal(await probe(), false);
  await refreshNativeBaseMetadata(pool, rpc);
  assert.equal(await publishedCount(), 0);
  assert.notEqual(await epoch(), afterUpdate);
  assert.equal(await publishBase(), "published");
  assert.equal(await publishedCount(), 1);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM metadata_source.render_revision"
      )
    ).rows[0].n,
    revisionCount
  );
  await pool.query(`DELETE FROM ${schema}.canonical_event WHERE id=$1`, [
    nativeRow(update).id
  ]);
  assert.equal(await probe(), false);
  await refreshNativeBaseMetadata(pool, rpc);
  assert.equal(await publishedCount(), 0);
  assert.equal(await publishBase(), "published");
  assert.equal(await publishedCount(), 1);
  passed.push(
    "cache invalidated by metadata events and approval; quiet checks preserve cache; rollback and same-key re-inclusion require fresh publication"
  );

  await pool.query(
    "UPDATE metadata_source.native_base_metadata_state SET checked_at=now()-interval '91 seconds'"
  );
  assert.equal(await probe(), false);
  implementation = "0x" + "f".repeat(40);
  await assert.rejects(refreshNativeBaseMetadata(pool, rpc), /ABI review/);
  assert.equal(
    (
      await pool.query(
        "SELECT state FROM metadata_source.native_base_metadata_state"
      )
    ).rows[0].state,
    "blocked"
  );
  assert.equal(await probe(), false);
  assert.equal(
    (
      await pool.query(
        `SELECT count(*)::int AS n FROM ${metadataReadRelationFor(`"${readSchema}"`, false, ["bnb"])} p`
      )
    ).rows[0].n,
    0
  );
  assert.equal(
    (
      await pool.query(
        `SELECT count(*)::int AS n FROM ${metadataReadRelation} p WHERE collection='bnb'`
      )
    ).rows[0].n,
    0
  );
  assert.equal((await app.request("/v1/tokens?chain=base")).status, 503);
  assert.equal((await app.request("/v1/tokens?chain=bnb")).status, 200);
  implementation = approvedBaseMetadataImplementation;
  await refreshNativeBaseMetadata(pool, rpc);
  assert.equal(await probe(), true);
  const changed = {
    ...update,
    transactionHash: hash(1002),
    traits: { ...traits, color: 9 }
  };
  await insertNative(changed);
  await refreshNativeBaseMetadata(pool, rpc);
  assert.equal(await publishBase(), "reconciliation_required");
  assert.equal(await publishedCount(), 0);
  passed.push(
    "expired or unapproved code blocks Base; BNB remains available; tuple changes stay quarantined"
  );

  const role = "yunipals_unified_ownership_test_reader";
  await pool.query(
    `GRANT USAGE ON SCHEMA ${readSchema},metadata_source TO ${role}`
  );
  await pool.query(
    `GRANT SELECT ON ${readSchema}.base_metadata_event,${readSchema}.base_metadata_scan,
      metadata_source.native_base_metadata_state,metadata_source.chain_metadata_scan TO ${role}`
  );
  await pool.query(
    `GRANT EXECUTE ON FUNCTION ${readSchema}.source_boundary(text),${readSchema}.base_metadata_frame(boolean),${readSchema}.base_metadata_probe() TO ${role}`
  );
  const limited = await pool.connect();
  try {
    await limited.query(`SET ROLE ${role}`);
    assert.equal(
      (
        await limited.query(
          `SELECT token_id FROM ${readSchema}.base_metadata_event WHERE token_id='1' ORDER BY block_number LIMIT 1`
        )
      ).rows[0].token_id,
      "1"
    );
    await assert.rejects(
      limited.query(
        "UPDATE metadata_source.native_base_metadata_state SET state='ready'"
      ),
      (error) => error.code === "42501"
    );
  } finally {
    await limited.query("RESET ROLE");
    limited.release();
  }
  const planner = await pool.connect();
  let plan;
  try {
    await planner.query("BEGIN");
    await planner.query("SET LOCAL enable_seqscan=off");
    plan = (
      await planner.query(
        `EXPLAIN(FORMAT JSON) SELECT * FROM ${readSchema}.base_metadata_event WHERE token_id='1' ORDER BY block_number DESC LIMIT 1`
      )
    ).rows[0]["QUERY PLAN"];
    await planner.query("ROLLBACK");
  } finally {
    planner.release();
  }
  assert.match(JSON.stringify(plan), /Index Cond[^}]*tokenId/);
  passed.push(
    "read role can use views without writes; token predicate reaches the Ponder JSON expression index"
  );
  console.log(
    JSON.stringify({
      event: "native_base_metadata_postgres_ok",
      passed,
      frameworkRollback:
        "covered separately by pinned Ponder dependency fixture; this fixture exercises post-rollback reader state",
      externalNetworkRequests: 0
    })
  );
} finally {
  globalThis.fetch = originalFetch;
  await apiPools?.apiPool.end();
  await apiPools?.pool.end();
  await pool.end();
}
