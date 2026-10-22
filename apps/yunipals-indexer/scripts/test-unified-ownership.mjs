import assert from "node:assert/strict";
import pg from "pg";
import { toHex } from "viem";
import { createIndexerReader } from "../../../packages/yunipals-indexer-server/src/readers.ts";
import { readOwnershipToken } from "../../../packages/yunipals-indexer-server/src/ownership.ts";
import {
  collections,
  indexedCollections,
  ZERO_ADDRESS
} from "../lib/constants.ts";
import { transferState, transferEventId } from "../lib/ownership/transfer.ts";
import { migrateIndexerControl } from "../lib/unified/control-schema.ts";
import { registerIndexerRelease } from "../lib/unified/releases.ts";
import { observeIndexerChain } from "../lib/unified/observer.ts";
import { createOwnershipReadViews } from "../lib/unified/ownership-views.ts";
import { ownershipReadDefinitions } from "../lib/unified/ownership-config.ts";
import {
  buildSourceManifest,
  sourceManifestHash
} from "../lib/unified/sources.ts";

const connectionString = process.env.PONDER_UNIFIED_TEST_DATABASE_URL;
assert.ok(connectionString, "PONDER_UNIFIED_TEST_DATABASE_URL is required");
const url = new URL(connectionString);
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
assert.equal(url.pathname, "/yunipals_ponder_dependency_test");
assert.equal(url.search, "");
const pool = new pg.Pool({ connectionString, max: 5 });
const schema = "unified_ownership_test",
  readSchema = "unified_ownership_read_test",
  buildId = "unified-ownership-test";
const includeBaseIslands =
  process.env.UNIFIED_TEST_BASE_ISLANDS_V2_ENABLED === "true";
const includeArena = process.env.UNIFIED_TEST_ARENA_ENABLED === "true";
const manifest = buildSourceManifest({
  UNIFIED_BASE_ISLANDS_V2_ENABLED: String(includeBaseIslands),
  ...(includeArena
    ? { ARENA_CONTRACT: `0x${"12".repeat(20)}`, ARENA_DEPLOYMENT_BLOCK: "100" }
    : {})
});
const baseHead = 60_000_000n;
let head = baseHead,
  finalityUnavailable = false;
const alice = `0x${"12".repeat(20)}`,
  bob = `0x${"34".repeat(20)}`,
  carol = `0x${"56".repeat(20)}`;
const hash = (chain, number) =>
  toHex(BigInt(chain) * 10n ** 18n + number, { size: 32 });
const checkpoint = (chain, number) =>
  `0000001000${String(chain).padStart(16, "0")}${String(number).padStart(16, "0")}${"9".repeat(33)}`;
const history = [];
const current = new Map();
const transfers = [];
let eventNumber = 1;
const definition = {
  collection: "bnb",
  sourceId: "ownership:bnb",
  policy: { kind: "depth", subsequentBlocks: 20 }
};

function rpc(chain) {
  return {
    providerId: "local-ownership-test",
    chainId: async () => chain,
    block: async (tag) => {
      if (tag === "finalized" && finalityUnavailable)
        throw new Error("No finalized observation");
      const number =
        tag === "latest" ? head : tag === "finalized" ? head - 30n : tag;
      return {
        number,
        hash: hash(chain, number),
        parentHash: hash(chain, number - 1n),
        timestamp: BigInt(Math.floor(Date.now() / 1000))
      };
    }
  };
}
async function witness(chain) {
  const names = { 1: "mainnet", 56: "bnb", 137: "polygon", 8453: "base" };
  await pool.query(
    `INSERT INTO ${schema}._ponder_checkpoint VALUES($1,$2,$3,$3,$4)
    ON CONFLICT(chain_name) DO UPDATE SET latest_checkpoint=$3,safe_checkpoint=$3,finalized_checkpoint=$4`,
    [
      names[chain],
      chain,
      checkpoint(chain, head),
      checkpoint(chain, head - 30n)
    ]
  );
  const timestamp = String(Math.floor(Date.now() / 1000));
  await pool.query(
    `INSERT INTO ${schema}.chain_checkpoint VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(id) DO UPDATE SET block_number=$3,block_hash=$4,parent_hash=$5,timestamp=$6`,
    [
      String(chain),
      chain,
      String(head),
      hash(chain, head),
      hash(chain, head - 1n),
      timestamp
    ]
  );
  for (let number = head - 50n; number <= head; number++)
    await pool.query(
      `INSERT INTO ${schema}.chain_block VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING`,
      [
        `${chain}:${number}`,
        chain,
        String(number),
        hash(chain, number),
        hash(chain, number - 1n),
        timestamp
      ]
    );
  await pool.query(
    `UPDATE ${schema}._ponder_meta SET value=jsonb_set(value,'{heartbeat_at}',$1::jsonb) WHERE key='app'`,
    [String(Date.now())]
  );
}
async function transfer(
  collection,
  tokenId,
  from,
  to,
  number,
  transactionIndex = 0,
  logIndex = eventNumber
) {
  const config = indexedCollections[collection],
    key = `${collection}:${tokenId}`;
  const old = current.get(key);
  const timestamp = number + 1000n,
    tx = hash(config.chainId, BigInt(10_000 + eventNumber++));
  const next = transferState(old ?? null, from, to, { number, timestamp });
  const token = {
    collection,
    chain_id: config.chainId,
    contract_address: config.address,
    token_id: tokenId,
    owner: to,
    burned: next.isBurn,
    lifecycle: next.lifecycle,
    mint_block: String(next.mintBlock),
    mint_timestamp: String(next.mintTimestamp),
    last_transfer_block: String(number),
    last_transfer_timestamp: String(timestamp),
    last_transaction_hash: tx
  };
  current.set(key, { ...next });
  history.push({ number, transactionIndex, logIndex, token });
  if (next.isMint)
    await pool.query(
      `INSERT INTO ${schema}.token_lifecycle
    (collection,token_id,lifecycle,minted_to,mint_block,mint_timestamp,mint_transaction_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        collection,
        tokenId,
        next.lifecycle,
        to,
        String(number),
        String(timestamp),
        tx
      ]
    );
  if (next.isBurn)
    await pool.query(
      `UPDATE ${schema}.token_lifecycle SET burned_at_block=$4,burned_at_timestamp=$5,burn_transaction_hash=$6
    WHERE collection=$1 AND token_id=$2 AND lifecycle=$3`,
      [
        collection,
        tokenId,
        next.lifecycle,
        String(number),
        String(timestamp),
        tx
      ]
    );
  await pool.query(
    `INSERT INTO ${schema}.token VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT(collection,token_id) DO UPDATE SET owner=$5,burned=$6,lifecycle=$7,mint_block=$8,mint_timestamp=$9,
      last_transfer_block=$10,last_transfer_timestamp=$11,last_transaction_hash=$12`,
    Object.values(token)
  );
  const legacyId = transferEventId(collection, tx, logIndex);
  const event = {
    id: legacyId,
    collection,
    chain_id: config.chainId,
    contract_address: config.address,
    token_id: tokenId,
    lifecycle: next.lifecycle,
    from,
    to,
    block_number: String(number),
    block_timestamp: String(timestamp),
    transaction_hash: tx,
    transaction_index: transactionIndex,
    log_index: logIndex
  };
  transfers.push(event);
  await pool.query(
    `INSERT INTO ${schema}.transfer_event VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    Object.values(event)
  );
  const sourceId =
    collection === "ethereum-islands"
      ? "islands:ethereum"
      : collection === "base-islands-v2"
        ? "islands:base:v2"
        : `ownership:${collection}`;
  const source = manifest.sources.find((source) => source.id === sourceId);
  await pool.query(
    `INSERT INTO ${schema}.canonical_event VALUES($1,$2,$3,$4,'Transfer',$5,$6,$7,$8,$9,$10,$11,$12,'[]','0x')`,
    [
      `${config.chainId}:${config.address}:${tx}:${logIndex}`,
      sourceId,
      config.chainId,
      config.address,
      JSON.stringify({ from, to, tokenId }),
      source.abiHash,
      String(number),
      hash(config.chainId, number),
      String(timestamp),
      tx,
      transactionIndex,
      logIndex
    ]
  );
}
const tokens = async (collection) =>
  (
    await pool.query(
      `SELECT * FROM ${readSchema}.token WHERE collection=$1 ORDER BY token_id::numeric`,
      [collection]
    )
  ).rows;
function expected(collection, through) {
  const state = new Map();
  for (const event of history
    .filter(
      (event) =>
        event.token.collection === collection && event.number <= through
    )
    .sort((a, b) =>
      a.number < b.number
        ? -1
        : a.number > b.number
          ? 1
          : a.transactionIndex - b.transactionIndex || a.logIndex - b.logIndex
    ))
    state.set(event.token.token_id, event.token);
  return [...state.values()].sort((a, b) =>
    BigInt(a.token_id) < BigInt(b.token_id) ? -1 : 1
  );
}
async function sourceError(task, reason) {
  await assert.rejects(
    task,
    (error) =>
      error.code === "YI001" && (!reason || error.detail.includes(reason))
  );
}

try {
  assert.ok(
    (
      await pool.query(
        "SELECT to_regclass('dependency_check.chain_block') AS source"
      )
    ).rows[0].source,
    "Run test:ponder:postgres first."
  );
  for (const value of [readSchema, "unified_ownership_finalized_test", schema])
    await pool.query(`DROP SCHEMA IF EXISTS ${value} CASCADE`);
  await pool.query(`CREATE SCHEMA ${schema}`);
  for (const table of [
    "_ponder_meta",
    "_ponder_checkpoint",
    "indexer_source",
    "canonical_event",
    "transaction_candidate",
    "chain_checkpoint",
    "chain_block",
    "token",
    "token_lifecycle",
    "transfer_event",
    "admin_role_event",
    "contract_owner_event",
    "arena_tournament",
    "arena_seat",
    "arena_credit"
  ])
    await pool.query(
      `CREATE TABLE ${schema}.${table} (LIKE dependency_check.${table} INCLUDING ALL)`
    );
  await pool.query(`INSERT INTO ${schema}._ponder_meta VALUES('app',$1)`, [
    JSON.stringify({
      version: "6",
      build_id: buildId,
      heartbeat_at: Date.now(),
      is_ready: 1,
      is_locked: 1,
      is_dev: 0
    })
  ]);
  for (const source of manifest.sources)
    await pool.query(
      `INSERT INTO ${schema}.indexer_source VALUES($1,$2,$3,$4)`,
      [
        source.id,
        source.chainId,
        sourceManifestHash(manifest),
        JSON.stringify(source)
      ]
    );
  await migrateIndexerControl(pool);
  await pool.query(
    "DELETE FROM yunipals_indexer_control.chain_anchor WHERE release_id=(SELECT id FROM yunipals_indexer_control.release WHERE physical_schema=$1)",
    [schema]
  );
  await pool.query(
    "DELETE FROM yunipals_indexer_control.chain_status WHERE release_id=(SELECT id FROM yunipals_indexer_control.release WHERE physical_schema=$1)",
    [schema]
  );
  // This guarded fixture recreates its physical schema; release reassignment is
  // still forbidden in the runtime and by the production registration command.
  await pool.query(
    "DELETE FROM yunipals_indexer_control.release WHERE physical_schema=$1",
    [schema]
  );
  const release = await registerIndexerRelease(pool, {
    schema,
    buildId,
    manifest
  });
  const definitions = ownershipReadDefinitions(release);
  assert.deepEqual(
    definitions.find((row) => row.collection === "bnb"),
    definition
  );
  await witness(56);
  assert.equal(
    await observeIndexerChain(pool, release, 56, rpc(56)),
    "observed"
  );
  assert.equal(
    (await createOwnershipReadViews(pool, release, readSchema, definitions))
      .activated,
    false
  );
  assert.equal(
    (await createOwnershipReadViews(pool, release, readSchema, definitions))
      .created,
    false
  );
  await assert.rejects(
    createOwnershipReadViews(pool, release, readSchema, [definition]),
    /cannot be reassigned/
  );
  await assert.rejects(
    createOwnershipReadViews(pool, release, "public", definitions),
    /without a unified read identity/
  );
  const reader = await createIndexerReader(pool, { releaseId: release.id });
  // Mint the initial lifecycles before their later burns/remints.
  for (const id of ["1", "2", "3", "5", "6", "7"])
    await transfer("bnb", id, ZERO_ADDRESS, alice, baseHead - 100n);
  await transfer("bnb", "3", alice, ZERO_ADDRESS, baseHead - 40n);
  await transfer("bnb", "6", alice, bob, baseHead - 35n);
  await transfer("bnb", "1", alice, bob, baseHead - 25n);
  await transfer("bnb", "5", alice, bob, baseHead - 20n, 1, 101);
  await transfer("bnb", "5", bob, carol, baseHead - 20n, 1, 102);
  await transfer("bnb", "5", carol, alice, baseHead - 20n, 2, 103);
  await transfer("bnb", "2", alice, ZERO_ADDRESS, baseHead - 10n);
  await transfer("bnb", "1", bob, carol, baseHead - 5n);
  await transfer("bnb", "3", ZERO_ADDRESS, carol, baseHead - 5n);
  await transfer("bnb", "4", ZERO_ADDRESS, alice, baseHead - 5n);
  await transfer("bnb", "6", bob, alice, baseHead - 4n);
  await transfer("bnb", "7", alice, alice, baseHead - 3n);
  await transfer("bnb", "5", alice, bob, baseHead - 1n);
  await transfer("ethereum", "1", ZERO_ADDRESS, carol, baseHead - 50n);
  await transfer("ethereum-islands", "1", ZERO_ADDRESS, bob, baseHead - 50n);
  await transfer("base", "1", ZERO_ADDRESS, alice, baseHead - 50n);
  await transfer("polygon", "1", ZERO_ADDRESS, bob, baseHead - 50n);
  if (includeBaseIslands) {
    await transfer("base-islands-v2", "1", ZERO_ADDRESS, alice, baseHead - 50n);
    await transfer("base-islands-v2", "1", alice, bob, baseHead - 2n);
    await witness(8453);
    await observeIndexerChain(pool, release, 8453, rpc(8453));
    const baseDefinition = definitions.find(
      (row) => row.collection === "base-islands-v2"
    );
    assert.deepEqual(baseDefinition.policy, { kind: "latest" });
    assert.equal((await tokens("base-islands-v2"))[0].owner, bob);
    assert.equal(
      (
        await readOwnershipToken(
          reader,
          { ...baseDefinition, policy: { kind: "depth", subsequentBlocks: 3 } },
          "1"
        )
      ).token.owner,
      alice
    );
  }
  for (const [granted, number] of [
    [true, baseHead - 35n],
    [false, baseHead - 2n]
  ]) {
    await pool.query(
      `INSERT INTO ${schema}.admin_role_event VALUES($1,'bnb',56,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        `bnb:${hash(56, number)}:0`,
        collections.bnb.address,
        hash(0, 0n),
        alice,
        bob,
        granted,
        String(number),
        hash(56, number),
        0
      ]
    );
  }

  // Other source observations are intentionally absent. Filter pushdown must
  // isolate BNB instead of invoking unavailable sources as empty/healthy data.
  assert.deepEqual(await tokens("bnb"), expected("bnb", baseHead - 20n));
  assert.deepEqual(
    (
      await pool.query(
        `SELECT granted FROM ${readSchema}.admin_role_event WHERE collection='bnb' ORDER BY block_number`
      )
    ).rows,
    [{ granted: true }]
  );
  assert.equal(
    (
      await pool.query(
        `SELECT owner FROM ${readSchema}.token WHERE collection='bnb' AND owner=$1 AND token_id='1'`,
        [bob]
      )
    ).rows[0].owner,
    bob
  );
  assert.equal(
    (
      await pool.query(
        `SELECT * FROM ${readSchema}.source_status WHERE collection='bnb'`
      )
    ).rows[0].policy,
    "depth:20"
  );
  await sourceError(
    pool.query(`SELECT * FROM ${readSchema}.token WHERE collection='ethereum'`),
    "source_unavailable"
  );
  const initial = await readOwnershipToken(reader, definition, "1");
  await assert.rejects(
    readOwnershipToken(reader, { ...definition, collection: "base" }, "1"),
    /Invalid ownership read source/
  );
  const readRole = "yunipals_unified_ownership_test_reader";
  if (
    !(await pool.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [readRole]))
      .rowCount
  )
    await pool.query(
      `CREATE ROLE ${readRole} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`
    );
  await pool.query(
    `GRANT USAGE ON SCHEMA ${schema},${readSchema},yunipals_indexer_control TO ${readRole}`
  );
  await pool.query(`GRANT SELECT ON ${schema}._ponder_meta,${schema}._ponder_checkpoint,${schema}.indexer_source,
    ${schema}.chain_block,${schema}.token,${schema}.token_lifecycle,${schema}.transfer_event,${schema}.canonical_event,
    yunipals_indexer_control.release,yunipals_indexer_control.chain_status,yunipals_indexer_control.chain_anchor TO ${readRole}`);
  await pool.query(`GRANT SELECT ON ${readSchema}.token,${readSchema}.token_lifecycle,${readSchema}.transfer_event,
    ${readSchema}.source_status,${readSchema}._unified_read_release TO ${readRole}`);
  await pool.query(
    `GRANT EXECUTE ON FUNCTION ${readSchema}.source_boundary(text),${readSchema}.source_probe(text) TO ${readRole}`
  );
  const limited = await pool.connect();
  try {
    await limited.query(`SET ROLE ${readRole}`);
    assert.equal(
      (
        await limited.query(
          `SELECT (${readSchema}.source_probe('bnb')->>'available')::boolean AS available`
        )
      ).rows[0].available,
      true
    );
    assert.equal(
      (
        await limited.query(
          `SELECT release_id FROM ${readSchema}._unified_read_release`
        )
      ).rows[0].release_id,
      release.id
    );
    assert.equal(
      (
        await limited.query(
          `SELECT owner FROM ${readSchema}.token WHERE collection='bnb' AND token_id='1'`
        )
      ).rows[0].owner,
      bob
    );
    await assert.rejects(
      limited.query(
        `UPDATE ${schema}.token SET owner=owner WHERE collection='bnb'`
      ),
      (error) => error.code === "42501"
    );
    await assert.rejects(
      limited.query(
        `UPDATE yunipals_indexer_control.chain_status SET halted=false`
      ),
      (error) => error.code === "42501"
    );
  } finally {
    await limited.query("RESET ROLE");
    limited.release();
  }
  assert.equal(initial.token.owner, bob);
  assert.equal(initial.anchor.number, String(baseHead - 20n));
  assert.equal((await readOwnershipToken(reader, definition, "4")).token, null);
  assert.equal(
    (await readOwnershipToken(reader, definition, "2")).token.burned,
    false
  );
  assert.equal(
    (await readOwnershipToken(reader, definition, "3")).token.lifecycle,
    1
  );
  assert.equal(
    (await readOwnershipToken(reader, definition, "3")).token.burned,
    true
  );
  const sameBlock = await readOwnershipToken(reader, definition, "5");
  assert.equal(sameBlock.token.owner, alice);
  assert.equal(sameBlock.token.event_transaction_index, 2);
  assert.equal(sameBlock.token.event_log_index, 103);
  const lifecycle = (
    await pool.query(
      `SELECT * FROM ${readSchema}.token_lifecycle WHERE collection='bnb' ORDER BY token_id,lifecycle`
    )
  ).rows;
  assert.equal(
    lifecycle.find((row) => row.token_id === "2").burned_at_block,
    null
  );
  assert.equal(lifecycle.filter((row) => row.token_id === "3").length, 1);
  assert.equal(
    lifecycle.find((row) => row.token_id === "3").burned_at_block,
    String(baseHead - 40n)
  );
  assert.deepEqual(
    (
      await pool.query(
        `SELECT * FROM ${readSchema}.transfer_event WHERE collection='bnb' ORDER BY block_number,transaction_index,log_index`
      )
    ).rows,
    transfers
      .filter(
        (row) =>
          row.collection === "bnb" && BigInt(row.block_number) <= baseHead - 20n
      )
      .sort((a, b) =>
        BigInt(a.block_number) < BigInt(b.block_number)
          ? -1
          : BigInt(a.block_number) > BigInt(b.block_number)
            ? 1
            : a.transaction_index - b.transaction_index ||
              a.log_index - b.log_index
      )
  );

  // Later events indexed before the observer must not spuriously make a
  // verified earlier snapshot unavailable.
  await pool.query(
    `UPDATE ${schema}._ponder_checkpoint SET latest_checkpoint=$1 WHERE chain_id=56`,
    [checkpoint(56, head + 1n)]
  );
  assert.equal(
    (await tokens("bnb")).find((row) => row.token_id === "1").owner,
    bob
  );
  await witness(56);
  // A partial checkpoint does not establish completion of its own block.
  const partial =
    checkpoint(56, head - 20n).slice(0, 42) +
    "0".repeat(16) +
    "5" +
    "0".repeat(16);
  await pool.query(
    `UPDATE ${schema}._ponder_checkpoint SET latest_checkpoint=$1 WHERE chain_id=56`,
    [partial]
  );
  await observeIndexerChain(pool, release, 56, rpc(56));
  const partialStatus = (
    await pool.query(
      `SELECT * FROM ${readSchema}.source_status WHERE collection='bnb'`
    )
  ).rows[0];
  assert.equal(partialStatus.block_number, String(head - 21n));
  assert.equal(partialStatus.ready, false);
  assert.deepEqual(await tokens("bnb"), expected("bnb", head - 21n));
  await assert.rejects(
    readOwnershipToken(reader, definition, "1", { requireReady: true }),
    /catching_up/
  );
  await witness(56);
  await observeIndexerChain(pool, release, 56, rpc(56));
  finalityUnavailable = true;
  await observeIndexerChain(pool, release, 56, rpc(56));
  assert.equal(
    (await tokens("bnb")).find((row) => row.token_id === "1").owner,
    bob
  );
  await createOwnershipReadViews(
    pool,
    release,
    "unified_ownership_finalized_test",
    [{ ...definition, policy: { kind: "finalized" } }]
  );
  await sourceError(
    pool.query("SELECT * FROM unified_ownership_finalized_test.token"),
    "finality_unavailable"
  );
  finalityUnavailable = false;
  await observeIndexerChain(pool, release, 56, rpc(56));
  assert.deepEqual(
    (
      await pool.query(
        "SELECT * FROM unified_ownership_finalized_test.token ORDER BY token_id::numeric"
      )
    ).rows,
    expected("bnb", baseHead - 30n)
  );

  for (const offset of [10n, 15n, 20n, 100n]) {
    head = baseHead + offset;
    await witness(56);
    await observeIndexerChain(pool, release, 56, rpc(56));
    assert.deepEqual(await tokens("bnb"), expected("bnb", head - 20n));
    assert.equal(
      (await readOwnershipToken(reader, definition, "1")).token.owner,
      head - 20n < baseHead - 5n ? bob : carol
    );
  }
  assert.equal(
    (await readOwnershipToken(reader, definition, "3")).token.lifecycle,
    2
  );
  assert.equal(
    (await readOwnershipToken(reader, definition, "4")).token.owner,
    alice
  );
  assert.equal((await tokens("bnb")).length, 7);
  assert.deepEqual(
    (
      await pool.query(
        `SELECT granted FROM ${readSchema}.admin_role_event WHERE collection='bnb' ORDER BY block_number`
      )
    ).rows,
    [{ granted: true }, { granted: false }]
  );

  // A missing canonical journal proof fails the point read even when the
  // native token/lifecycle rows are still present.
  const tx = (await readOwnershipToken(reader, definition, "1")).token
    .last_transaction_hash;
  const saved = (
    await pool.query(
      `DELETE FROM ${schema}.canonical_event WHERE transaction_hash=$1 RETURNING *`,
      [tx]
    )
  ).rows[0];
  await assert.rejects(
    readOwnershipToken(reader, definition, "1"),
    /proof is incomplete/
  );
  await pool.query(
    `INSERT INTO ${schema}.canonical_event SELECT * FROM json_populate_record(NULL::${schema}.canonical_event,$1::json)`,
    [JSON.stringify(saved)]
  );

  // Scope isolation holds across numeric token collisions and stale branches.
  await witness(1);
  await observeIndexerChain(pool, release, 1, rpc(1));
  for (const chain of [8453, 137]) {
    await witness(chain);
    await observeIndexerChain(pool, release, chain, rpc(chain));
  }
  assert.equal((await tokens("ethereum"))[0].owner, carol);
  assert.equal((await tokens("ethereum-islands"))[0].owner, bob);
  await assert.rejects(
    readOwnershipToken(
      reader,
      {
        collection: "ethereum",
        sourceId: "islands:ethereum",
        policy: { kind: "latest" }
      },
      "1"
    ),
    /Invalid ownership read source/
  );
  assert.equal((await tokens("base"))[0].owner, alice);
  assert.equal((await tokens("polygon"))[0].owner, bob);
  if (includeBaseIslands) {
    assert.equal((await tokens("base-islands-v2"))[0].owner, bob);
  }
  assert.equal(
    (
      await pool.query(
        `SELECT count(*)::integer AS count FROM ${readSchema}.token`
      )
    ).rows[0].count,
    11 + Number(includeBaseIslands)
  );
  // Empty results become a healthy empty collection only after a source proof;
  // data-only SQL can be optimized without executing a join on an empty table.
  await pool.query(`DELETE FROM ${schema}.token WHERE collection='polygon'`);
  await pool.query(
    `DELETE FROM ${schema}.token_lifecycle WHERE collection='polygon'`
  );
  await pool.query(
    `DELETE FROM ${schema}.transfer_event WHERE collection='polygon'`
  );
  await pool.query(
    `DELETE FROM ${schema}.canonical_event WHERE source_id='ownership:polygon'`
  );
  assert.equal((await tokens("polygon")).length, 0);
  assert.equal(
    (
      await pool.query(
        `SELECT ready FROM ${readSchema}.source_status WHERE collection='polygon'`
      )
    ).rows[0].ready,
    true
  );
  assert.equal(
    (
      await readOwnershipToken(
        reader,
        {
          collection: "polygon",
          sourceId: "ownership:polygon",
          policy: { kind: "latest" }
        },
        "1"
      )
    ).token,
    null
  );
  await pool.query(
    "UPDATE yunipals_indexer_control.chain_status SET error_code='fixture_unavailable' WHERE release_id=$1 AND chain_id=137",
    [release.id]
  );
  await sourceError(
    pool.query(
      `SELECT * FROM ${readSchema}.source_status WHERE collection='polygon'`
    ),
    "source_unavailable"
  );
  await assert.rejects(
    readOwnershipToken(
      reader,
      {
        collection: "polygon",
        sourceId: "ownership:polygon",
        policy: { kind: "latest" }
      },
      "1"
    ),
    /fixture_unavailable/
  );
  await observeIndexerChain(pool, release, 137, rpc(137));
  const witnessHash = hash(56, head);
  await pool.query(
    `UPDATE ${schema}.chain_block SET block_hash=$1 WHERE chain_id=56 AND block_number=$2`,
    [hash(56, head + 999n), String(head)]
  );
  await sourceError(
    pool.query(`SELECT * FROM ${readSchema}.token WHERE collection='bnb'`),
    "witness_unverified"
  );
  assert.equal((await tokens("ethereum"))[0].owner, carol);
  await pool.query(
    `UPDATE ${schema}.chain_block SET block_hash=$1 WHERE chain_id=56 AND block_number=$2`,
    [witnessHash, String(head)]
  );
  await pool.query(
    "UPDATE yunipals_indexer_control.chain_status SET observed_at_ms=$2 WHERE release_id=$1 AND chain_id=56",
    [release.id, Date.now() - 180001]
  );
  await sourceError(
    pool.query(`SELECT * FROM ${readSchema}.token WHERE collection='bnb'`),
    "source_unavailable"
  );
  await observeIndexerChain(pool, release, 56, rpc(56));
  await pool.query(
    `UPDATE ${schema}._ponder_meta SET value=value-'build_id' WHERE key='app'`
  );
  await sourceError(
    pool.query(`SELECT * FROM ${readSchema}.token WHERE collection='bnb'`),
    "runtime_unavailable"
  );
  await pool.query(
    `UPDATE ${schema}._ponder_meta SET value=jsonb_set(value,'{build_id}',$1::jsonb) WHERE key='app'`,
    [JSON.stringify(buildId)]
  );
  await pool.query(`DROP VIEW ${readSchema}.contract_owner_event`);
  await assert.rejects(
    createOwnershipReadViews(pool, release, readSchema, definitions),
    /objects are incomplete/
  );

  console.log(
    JSON.stringify({
      event: "unified_ownership_postgres_verified",
      baseIslands: includeBaseIslands
        ? "latest-and-legacy-depth-three"
        : "disabled",
      arenaEnabled: includeArena,
      checks: [
        "confirmed owner reconstruction after newer transfer/burn/remint",
        "same-block ordering, transfer away/back and self transfer",
        "future mints hidden and future lifecycle burns masked",
        "complete transfer history and retained legacy event identities",
        "confirmed role history and partial-block coverage",
        "quiet-boundary advancement and actual-finality isolation",
        "release-bound candidate views without publication or reassignment",
        "per-source failure isolation and source predicate pushdown",
        "restricted reader grants reject chain/control writes",
        "four-chain and Islands token-number collisions",
        "canonical point proofs, stale observations and orphaned witness rejection"
      ]
    })
  );
} finally {
  await pool.end();
}
